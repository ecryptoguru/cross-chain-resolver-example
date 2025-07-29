import { 
  FusionSDK, 
  FusionOrder, 
  OrderParams, 
  PreparedOrder,
  AuctionDetails,
  NetworkEnum,
  Address
} from '@1inch/fusion-sdk';
import { ethers } from 'ethers';

/**
 * Configuration for cross-chain Fusion+ orders
 */
export interface CrossChainOrderConfig {
  // Source chain configuration
  sourceChain: NetworkEnum;
  sourceToken: Address;
  sourceAmount: bigint;
  
  // Destination chain configuration (NEAR)
  destinationChain: 'NEAR';
  destinationToken: string; // NEAR token identifier
  destinationAmount: bigint;
  destinationRecipient: string; // NEAR account ID
  
  // Cross-chain parameters
  secretHash: string; // For atomic swap hashlock
  timelock: number; // Expiration timestamp
  
  // Order parameters
  maker: Address;
  receiver?: Address;
  allowPartialFills?: boolean;
  allowMultipleFills?: boolean;
  
  // Auction configuration
  auctionDuration?: number; // Duration in seconds
  startAuctionIn?: number; // Delay before auction starts
  
  // Fee configuration
  integratorFee?: {
    recipient: Address;
    ratio: number; // Basis points (e.g., 30 = 0.3%)
  };
}

/**
 * Builder class for constructing 1inch Fusion+ meta-orders for cross-chain swaps
 * Integrates with NEAR Protocol for atomic cross-chain transactions
 */
export class FusionOrderBuilder {
  private sdk: FusionSDK;
  private provider: ethers.Provider;
  private settlementContract: Address;

  constructor(
    provider: ethers.Provider,
    config: {
      url: string;
      network: NetworkEnum;
      blockchainProvider: ethers.Provider;
    }
  ) {
    this.provider = provider;
    this.sdk = new FusionSDK({
      url: config.url,
      network: config.network,
      blockchainProvider: config.blockchainProvider
    });
    
    // Settlement contract addresses for different networks
    // These should be updated with actual deployment addresses
    const settlementContracts = {
      [NetworkEnum.ETHEREUM]: '0x1111111254eeb25477b68fb85ed929f73a960582' as Address,
      [NetworkEnum.POLYGON]: '0x1111111254eeb25477b68fb85ed929f73a960582' as Address,
      [NetworkEnum.BSC]: '0x1111111254eeb25477b68fb85ed929f73a960582' as Address,
      [NetworkEnum.ARBITRUM]: '0x1111111254eeb25477b68fb85ed929f73a960582' as Address,
    };
    
    this.settlementContract = settlementContracts[config.network];
  }

  /**
   * Create a cross-chain Fusion+ meta-order for ETH/ERC20 -> NEAR swap
   */
  async createCrossChainOrder(config: CrossChainOrderConfig): Promise<FusionOrder> {
    // Validate configuration
    this.validateConfig(config);

    // Create auction details for cross-chain swap
    const auctionDetails = this.createAuctionDetails(config);

    // Create order info with cross-chain parameters
    const orderInfo = {
      maker: config.maker,
      receiver: config.receiver || config.maker,
      makerAsset: config.sourceToken,
      takerAsset: config.sourceToken, // Will be resolved by auction
      makingAmount: config.sourceAmount,
      takingAmount: 0n, // Will be determined by auction
    };

    // Create whitelist for cross-chain resolvers
    const whitelist = await this.createCrossChainWhitelist();

    // Create the Fusion order with cross-chain extensions
    const fusionOrder = FusionOrder.new(
      this.settlementContract,
      orderInfo,
      {
        auction: auctionDetails,
        fees: config.integratorFee ? {
          integratorFee: {
            recipient: config.integratorFee.recipient,
            ratio: BigInt(config.integratorFee.ratio)
          }
        } : undefined,
        whitelist,
        resolvingStartTime: BigInt(Math.floor(Date.now() / 1000) + (config.startAuctionIn || 0))
      },
      {
        allowPartialFills: config.allowPartialFills || false,
        allowMultipleFills: config.allowMultipleFills || false,
        nonce: BigInt(Math.floor(Math.random() * 1000000)),
        unwrapWETH: false, // Keep as wrapped for cross-chain
      }
    );

    return fusionOrder;
  }

  /**
   * Create a local quote for cross-chain swap (without API calls)
   */
  async createLocalQuote(config: CrossChainOrderConfig): Promise<{
    destinationAmount: bigint;
    executionPrice: bigint;
    priceImpact: number;
    estimatedGas: bigint;
  }> {
    // For local testing, create a mock quote based on simple price calculation
    // In production, this would integrate with actual price oracles
    
    const mockExchangeRate = 2000n; // 1 ETH = 2000 NEAR (mock rate)
    const slippageTolerance = 300n; // 3% slippage tolerance (basis points)
    
    // Calculate destination amount with slippage
    const baseDestinationAmount = (config.sourceAmount * mockExchangeRate) / (10n ** 18n);
    const slippageAmount = (baseDestinationAmount * slippageTolerance) / 10000n;
    const destinationAmount = baseDestinationAmount - slippageAmount;
    
    return {
      destinationAmount,
      executionPrice: mockExchangeRate,
      priceImpact: 0.5, // 0.5% price impact
      estimatedGas: 150000n
    };
  }

  /**
   * Create auction details for cross-chain swap
   */
  private createAuctionDetails(config: CrossChainOrderConfig): AuctionDetails {
    const now = Math.floor(Date.now() / 1000);
    const auctionDuration = config.auctionDuration || 300; // 5 minutes default
    const startTime = now + (config.startAuctionIn || 30); // 30 seconds delay default
    
    return {
      startTime: BigInt(startTime),
      duration: BigInt(auctionDuration),
      initialRateBump: 50000n, // 5% initial rate bump (basis points)
      points: [
        { coefficient: 0n, delay: 0n },
        { coefficient: 10000n, delay: BigInt(auctionDuration / 4) },
        { coefficient: 20000n, delay: BigInt(auctionDuration / 2) },
        { coefficient: 30000n, delay: BigInt((3 * auctionDuration) / 4) },
        { coefficient: 50000n, delay: BigInt(auctionDuration) }
      ]
    };
  }

  /**
   * Create whitelist for cross-chain resolvers
   */
  private async createCrossChainWhitelist() {
    // For local testing, create a whitelist with our resolver addresses
    // In production, this would include verified cross-chain resolvers
    
    return [
      {
        address: '0x1111111111111111111111111111111111111111' as Address, // Mock resolver 1
        allowFrom: 0n,
        allowTo: BigInt(Math.floor(Date.now() / 1000) + 86400) // 24 hours
      },
      {
        address: '0x2222222222222222222222222222222222222222' as Address, // Mock resolver 2
        allowFrom: 0n,
        allowTo: BigInt(Math.floor(Date.now() / 1000) + 86400)
      }
    ];
  }

  /**
   * Validate cross-chain order configuration
   */
  private validateConfig(config: CrossChainOrderConfig): void {
    if (!config.sourceToken || !config.sourceAmount) {
      throw new Error('Source token and amount are required');
    }
    
    if (!config.destinationToken || !config.destinationAmount) {
      throw new Error('Destination token and amount are required');
    }
    
    if (!config.destinationRecipient) {
      throw new Error('Destination recipient (NEAR account) is required');
    }
    
    if (!config.secretHash || config.secretHash.length !== 66) {
      throw new Error('Valid secret hash (32 bytes) is required for atomic swap');
    }
    
    if (!config.timelock || config.timelock <= Math.floor(Date.now() / 1000)) {
      throw new Error('Valid future timelock is required');
    }
    
    if (config.sourceAmount <= 0n || config.destinationAmount <= 0n) {
      throw new Error('Amounts must be greater than zero');
    }
  }

  /**
   * Get order hash for tracking and cancellation
   */
  async getOrderHash(order: FusionOrder): Promise<string> {
    // This would typically use the order's EIP-712 hash
    // For now, return a mock hash for local testing
    const orderData = JSON.stringify({
      maker: order.maker,
      makerAsset: order.makerAsset,
      takerAsset: order.takerAsset,
      makingAmount: order.makingAmount.toString(),
      takingAmount: order.takingAmount.toString(),
      salt: order.salt.toString()
    });
    
    return ethers.keccak256(ethers.toUtf8Bytes(orderData));
  }

  /**
   * Create order parameters for local order management
   */
  createOrderParams(config: CrossChainOrderConfig): OrderParams {
    return {
      fromTokenAddress: config.sourceToken,
      toTokenAddress: config.destinationToken,
      amount: config.sourceAmount.toString(),
      walletAddress: config.maker,
      receiver: config.receiver,
      preset: 'fast', // Use fast preset for cross-chain
      isPermit2: false,
      fee: config.integratorFee ? {
        takeFee: true,
        feeRecipient: config.integratorFee.recipient,
        feePercent: config.integratorFee.ratio / 100 // Convert basis points to percentage
      } : undefined
    };
  }
}

/**
 * Utility functions for cross-chain order management
 */
export class CrossChainOrderUtils {
  /**
   * Generate a secure secret for atomic swap
   */
  static generateSecret(): { secret: string; secretHash: string } {
    const secret = ethers.hexlify(ethers.randomBytes(32));
    const secretHash = ethers.keccak256(secret);
    return { secret, secretHash };
  }

  /**
   * Calculate timelock for cross-chain swap
   */
  static calculateTimelock(durationHours: number = 24): number {
    return Math.floor(Date.now() / 1000) + (durationHours * 3600);
  }

  /**
   * Validate NEAR account ID format
   */
  static validateNearAccount(accountId: string): boolean {
    const nearAccountRegex = /^[a-z0-9._-]+$/;
    return nearAccountRegex.test(accountId) && accountId.length >= 2 && accountId.length <= 64;
  }

  /**
   * Format amounts for display
   */
  static formatAmount(amount: bigint, decimals: number = 18): string {
    const divisor = 10n ** BigInt(decimals);
    const whole = amount / divisor;
    const fraction = amount % divisor;
    return `${whole}.${fraction.toString().padStart(decimals, '0').slice(0, 6)}`;
  }
}
