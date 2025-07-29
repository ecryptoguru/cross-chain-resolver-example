import { ethers } from 'ethers';
import { NetworkEnum } from '@1inch/fusion-sdk';
import { FusionOrderBuilder, CrossChainOrderConfig, CrossChainOrderUtils } from './FusionOrderBuilder';
import { NearChainSignatures, NearChainSignaturesConfig, NearChainSignaturesUtils } from '../near-signatures/NearChainSignatures';
import { LocalOrderManager, LocalOrder, OrderStatus, OrderType } from '../order-management/LocalOrderManager';

/**
 * Configuration for the complete Fusion+ cross-chain integration
 */
export interface FusionCrossChainConfig {
  // Ethereum configuration
  ethereumProvider: ethers.Provider;
  ethereumNetwork: NetworkEnum;
  fusionApiUrl: string;
  
  // NEAR configuration
  nearConfig: NearChainSignaturesConfig;
  
  // Contract addresses
  resolverAddress: string;
  nearBridgeAddress: string;
  
  // Integration settings
  defaultAuctionDuration: number; // seconds
  defaultTimelock: number; // hours
  maxRetries: number;
  processingInterval: number; // milliseconds
}

/**
 * Swap parameters for cross-chain operations
 */
export interface CrossChainSwapParams {
  // Source chain details
  sourceToken: string; // Address or 'ETH'
  sourceAmount: string; // Amount in token units
  
  // Destination chain details (NEAR)
  destinationToken: string; // NEAR token identifier
  nearRecipient: string; // NEAR account ID
  
  // Swap settings
  slippageTolerance?: number; // Percentage (default: 1%)
  deadline?: number; // Unix timestamp (default: 24 hours)
  allowPartialFills?: boolean;
  
  // Fee settings
  integratorFee?: {
    recipient: string;
    basisPoints: number; // e.g., 30 = 0.3%
  };
}

/**
 * Swap result information
 */
export interface SwapResult {
  success: boolean;
  orderId: string;
  orderHash: string;
  estimatedDestinationAmount: string;
  secretHash: string;
  secret: string;
  timelock: number;
  error?: string;
}

/**
 * Main integration class for 1inch Fusion+ cross-chain swaps with NEAR
 * Combines meta-order construction, NEAR Chain Signatures, and local order management
 */
export class FusionCrossChainIntegration {
  private config: FusionCrossChainConfig;
  private fusionBuilder: FusionOrderBuilder;
  private nearSignatures: NearChainSignatures;
  private orderManager: LocalOrderManager;
  private initialized: boolean = false;

  constructor(config: FusionCrossChainConfig) {
    this.config = config;
    
    // Initialize components
    this.fusionBuilder = new FusionOrderBuilder(config.ethereumProvider, {
      url: config.fusionApiUrl,
      network: config.ethereumNetwork,
      blockchainProvider: config.ethereumProvider
    });
    
    this.nearSignatures = new NearChainSignatures(config.nearConfig);
    
    this.orderManager = new LocalOrderManager(
      this.fusionBuilder,
      this.nearSignatures,
      config.ethereumProvider
    );
  }

  /**
   * Initialize the integration system
   */
  async initialize(): Promise<void> {
    try {
      console.log('Initializing Fusion+ Cross-Chain Integration...');
      
      // Validate configuration
      this.validateConfig();
      
      // Initialize NEAR Chain Signatures
      await this.nearSignatures.initialize();
      
      // Log initialization success
      const derivedAddress = this.nearSignatures.getDerivedAddress();
      console.log(`Integration initialized successfully:`);
      console.log(`- Ethereum Network: ${this.config.ethereumNetwork}`);
      console.log(`- NEAR Network: ${this.config.nearConfig.nearNetworkId}`);
      console.log(`- Derived Ethereum Address: ${derivedAddress}`);
      console.log(`- Agent Account: ${this.config.nearConfig.agentAccountId}`);
      
      this.initialized = true;
      
    } catch (error) {
      throw new Error(`Failed to initialize Fusion+ Cross-Chain Integration: ${error}`);
    }
  }

  /**
   * Execute a cross-chain swap from Ethereum to NEAR
   */
  async executeSwap(params: CrossChainSwapParams): Promise<SwapResult> {
    if (!this.initialized) {
      throw new Error('Integration not initialized. Call initialize() first.');
    }

    try {
      console.log('Executing cross-chain swap:', params);
      
      // Validate swap parameters
      this.validateSwapParams(params);
      
      // Generate atomic swap secrets
      const { secret, secretHash } = CrossChainOrderUtils.generateSecret();
      
      // Calculate timelock
      const timelock = CrossChainOrderUtils.calculateTimelock(this.config.defaultTimelock);
      
      // Get quote for the swap
      const quote = await this.getSwapQuote(params);
      
      // Create cross-chain order configuration
      const orderConfig: CrossChainOrderConfig = {
        sourceChain: this.config.ethereumNetwork,
        sourceToken: this.normalizeTokenAddress(params.sourceToken),
        sourceAmount: ethers.parseUnits(params.sourceAmount, 18), // Assume 18 decimals for now
        
        destinationChain: 'NEAR',
        destinationToken: params.destinationToken,
        destinationAmount: BigInt(quote.destinationAmount),
        destinationRecipient: params.nearRecipient,
        
        secretHash,
        timelock,
        
        maker: this.nearSignatures.getDerivedAddress(),
        allowPartialFills: params.allowPartialFills || false,
        
        auctionDuration: this.config.defaultAuctionDuration,
        startAuctionIn: 30, // 30 seconds delay
        
        integratorFee: params.integratorFee ? {
          recipient: params.integratorFee.recipient,
          ratio: params.integratorFee.basisPoints
        } : undefined
      };
      
      // Create and submit the order
      const order = await this.orderManager.createOrder(orderConfig);
      
      console.log(`Cross-chain swap order created: ${order.id}`);
      console.log(`Secret hash: ${secretHash}`);
      console.log(`Timelock: ${new Date(timelock * 1000).toISOString()}`);
      
      return {
        success: true,
        orderId: order.id,
        orderHash: order.hash,
        estimatedDestinationAmount: quote.destinationAmount.toString(),
        secretHash,
        secret,
        timelock
      };
      
    } catch (error) {
      console.error('Swap execution failed:', error);
      return {
        success: false,
        orderId: '',
        orderHash: '',
        estimatedDestinationAmount: '0',
        secretHash: '',
        secret: '',
        timelock: 0,
        error: `Swap failed: ${error}`
      };
    }
  }

  /**
   * Get a quote for cross-chain swap
   */
  async getSwapQuote(params: CrossChainSwapParams): Promise<{
    destinationAmount: bigint;
    executionPrice: bigint;
    priceImpact: number;
    estimatedGas: bigint;
  }> {
    const sourceAmount = ethers.parseUnits(params.sourceAmount, 18);
    
    const mockConfig: CrossChainOrderConfig = {
      sourceChain: this.config.ethereumNetwork,
      sourceToken: this.normalizeTokenAddress(params.sourceToken),
      sourceAmount,
      destinationChain: 'NEAR',
      destinationToken: params.destinationToken,
      destinationAmount: 0n, // Will be calculated
      destinationRecipient: params.nearRecipient,
      secretHash: '0x' + '0'.repeat(64), // Mock hash
      timelock: 0, // Mock timelock
      maker: this.nearSignatures.getDerivedAddress()
    };
    
    return await this.fusionBuilder.createLocalQuote(mockConfig);
  }

  /**
   * Get order status and details
   */
  getOrderStatus(orderId: string): LocalOrder | undefined {
    return this.orderManager.getOrder(orderId);
  }

  /**
   * Get order by hash
   */
  getOrderByHash(orderHash: string): LocalOrder | undefined {
    return this.orderManager.getOrderByHash(orderHash);
  }

  /**
   * Cancel an order
   */
  async cancelOrder(orderId: string): Promise<void> {
    await this.orderManager.cancelOrder(orderId);
  }

  /**
   * Get all orders for the current user
   */
  getAllOrders(): LocalOrder[] {
    return this.orderManager.getAllOrders();
  }

  /**
   * Get orders by status
   */
  getOrdersByStatus(status: OrderStatus): LocalOrder[] {
    return this.orderManager.getOrdersByStatus(status);
  }

  /**
   * Get order book statistics
   */
  getOrderBookStats() {
    return this.orderManager.getOrderBookStats();
  }

  /**
   * Reveal secret to complete cross-chain swap
   */
  async revealSecret(orderId: string, secret: string): Promise<boolean> {
    const order = this.orderManager.getOrder(orderId);
    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }

    // Verify secret matches hash
    const computedHash = ethers.keccak256(secret);
    if (computedHash !== order.secretHash) {
      throw new Error('Invalid secret provided');
    }

    // Store secret in order
    order.secret = secret;
    order.updatedAt = Date.now();

    console.log(`Secret revealed for order: ${orderId}`);
    return true;
  }

  /**
   * Monitor order execution and provide updates
   */
  async monitorOrder(orderId: string, callback: (order: LocalOrder) => void): Promise<void> {
    const checkOrder = () => {
      const order = this.orderManager.getOrder(orderId);
      if (order) {
        callback(order);
        
        // Continue monitoring if order is still active
        if (![OrderStatus.FILLED, OrderStatus.CANCELLED, OrderStatus.EXPIRED, OrderStatus.FAILED].includes(order.status)) {
          setTimeout(checkOrder, 5000); // Check every 5 seconds
        }
      }
    };

    checkOrder();
  }

  /**
   * Private helper methods
   */

  private validateConfig(): void {
    if (!this.config.ethereumProvider) {
      throw new Error('Ethereum provider is required');
    }
    
    if (!this.config.fusionApiUrl) {
      throw new Error('Fusion API URL is required');
    }
    
    NearChainSignaturesUtils.validateConfig(this.config.nearConfig);
    
    if (!this.config.resolverAddress || !ethers.isAddress(this.config.resolverAddress)) {
      throw new Error('Valid resolver address is required');
    }
    
    if (!this.config.nearBridgeAddress || !ethers.isAddress(this.config.nearBridgeAddress)) {
      throw new Error('Valid NEAR bridge address is required');
    }
  }

  private validateSwapParams(params: CrossChainSwapParams): void {
    if (!params.sourceToken) {
      throw new Error('Source token is required');
    }
    
    if (!params.sourceAmount || parseFloat(params.sourceAmount) <= 0) {
      throw new Error('Valid source amount is required');
    }
    
    if (!params.destinationToken) {
      throw new Error('Destination token is required');
    }
    
    if (!params.nearRecipient || !CrossChainOrderUtils.validateNearAccount(params.nearRecipient)) {
      throw new Error('Valid NEAR recipient account is required');
    }
    
    if (params.slippageTolerance && (params.slippageTolerance < 0 || params.slippageTolerance > 50)) {
      throw new Error('Slippage tolerance must be between 0% and 50%');
    }
    
    if (params.deadline && params.deadline <= Math.floor(Date.now() / 1000)) {
      throw new Error('Deadline must be in the future');
    }
  }

  private normalizeTokenAddress(token: string): string {
    if (token.toLowerCase() === 'eth') {
      return '0x0000000000000000000000000000000000000000';
    }
    
    if (!ethers.isAddress(token)) {
      throw new Error(`Invalid token address: ${token}`);
    }
    
    return ethers.getAddress(token);
  }
}

/**
 * Factory class for creating integration instances
 */
export class FusionCrossChainFactory {
  /**
   * Create integration for mainnet
   */
  static createMainnet(
    ethereumProvider: ethers.Provider,
    nearAgentAccountId: string,
    contractAddresses: {
      resolver: string;
      nearBridge: string;
    }
  ): FusionCrossChainIntegration {
    const config: FusionCrossChainConfig = {
      ethereumProvider,
      ethereumNetwork: NetworkEnum.ETHEREUM,
      fusionApiUrl: 'https://api.1inch.dev/fusion',
      nearConfig: NearChainSignaturesUtils.createConfig('mainnet', nearAgentAccountId),
      resolverAddress: contractAddresses.resolver,
      nearBridgeAddress: contractAddresses.nearBridge,
      defaultAuctionDuration: 300, // 5 minutes
      defaultTimelock: 24, // 24 hours
      maxRetries: 3,
      processingInterval: 10000 // 10 seconds
    };
    
    return new FusionCrossChainIntegration(config);
  }

  /**
   * Create integration for testnet
   */
  static createTestnet(
    ethereumProvider: ethers.Provider,
    nearAgentAccountId: string,
    contractAddresses: {
      resolver: string;
      nearBridge: string;
    }
  ): FusionCrossChainIntegration {
    const config: FusionCrossChainConfig = {
      ethereumProvider,
      ethereumNetwork: NetworkEnum.ETHEREUM, // Use Sepolia in practice
      fusionApiUrl: 'https://api.1inch.dev/fusion',
      nearConfig: NearChainSignaturesUtils.createConfig('testnet', nearAgentAccountId),
      resolverAddress: contractAddresses.resolver,
      nearBridgeAddress: contractAddresses.nearBridge,
      defaultAuctionDuration: 180, // 3 minutes for faster testing
      defaultTimelock: 2, // 2 hours for testing
      maxRetries: 3,
      processingInterval: 5000 // 5 seconds for faster testing
    };
    
    return new FusionCrossChainIntegration(config);
  }

  /**
   * Create integration for local development
   */
  static createLocal(
    ethereumProvider: ethers.Provider,
    nearAgentAccountId: string,
    contractAddresses: {
      resolver: string;
      nearBridge: string;
    }
  ): FusionCrossChainIntegration {
    const config: FusionCrossChainConfig = {
      ethereumProvider,
      ethereumNetwork: NetworkEnum.ETHEREUM, // Local network
      fusionApiUrl: 'http://localhost:3000/fusion', // Mock local API
      nearConfig: NearChainSignaturesUtils.createConfig('localnet', nearAgentAccountId),
      resolverAddress: contractAddresses.resolver,
      nearBridgeAddress: contractAddresses.nearBridge,
      defaultAuctionDuration: 60, // 1 minute for local testing
      defaultTimelock: 1, // 1 hour for local testing
      maxRetries: 2,
      processingInterval: 2000 // 2 seconds for local testing
    };
    
    return new FusionCrossChainIntegration(config);
  }
}

/**
 * Utility functions for the integration
 */
export class FusionCrossChainUtils {
  /**
   * Format order for display
   */
  static formatOrder(order: LocalOrder): {
    id: string;
    status: string;
    type: string;
    sourceAmount: string;
    destinationAmount: string;
    progress: number;
    createdAt: string;
    expiresAt: string;
  } {
    const progress = order.filledAmount > 0n 
      ? Number((order.filledAmount * 100n) / order.config.sourceAmount)
      : 0;

    return {
      id: order.id,
      status: order.status,
      type: order.type,
      sourceAmount: CrossChainOrderUtils.formatAmount(order.config.sourceAmount),
      destinationAmount: CrossChainOrderUtils.formatAmount(order.config.destinationAmount),
      progress,
      createdAt: new Date(order.createdAt).toISOString(),
      expiresAt: new Date(order.expiresAt).toISOString()
    };
  }

  /**
   * Estimate swap time based on network conditions
   */
  static estimateSwapTime(orderType: OrderType): {
    min: number; // minutes
    max: number; // minutes
    average: number; // minutes
  } {
    const estimates = {
      [OrderType.ETH_TO_NEAR]: { min: 5, max: 15, average: 8 },
      [OrderType.ERC20_TO_NEAR]: { min: 7, max: 20, average: 12 },
      [OrderType.NEAR_TO_ETH]: { min: 10, max: 25, average: 15 },
      [OrderType.NEAR_TO_ERC20]: { min: 12, max: 30, average: 18 }
    };

    return estimates[orderType];
  }

  /**
   * Calculate optimal auction parameters
   */
  static calculateAuctionParams(
    sourceAmount: bigint,
    volatility: number = 0.1
  ): {
    duration: number;
    initialRateBump: number;
    startDelay: number;
  } {
    // Larger amounts get longer auctions
    const baseDuration = sourceAmount > ethers.parseEther('10') ? 300 : 180;
    
    // Higher volatility gets longer auctions
    const volatilityMultiplier = 1 + (volatility * 0.5);
    
    return {
      duration: Math.floor(baseDuration * volatilityMultiplier),
      initialRateBump: Math.floor(5000 * (1 + volatility)), // 5% base + volatility adjustment
      startDelay: 30 // 30 seconds standard delay
    };
  }
}
