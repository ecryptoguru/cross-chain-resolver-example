/**
 * Comprehensive Integration Tests for NearRelayer
 * Tests the complete relayer functionality with proper mocking
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { NearRelayer } from '../../src/relay/NearRelayer.js';
import { MockProvider, MockSigner } from '../mocks/ethers-mock.js';
import { MockNearAccount, MockNearProvider, MockNearConnection } from '../mocks/near-api-mock.js';
import { MessageType } from '../../src/types/interfaces.js';

// Define test context type
/** @typedef {Object} TestContext
 * @property {any} relayer - The NearRelayer instance
 * @property {Object} config - Configuration object
 * @property {any} mockNearAccount - Mock NEAR account
 * @property {any} mockNearProvider - Mock NEAR provider
 * @property {any} mockEthereumProvider - Mock Ethereum provider
 * @property {any} mockEthereumSigner - Mock Ethereum signer
 */

// Setup test environment
beforeEach(() => {
  jest.clearAllMocks();
});

// Test setup function
/**
 * @returns {TestContext} Test context with mocks and relayer instance
 */
function setupTest() {
  // Create mock NEAR provider and account
  const mockNearProvider = new MockNearProvider();
  const mockNearAccount = new MockNearAccount('test.near', new MockNearConnection('testnet', mockNearProvider));
  
  // Create mock Ethereum provider and signer
  const mockEthereumProvider = new MockProvider();
  const mockEthereumSigner = new MockSigner();

  // Set up NEAR account connection
  mockNearAccount.connection = {
    provider: mockNearProvider
  };

  // Configure relayer
  const config = {
    nearAccount: mockNearAccount,
    ethereumSigner: mockEthereumSigner,
    ethereumProvider: mockEthereumProvider,
    ethereumEscrowFactoryAddress: '0x1234567890123456789012345678901234567890',
    escrowContractId: 'escrow.test.near',
    pollIntervalMs: 1000,
    storageDir: './test-storage'
  };

  // Initialize relayer with config
  const relayer = new NearRelayer(config);

  return {
    relayer,
    config,
    mockNearAccount,
    mockNearProvider,
    mockEthereumProvider,
    mockEthereumSigner
  };
}

// Main test suite for NearRelayer
describe('NearRelayer', () => {
  // Clear mocks before each test
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Initialization', () => {
    test('should initialize with valid configuration', () => {
      const { relayer } = setupTest();
      expect(relayer).toBeDefined();
      expect(relayer.isRelayerRunning()).toBe(false);
    });

    test('should throw error with invalid configuration - missing NEAR account', () => {
      expect(() => {
        new NearRelayer({
          nearAccount: null as any,
          ethereumSigner: new MockSigner() as any,
          ethereumProvider: new MockProvider() as any,
          ethereumEscrowFactoryAddress: '0x1234567890123456789012345678901234567890',
          escrowContractId: 'escrow.test.near'
        });
      }).toThrow();
    });

    test('should throw error with invalid Ethereum factory address', () => {
      const mockNearAccount = new MockNearAccount('test.near', new MockNearConnection('testnet', new MockNearProvider()));
      
      expect(() => {
        new NearRelayer({
          nearAccount: mockNearAccount as any,
          ethereumSigner: new MockSigner() as any,
          ethereumProvider: new MockProvider() as any,
          ethereumEscrowFactoryAddress: 'invalid-address',
          escrowContractId: 'escrow.test.near'
        });
      }).toThrow();
    });
  });

  describe('Lifecycle Management', () => {
    test('should start relayer successfully', async () => {
      const { relayer } = setupTest();
      await relayer.start();
      expect(relayer.isRelayerRunning()).toBe(true);
    });

    test('should stop relayer successfully', async () => {
      const { relayer } = setupTest();
      await relayer.start();
      await relayer.stop();
      expect(relayer.isRelayerRunning()).toBe(false);
    });
  });

  describe('Event Handling', () => {
    test('should handle swap order created event', async () => {
      const { relayer, mockNearAccount, mockEthereumProvider } = setupTest();
      
      // Mock transaction receipt
      mockEthereumProvider.setMockTransactionReceipt({
        status: 1,
        transactionHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        blockNumber: 12345,
        gasUsed: '100000'
      });

      await relayer.start();

      // Emit swap order created event
      mockNearAccount.emit('swap_order_created', {
        orderId: 'test-order-1',
        initiator: 'sender.near',
        recipient: 'receiver.eth',
        amount: '1000000000000000000', // 1 NEAR
        secretHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        timelock: Date.now() + 3600000, // 1 hour from now
        blockNumber: 12345,
        transactionHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        timestamp: Date.now()
      });

      // Verify transaction was sent
      expect(mockEthereumProvider.sendTransaction).toHaveBeenCalledTimes(1);
    });

    test('should handle swap order completed event', async () => {
      const { relayer, mockNearAccount, mockEthereumProvider } = setupTest();
      
      // Mock escrow data
      mockEthereumProvider.setMockEscrow({
        escrowAddress: '0x1234567890123456789012345678901234567890',
        initiator: 'test.near',
        recipient: '0x1234567890123456789012345678901234567890',
        amount: '1000000000000000000',
        secretHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        timelock: Math.floor(Date.now() / 1000) + 86400,
        status: 'active'
      });

      await relayer.start();

      // Emit swap order completed event
      mockNearAccount.emit('swap_order_completed', {
        orderId: 'test-order-1',
        secret: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        blockNumber: 12346,
        transactionHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        timestamp: Date.now()
      });

      // Verify transaction was sent
      expect(mockEthereumProvider.sendTransaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('Error Handling', () => {
    test('should handle NEAR provider connection errors', async () => {
      const { relayer, mockNearProvider } = setupTest();
      
      // Mock provider error
      mockNearProvider.setMockError(new Error('NEAR provider connection failed'));
      
      // Expect start to throw
      await expect(relayer.start()).rejects.toThrow('NEAR provider connection failed');
    });
  });

  describe('Integration Scenarios', () => {
    test('should handle complete NEAR to Ethereum flow', async () => {
      const { relayer, mockNearAccount, mockEthereumProvider } = setupTest();
      
      // Mock transaction receipt for deposit
      mockEthereumProvider.setMockTransactionReceipt({
        status: 1,
        transactionHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        blockNumber: 12345,
        gasUsed: '100000'
      });

      // Start the relayer
      await relayer.start();

      // Create and emit the swap order created event
      const swapOrderEvent = {
        event: 'SwapOrderCreated',
        args: {
          orderId: 'integration-order-123',
          initiator: 'test.near',
          recipient: '0x1234567890123456789012345678901234567890',
          amount: '1000000000000000000',
          secretHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab',
          timelock: Math.floor(Date.now() / 1000) + 86400,
          blockHeight: 12345,
          transactionHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
        },
        eventSignature: 'SwapOrderCreated(address,address,uint256,bytes32,uint256,uint256,bytes32)',
        raw: {
          data: '0x',
          topics: ['0x']
        }
      };
      
      // Emit the swap order created event
      mockNearAccount.emit('swap_order_created', swapOrderEvent);
      
      // Verify the transaction was sent
      expect(mockEthereumProvider.sendTransaction).toHaveBeenCalledTimes(1);
      
      // Create and emit the swap completed event
      const swapCompletedEvent = {
        event: 'SwapOrderCompleted',
        args: {
          orderId: 'integration-order-123',
          secret: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef12',
          blockNumber: 12346,
          transactionHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
          timestamp: Date.now()
        },
        eventSignature: 'SwapOrderCompleted(string,string,uint256,string,uint256)',
        raw: {
          data: '0x',
          topics: []
        }
      };
      
      // Set up mock escrow
      mockEthereumProvider.setMockEscrow({
        escrowAddress: '0x9876543210987654321098765432109876543210',
        initiator: 'test.near',
        recipient: '0x1234567890123456789012345678901234567890',
        amount: '1000000000000000000',
        secretHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab',
        timelock: Math.floor(Date.now() / 1000) + 86400,
        status: 'active'
      });
      
      // Emit the swap completed event
      mockNearAccount.emit('swap_order_completed', swapCompletedEvent);
      
      // Verify the transaction was sent
      expect(mockEthereumProvider.sendTransaction).toHaveBeenCalledTimes(2);
    });
  });

  describe('Constructor and Configuration', () => {
    test('should create relayer with valid configuration', () => {
      const { relayer } = setupTest();
      expect(relayer).toBeDefined();
      expect(relayer.isRelayerRunning()).toBe(false);
    });

    test('should throw error with invalid configuration - missing NEAR account', () => {
      expect(() => {
        new NearRelayer({
          nearAccount: null as any,
          ethereumSigner: new MockSigner() as any,
          ethereumProvider: new MockProvider() as any,
          ethereumEscrowFactoryAddress: '0x1234567890123456789012345678901234567890',
          escrowContractId: 'escrow.test.near'
        });
      }).toThrow();
    });

    test('should throw error with invalid Ethereum factory address', () => {
      const mockNearAccount = new MockNearAccount();
      mockNearAccount.connection = { provider: new MockNearProvider() } as any;
      
      expect(() => {
        new NearRelayer({
          nearAccount: mockNearAccount as any,
          ethereumSigner: new MockSigner() as any,
          ethereumProvider: new MockProvider() as any,
          ethereumEscrowFactoryAddress: 'invalid-address',
          escrowContractId: 'escrow.test.near'
        });
      }).toThrow();
    });
  });

  describe('Lifecycle Management', () => {
    test('should start relayer successfully', async () => {
      const { relayer } = setupTest();
      await relayer.start();
      expect(relayer.isRelayerRunning()).toBe(true);
    });

    test('should stop relayer successfully', async () => {
      const { relayer } = setupTest();
      await relayer.start();
      expect(relayer.isRelayerRunning()).toBe(true);
      
      await relayer.stop();
      expect(relayer.isRelayerRunning()).toBe(false);
    });

    test('should handle multiple start calls gracefully', async () => {
      const { relayer } = setupTest();
      await relayer.start();
      expect(relayer.isRelayerRunning()).toBe(true);
      
      await relayer.start();
      expect(relayer.isRelayerRunning()).toBe(true);
    });
  });

  describe('Message Processing', () => {
    test('should process deposit message successfully', async () => {
      const { relayer, mockNearAccount } = setupTest();
      await relayer.start();
      
      const depositMessage: CrossChainMessage = {
        messageId: 'deposit-123',
        type: MessageType.DEPOSIT,
        sender: '0x1234567890123456789012345678901234567890',
        recipient: 'test.near',
        amount: '1000000000000000000',
        token: '0x0000000000000000000000000000000000000000',
        timestamp: Date.now(),
        blockNumber: 12345,
        transactionHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
      };
      
      mockNearAccount.setMockFunctionCallResult({ success: true });
      await relayer.processMessage(depositMessage);
      
      expect(mockNearAccount.functionCall).toHaveBeenCalledWith(
        expect.objectContaining({
          methodName: 'create_escrow',
          args: expect.objectContaining({
            recipient: 'test.near'
          })
        })
      );
    });

    test('should process withdrawal message successfully', async () => {
      const { relayer, mockEthereumProvider, mockNearAccount } = setupTest();
      await relayer.start();
      
      const message = {
        messageId: 'test-swap-1',
        type: MessageType.DEPOSIT,
        sourceChain: 'NEAR',
        destChain: 'ETH',
        sender: 'sender.near',
        recipient: '0x1234567890123456789012345678901234567890',
        amount: '1000000000000000000', // 1 NEAR
        token: 'NEAR',
        timestamp: Math.floor(Date.now() / 1000), // Convert to Unix timestamp
        data: {
          // Add any additional data required for the deposit
          secretHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab',
          timelock: Math.floor(Date.now() / 1000) + 86400, // 24 hours from now
          txHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' // Mock transaction hash
        }
      };
      
      mockNearAccount.setMockViewResult({
        initiator: 'test.near',
        recipient: '0x1234567890123456789012345678901234567890',
        amount: '1000000000000000000',
        secret_hash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab',
        timelock: Math.floor(Date.now() / 1000) + 86400,
        status: 'active'
      });
      
      mockEthereumProvider.setMockEscrow({
        escrowAddress: '0x9876543210987654321098765432109876543210',
        initiator: 'test.near',
        recipient: '0x1234567890123456789012345678901234567890',
        amount: '1000000000000000000',
        secretHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab',
        timelock: Math.floor(Date.now() / 1000) + 86400,
        status: 'active'
      });
      
      await relayer.processMessage(message);
      expect(mockEthereumProvider.call).toHaveBeenCalled();
    });

    test('should skip already processed messages', async () => {
      const { relayer } = setupTest();
      await relayer.start();
      
      const depositMessage: CrossChainMessage = {
        messageId: 'deposit-duplicate',
        type: MessageType.DEPOSIT,
        sender: '0x1234567890123456789012345678901234567890',
        recipient: 'test.near',
        amount: '1000000000000000000',
        token: '0x0000000000000000000000000000000000000000',
        timestamp: Date.now(),
        blockNumber: 12345,
        transactionHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
      };
      
      await relayer.processMessage(depositMessage);
      await relayer.processMessage(depositMessage);
      
      expect(relayer.getProcessedMessageCount()).toBe(1);
    });
  });

  describe('Event Handling', () => {
    test('should handle swap order created event', async () => {
      const { relayer, mockEthereumProvider } = setupTest();
      await relayer.start();
      
      // Create a swap order created event
      const swapOrderEvent: Event = {
        event: 'SwapOrderCreated',
        args: {
          orderId: 'test-order-1',
          initiator: 'sender.near',
          recipient: '0x1234567890123456789012345678901234567890',
          amount: '1000000000000000000',
          sourceToken: 'wrap.near',
          destToken: '0x0000000000000000000000000000000000000000',
          secretHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab',
          timelock: Math.floor(Date.now() / 1000) + 86400,
          blockNumber: 12345,
          transactionHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
          timestamp: Date.now()
        },
        eventSignature: 'SwapOrderCreated(string,string,string,string,string,string,uint256,uint256,string,uint256)',
        raw: {
          data: '0x',
          topics: []
        }
      } as Event;
      
      mockEthereumProvider.setMockTransactionReceipt({
        status: 1,
        transactionHash: '0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321',
        blockNumber: 12346,
        gasUsed: '100000'
      } as TransactionReceipt);
      
      // Emit the swap order created event
      mockNearAccount.emit('swap_order_created', swapOrderEvent);
      
      // Create and emit the swap completed event
      const swapCompletedEvent = {
        event: 'SwapOrderCompleted',
        args: {
          orderId: 'order-123',
          secret: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef12',
          blockNumber: 12345,
          transactionHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
          timestamp: Date.now()
        },
        eventSignature: 'SwapOrderCompleted(string,string,uint256,string,uint256)',
        raw: {
          data: '0x',
          topics: []
        }
      };
      
      // Verify the transaction was sent
      expect(mockEthereumProvider.sendTransaction).toHaveBeenCalled();
    });
  });
});
