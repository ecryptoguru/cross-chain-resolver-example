import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ethers } from 'ethers';
import { NetworkEnum } from '@1inch/fusion-sdk';
import { 
  FusionCrossChainIntegration, 
  FusionCrossChainFactory,
  FusionCrossChainConfig,
  CrossChainSwapParams,
  FusionCrossChainUtils
} from '../../src/fusion/FusionCrossChainIntegration';
import { OrderStatus, OrderType } from '../../src/order-management/LocalOrderManager';
import { CrossChainOrderUtils } from '../../src/fusion/FusionOrderBuilder';

describe('FusionCrossChainIntegration', () => {
  let integration: FusionCrossChainIntegration;
  let mockProvider: ethers.Provider;
  let config: FusionCrossChainConfig;

  beforeEach(async () => {
    // Create mock provider
    mockProvider = new ethers.JsonRpcProvider('http://localhost:8545');
    
    // Create test configuration
    config = {
      ethereumProvider: mockProvider,
      ethereumNetwork: NetworkEnum.ETHEREUM,
      fusionApiUrl: 'http://localhost:3000/fusion',
      nearConfig: {
        nearNetworkId: 'localnet',
        nearNodeUrl: 'http://localhost:3030',
        agentAccountId: 'test-agent.test.near',
        agentContractId: 'agent.test.near',
        derivationPath: 'ethereum,31337'
      },
      resolverAddress: '0x1111111111111111111111111111111111111111',
      nearBridgeAddress: '0x2222222222222222222222222222222222222222',
      defaultAuctionDuration: 60,
      defaultTimelock: 1,
      maxRetries: 2,
      processingInterval: 1000
    };

    integration = new FusionCrossChainIntegration(config);
  });

  describe('Initialization', () => {
    it('should initialize successfully with valid configuration', async () => {
      await expect(integration.initialize()).resolves.not.toThrow();
    });

    it('should throw error with invalid configuration', async () => {
      const invalidConfig = { ...config, resolverAddress: 'invalid-address' };
      const invalidIntegration = new FusionCrossChainIntegration(invalidConfig);
      
      await expect(invalidIntegration.initialize()).rejects.toThrow('Valid resolver address is required');
    });

    it('should derive Ethereum address from NEAR agent', async () => {
      await integration.initialize();
      
      // Should not throw when getting derived address
      expect(() => integration.getOrderBookStats()).not.toThrow();
    });
  });

  describe('Cross-Chain Swap Execution', () => {
    beforeEach(async () => {
      await integration.initialize();
    });

    it('should execute ETH to NEAR swap successfully', async () => {
      const swapParams: CrossChainSwapParams = {
        sourceToken: 'ETH',
        sourceAmount: '1.0',
        destinationToken: 'near',
        nearRecipient: 'test-recipient.near',
        slippageTolerance: 1.0,
        allowPartialFills: false
      };

      const result = await integration.executeSwap(swapParams);

      expect(result.success).toBe(true);
      expect(result.orderId).toBeTruthy();
      expect(result.orderHash).toBeTruthy();
      expect(result.secretHash).toBeTruthy();
      expect(result.secret).toBeTruthy();
      expect(result.timelock).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });

    it('should execute ERC20 to NEAR swap successfully', async () => {
      const swapParams: CrossChainSwapParams = {
        sourceToken: '0xA0b86a33E6441d1F6f0b8c2c5e8b8B8b8B8b8B8b', // Mock USDC
        sourceAmount: '1000.0',
        destinationToken: 'usdc.near',
        nearRecipient: 'test-recipient.near',
        integratorFee: {
          recipient: '0x3333333333333333333333333333333333333333',
          basisPoints: 30 // 0.3%
        }
      };

      const result = await integration.executeSwap(swapParams);

      expect(result.success).toBe(true);
      expect(result.orderId).toBeTruthy();
      expect(parseFloat(result.estimatedDestinationAmount)).toBeGreaterThan(0);
    });

    it('should handle invalid swap parameters', async () => {
      const invalidParams: CrossChainSwapParams = {
        sourceToken: 'ETH',
        sourceAmount: '0', // Invalid amount
        destinationToken: 'near',
        nearRecipient: 'invalid-account' // Invalid NEAR account
      };

      const result = await integration.executeSwap(invalidParams);

      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('should validate NEAR account format', async () => {
      const invalidParams: CrossChainSwapParams = {
        sourceToken: 'ETH',
        sourceAmount: '1.0',
        destinationToken: 'near',
        nearRecipient: 'INVALID_ACCOUNT!' // Invalid characters
      };

      const result = await integration.executeSwap(invalidParams);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Valid NEAR recipient account is required');
    });
  });

  describe('Order Management', () => {
    beforeEach(async () => {
      await integration.initialize();
    });

    it('should track order status changes', async () => {
      const swapParams: CrossChainSwapParams = {
        sourceToken: 'ETH',
        sourceAmount: '0.5',
        destinationToken: 'near',
        nearRecipient: 'test.near'
      };

      const result = await integration.executeSwap(swapParams);
      expect(result.success).toBe(true);

      // Get order and check initial status
      const order = integration.getOrderStatus(result.orderId);
      expect(order).toBeTruthy();
      expect(order!.status).toBe(OrderStatus.PENDING);
      expect(order!.type).toBe(OrderType.ETH_TO_NEAR);
    });

    it('should retrieve order by hash', async () => {
      const swapParams: CrossChainSwapParams = {
        sourceToken: 'ETH',
        sourceAmount: '0.1',
        destinationToken: 'near',
        nearRecipient: 'test.near'
      };

      const result = await integration.executeSwap(swapParams);
      const orderByHash = integration.getOrderByHash(result.orderHash);

      expect(orderByHash).toBeTruthy();
      expect(orderByHash!.id).toBe(result.orderId);
      expect(orderByHash!.hash).toBe(result.orderHash);
    });

    it('should cancel orders successfully', async () => {
      const swapParams: CrossChainSwapParams = {
        sourceToken: 'ETH',
        sourceAmount: '0.2',
        destinationToken: 'near',
        nearRecipient: 'test.near'
      };

      const result = await integration.executeSwap(swapParams);
      await integration.cancelOrder(result.orderId);

      const order = integration.getOrderStatus(result.orderId);
      expect(order!.status).toBe(OrderStatus.CANCELLED);
    });

    it('should reveal secrets correctly', async () => {
      const swapParams: CrossChainSwapParams = {
        sourceToken: 'ETH',
        sourceAmount: '0.3',
        destinationToken: 'near',
        nearRecipient: 'test.near'
      };

      const result = await integration.executeSwap(swapParams);
      const revealed = await integration.revealSecret(result.orderId, result.secret);

      expect(revealed).toBe(true);

      const order = integration.getOrderStatus(result.orderId);
      expect(order!.secret).toBe(result.secret);
    });

    it('should reject invalid secrets', async () => {
      const swapParams: CrossChainSwapParams = {
        sourceToken: 'ETH',
        sourceAmount: '0.1',
        destinationToken: 'near',
        nearRecipient: 'test.near'
      };

      const result = await integration.executeSwap(swapParams);
      const invalidSecret = '0x' + '1'.repeat(64);

      await expect(integration.revealSecret(result.orderId, invalidSecret))
        .rejects.toThrow('Invalid secret provided');
    });
  });

  describe('Quote Generation', () => {
    beforeEach(async () => {
      await integration.initialize();
    });

    it('should generate quotes for ETH swaps', async () => {
      const params: CrossChainSwapParams = {
        sourceToken: 'ETH',
        sourceAmount: '1.0',
        destinationToken: 'near',
        nearRecipient: 'test.near'
      };

      const quote = await integration.getSwapQuote(params);

      expect(quote.destinationAmount).toBeGreaterThan(0n);
      expect(quote.executionPrice).toBeGreaterThan(0n);
      expect(quote.priceImpact).toBeGreaterThan(0);
      expect(quote.estimatedGas).toBeGreaterThan(0n);
    });

    it('should generate quotes for ERC20 swaps', async () => {
      const params: CrossChainSwapParams = {
        sourceToken: '0xA0b86a33E6441d1F6f0b8c2c5e8b8B8b8B8b8B8b',
        sourceAmount: '1000.0',
        destinationToken: 'usdc.near',
        nearRecipient: 'test.near'
      };

      const quote = await integration.getSwapQuote(params);

      expect(quote.destinationAmount).toBeGreaterThan(0n);
      expect(quote.priceImpact).toBeLessThan(10); // Less than 10% price impact
    });
  });

  describe('Order Book Statistics', () => {
    beforeEach(async () => {
      await integration.initialize();
    });

    it('should provide order book statistics', async () => {
      // Create a few orders
      const swapParams1: CrossChainSwapParams = {
        sourceToken: 'ETH',
        sourceAmount: '1.0',
        destinationToken: 'near',
        nearRecipient: 'test1.near'
      };

      const swapParams2: CrossChainSwapParams = {
        sourceToken: '0xA0b86a33E6441d1F6f0b8c2c5e8b8B8b8B8b8B8b',
        sourceAmount: '500.0',
        destinationToken: 'usdc.near',
        nearRecipient: 'test2.near'
      };

      await integration.executeSwap(swapParams1);
      await integration.executeSwap(swapParams2);

      const stats = integration.getOrderBookStats();

      expect(stats.totalOrders).toBe(2);
      expect(stats.ordersByStatus[OrderStatus.PENDING]).toBe(2);
      expect(stats.ordersByType[OrderType.ETH_TO_NEAR]).toBe(1);
      expect(stats.ordersByType[OrderType.ERC20_TO_NEAR]).toBe(1);
    });
  });

  describe('Order Monitoring', () => {
    beforeEach(async () => {
      await integration.initialize();
    });

    it('should monitor order status changes', async () => {
      const swapParams: CrossChainSwapParams = {
        sourceToken: 'ETH',
        sourceAmount: '0.1',
        destinationToken: 'near',
        nearRecipient: 'test.near'
      };

      const result = await integration.executeSwap(swapParams);
      const statusUpdates: OrderStatus[] = [];

      // Monitor order for status changes
      const monitorPromise = new Promise<void>((resolve) => {
        integration.monitorOrder(result.orderId, (order) => {
          statusUpdates.push(order.status);
          if (statusUpdates.length >= 2) {
            resolve();
          }
        });
      });

      // Cancel order to trigger status change
      setTimeout(() => {
        integration.cancelOrder(result.orderId);
      }, 100);

      await monitorPromise;

      expect(statusUpdates).toContain(OrderStatus.PENDING);
      expect(statusUpdates).toContain(OrderStatus.CANCELLED);
    });
  });
});

describe('FusionCrossChainFactory', () => {
  let mockProvider: ethers.Provider;
  let contractAddresses: { resolver: string; nearBridge: string };

  beforeEach(() => {
    mockProvider = new ethers.JsonRpcProvider('http://localhost:8545');
    contractAddresses = {
      resolver: '0x1111111111111111111111111111111111111111',
      nearBridge: '0x2222222222222222222222222222222222222222'
    };
  });

  it('should create mainnet integration', () => {
    const integration = FusionCrossChainFactory.createMainnet(
      mockProvider,
      'agent.near',
      contractAddresses
    );

    expect(integration).toBeInstanceOf(FusionCrossChainIntegration);
  });

  it('should create testnet integration', () => {
    const integration = FusionCrossChainFactory.createTestnet(
      mockProvider,
      'agent.testnet',
      contractAddresses
    );

    expect(integration).toBeInstanceOf(FusionCrossChainIntegration);
  });

  it('should create local integration', () => {
    const integration = FusionCrossChainFactory.createLocal(
      mockProvider,
      'agent.test.near',
      contractAddresses
    );

    expect(integration).toBeInstanceOf(FusionCrossChainIntegration);
  });
});

describe('FusionCrossChainUtils', () => {
  it('should format orders correctly', () => {
    const mockOrder = {
      id: 'test-order-123',
      status: OrderStatus.PENDING,
      type: OrderType.ETH_TO_NEAR,
      config: {
        sourceAmount: ethers.parseEther('1.0'),
        destinationAmount: ethers.parseEther('2000.0')
      },
      filledAmount: ethers.parseEther('0.5'),
      createdAt: Date.now(),
      expiresAt: Date.now() + 86400000
    } as any;

    const formatted = FusionCrossChainUtils.formatOrder(mockOrder);

    expect(formatted.id).toBe('test-order-123');
    expect(formatted.status).toBe('pending');
    expect(formatted.type).toBe('eth_to_near');
    expect(formatted.progress).toBe(50); // 50% filled
    expect(formatted.sourceAmount).toContain('1.0');
    expect(formatted.destinationAmount).toContain('2000.0');
  });

  it('should estimate swap times correctly', () => {
    const ethToNearTime = FusionCrossChainUtils.estimateSwapTime(OrderType.ETH_TO_NEAR);
    const nearToEthTime = FusionCrossChainUtils.estimateSwapTime(OrderType.NEAR_TO_ETH);

    expect(ethToNearTime.min).toBeLessThan(ethToNearTime.max);
    expect(ethToNearTime.average).toBeGreaterThan(ethToNearTime.min);
    expect(ethToNearTime.average).toBeLessThan(ethToNearTime.max);

    expect(nearToEthTime.average).toBeGreaterThan(ethToNearTime.average);
  });

  it('should calculate auction parameters based on amount and volatility', () => {
    const smallAmount = ethers.parseEther('1.0');
    const largeAmount = ethers.parseEther('100.0');
    const lowVolatility = 0.05;
    const highVolatility = 0.3;

    const smallLowVol = FusionCrossChainUtils.calculateAuctionParams(smallAmount, lowVolatility);
    const largeLowVol = FusionCrossChainUtils.calculateAuctionParams(largeAmount, lowVolatility);
    const smallHighVol = FusionCrossChainUtils.calculateAuctionParams(smallAmount, highVolatility);

    // Larger amounts should have longer durations
    expect(largeLowVol.duration).toBeGreaterThan(smallLowVol.duration);

    // Higher volatility should increase rate bump
    expect(smallHighVol.initialRateBump).toBeGreaterThan(smallLowVol.initialRateBump);

    // All should have reasonable values
    expect(smallLowVol.duration).toBeGreaterThan(60);
    expect(smallLowVol.duration).toBeLessThan(600);
    expect(smallLowVol.startDelay).toBe(30);
  });
});

describe('CrossChainOrderUtils', () => {
  it('should generate valid secrets', () => {
    const { secret, secretHash } = CrossChainOrderUtils.generateSecret();

    expect(secret).toMatch(/^0x[0-9a-f]{64}$/i);
    expect(secretHash).toMatch(/^0x[0-9a-f]{64}$/i);
    expect(ethers.keccak256(secret)).toBe(secretHash);
  });

  it('should calculate future timelocks', () => {
    const timelock1 = CrossChainOrderUtils.calculateTimelock(1);
    const timelock24 = CrossChainOrderUtils.calculateTimelock(24);
    const now = Math.floor(Date.now() / 1000);

    expect(timelock1).toBeGreaterThan(now);
    expect(timelock24).toBeGreaterThan(timelock1);
    expect(timelock24 - timelock1).toBe(23 * 3600); // 23 hours difference
  });

  it('should validate NEAR account IDs', () => {
    expect(CrossChainOrderUtils.validateNearAccount('valid.near')).toBe(true);
    expect(CrossChainOrderUtils.validateNearAccount('test-account.testnet')).toBe(true);
    expect(CrossChainOrderUtils.validateNearAccount('user123.near')).toBe(true);

    expect(CrossChainOrderUtils.validateNearAccount('INVALID')).toBe(false);
    expect(CrossChainOrderUtils.validateNearAccount('invalid@account')).toBe(false);
    expect(CrossChainOrderUtils.validateNearAccount('')).toBe(false);
    expect(CrossChainOrderUtils.validateNearAccount('a')).toBe(false); // Too short
  });

  it('should format amounts correctly', () => {
    const amount = ethers.parseEther('1.234567890123456789');
    const formatted = CrossChainOrderUtils.formatAmount(amount);

    expect(formatted).toContain('1.234567');
    expect(formatted.split('.')[1].length).toBeLessThanOrEqual(6);
  });
});
