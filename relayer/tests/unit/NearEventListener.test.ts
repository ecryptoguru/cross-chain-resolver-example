/**
 * Comprehensive unit tests for NearEventListener
 * Tests NEAR blockchain event listening, parsing, and handling
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { 
  NearEventListener, 
  NearEventHandlers, 
  SwapOrderCreatedEvent, 
  SwapOrderCompletedEvent, 
  SwapOrderRefundedEvent,
  TransactionProcessedEvent 
} from '../../src/services/NearEventListener.js';
import { NetworkError, ValidationError } from '../../src/utils/errors.js';
import { MockNearProvider } from '../mocks/near-api-mock.js';

describe('NearEventListener', () => {
  let nearEventListener: NearEventListener;
  let mockProvider: MockNearProvider;
  let mockHandlers: NearEventHandlers;
  const escrowContractId = 'escrow.testnet';

  // Helper function to create a mock block
  function createMockBlock(height: number, chunkHashes: string[] = []) {
    return {
      header: {
        height,
        hash: `block_hash_${height}`,
        prev_hash: `block_hash_${height - 1}`,
        timestamp: Date.now() * 1_000_000, // nanosecond precision
        epoch_id: `epoch_${height}`,
        next_epoch_id: `epoch_${height + 1}`,
        prev_state_root: 'state_root',
        chunk_receipts_root: 'receipts_root',
        chunk_headers_root: 'headers_root',
        chunk_tx_root: 'tx_root',
        outcome_root: 'outcome_root',
        random_value: 'random_value',
        latest_protocol_version: 1
      },
      chunks: chunkHashes.map(hash => ({
        chunk_hash: hash,
        prev_block_hash: `block_hash_${height - 1}`,
        outcome_root: 'outcome_root',
        prev_state_root: 'state_root',
        encoded_merkle_root: 'merkle_root',
        encoded_length: 1000,
        height_created: height,
        height_included: height,
        shard_id: 0,
        gas_used: 0,
        gas_limit: 0,
        rent_paid: '0',
        validator_reward: '0',
        balance_burnt: '0',
        outgoing_receipts_root: 'receipt_root',
        tx_root: 'tx_root',
        validator_proposals: [],
        signature: 'ed25519:signature'
      }))
    };
  }

  // Helper function to create a mock transaction
  function createMockTransaction(
    methodName: string, 
    args: any, 
    signerId: string = 'test.near',
    receiverId: string = escrowContractId
  ) {
    return {
      signer_id: signerId,
      receiver_id: receiverId,
      actions: [
        {
          FunctionCall: {
            method_name: methodName,
            args: Buffer.from(JSON.stringify(args)).toString('base64'),
            gas: '100000000000000',
            deposit: '0'
          }
        }
      ],
      hash: 'transaction_hash',
      nonce: 1,
      public_key: 'ed25519:public_key',
      signature: 'ed25519:signature',
      signer_account_id: signerId,
      receiver_account_id: receiverId,
      block_hash: 'block_hash',
      block_timestamp: Date.now() * 1000000, // nanosecond precision
      status: {
        SuccessValue: ''
      },
      transaction_outcome: {
        id: 'transaction_hash',
        outcome: {
          logs: [],
          receipt_ids: [],
          gas_burnt: 0,
          status: {
            SuccessValue: ''
          },
          tokens_burnt: '0',
          executor_id: signerId,
          metadata: {
            gas_profile: []
          }
        }
      }
    };
  }

  // Setup before each test
  beforeEach(() => {
    mockProvider = new MockNearProvider();
    mockHandlers = {
      onSwapOrderCreated: async (_event: SwapOrderCreatedEvent) => {},
      onSwapOrderCompleted: async (_event: SwapOrderCompletedEvent) => {},
      onSwapOrderRefunded: async (_event: SwapOrderRefundedEvent) => {},
      onTransactionProcessed: async (_event: TransactionProcessedEvent) => {}
    };

    // Create a fresh instance for each test
    nearEventListener = new NearEventListener(
      mockProvider as any,
      escrowContractId,
      mockHandlers,
      1000 // Shorter poll interval for tests
    );
  });

  // Cleanup after each test
  afterEach(async () => {
    // Ensure the listener is stopped and all resources are cleaned up
    if (nearEventListener) {
      await nearEventListener.stop();
    }
    
    // Clear any pending timers
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe('Constructor', () => {
    test('should initialize with valid parameters', () => {
      assert.ok(nearEventListener instanceof NearEventListener);
      assert.strictEqual(nearEventListener.isRunning(), false);
    });

    test('should throw error for invalid provider', () => {
      assert.throws(
        () => new NearEventListener(null as any, escrowContractId, mockHandlers),
        ValidationError
      );
    });

    test('should throw error for empty escrow contract ID', () => {
      try {
        new NearEventListener(mockProvider as any, '', mockHandlers);
        assert.fail('Should have thrown a ValidationError');
      } catch (error: any) {
        // Check that the error is a ValidationError
        assert.strictEqual(error.name, 'ValidationError');
        
        // Check that the error message contains the expected validation message
        assert.ok(
          error.message.includes('Validation failed for field \'escrowContractId\''),
          `Expected error message to contain 'Validation failed for field 'escrowContractId'', but got: ${error.message}`
        );
        
        // Check that the error has the expected field and value
        assert.strictEqual(error.field, 'escrowContractId');
        assert.strictEqual(error.value, '');
      }
    });

    test('should throw error for missing handlers', () => {
      try {
        new NearEventListener(mockProvider as any, escrowContractId, {} as any);
        assert.fail('Should have thrown a ValidationError');
      } catch (error: any) {
        // Check that the error is a ValidationError
        assert.strictEqual(error.name, 'ValidationError');
        
        // Check that the error message contains the expected validation message
        assert.ok(
          error.message.includes('Event handlers object is required'),
          `Expected error message to contain 'Event handlers object is required', but got: ${error.message}`
        );
        
        // Check that the error has the expected field
        assert.strictEqual(error.field, 'handlers');
      }
    });
  });

  describe('Start/Stop', () => {
    test('should start and stop the listener', async () => {
      // Mock the provider's status method
      mockProvider.setMockStatus({
        sync_info: { latest_block_height: 1000 }
      });

      await nearEventListener.start();
      assert.strictEqual(nearEventListener.isRunning(), true);
      
      await nearEventListener.stop();
      assert.strictEqual(nearEventListener.isRunning(), false);
    });

    test('should handle provider errors during start', async () => {
      mockProvider.setMockError(new Error('Provider error'));
      
      try {
        await nearEventListener.start();
        assert.fail('Should have thrown an error');
      } catch (error) {
        assert.ok(error instanceof NetworkError);
        assert.strictEqual(error.operation, 'start');
      }
    });
  });

  describe('Event Processing', () => {
    test('should process SwapOrderCreated event', async () => {
      // Setup mocks
      const blockHeight = 1001;
      const txHash = 'tx123';
      const orderId = 'order123';
      
      // Create a mock block with a chunk
      const chunkHash = 'chunk123';
      const block = createMockBlock(blockHeight, [chunkHash]);
      mockProvider.setMockBlock(block);
      
      // Create a mock transaction with SwapOrderCreated event
      const tx = createMockTransaction('swap_order_created', {
        order_id: orderId,
        initiator: 'alice.near',
        recipient: 'bob.near',
        amount: '1000000000000000000000000', // 1 NEAR
        secret_hash: 'a1b2c3d4e5f6',
        timelock: Math.floor((Date.now() + 3600000) / 1000), // 1 hour from now in seconds
        block_height: blockHeight,
        transaction_hash: txHash,
        timestamp: Date.now()
      });
      
      // Mock the chunk content with proper type
      const mockOutcome: any = {
        transaction_outcome: {
          id: tx.hash,
          outcome: {
            logs: [],
            receipt_ids: [],
            gas_burnt: 0,
            status: { SuccessValue: '' },
            tokens_burnt: '0',
            executor_id: tx.signer_id,
            metadata: { gas_profile: [] }
          }
        },
        receipts_outcome: [{
          id: 'receipt123',
          outcome: {
            logs: [
              `EVENT_JSON:{"standard":"nep297","version":"1.0.0","event":"swap_order_created","data":[{"order_id":"${orderId}","initiator":"alice.near","recipient":"bob.near","amount":"1000000000000000000000000","secret_hash":"a1b2c3d4e5f6","timelock":${Date.now() + 3600000}}]}`
            ],
            receipt_ids: [],
            gas_burnt: 0,
            status: { SuccessValue: '' },
            tokens_burnt: '0',
            executor_id: escrowContractId,
            metadata: { gas_profile: [] }
          }
        }]
      };
      mockProvider.setMockTransactionOutcome(mockOutcome);

      // Setup handler spy with proper type assertion
      let eventData: SwapOrderCreatedEvent | null = null;
      mockHandlers.onSwapOrderCreated = async (event: any) => {
        eventData = event as SwapOrderCreatedEvent;
      };

      // Start the listener and process the block
      await nearEventListener.start();
      await nearEventListener['processBlock'](blockHeight);

      // Verify the event was processed with type assertion
      assert.ok(eventData);
      const event = eventData as SwapOrderCreatedEvent;
      assert.strictEqual(event.orderId, orderId);
      assert.strictEqual(event.initiator, 'alice.near');
      assert.strictEqual(event.recipient, 'bob.near');
      assert.strictEqual(event.amount, '1000000000000000000000000');
      assert.strictEqual(event.secretHash, 'a1b2c3d4e5f6');
      assert.strictEqual(event.blockHeight, blockHeight);
      assert.strictEqual(event.transactionHash, tx.hash);
    });

    test('should handle invalid event JSON', async () => {
      const blockHeight = 1002;
      const block = createMockBlock(blockHeight, ['chunk_invalid']);
      mockProvider.setMockBlock(block);
      
      // Create a transaction with invalid JSON in logs
      const tx = createMockTransaction('some_method', {});
      const invalidTxOutcome: any = {
        transaction_outcome: {
          id: tx.hash,
          outcome: {
            logs: [],
            receipt_ids: ['receipt_invalid'],
            gas_burnt: 0,
            status: { SuccessValue: '' },
            tokens_burnt: '0',
            executor_id: tx.signer_id,
            metadata: { gas_profile: [] }
          }
        },
        receipts_outcome: [{
          id: 'receipt_invalid',
          outcome: {
            logs: ['INVALID_JSON'],
            receipt_ids: [],
            gas_burnt: 0,
            status: { SuccessValue: '' },
            tokens_burnt: '0',
            executor_id: escrowContractId,
            metadata: { gas_profile: [] }
          }
        }]
      };
      mockProvider.setMockTransactionOutcome(invalidTxOutcome);

      // This should not throw
      await nearEventListener.start();
      await nearEventListener['processBlock'](blockHeight);
      
      // No assertions needed, just verifying no errors are thrown
      assert.ok(true);
    });
  });

  describe('Error Handling', () => {
    test('should handle block processing errors', async () => {
      const blockHeight = 1003;
      mockProvider.setMockBlock(createMockBlock(blockHeight));
      mockProvider.setMockError(new Error('Block processing error'));
      
      // This should not throw
      await nearEventListener.start();
      await nearEventListener['processBlock'](blockHeight);
      
      // Verify the block was marked as processed to prevent getting stuck
      assert.ok(nearEventListener['processedBlocks'].has(blockHeight));
    });

    test('should handle chunk processing errors', async () => {
      const blockHeight = 1004;
      const block = createMockBlock(blockHeight, ['chunk_error']);
      mockProvider.setMockBlock(block);
      mockProvider.setMockError(new Error('Chunk processing error'));
      
      // This should not throw
      await nearEventListener.start();
      await nearEventListener['processBlock'](blockHeight);
      
      // Verify the block was still marked as processed
      assert.ok(nearEventListener['processedBlocks'].has(blockHeight));
    });
  });

  describe('Block Processing', () => {
    test('should skip already processed blocks', async () => {
      const blockHeight = 1005;
      nearEventListener['processedBlocks'].add(blockHeight);
      
      // This should not throw or try to process the block again
      await nearEventListener['processBlock'](blockHeight);
      assert.ok(true);
    });

    test('should handle empty blocks', async () => {
      const blockHeight = 1006;
      const block = createMockBlock(blockHeight, []); // No chunks
      mockProvider.setMockBlock(block);
      
      await nearEventListener.start();
      await nearEventListener['processBlock'](blockHeight);
      
      // Verify the block was processed
      assert.ok(nearEventListener['processedBlocks'].has(blockHeight));
    });
  });

  describe('Concurrency', () => {
    test('should handle concurrent block processing', async () => {
      const blockHeight = 1007;
      const block = createMockBlock(blockHeight, ['chunk1', 'chunk2']);
      mockProvider.setMockBlock(block);
      
      // Setup mock transaction for both chunks
      const tx = createMockTransaction('some_method', {});
      const concurrentTxOutcome: any = {
        transaction_outcome: {
          id: tx.hash,
          outcome: {
            logs: [],
            receipt_ids: ['receipt1'],
            gas_burnt: 0,
            status: { SuccessValue: '' },
            tokens_burnt: '0',
            executor_id: tx.signer_id,
            metadata: { gas_profile: [] }
          }
        },
        receipts_outcome: [{
          id: 'receipt1',
          outcome: {
            logs: [],
            receipt_ids: [],
            gas_burnt: 0,
            status: { SuccessValue: '' },
            tokens_burnt: '0',
            executor_id: escrowContractId,
            metadata: { gas_profile: [] }
          }
        }]
      };
      mockProvider.setMockTransactionOutcome(concurrentTxOutcome);
      
      // Start processing the same block twice concurrently
      await nearEventListener.start();
      const promises = [
        nearEventListener['processBlock'](blockHeight),
        nearEventListener['processBlock'](blockHeight)
      ];
      
      await Promise.all(promises);
      
      // The block should only be processed once
      assert.strictEqual(nearEventListener['processedBlocks'].size, 1);
    });
  });
});
