// Mock implementation for NEAR API used in enhanced scripts testing

export class MockInMemoryKeyStore {
  private keys: Map<string, any> = new Map();

  async setKey(networkId: string, accountId: string, keyPair: any) {
    this.keys.set(`${networkId}:${accountId}`, keyPair);
  }

  async getKey(networkId: string, accountId: string) {
    return this.keys.get(`${networkId}:${accountId}`);
  }

  async clear() {
    this.keys.clear();
  }
}

export class MockKeyPair {
  constructor(private secretKey: string) {}

  static fromString(secretKey: string) {
    return new MockKeyPair(secretKey);
  }

  getPublicKey() {
    return {
      toString: () => 'ed25519:' + 'A'.repeat(44)
    };
  }
}

export class MockAccount {
  constructor(
    public accountId: string,
    private connection: any,
    private signer: any
  ) {}

  async state() {
    return {
      amount: '1000000000000000000000000', // 1 NEAR
      storage_usage: 1000,
      code_hash: '11111111111111111111111111111111',
      block_height: 1000000,
      block_hash: 'hash'
    };
  }

  async functionCall(options: {
    contractId: string;
    methodName: string;
    args: any;
    gas?: string;
    attachedDeposit?: string;
  }) {
    return {
      transaction: {
        hash: 'near_tx_' + Math.random().toString(36).substr(2, 16)
      },
      receipts_outcome: [],
      status: { SuccessValue: '' }
    };
  }

  async viewFunction(contractId: string, methodName: string, args: any = {}) {
    // Mock view function responses
    if (methodName === 'get_contract_info') {
      return {
        version: '1.0.0',
        owner: 'test.testnet'
      };
    }

    if (methodName === 'get_escrow_details') {
      return {
        orderId: args.escrow_id || 'test-order',
        amount: '10000000000000000000000',
        recipient: '0x' + '3'.repeat(40),
        hashlock: '0x' + '4'.repeat(64),
        timelock: Date.now() + 3600000,
        status: 'created',
        created_at: Date.now()
      };
    }

    return {};
  }
}

export class MockConnection {
  constructor(private config: any) {}

  async account(accountId: string) {
    return new MockAccount(accountId, this, null);
  }
}

export class MockJsonRpcProvider {
  constructor(private config: { url: string }) {}

  async query(params: any) {
    // Mock NEAR RPC responses
    if (params.request_type === 'call_function') {
      const result = {
        result: Buffer.from(JSON.stringify({
          orderId: 'test-order',
          amount: '10000000000000000000000',
          status: 'created'
        })).toString('base64')
      };
      
      return { result: result.result };
    }

    if (params.method === 'block') {
      return {
        result: {
          header: {
            height: 1000000,
            timestamp: Date.now() * 1000000
          }
        }
      };
    }

    return { result: null };
  }

  async sendJsonRpc(method: string, params: any) {
    return this.query({ request_type: method, ...params });
  }
}

// Mock NEAR API functions
export async function mockConnect(config?: any) {
  return new MockConnection(config || {});
}

export const mockKeyStores = {
  InMemoryKeyStore: MockInMemoryKeyStore
};

export const mockUtils = {
  KeyPair: MockKeyPair,
  format: {
    parseNearAmount: (amount: string) => {
      return (parseFloat(amount) * 1e24).toString();
    },
    formatNearAmount: (amount: string) => {
      return (parseInt(amount) / 1e24).toString();
    }
  }
};

// Export the complete mock NEAR API
export const mockNearApi = {
  connect: mockConnect,
  keyStores: mockKeyStores,
  utils: mockUtils,
  Account: MockAccount,
  Connection: MockConnection,
  InMemoryKeyStore: MockInMemoryKeyStore,
  KeyPair: MockKeyPair
};
