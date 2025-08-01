/**
 * Mock implementation for NEAR API JS used in relayer testing
 */

export interface MockNearTransaction {
  transaction_outcome: {
    id: string;
    outcome: {
      status: { SuccessValue?: string; Failure?: any };
      logs: string[];
      receipt_ids: string[];
      gas_burnt: number;
      tokens_burnt: string;
    };
  };
  receipts_outcome: Array<{
    id: string;
    outcome: {
      status: { SuccessValue?: string; Failure?: any };
      logs: string[];
      gas_burnt: number;
      tokens_burnt: string;
    };
  }>;
}

export interface MockNearBlock {
  header: {
    height: number;
    hash: string;
    prev_hash: string;
    timestamp: number;
  };
  chunks: Array<{
    chunk_hash: string;
    prev_block_hash: string;
    outcome_root: string;
    prev_state_root: string;
    encoded_merkle_root: string;
    encoded_length: number;
    height_created: number;
    height_included: number;
    shard_id: number;
    gas_used: number;
    gas_limit: number;
    rent_paid: string;
    validator_reward: string;
    balance_burnt: string;
    outgoing_receipts_root: string;
    tx_root: string;
    validator_proposals: any[];
    signature: string;
  }>;
}

export interface MockEscrowDetails {
  id: string;
  initiator: string;
  recipient: string;
  amount: string;
  secret_hash: string;
  timelock: number;
  status: 'active' | 'completed' | 'refunded' | 'expired';
  created_at: number;
  secret?: string;
}

export class MockNearProvider {
  private blockHeight = 100000000;
  private transactions: Map<string, MockNearTransaction> = new Map();
  private blocks: Map<number, MockNearBlock> = new Map();
  private mockStatus: any = null;
  private mockError: Error | null = null;
  private mockBlock: MockNearBlock | null = null;
  private mockTransactionOutcome: MockNearTransaction | null = null;

  async status(): Promise<any> {
    if (this.mockError) {
      throw this.mockError;
    }
    
    if (this.mockStatus) {
      return this.mockStatus;
    }
    
    return {
      sync_info: {
        latest_block_height: this.blockHeight,
        latest_block_hash: '0x' + Math.random().toString(16).substr(2, 64),
        latest_block_time: Date.now() * 1000000
      },
      version: {
        version: '1.0.0',
        build: 'test'
      }
    };
  }

  async block(blockQuery: { blockId: string | number }): Promise<MockNearBlock> {
    if (this.mockError) {
      throw this.mockError;
    }
    
    if (this.mockBlock) {
      return this.mockBlock;
    }
    
    const height = typeof blockQuery.blockId === 'number' ? blockQuery.blockId : this.blockHeight;
    
    if (!this.blocks.has(height)) {
      const block: MockNearBlock = {
        header: {
          height,
          hash: '0x' + Math.random().toString(16).substr(2, 64),
          prev_hash: '0x' + Math.random().toString(16).substr(2, 64),
          timestamp: Date.now() * 1000000
        },
        chunks: [{
          chunk_hash: '0x' + Math.random().toString(16).substr(2, 64),
          prev_block_hash: '0x' + Math.random().toString(16).substr(2, 64),
          outcome_root: '0x' + Math.random().toString(16).substr(2, 64),
          prev_state_root: '0x' + Math.random().toString(16).substr(2, 64),
          encoded_merkle_root: '0x' + Math.random().toString(16).substr(2, 64),
          encoded_length: 1000,
          height_created: height,
          height_included: height,
          shard_id: 0,
          gas_used: 1000000,
          gas_limit: 1000000000,
          rent_paid: '0',
          validator_reward: '0',
          balance_burnt: '0',
          outgoing_receipts_root: '0x' + Math.random().toString(16).substr(2, 64),
          tx_root: '0x' + Math.random().toString(16).substr(2, 64),
          validator_proposals: [],
          signature: 'ed25519:' + Math.random().toString(16).substr(2, 128)
        }]
      };
      this.blocks.set(height, block);
    }

    return this.blocks.get(height)!;
  }

  async txStatus(txHash: string, accountId: string): Promise<MockNearTransaction> {
    if (this.mockError) {
      throw this.mockError;
    }
    
    if (this.mockTransactionOutcome) {
      return this.mockTransactionOutcome;
    }
    
    if (!this.transactions.has(txHash)) {
      const transaction: MockNearTransaction = {
        transaction_outcome: {
          id: txHash,
          outcome: {
            status: { SuccessValue: 'dGVzdA==' }, // base64 encoded "test"
            logs: [`EVENT_JSON:{"standard":"escrow","version":"1.0.0","event":"swap_order_created","data":{"order_id":"${Math.random().toString(36).substr(2, 9)}","initiator":"${accountId}","recipient":"recipient.testnet","amount":"1000000000000000000000000","secret_hash":"${'0x' + '3'.repeat(64)}","timelock":${Date.now() + 86400000}}}`],
            receipt_ids: [Math.random().toString(16).substr(2, 64)],
            gas_burnt: 1000000,
            tokens_burnt: '1000000000000000000000'
          }
        },
        receipts_outcome: [{
          id: Math.random().toString(16).substr(2, 64),
          outcome: {
            status: { SuccessValue: 'dGVzdA==' },
            logs: [],
            gas_burnt: 500000,
            tokens_burnt: '500000000000000000000'
          }
        }]
      };
      this.transactions.set(txHash, transaction);
    }

    return this.transactions.get(txHash)!;
  }

  async query(params: any): Promise<any> {
    if (params.request_type === 'call_function') {
      const { method_name, args_base64 } = params;
      
      if (method_name === 'get_escrow_details') {
        const args = JSON.parse(Buffer.from(args_base64, 'base64').toString());
        return {
          result: Buffer.from(JSON.stringify({
            id: args.order_id,
            initiator: 'initiator.testnet',
            recipient: 'recipient.testnet',
            amount: '1000000000000000000000000',
            secret_hash: '0x' + '3'.repeat(64),
            timelock: Date.now() + 86400000,
            status: 'active',
            created_at: Date.now()
          })).toString('base64')
        };
      }

      if (method_name === 'get_all_escrows') {
        return {
          result: Buffer.from(JSON.stringify([
            {
              id: 'order_1',
              initiator: 'initiator.testnet',
              recipient: 'recipient.testnet',
              amount: '1000000000000000000000000',
              secret_hash: '0x' + '3'.repeat(64),
              timelock: Date.now() + 86400000,
              status: 'active',
              created_at: Date.now()
            }
          ])).toString('base64')
        };
      }
    }

    if (params.request_type === 'view_account') {
      return {
        amount: '1000000000000000000000000',
        locked: '0',
        code_hash: '11111111111111111111111111111111',
        storage_usage: 1000,
        storage_paid_at: 0,
        block_height: this.blockHeight,
        block_hash: '0x' + Math.random().toString(16).substr(2, 64)
      };
    }

    return { result: [] };
  }

  // Test helper methods
  addTransaction(txHash: string, transaction: MockNearTransaction): void {
    this.transactions.set(txHash, transaction);
  }

  setBlockHeight(height: number): void {
    this.blockHeight = height;
  }

  clearTransactions(): void {
    this.transactions.clear();
  }

  clearBlocks(): void {
    this.blocks.clear();
  }

  // Mock control methods for testing
  setMockStatus(status: any): void {
    this.mockStatus = status;
  }

  setMockError(error: Error | null): void {
    this.mockError = error;
  }

  setMockBlock(block: MockNearBlock): void {
    this.mockBlock = block;
  }

  setMockTransactionOutcome(transaction: MockNearTransaction): void {
    this.mockTransactionOutcome = transaction;
  }
}

export class MockNearConnection {
  public provider: MockNearProvider;
  public signer: any;
  public networkId: string;

  constructor(networkId: string = 'testnet', provider?: MockNearProvider) {
    this.provider = provider || new MockNearProvider();
    this.signer = {
      signTransaction: async () => ({ signature: 'mock_signature', publicKey: 'mock_public_key' })
    };
    this.networkId = networkId;
  }
}

export class MockNearAccount {
  public accountId: string;
  public connection: MockNearConnection;
  private balance = '1000000000000000000000000'; // 1000 NEAR
  private mockFunctionCallResult: any = null;
  private mockError: Error | null = null;

  constructor(accountId: string, connection?: MockNearConnection) {
    this.accountId = accountId;
    this.connection = connection || new MockNearConnection();
  }

  // Mock control methods for testing
  setMockFunctionCallResult(result: any): void {
    this.mockFunctionCallResult = result;
    this.mockError = null;
  }

  setMockError(error: Error): void {
    this.mockError = error;
    this.mockFunctionCallResult = null;
  }

  async state(): Promise<any> {
    return {
      amount: this.balance,
      locked: '0',
      code_hash: '11111111111111111111111111111111',
      storage_usage: 1000,
      storage_paid_at: 0,
      block_height: 100000000,
      block_hash: '0x' + Math.random().toString(16).substr(2, 64)
    };
  }

  async functionCall(options: {
    contractId: string;
    methodName: string;
    args: any;
    gas?: bigint;
    attachedDeposit?: bigint;
  }): Promise<any> {
    // Check for mock error first
    if (this.mockError) {
      throw this.mockError;
    }

    // Return mock result if set
    if (this.mockFunctionCallResult !== null) {
      return this.mockFunctionCallResult;
    }

    const txHash = Math.random().toString(16).substr(2, 64);
    
    // Create mock transaction result
    const transaction: MockNearTransaction = {
      transaction_outcome: {
        id: txHash,
        outcome: {
          status: { SuccessValue: 'dGVzdA==' },
          logs: this.generateEventLogs(options.methodName, options.args),
          receipt_ids: [Math.random().toString(16).substr(2, 64)],
          gas_burnt: Number(options.gas || BigInt(1000000)),
          tokens_burnt: '1000000000000000000000'
        }
      },
      receipts_outcome: [{
        id: Math.random().toString(16).substr(2, 64),
        outcome: {
          status: { SuccessValue: 'dGVzdA==' },
          logs: [],
          gas_burnt: 500000,
          tokens_burnt: '500000000000000000000'
        }
      }]
    };

    this.connection.provider.addTransaction(txHash, transaction);

    return {
      transaction_outcome: transaction.transaction_outcome,
      receipts_outcome: transaction.receipts_outcome
    };
  }

  async viewFunction(_contractId: string, methodName: string, args: any = {}): Promise<any> {
    if (methodName === 'get_escrow_details') {
      return {
        id: args.order_id || 'test_order',
        initiator: 'initiator.testnet',
        recipient: 'recipient.testnet',
        amount: '1000000000000000000000000',
        secret_hash: '0x' + '3'.repeat(64),
        timelock: Date.now() + 86400000,
        status: 'active',
        created_at: Date.now()
      };
    }

    if (methodName === 'get_all_escrows') {
      return [
        {
          id: 'order_1',
          initiator: 'initiator.testnet',
          recipient: 'recipient.testnet',
          amount: '1000000000000000000000000',
          secret_hash: '0x' + '3'.repeat(64),
          timelock: Date.now() + 86400000,
          status: 'active',
          created_at: Date.now()
        }
      ];
    }

    return null;
  }

  private generateEventLogs(methodName: string, args: any): string[] {
    const logs: string[] = [];

    if (methodName === 'create_escrow') {
      logs.push(`EVENT_JSON:{"standard":"escrow","version":"1.0.0","event":"swap_order_created","data":{"order_id":"${Math.random().toString(36).substr(2, 9)}","initiator":"${this.accountId}","recipient":"${args.recipient}","amount":"${args.amount || '1000000000000000000000000'}","secret_hash":"${args.hashlock || '0x' + '3'.repeat(64)}","timelock":${Date.now() + (args.timelock_duration || 86400) * 1000}}}`);
    }

    if (methodName === 'complete_swap') {
      logs.push(`EVENT_JSON:{"standard":"escrow","version":"1.0.0","event":"swap_order_completed","data":{"order_id":"${args.order_id}","secret":"${args.secret || 'test_secret_' + Math.random().toString(36).substr(2, 32)}","completed_by":"${this.accountId}","completed_at":${Date.now()}}}`);
    }

    if (methodName === 'refund_escrow') {
      logs.push(`EVENT_JSON:{"standard":"escrow","version":"1.0.0","event":"swap_order_refunded","data":{"order_id":"${args.order_id}","refunded_to":"${this.accountId}","refunded_at":${Date.now()}}}`);
    }

    return logs;
  }

  // Test helper methods
  setBalance(balance: string): void {
    this.balance = balance;
  }

  getBalance(): string {
    return this.balance;
  }
}

// Mock NEAR utilities
export const mockNear = {
  connect: async (config: any) => new MockNearConnection(config.networkId),
  Account: MockNearAccount,
  Connection: MockNearConnection,
  providers: {
    JsonRpcProvider: MockNearProvider
  },
  utils: {
    format: {
      parseNearAmount: (amount: string) => (BigInt(parseFloat(amount) * 1e24)).toString(),
      formatNearAmount: (amount: string) => (BigInt(amount) / BigInt(1e24)).toString()
    }
  }
};

// Export default mock
export default mockNear;
