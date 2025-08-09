/**
 * Comprehensive Integration Tests for NearRelayer
 * Tests the complete relayer functionality with proper mocking
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { NearRelayer } from '../../src/relay/NearRelayer';
import { MockProvider, MockSigner } from '../mocks/ethers-mock-enhanced';
import { MockNearAccount, MockNearProvider, MockNearConnection } from '../mocks/near-api-mock';
import { MessageType, CrossChainMessage } from '../../src/types/interfaces';

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
  const mockEthereumSigner = new MockSigner(mockEthereumProvider);

  // Set up NEAR account connection
  mockNearAccount.connection = {
    provider: mockNearProvider,
    signer: { signMessage: jest.fn() } as any
  };

  // Configure relayer
  const config = {
    nearAccount: mockNearAccount,
    ethereum: {
      rpcUrl: 'http://localhost:8545',
      privateKey: '0x' + '11'.repeat(32),
      // Inject mocks so EthereumContractService uses them
      provider: mockEthereumProvider as any,
      signer: mockEthereumSigner as any
    },
    ethereumEscrowFactoryAddress: '0x1234567890123456789012345678901234567890',
    escrowContractId: 'escrow.test.near',
    pollIntervalMs: 10,
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
          ethereum: {
            rpcUrl: 'http://localhost:8545',
            privateKey: '0x' + '11'.repeat(32)
          },
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
          ethereum: {
            rpcUrl: 'http://localhost:8545',
            privateKey: '0x' + '11'.repeat(32)
          },
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
      const { relayer, config, mockNearProvider, mockEthereumSigner, mockEthereumProvider } = setupTest();

      // Mock transaction receipt for Ethereum side
      mockEthereumProvider.setMockTransactionReceipt({
        status: 1,
        transactionHash: '0x' + '1'.repeat(64),
        blockNumber: 12345,
        gasUsed: '100000'
      });

      // Ensure listener starts from height 1000
      mockNearProvider.setMockStatus({ sync_info: { latest_block_height: 1000 } });
      await relayer.start();

      const sendSpy = jest.spyOn(mockEthereumSigner as any, 'sendTransaction');

      // Prepare NEAR provider mocks to include EVENT_JSON log for swap_order_created at next block
      const blockHeight = 1001;
      const chunkHash = `chunk-hash-${blockHeight}`;
      const txHash = 'abcdEFGH1234567890abcdEFGH1234567890abcd';

      mockNearProvider.setMockChunk(chunkHash, {
        transactions: [
          {
            hash: txHash,
            signer_id: 'sender.near',
            receiver_id: config.escrowContractId,
            actions: [],
          },
        ],
        receipts: [
          {
            outcome: {
              logs: [
                'EVENT_JSON:' +
                  JSON.stringify({
                    event: 'swap_order_created',
                    data: {
                      order_id: 'test-order-1',
                      initiator: 'sender.near',
                      recipient: '0x1234567890123456789012345678901234567890',
                      amount: '1000000000000000000',
                      secret_hash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
                      timelock: Math.floor(Date.now() / 1000) + 3600,
                    },
                  }),
              ],
              receipt_ids: [],
              gas_burnt: 0,
              status: { SuccessValue: '' },
            },
          },
        ],
      } as any);

      // Advance status so poller processes new block
      mockNearProvider.setMockStatus({ sync_info: { latest_block_height: blockHeight } });

      // Allow poller to run and process the block
      await new Promise((r) => setTimeout(r, 80));

      expect(sendSpy).toHaveBeenCalledTimes(1);
    });

    test('should handle swap order completed event', async () => {
      const { relayer, config, mockNearProvider, mockEthereumSigner, mockEthereumProvider } = setupTest();

      // Mock escrow data used by relayer lookup
      mockEthereumProvider.setMockEscrow({
        escrowAddress: '0x1234567890123456789012345678901234567890',
        initiator: 'test.near',
        recipient: '0x1234567890123456789012345678901234567890',
        amount: '1000000000000000000',
        secretHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        timelock: Math.floor(Date.now() / 1000) + 86400,
        status: 'active',
      });

      // Ensure listener starts from height 1001
      mockNearProvider.setMockStatus({ sync_info: { latest_block_height: 1001 } });
      await relayer.start();

      const sendSpy = jest.spyOn(mockEthereumSigner as any, 'sendTransaction');

      // Prepare NEAR provider mocks to include EVENT_JSON log for swap_order_completed at next block
      const blockHeight = 1002;
      const chunkHash = `chunk-hash-${blockHeight}`;
      const txHash = 'abcdEFGH1234567890abcdEFGH1234567890abc1';

      mockNearProvider.setMockChunk(chunkHash, {
        transactions: [
          {
            hash: txHash,
            signer_id: 'sender.near',
            receiver_id: config.escrowContractId,
            actions: [],
          },
        ],
        receipts: [
          {
            outcome: {
              logs: [
                'EVENT_JSON:' +
                  JSON.stringify({
                    event: 'swap_order_completed',
                    data: {
                      order_id: 'test-order-1',
                      secret: '0x' + '12'.repeat(32),
                    },
                  }),
              ],
              receipt_ids: [],
              gas_burnt: 0,
              status: { SuccessValue: '' },
            },
          },
        ],
      } as any);

      // Advance status so poller processes new block
      mockNearProvider.setMockStatus({ sync_info: { latest_block_height: blockHeight } });

      // Allow poller to run and process the block
      await new Promise((r) => setTimeout(r, 80));

      expect(sendSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('Error Handling', () => {
    test('should handle NEAR provider connection errors', async () => {
      const { relayer, mockNearProvider } = setupTest();
      
      // Mock provider error
      mockNearProvider.setMockError(new Error('NEAR provider connection failed'));
      
      // Expect start to throw
      await expect(relayer.start()).rejects.toThrow('Failed to start NEAR relayer: Failed to start NEAR event listener');
    });
  });

  describe('Integration Scenarios', () => {
    test('should handle complete NEAR to Ethereum flow', async () => {
      const { relayer, mockNearProvider, mockEthereumSigner, mockEthereumProvider } = setupTest();
      
      // Mock transaction receipt for deposit
      mockEthereumProvider.setMockTransactionReceipt({
        status: 1,
        transactionHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        blockNumber: 12345,
        gasUsed: '100000'
      });

      // Ensure listener starts from a baseline height
      mockNearProvider.setMockStatus({ sync_info: { latest_block_height: 1000 } });

      // Start the relayer
      await relayer.start();

      const sendSpy = jest.spyOn(mockEthereumSigner as any, 'sendTransaction');

      // Inject swap_order_created via EVENT_JSON log at block 1001
      const createdBlock = 1001;
      const createdChunkHash = `chunk-hash-${createdBlock}`;
      const createdTxHash = 'abcdEFGH1234567890abcdEFGH1234567890abc2';

      mockNearProvider.setMockChunk(createdChunkHash, {
        transactions: [
          {
            hash: createdTxHash,
            signer_id: 'test.near',
            receiver_id: (relayer as any).config.escrowContractId,
            actions: [],
          },
        ],
        receipts: [
          {
            outcome: {
              logs: [
                'EVENT_JSON:' +
                  JSON.stringify({
                    event: 'swap_order_created',
                    data: {
                      order_id: 'integration-order-123',
                      initiator: 'test.near',
                      recipient: '0x1234567890123456789012345678901234567890',
                      amount: '1000000000000000000',
                      secret_hash: '0x' + '12'.repeat(32),
                      timelock: Math.floor(Date.now() / 1000) + 86400,
                    },
                  }),
              ],
              receipt_ids: [],
              gas_burnt: 0,
              status: { SuccessValue: '' },
            },
          },
        ],
      } as any);

      // Advance status so poller processes created block
      mockNearProvider.setMockStatus({ sync_info: { latest_block_height: createdBlock } });
      await new Promise((r) => setTimeout(r, 80));

      // Verify the transaction was sent once for escrow creation
      expect(sendSpy).toHaveBeenCalledTimes(1);

      // Prepare escrow details for completion path
      mockEthereumProvider.setMockEscrow({
        escrowAddress: '0x9876543210987654321098765432109876543210',
        initiator: 'test.near',
        recipient: '0x1234567890123456789012345678901234567890',
        amount: '1000000000000000000',
        secretHash: '0x' + '12'.repeat(32),
        timelock: Math.floor(Date.now() / 1000) + 86400,
        status: 'active'
      });

      // Inject swap_order_completed via EVENT_JSON log at block 1002
      const completedBlock = 1002;
      const completedChunkHash = `chunk-hash-${completedBlock}`;
      const completedTxHash = 'abcdEFGH1234567890abcdEFGH1234567890abc3';

      mockNearProvider.setMockChunk(completedChunkHash, {
        transactions: [
          {
            hash: completedTxHash,
            signer_id: 'test.near',
            receiver_id: (relayer as any).config.escrowContractId,
            actions: [],
          },
        ],
        receipts: [
          {
            outcome: {
              logs: [
                'EVENT_JSON:' +
                  JSON.stringify({
                    event: 'swap_order_completed',
                    data: {
                      order_id: 'integration-order-123',
                      secret: '0x' + '12'.repeat(32),
                    },
                  }),
              ],
              receipt_ids: [],
              gas_burnt: 0,
              status: { SuccessValue: '' },
            },
          },
        ],
      } as any);

      // Advance status so poller processes completed block
      mockNearProvider.setMockStatus({ sync_info: { latest_block_height: completedBlock } });
      await new Promise((r) => setTimeout(r, 80));

      // Verify the follow-up transaction was sent
      expect(sendSpy).toHaveBeenCalledTimes(2);
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
          ethereum: {
            rpcUrl: 'http://localhost:8545',
            privateKey: '0x' + '11'.repeat(32)
          },
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
          ethereum: {
            rpcUrl: 'http://localhost:8545',
            privateKey: '0x' + '11'.repeat(32)
          },
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
        sourceChain: 'ETH' as 'ETH',
        destChain: 'NEAR' as 'NEAR',
        sender: '0x1234567890123456789012345678901234567890',
        recipient: 'test.near',
        amount: '1000000000000000000',
        token: '0x0000000000000000000000000000000000000000',
        data: {
          secretHash: '0x' + '12'.repeat(32),
          timelock: Math.floor(Date.now() / 1000) + 3600,
          txHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
        },
        timestamp: Date.now()
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
      
      const message: CrossChainMessage = {
        messageId: 'test-swap-1',
        type: MessageType.DEPOSIT,
        sourceChain: 'NEAR' as 'NEAR',
        destChain: 'ETH' as 'ETH',
        sender: 'sender.near',
        recipient: '0x1234567890123456789012345678901234567890',
        amount: '1000000000000000000', // 1 NEAR
        token: 'NEAR',
        timestamp: Math.floor(Date.now() / 1000), // Convert to Unix timestamp
        data: {
          // Add any additional data required for the deposit
          secretHash: '0x' + '12'.repeat(32),
          timelock: Math.floor(Date.now() / 1000) + 86400, // 24 hours from now
          txHash: 'abcdEFGH1234567890abcdEFGH1234567890abc1' // NEAR tx hash format (no 0x)
        }
      };
      
      mockNearAccount.setMockViewFunctionResult({
        initiator: 'test.near',
        recipient: '0x1234567890123456789012345678901234567890',
        amount: '1000000000000000000',
        secret_hash: '0x' + '12'.repeat(32),
        timelock: Math.floor(Date.now() / 1000) + 86400,
        status: 'active'
      });
      
      mockEthereumProvider.setMockEscrow({
        escrowAddress: '0x9876543210987654321098765432109876543210',
        initiator: 'test.near',
        recipient: '0x1234567890123456789012345678901234567890',
        amount: '1000000000000000000',
        secretHash: '0x' + '12'.repeat(32),
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
        sourceChain: 'ETH' as 'ETH',
        destChain: 'NEAR' as 'NEAR',
        sender: '0x1234567890123456789012345678901234567890',
        recipient: 'test.near',
        amount: '1000000000000000000',
        token: '0x0000000000000000000000000000000000000000',
        data: {
          txHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
        },
        timestamp: Date.now()
      };
      
      await relayer.processMessage(depositMessage);
      await relayer.processMessage(depositMessage);
      
      expect(relayer.getProcessedMessageCount()).toBe(1);
    });
  });

  describe('Event Handling', () => {
    test('should handle swap order created event', async () => {
      const { relayer, mockNearProvider, mockEthereumProvider, mockEthereumSigner } = setupTest();
      
      mockEthereumProvider.setMockTransactionReceipt({
        status: 1,
        transactionHash: '0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321',
        blockNumber: 12346,
        gasUsed: '100000'
      });

      // Start from baseline height and start relayer
      mockNearProvider.setMockStatus({ sync_info: { latest_block_height: 2000 } });
      await relayer.start();

      const sendSpy = jest.spyOn(mockEthereumSigner as any, 'sendTransaction');

      // Inject swap_order_created via EVENT_JSON log at next block
      const blockHeight = 2001;
      const chunkHash = `chunk-hash-${blockHeight}`;
      const txHash = 'abcdEFGH1234567890abcdEFGH1234567890abc4';

      mockNearProvider.setMockChunk(chunkHash, {
        transactions: [
          {
            hash: txHash,
            signer_id: 'sender.near',
            receiver_id: (relayer as any).config.escrowContractId,
            actions: [],
          },
        ],
        receipts: [
          {
            outcome: {
              logs: [
                'EVENT_JSON:' +
                  JSON.stringify({
                    event: 'swap_order_created',
                    data: {
                      order_id: 'test-order-1',
                      initiator: 'sender.near',
                      recipient: '0x1234567890123456789012345678901234567890',
                      amount: '1000000000000000000',
                      secret_hash: '0x' + '12'.repeat(32),
                      timelock: Math.floor(Date.now() / 1000) + 86400,
                    },
                  }),
              ],
              receipt_ids: [],
              gas_burnt: 0,
              status: { SuccessValue: '' },
            },
          },
        ],
      } as any);

      mockNearProvider.setMockStatus({ sync_info: { latest_block_height: blockHeight } });
      await new Promise((r) => setTimeout(r, 80));

      // Verify the transaction was sent via signer
      expect(sendSpy).toHaveBeenCalled();
    });
  });
});
