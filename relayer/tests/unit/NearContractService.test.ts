/**
 * Comprehensive unit tests for NearContractService
 * Tests NEAR contract interactions, escrow operations, and error handling
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { NearContractService, NearSwapOrderParams, NearEscrowUpdateParams } from '../../src/services/NearContractService.js';
import { ContractError, ValidationError } from '../../src/utils/errors.js';
import { MockNearAccount, MockNearProvider, MockNearConnection } from '../mocks/near-api-mock.js';

describe('NearContractService', () => {
  let nearContractService: NearContractService;
  let mockNearAccount: MockNearAccount;
  let mockProvider: any;
  let mockConnection: any;
  const escrowContractId = 'escrow.testnet';

  // Setup before each test
  beforeEach(() => {
    mockProvider = new MockNearProvider();
    mockConnection = new MockNearConnection(mockProvider);
    mockNearAccount = new MockNearAccount('test.testnet', mockConnection);
    nearContractService = new NearContractService(mockNearAccount as any, escrowContractId);
    
    // Verify setup
    assert(nearContractService instanceof NearContractService);
    assert.strictEqual(typeof mockNearAccount, 'object');
    assert.strictEqual(typeof escrowContractId, 'string');
  });

  describe('Constructor', () => {
    test('should initialize with valid parameters', () => {
      const service = new NearContractService(mockNearAccount as any, escrowContractId);
      assert(service instanceof NearContractService);
    });

    test('should throw error for invalid NEAR account', () => {
      assert.throws(() => {
        new NearContractService(null as any, escrowContractId);
      }, ValidationError);
    });

    test('should throw error for missing account ID', () => {
      const invalidAccount = { ...mockNearAccount, accountId: '' };
      assert.throws(() => {
        new NearContractService(invalidAccount as any, escrowContractId);
      }, ValidationError);
    });

    test('should throw error for missing connection', () => {
      const invalidAccount = { ...mockNearAccount, connection: null as any };
      assert.throws(() => {
        new NearContractService(invalidAccount as any, escrowContractId);
      }, ValidationError);
    });

    test('should throw error for invalid escrow contract ID', () => {
      assert.throws(() => {
        new NearContractService(mockNearAccount as any, '');
      }, ValidationError);

      assert.throws(() => {
        new NearContractService(mockNearAccount as any, 'invalid contract id');
      }, ValidationError);
    });
  });

  describe('getContractDetails', () => {
    test('should get escrow contract details', async () => {
      // Mock escrow contract state
      mockProvider.setMockQueryResult({
        result: Buffer.from(JSON.stringify({
          total_escrows: 5,
          active_escrows: 3,
          completed_escrows: 2
        })).toString('base64').split('').map((c: string) => c.charCodeAt(0))
      });

      const details = await nearContractService.getContractDetails(escrowContractId);
      
      assert(details);
      assert.strictEqual(details.total_escrows, 5);
      assert.strictEqual(details.active_escrows, 3);
      assert.strictEqual(details.completed_escrows, 2);
    });

    test('should get generic contract details', async () => {
      const contractId = 'other.testnet';
      
      // Mock account view result
      mockProvider.setMockQueryResult({
        amount: '1000000000000000000000000',
        locked: '0',
        code_hash: 'ABC123',
        storage_usage: 1000
      });

      const details = await nearContractService.getContractDetails(contractId);
      
      assert(details);
      assert.strictEqual(details.accountId, contractId);
      assert(details.amount);
      assert(details.code_hash);
    });

    test('should throw error for invalid contract ID', async () => {
      await assert.rejects(
        nearContractService.getContractDetails(''),
        ValidationError
      );

      await assert.rejects(
        nearContractService.getContractDetails('invalid contract id'),
        ValidationError
      );
    });

    test('should handle contract query errors', async () => {
      mockProvider.setMockError(new Error('Contract not found'));

      await assert.rejects(
        nearContractService.getContractDetails('nonexistent.testnet'),
        ContractError
      );
    });
  });

  describe('executeTransaction', () => {
    test('should execute transaction successfully', async () => {
      const contractId = 'test.testnet';
      const method = 'test_method';
      const params = [{ arg1: 'value1', arg2: 42 }];

      mockNearAccount.setMockFunctionCallResult({
        transaction: { hash: 'tx123' },
        receipts: []
      });

      const result = await nearContractService.executeTransaction(contractId, method, params);
      
      assert(result);
      assert(result.transaction);
      assert.strictEqual(result.transaction.hash, 'tx123');
    });

    test('should handle empty params array', async () => {
      const contractId = 'test.testnet';
      const method = 'test_method';
      const params: any[] = [];

      mockNearAccount.setMockFunctionCallResult({
        transaction: { hash: 'tx456' },
        receipts: []
      });

      const result = await nearContractService.executeTransaction(contractId, method, params);
      
      assert(result);
      assert.strictEqual(result.transaction.hash, 'tx456');
    });

    test('should throw error for invalid contract ID', async () => {
      await assert.rejects(
        nearContractService.executeTransaction('', 'method', []),
        ValidationError
      );
    });

    test('should throw error for invalid method name', async () => {
      await assert.rejects(
        nearContractService.executeTransaction('test.testnet', '', []),
        ValidationError
      );

      await assert.rejects(
        nearContractService.executeTransaction('test.testnet', null as any, []),
        ValidationError
      );
    });

    test('should throw error for invalid params', async () => {
      await assert.rejects(
        nearContractService.executeTransaction('test.testnet', 'method', null as any),
        ValidationError
      );
    });

    test('should handle transaction execution errors', async () => {
      mockNearAccount.setMockError(new Error('Transaction failed'));

      await assert.rejects(
        nearContractService.executeTransaction('test.testnet', 'method', []),
        ContractError
      );
    });
  });

  describe('createSwapOrder', () => {
    test('should create swap order successfully', async () => {
      const params: NearSwapOrderParams = {
        recipient: 'recipient.testnet',
        hashlock: '0x' + 'a'.repeat(64),
        timelockDuration: 3600,
        attachedDeposit: BigInt('1000000000000000000000000') // 1 NEAR
      };

      mockNearAccount.setMockFunctionCallResult({
        transaction: { hash: 'order_tx123' },
        receipts: [{ 
          outcome: { 
            logs: ['Order created with ID: order_123'] 
          } 
        }]
      });

      const result = await nearContractService.createSwapOrder(params);
      
      assert(result);
      assert(result.transaction);
      assert.strictEqual(result.transaction.hash, 'order_tx123');
    });

    test('should validate swap order parameters', async () => {
      const invalidParams = [
        // Invalid recipient
        {
          recipient: '',
          hashlock: '0x' + 'a'.repeat(64),
          timelockDuration: 3600,
          attachedDeposit: BigInt('1000000000000000000000000')
        },
        // Invalid hashlock
        {
          recipient: 'recipient.testnet',
          hashlock: 'invalid_hash',
          timelockDuration: 3600,
          attachedDeposit: BigInt('1000000000000000000000000')
        },
        // Invalid timelock duration
        {
          recipient: 'recipient.testnet',
          hashlock: '0x' + 'a'.repeat(64),
          timelockDuration: -1,
          attachedDeposit: BigInt('1000000000000000000000000')
        },
        // Invalid attached deposit
        {
          recipient: 'recipient.testnet',
          hashlock: '0x' + 'a'.repeat(64),
          timelockDuration: 3600,
          attachedDeposit: BigInt('0')
        }
      ];

      for (const params of invalidParams) {
        await assert.rejects(
          nearContractService.createSwapOrder(params as NearSwapOrderParams),
          ValidationError
        );
      }
    });

    test('should handle contract call errors', async () => {
      const params: NearSwapOrderParams = {
        recipient: 'recipient.testnet',
        hashlock: '0x' + 'a'.repeat(64),
        timelockDuration: 3600,
        attachedDeposit: BigInt('1000000000000000000000000')
      };

      mockNearAccount.setMockError(new Error('Insufficient balance'));

      await assert.rejects(
        nearContractService.createSwapOrder(params),
        ContractError
      );
    });
  });

  describe('completeSwapOrder', () => {
    test('should complete swap order successfully', async () => {
      const orderId = 'order_123';
      const secret = '0x' + 'b'.repeat(64);

      mockNearAccount.setMockFunctionCallResult({
        transaction: { hash: 'complete_tx123' },
        receipts: [{ 
          outcome: { 
            logs: [`Order ${orderId} completed successfully`] 
          } 
        }]
      });

      const result = await nearContractService.completeSwapOrder(orderId, secret);
      
      assert(result);
      assert(result.transaction);
      assert.strictEqual(result.transaction.hash, 'complete_tx123');
    });

    test('should validate order ID and secret', async () => {
      await assert.rejects(
        nearContractService.completeSwapOrder('', 'secret'),
        ValidationError
      );

      await assert.rejects(
        nearContractService.completeSwapOrder('order_123', ''),
        ValidationError
      );

      await assert.rejects(
        nearContractService.completeSwapOrder('order_123', 'invalid_secret'),
        ValidationError
      );
    });

    test('should handle completion errors', async () => {
      mockNearAccount.setMockError(new Error('Order not found'));

      await assert.rejects(
        nearContractService.completeSwapOrder('nonexistent_order', '0x' + 'b'.repeat(64)),
        ContractError
      );
    });
  });

  describe('refundSwapOrder', () => {
    test('should refund swap order successfully', async () => {
      const orderId = 'order_123';

      mockNearAccount.setMockFunctionCallResult({
        transaction: { hash: 'refund_tx123' },
        receipts: [{ 
          outcome: { 
            logs: [`Order ${orderId} refunded successfully`] 
          } 
        }]
      });

      const result = await nearContractService.refundSwapOrder(orderId);
      
      assert(result);
      assert(result.transaction);
      assert.strictEqual(result.transaction.hash, 'refund_tx123');
    });

    test('should validate order ID', async () => {
      await assert.rejects(
        nearContractService.refundSwapOrder(''),
        ValidationError
      );
    });

    test('should handle refund errors', async () => {
      mockNearAccount.setMockError(new Error('Timelock not expired'));

      await assert.rejects(
        nearContractService.refundSwapOrder('order_123'),
        ContractError
      );
    });
  });

  describe('getEscrowDetails', () => {
    test('should get escrow details successfully', async () => {
      const orderId = 'order_123';
      const mockEscrowDetails = {
        orderId,
        initiator: 'initiator.testnet',
        recipient: 'recipient.testnet',
        amount: '1000000000000000000000000',
        hashlock: '0x' + 'a'.repeat(64),
        timelock: Date.now() + 3600000,
        status: 'active',
        secret: null,
        createdAt: Date.now(),
        completedAt: null
      };

      mockProvider.setMockQueryResult({
        result: Buffer.from(JSON.stringify(mockEscrowDetails)).toString('base64').split('').map((c: string) => c.charCodeAt(0))
      });

      const details = await nearContractService.getEscrowDetails(orderId);
      
      assert(details);
      assert.strictEqual(details.id, orderId);
      assert.strictEqual(details.initiator, 'initiator.testnet');
      assert.strictEqual(details.status, 'active');
    });

    test('should return null for non-existent escrow', async () => {
      mockProvider.setMockQueryResult({
        result: Buffer.from('null').toString('base64').split('').map((c: string) => c.charCodeAt(0))
      });

      const details = await nearContractService.getEscrowDetails('nonexistent_order');
      
      assert.strictEqual(details, null);
    });

    test('should validate order ID', async () => {
      await assert.rejects(
        nearContractService.getEscrowDetails(''),
        ValidationError
      );
    });

    test('should handle query errors', async () => {
      mockProvider.setMockError(new Error('Query failed'));

      await assert.rejects(
        nearContractService.getEscrowDetails('order_123'),
        ContractError
      );
    });
  });

  describe('updateEscrow', () => {
    test('should update escrow successfully', async () => {
      const orderId = 'order_123';
      const updates: NearEscrowUpdateParams = {
        status: 'completed',
        secret: '0x' + 'b'.repeat(64),
        completedAt: Date.now()
      };

      mockNearAccount.setMockFunctionCallResult({
        transaction: { hash: 'update_tx123' },
        receipts: []
      });

      const result = await nearContractService.updateEscrow(orderId, updates);
      
      assert(result);
      assert(result.transaction);
      assert.strictEqual(result.transaction.hash, 'update_tx123');
    });

    test('should validate update parameters', async () => {
      await assert.rejects(
        nearContractService.updateEscrow('', {}),
        ValidationError
      );

      await assert.rejects(
        nearContractService.updateEscrow('order_123', null as any),
        ValidationError
      );
    });

    test('should handle update errors', async () => {
      mockNearAccount.setMockError(new Error('Update failed'));

      await assert.rejects(
        nearContractService.updateEscrow('order_123', { status: 'completed' }),
        ContractError
      );
    });
  });

  describe('findEscrowBySecretHash', () => {
    test('should find escrow by secret hash', async () => {
      const secretHash = '0x' + 'a'.repeat(64);
      const mockEscrow = {
        orderId: 'order_123',
        initiator: 'initiator.testnet',
        recipient: 'recipient.testnet',
        hashlock: secretHash,
        status: 'active'
      };

      mockProvider.setMockQueryResult({
        result: Buffer.from(JSON.stringify(mockEscrow)).toString('base64').split('').map((c: string) => c.charCodeAt(0))
      });

      const escrow = await nearContractService.findEscrowBySecretHash(secretHash);
      
      assert(escrow);
      assert.strictEqual(escrow.secret_hash, secretHash);
      assert.strictEqual(escrow.id, 'order_123');
    });

    test('should return null when escrow not found', async () => {
      mockProvider.setMockQueryResult({
        result: Buffer.from('null').toString('base64').split('').map((c: string) => c.charCodeAt(0))
      });

      const escrow = await nearContractService.findEscrowBySecretHash('0x' + 'c'.repeat(64));
      
      assert.strictEqual(escrow, null);
    });

    test('should validate secret hash', async () => {
      await assert.rejects(
        nearContractService.findEscrowBySecretHash(''),
        ValidationError
      );

      await assert.rejects(
        nearContractService.findEscrowBySecretHash('invalid_hash'),
        ValidationError
      );
    });
  });

  describe('findEscrowByInitiator', () => {
    test('should find escrows by initiator', async () => {
      const initiator = 'initiator.testnet';
      const mockEscrows = [
        {
          orderId: 'order_1',
          initiator,
          amount: '1000000000000000000000000',
          status: 'active'
        },
        {
          orderId: 'order_2',
          initiator,
          amount: '2000000000000000000000000',
          status: 'completed'
        }
      ];

      mockProvider.setMockQueryResult({
        result: Buffer.from(JSON.stringify(mockEscrows)).toString('base64').split('').map((c: string) => c.charCodeAt(0))
      });

      const escrows = await nearContractService.findEscrowByInitiator(initiator);
      
      assert(Array.isArray(escrows));
      assert.strictEqual(escrows.length, 2);
      assert.strictEqual(escrows[0].initiator, initiator);
      assert.strictEqual(escrows[1].initiator, initiator);
    });

    test('should find escrows by initiator and amount', async () => {
      const initiator = 'initiator.testnet';
      const amount = '1000000000000000000000000';
      
      mockProvider.setMockQueryResult({
        result: Buffer.from(JSON.stringify([{
          orderId: 'order_1',
          initiator,
          amount,
          status: 'active'
        }])).toString('base64').split('').map((c: string) => c.charCodeAt(0))
      });

      const escrows = await nearContractService.findEscrowByInitiator(initiator, amount);
      
      assert(Array.isArray(escrows));
      assert.strictEqual(escrows.length, 1);
      assert.strictEqual(escrows[0].amount, amount);
    });

    test('should validate initiator', async () => {
      await assert.rejects(
        nearContractService.findEscrowByInitiator(''),
        ValidationError
      );

      await assert.rejects(
        nearContractService.findEscrowByInitiator('invalid account'),
        ValidationError
      );
    });
  });

  describe('findEscrowByRecipient', () => {
    test('should find escrows by recipient', async () => {
      const recipient = 'recipient.testnet';
      const mockEscrows = [
        {
          orderId: 'order_1',
          recipient,
          status: 'active'
        }
      ];

      mockProvider.setMockQueryResult({
        result: Buffer.from(JSON.stringify(mockEscrows)).toString('base64').split('').map((c: string) => c.charCodeAt(0))
      });

      const escrows = await nearContractService.findEscrowByRecipient(recipient);
      
      assert(Array.isArray(escrows));
      assert.strictEqual(escrows.length, 1);
      assert.strictEqual(escrows[0].recipient, recipient);
    });

    test('should validate recipient', async () => {
      await assert.rejects(
        nearContractService.findEscrowByRecipient(''),
        ValidationError
      );
    });
  });

  describe('findEscrowsByStatus', () => {
    test('should find escrows by status', async () => {
      const status = 'active';
      const mockEscrows = [
        { orderId: 'order_1', status },
        { orderId: 'order_2', status }
      ];

      mockProvider.setMockQueryResult({
        result: Buffer.from(JSON.stringify(mockEscrows)).toString('base64').split('').map((c: string) => c.charCodeAt(0))
      });

      const escrows = await nearContractService.findEscrowsByStatus(status);
      
      assert(Array.isArray(escrows));
      assert.strictEqual(escrows.length, 2);
      assert.strictEqual(escrows[0].status, status);
      assert.strictEqual(escrows[1].status, status);
    });

    test('should validate status', async () => {
      await assert.rejects(
        nearContractService.findEscrowsByStatus(''),
        ValidationError
      );
    });
  });

  describe('getEscrowContractState', () => {
    test('should get contract state successfully', async () => {
      const mockState = {
        total_escrows: 10,
        active_escrows: 5,
        completed_escrows: 3,
        refunded_escrows: 2
      };

      mockProvider.setMockQueryResult({
        result: Buffer.from(JSON.stringify(mockState)).toString('base64').split('').map((c: string) => c.charCodeAt(0))
      });

      const state = await nearContractService.getEscrowContractState();
      
      assert(state);
      assert.strictEqual(state.total_escrows, 10);
      assert.strictEqual(state.active_escrows, 5);
    });

    test('should handle query errors', async () => {
      mockProvider.setMockError(new Error('Contract state query failed'));

      await assert.rejects(
        nearContractService.getEscrowContractState(),
        ContractError
      );
    });
  });

  describe('Error Handling', () => {
    test('should handle network errors gracefully', async () => {
      mockProvider.setMockError(new Error('Network timeout'));

      await assert.rejects(
        nearContractService.getContractDetails(escrowContractId),
        ContractError
      );
    });

    test('should handle malformed responses', async () => {
      mockProvider.setMockQueryResult({
        result: 'invalid_base64'
      });

      await assert.rejects(
        nearContractService.getEscrowDetails('order_123'),
        ContractError
      );
    });

    test('should sanitize sensitive data in logs', () => {
      const sensitiveArgs = {
        secret: 'secret_value',
        private_key: 'private_key_value',
        normal_field: 'normal_value'
      };

      const sanitized = (nearContractService as any).sanitizeArgsForLogging(sensitiveArgs);
      
      assert.strictEqual(sanitized.secret, '***redacted***');
      assert.strictEqual(sanitized.private_key, '***redacted***');
      assert.strictEqual(sanitized.normal_field, 'normal_value');
    });
  });

  describe('Edge Cases', () => {
    test('should handle very large amounts', async () => {
      const params: NearSwapOrderParams = {
        recipient: 'recipient.testnet',
        hashlock: '0x' + 'a'.repeat(64),
        timelockDuration: 3600,
        attachedDeposit: BigInt('1000000000000000000000000000000') // Very large amount
      };

      mockNearAccount.setMockFunctionCallResult({
        transaction: { hash: 'large_amount_tx' },
        receipts: []
      });

      const result = await nearContractService.createSwapOrder(params);
      assert(result);
    });

    test('should handle maximum timelock duration', async () => {
      const params: NearSwapOrderParams = {
        recipient: 'recipient.testnet',
        hashlock: '0x' + 'a'.repeat(64),
        timelockDuration: Number.MAX_SAFE_INTEGER,
        attachedDeposit: BigInt('1000000000000000000000000')
      };

      mockNearAccount.setMockFunctionCallResult({
        transaction: { hash: 'max_timelock_tx' },
        receipts: []
      });

      const result = await nearContractService.createSwapOrder(params);
      assert(result);
    });

    test('should handle empty query results', async () => {
      mockProvider.setMockQueryResult({
        result: Buffer.from('[]').toString('base64').split('').map((c: string) => c.charCodeAt(0))
      });

      const escrows = await nearContractService.findEscrowsByStatus('nonexistent');
      assert(Array.isArray(escrows));
      assert.strictEqual(escrows.length, 0);
    });
  });
});
