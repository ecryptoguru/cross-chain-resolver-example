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
  private mockQueryResults: Map<string, any> = new Map();

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
      
      // Check if there's a mock result for this method
      if (this.mockQueryResults.has(method_name)) {
        const result = this.mockQueryResults.get(method_name);
        return {
          result: Buffer.from(JSON.stringify(result)).toString('base64')
        };
      }
      
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
      
      if (method_name === 'get_orders_by_taker') {
        const args = JSON.parse(Buffer.from(args_base64, 'base64').toString());
        const mockEscrows = [{
          orderId: 'order_1',
          recipient: args.taker,
          status: 'active',
          initiator: 'initiator.testnet',
          amount: '1000000000000000000000000',
          secret_hash: '0x' + 'a'.repeat(64),
          timelock: Date.now() + 86400000,
          created_at: Date.now()
        }];
        
        return {
          result: Buffer.from(JSON.stringify(mockEscrows)).toString('base64')
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

  // Add missing mock method for testing
  setMockTransactionReceipt(receipt: any): void {
    // Convert receipt to the expected format if needed
    this.mockTransactionOutcome = {
      transaction_outcome: {
        id: receipt.transactionHash || 'mock-tx-hash',
        outcome: {
          status: { SuccessValue: '' },
          logs: receipt.logs || [],
          receipt_ids: receipt.receiptIds || [],
          gas_burnt: receipt.gasBurnt || 0,
          tokens_burnt: receipt.tokensBurnt || '0'
        }
      },
      receipts_outcome: []
    };
  }

  // Set mock query result for testing
  setMockQueryResult(methodName: string, result: any): void {
    this.mockQueryResults.set(methodName, result);
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

// Extend the Function type to include our custom properties
type MockFunction<T extends (...args: any[]) => any> = T & {
  original?: T;
};

export class MockNearAccount {
  public accountId: string;
  public connection: MockNearConnection;
  private _balance = '1000000000000000000000000'; // 1000 NEAR
  private _mockFunctionCallResult: any = null;
  private _mockError: Error | null = null;
  
  // Track function calls for testing
  public functionCallCalls: any[] = [];
  public viewFunctionCalls: Array<{contractId: string, methodName: string, args: any}> = [];
  
  // Store original implementations
  private originalFunctionCall: MockFunction<typeof this.functionCall>;
  private originalViewFunction: MockFunction<typeof this.viewFunction>;

  constructor(accountId: string, connection?: MockNearConnection) {
    this.accountId = accountId;
    this.connection = connection || new MockNearConnection('testnet');
    
    // Store original implementations
    this.originalFunctionCall = this.functionCall.bind(this);
    this.originalViewFunction = this.viewFunction.bind(this);
  }

  // Mock view result setter for testing
  setMockViewResult(result: any): void {
    this._mockFunctionCallResult = result;
    // Store the result to be returned by viewFunction
    this.viewFunction = async () => result;
  }

  // Mock transaction receipt setter for testing
  setMockTransactionReceipt(receipt: any): void {
    this._mockFunctionCallResult = receipt;
    // Store the receipt to be returned by functionCall
    this.functionCall = async () => receipt;
  }

  // Set mock function call result with detailed transaction response
  setMockFunctionCallResult(result: any): void {
    this._mockFunctionCallResult = result;
    
    // Create a mock response that matches the expected transaction response format
    const mockResponse = {
      transaction: {
        hash: 'mock-tx-hash',
        signer_id: this.accountId,
        receiver_id: 'mock-contract.testnet',
        actions: [{
          FunctionCall: {
            method_name: 'mock_method',
            args: JSON.stringify({}),
            gas: 300000000000000,
            deposit: '0'
          }
        }]
      },
      status: { SuccessValue: '' },
      transaction_outcome: {
        id: 'mock-tx-hash',
        outcome: {
          status: { SuccessValue: '' },
          logs: [],
          receipt_ids: [],
          gas_burnt: 0,
          tokens_burnt: '0'
        }
      },
      receipts_outcome: []
    };
    
    // Merge the mock response with the provided result
    const mergedResponse = { ...mockResponse, ...result };
    
    // Set up the mock implementation
    this.functionCall = async () => mergedResponse;
  }

  // Mock function call implementation
  public functionCall = async (options: any): Promise<any> => {
    this.functionCallCalls.push(options);
    
    if (this._mockError) {
      throw this._mockError;
    }
    
    // Simulate transaction receipt with proper typing
    interface MockReceipt {
      transactionHash: string;
      logs: string[];
      receiptIds: string[];
      gasBurnt: number;
      tokensBurnt: string;
    }
    
    const receipt: MockReceipt = {
      transactionHash: 'mock-tx-hash',
      logs: [],
      receiptIds: [],
      gasBurnt: 0,
      tokensBurnt: '0'
    };
    
    // Generate mock event log based on method name
    const eventLog = `EVENT_JSON:{"standard":"nep171","version":"1.0.0","event":"${options.methodName}","data":${JSON.stringify(options.args || {})}}`;
    receipt.logs = [eventLog];
    
    return {
      transaction: {
        hash: receipt.transactionHash,
        signer_id: this.accountId,
        receiver_id: options.contractId,
        actions: [{
          FunctionCall: {
            method_name: options.methodName,
            args: JSON.stringify(options.args || {}),
            gas: options.gas || 300000000000000,
            deposit: options.attachedDeposit || '0'
          }
        }]
      },
      status: { SuccessValue: '' },
      transaction_outcome: {
        id: receipt.transactionHash,
        outcome: {
          status: { SuccessValue: '' },
          logs: receipt.logs,
          receipt_ids: receipt.receiptIds,
          gas_burnt: receipt.gasBurnt,
          tokens_burnt: receipt.tokensBurnt
        }
      },
      receipts_outcome: []
    };
  };

  // Mock implementation for view functions
  public viewFunction = async (contractId: string, methodName: string, args: any = {}): Promise<any> => {
    this.viewFunctionCalls.push({contractId, methodName, args});
    
    if (this._mockError) {
      throw this._mockError;
    }
    
    // Return different mock data based on method name
    switch (methodName) {
      case 'get_escrow':
        return {
          id: args.escrow_id || 'test-escrow',
          initiator: 'test.near',
          recipient: 'recipient.testnet',
          amount: '1000000000000000000',
          secret_hash: 'a'.repeat(64),
          timelock: Math.floor(Date.now() / 1000) + 86400, // 1 day from now
          status: 'active',
          created_at: Math.floor(Date.now() / 1000)
        };
      case 'get_escrow_by_secret_hash':
        return {
          id: 'escrow-by-hash',
          initiator: 'test.near',
          recipient: 'recipient.testnet',
          amount: '1000000000000000000',
          secret_hash: args.secret_hash || 'a'.repeat(64),
          timelock: Math.floor(Date.now() / 1000) + 86400,
          status: 'active',
          created_at: Math.floor(Date.now() / 1000)
        };
      default:
        return this._mockFunctionCallResult || { success: true };
    }
  };

  async state(): Promise<any> {
    return {
      amount: this._balance,
      block_hash: 'mock-block-hash',
      block_height: 12345,
      code_hash: 'mock-code-hash',
      locked: '0',
      storage_paid_at: 0,
      storage_usage: 1000
    };
  }

  // Mock balance getter
  async getBalance(): Promise<string> {
    return this._balance;
  }
  
  // Mock control methods for testing
  setBalance(balance: string): void {
    this._balance = balance;
  }
  
  // Set mock error for testing error cases
  setMockError(error: Error | null): void {
    this._mockError = error;
    this._mockFunctionCallResult = null;
    
    if (error) {
      // Override methods to throw the error
      this.functionCall = (async () => { throw error; }) as typeof this.functionCall;
      this.viewFunction = (async () => { throw error; }) as typeof this.viewFunction;
    } else {
      // Restore original implementations
      this.functionCall = this.originalFunctionCall;
      this.viewFunction = this.originalViewFunction;
    }
  }
}

// Mock NEAR utilities

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
