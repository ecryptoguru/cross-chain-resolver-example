import { ethers } from 'ethers';
import { FusionOrder } from '@1inch/fusion-sdk';
import { FusionOrderBuilder, CrossChainOrderConfig } from '../fusion/FusionOrderBuilder';
import { NearChainSignatures } from '../near-signatures/NearChainSignatures';

/**
 * Order status enumeration
 */
export enum OrderStatus {
  CREATED = 'created',
  PENDING = 'pending',
  MATCHED = 'matched',
  PARTIALLY_FILLED = 'partially_filled',
  FILLED = 'filled',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired',
  FAILED = 'failed'
}

/**
 * Order type enumeration
 */
export enum OrderType {
  ETH_TO_NEAR = 'eth_to_near',
  NEAR_TO_ETH = 'near_to_eth',
  ERC20_TO_NEAR = 'erc20_to_near',
  NEAR_TO_ERC20 = 'near_to_erc20'
}

/**
 * Local order representation
 */
export interface LocalOrder {
  id: string;
  hash: string;
  type: OrderType;
  status: OrderStatus;
  fusionOrder: FusionOrder;
  config: CrossChainOrderConfig;
  signature: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  
  // Cross-chain specific fields
  secretHash: string;
  secret?: string; // Only set when revealed
  timelock: number;
  
  // Execution tracking
  sourceChainTxHash?: string;
  destinationChainTxHash?: string;
  filledAmount: bigint;
  remainingAmount: bigint;
  
  // Resolver tracking
  assignedResolver?: string;
  resolverConfirmations: string[];
  
  // Error tracking
  lastError?: string;
  retryCount: number;
}

/**
 * Order matching criteria
 */
export interface OrderMatchingCriteria {
  sourceToken: string;
  destinationToken: string;
  minAmount: bigint;
  maxAmount: bigint;
  maxPriceImpact: number; // Percentage
  maxSlippage: number; // Percentage
}

/**
 * Order fill result
 */
export interface OrderFillResult {
  success: boolean;
  filledAmount: bigint;
  executionPrice: bigint;
  txHash: string;
  gasUsed: bigint;
  error?: string;
}

/**
 * Local order management system for 1inch Fusion+ cross-chain orders
 * Handles order lifecycle without relying on live 1inch APIs
 */
export class LocalOrderManager {
  private orders: Map<string, LocalOrder> = new Map();
  private ordersByHash: Map<string, string> = new Map();
  private ordersByStatus: Map<OrderStatus, Set<string>> = new Map();
  
  private fusionBuilder: FusionOrderBuilder;
  private nearSignatures: NearChainSignatures;
  private provider: ethers.Provider;
  
  // Order book for matching
  private buyOrders: Map<string, LocalOrder[]> = new Map(); // token -> orders
  private sellOrders: Map<string, LocalOrder[]> = new Map(); // token -> orders

  constructor(
    fusionBuilder: FusionOrderBuilder,
    nearSignatures: NearChainSignatures,
    provider: ethers.Provider
  ) {
    this.fusionBuilder = fusionBuilder;
    this.nearSignatures = nearSignatures;
    this.provider = provider;
    
    // Initialize order status tracking
    Object.values(OrderStatus).forEach(status => {
      this.ordersByStatus.set(status, new Set());
    });
    
    // Start background processes
    this.startOrderProcessing();
  }

  /**
   * Create a new cross-chain order
   */
  async createOrder(config: CrossChainOrderConfig): Promise<LocalOrder> {
    try {
      // Create Fusion+ meta-order
      const fusionOrder = await this.fusionBuilder.createCrossChainOrder(config);
      
      // Sign the order using NEAR Chain Signatures
      const signature = await this.nearSignatures.signFusionOrder(fusionOrder);
      
      // Get order hash for tracking
      const orderHash = await this.fusionBuilder.getOrderHash(fusionOrder);
      
      // Determine order type
      const orderType = this.determineOrderType(config);
      
      // Create local order record
      const order: LocalOrder = {
        id: this.generateOrderId(),
        hash: orderHash,
        type: orderType,
        status: OrderStatus.CREATED,
        fusionOrder,
        config,
        signature,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        expiresAt: config.timelock * 1000,
        secretHash: config.secretHash,
        timelock: config.timelock,
        filledAmount: 0n,
        remainingAmount: config.sourceAmount,
        resolverConfirmations: [],
        retryCount: 0
      };
      
      // Store the order
      this.orders.set(order.id, order);
      this.ordersByHash.set(order.hash, order.id);
      this.addToStatusIndex(order.id, OrderStatus.CREATED);
      
      // Add to order book for matching
      this.addToOrderBook(order);
      
      console.log(`Created cross-chain order: ${order.id} (${orderType})`);
      console.log(`Order hash: ${orderHash}`);
      
      return order;
      
    } catch (error) {
      throw new Error(`Failed to create order: ${error}`);
    }
  }

  /**
   * Get order by ID
   */
  getOrder(orderId: string): LocalOrder | undefined {
    return this.orders.get(orderId);
  }

  /**
   * Get order by hash
   */
  getOrderByHash(orderHash: string): LocalOrder | undefined {
    const orderId = this.ordersByHash.get(orderHash);
    return orderId ? this.orders.get(orderId) : undefined;
  }

  /**
   * Get orders by status
   */
  getOrdersByStatus(status: OrderStatus): LocalOrder[] {
    const orderIds = this.ordersByStatus.get(status) || new Set();
    return Array.from(orderIds).map(id => this.orders.get(id)!).filter(Boolean);
  }

  /**
   * Get all orders
   */
  getAllOrders(): LocalOrder[] {
    return Array.from(this.orders.values());
  }

  /**
   * Update order status
   */
  updateOrderStatus(orderId: string, newStatus: OrderStatus, error?: string): void {
    const order = this.orders.get(orderId);
    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }

    const oldStatus = order.status;
    
    // Remove from old status index
    this.removeFromStatusIndex(orderId, oldStatus);
    
    // Update order
    order.status = newStatus;
    order.updatedAt = Date.now();
    if (error) {
      order.lastError = error;
    }
    
    // Add to new status index
    this.addToStatusIndex(orderId, newStatus);
    
    console.log(`Order ${orderId} status: ${oldStatus} -> ${newStatus}`);
  }

  /**
   * Cancel an order
   */
  async cancelOrder(orderId: string): Promise<void> {
    const order = this.orders.get(orderId);
    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }

    if ([OrderStatus.FILLED, OrderStatus.CANCELLED, OrderStatus.EXPIRED].includes(order.status)) {
      throw new Error(`Cannot cancel order in status: ${order.status}`);
    }

    try {
      // Remove from order book
      this.removeFromOrderBook(order);
      
      // Update status
      this.updateOrderStatus(orderId, OrderStatus.CANCELLED);
      
      console.log(`Cancelled order: ${orderId}`);
      
    } catch (error) {
      throw new Error(`Failed to cancel order: ${error}`);
    }
  }

  /**
   * Match orders in the local order book
   */
  async matchOrders(): Promise<void> {
    console.log('Running order matching...');
    
    const pendingOrders = this.getOrdersByStatus(OrderStatus.PENDING);
    
    for (const order of pendingOrders) {
      try {
        const matches = await this.findMatches(order);
        
        if (matches.length > 0) {
          await this.executeMatch(order, matches[0]); // Execute with best match
        }
        
      } catch (error) {
        console.error(`Error matching order ${order.id}:`, error);
        order.retryCount++;
        if (order.retryCount >= 3) {
          this.updateOrderStatus(order.id, OrderStatus.FAILED, `Matching failed: ${error}`);
        }
      }
    }
  }

  /**
   * Process order fills and settlements
   */
  async processOrderFills(): Promise<void> {
    console.log('Processing order fills...');
    
    const matchedOrders = this.getOrdersByStatus(OrderStatus.MATCHED);
    
    for (const order of matchedOrders) {
      try {
        const fillResult = await this.fillOrder(order);
        
        if (fillResult.success) {
          order.filledAmount += fillResult.filledAmount;
          order.remainingAmount -= fillResult.filledAmount;
          order.sourceChainTxHash = fillResult.txHash;
          
          if (order.remainingAmount === 0n) {
            this.updateOrderStatus(order.id, OrderStatus.FILLED);
          } else {
            this.updateOrderStatus(order.id, OrderStatus.PARTIALLY_FILLED);
          }
        } else {
          order.retryCount++;
          if (order.retryCount >= 3) {
            this.updateOrderStatus(order.id, OrderStatus.FAILED, fillResult.error);
          }
        }
        
      } catch (error) {
        console.error(`Error filling order ${order.id}:`, error);
        this.updateOrderStatus(order.id, OrderStatus.FAILED, `Fill failed: ${error}`);
      }
    }
  }

  /**
   * Check for expired orders
   */
  checkExpiredOrders(): void {
    const now = Date.now();
    
    for (const order of this.orders.values()) {
      if (order.status !== OrderStatus.EXPIRED && order.expiresAt < now) {
        this.updateOrderStatus(order.id, OrderStatus.EXPIRED);
        this.removeFromOrderBook(order);
      }
    }
  }

  /**
   * Get order book statistics
   */
  getOrderBookStats(): {
    totalOrders: number;
    ordersByStatus: Record<OrderStatus, number>;
    ordersByType: Record<OrderType, number>;
    totalVolume: bigint;
  } {
    const stats = {
      totalOrders: this.orders.size,
      ordersByStatus: {} as Record<OrderStatus, number>,
      ordersByType: {} as Record<OrderType, number>,
      totalVolume: 0n
    };

    // Initialize counters
    Object.values(OrderStatus).forEach(status => {
      stats.ordersByStatus[status] = 0;
    });
    Object.values(OrderType).forEach(type => {
      stats.ordersByType[type] = 0;
    });

    // Count orders
    for (const order of this.orders.values()) {
      stats.ordersByStatus[order.status]++;
      stats.ordersByType[order.type]++;
      stats.totalVolume += order.filledAmount;
    }

    return stats;
  }

  /**
   * Private helper methods
   */

  private generateOrderId(): string {
    return `order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private determineOrderType(config: CrossChainOrderConfig): OrderType {
    const isEthSource = config.sourceToken === '0x0000000000000000000000000000000000000000';
    const isNearDestination = config.destinationChain === 'NEAR';
    
    if (isEthSource && isNearDestination) {
      return OrderType.ETH_TO_NEAR;
    } else if (!isEthSource && isNearDestination) {
      return OrderType.ERC20_TO_NEAR;
    } else if (isEthSource && !isNearDestination) {
      return OrderType.NEAR_TO_ETH;
    } else {
      return OrderType.NEAR_TO_ERC20;
    }
  }

  private addToStatusIndex(orderId: string, status: OrderStatus): void {
    const statusSet = this.ordersByStatus.get(status) || new Set();
    statusSet.add(orderId);
    this.ordersByStatus.set(status, statusSet);
  }

  private removeFromStatusIndex(orderId: string, status: OrderStatus): void {
    const statusSet = this.ordersByStatus.get(status);
    if (statusSet) {
      statusSet.delete(orderId);
    }
  }

  private addToOrderBook(order: LocalOrder): void {
    const isBuyOrder = [OrderType.ETH_TO_NEAR, OrderType.ERC20_TO_NEAR].includes(order.type);
    const bookMap = isBuyOrder ? this.buyOrders : this.sellOrders;
    const tokenKey = order.config.sourceToken;
    
    const orders = bookMap.get(tokenKey) || [];
    orders.push(order);
    orders.sort((a, b) => Number(b.config.sourceAmount - a.config.sourceAmount)); // Sort by amount desc
    bookMap.set(tokenKey, orders);
    
    // Update order status to pending
    this.updateOrderStatus(order.id, OrderStatus.PENDING);
  }

  private removeFromOrderBook(order: LocalOrder): void {
    const isBuyOrder = [OrderType.ETH_TO_NEAR, OrderType.ERC20_TO_NEAR].includes(order.type);
    const bookMap = isBuyOrder ? this.buyOrders : this.sellOrders;
    const tokenKey = order.config.sourceToken;
    
    const orders = bookMap.get(tokenKey) || [];
    const filteredOrders = orders.filter(o => o.id !== order.id);
    bookMap.set(tokenKey, filteredOrders);
  }

  private async findMatches(order: LocalOrder): Promise<LocalOrder[]> {
    // Simple matching logic - in production this would be more sophisticated
    const oppositeBookMap = [OrderType.ETH_TO_NEAR, OrderType.ERC20_TO_NEAR].includes(order.type) 
      ? this.sellOrders 
      : this.buyOrders;
    
    const potentialMatches = oppositeBookMap.get(order.config.sourceToken) || [];
    
    return potentialMatches.filter(match => 
      match.status === OrderStatus.PENDING &&
      match.config.sourceAmount >= order.config.destinationAmount &&
      match.config.destinationAmount >= order.config.sourceAmount
    );
  }

  private async executeMatch(order1: LocalOrder, order2: LocalOrder): Promise<void> {
    console.log(`Matching orders: ${order1.id} <-> ${order2.id}`);
    
    // Update both orders to matched status
    this.updateOrderStatus(order1.id, OrderStatus.MATCHED);
    this.updateOrderStatus(order2.id, OrderStatus.MATCHED);
    
    // Remove from order book
    this.removeFromOrderBook(order1);
    this.removeFromOrderBook(order2);
  }

  private async fillOrder(order: LocalOrder): Promise<OrderFillResult> {
    try {
      // Mock fill execution - in production this would interact with actual contracts
      console.log(`Filling order: ${order.id}`);
      
      // Simulate transaction execution
      const mockTxHash = ethers.keccak256(ethers.toUtf8Bytes(`fill_${order.id}_${Date.now()}`));
      
      return {
        success: true,
        filledAmount: order.remainingAmount,
        executionPrice: order.config.destinationAmount,
        txHash: mockTxHash,
        gasUsed: 150000n
      };
      
    } catch (error) {
      return {
        success: false,
        filledAmount: 0n,
        executionPrice: 0n,
        txHash: '',
        gasUsed: 0n,
        error: `Fill execution failed: ${error}`
      };
    }
  }

  private startOrderProcessing(): void {
    // Run order processing every 10 seconds
    setInterval(async () => {
      try {
        await this.matchOrders();
        await this.processOrderFills();
        this.checkExpiredOrders();
      } catch (error) {
        console.error('Error in order processing:', error);
      }
    }, 10000);
    
    console.log('Local order processing started');
  }
}
