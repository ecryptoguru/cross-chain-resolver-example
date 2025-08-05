/**
 * Mock implementation for NEAR API
 */

// Create a mock NEAR account with all required methods
export const createMockNearAccount = (accountId: string) => {
  const mockAccount = {
    accountId,
  connection: {
    provider: {
      query: jest.fn().mockResolvedValue({
        result: [],
        block_hash: 'hash123',
        block_height: 12345
      }),
      sendTransaction: jest.fn().mockResolvedValue({
        transaction: { hash: 'tx123' },
        receipts_outcome: []
      })
    }
  },
  functionCall: jest.fn().mockResolvedValue({
    transaction: { hash: 'tx123' },
    receipts_outcome: []
  }),
  viewFunction: jest.fn().mockResolvedValue({}),
  getAccountBalance: jest.fn().mockResolvedValue({
    total: '1000000000000000000000000',
    available: '1000000000000000000000000'
  }),
    state: jest.fn().mockResolvedValue({
      amount: '1000000000000000000000000',
      code_hash: 'hash123'
    }),
    
    // Additional mock methods needed for testing
    setMockError: jest.fn(),
    setMockFunctionCallResult: jest.fn(),
    setMockViewFunctionResult: jest.fn()
  };
  
  return mockAccount;
};

// Default export for backward compatibility
export const mockNearAccount = createMockNearAccount('test.near');

export const mockNearConnection = {
  provider: {
    query: jest.fn().mockResolvedValue({
      result: [],
      block_hash: 'hash123',
      block_height: 12345
    }),
    sendTransaction: jest.fn().mockResolvedValue({
      transaction: { hash: 'tx123' },
      receipts_outcome: []
    }),
    block: jest.fn().mockResolvedValue({
      header: {
        height: 12345,
        timestamp: Date.now() * 1000000
      }
    })
  },
  account: jest.fn().mockResolvedValue(mockNearAccount)
};

export const nearApi = {
  connect: jest.fn().mockResolvedValue(mockNearConnection),
  keyStores: {
    InMemoryKeyStore: jest.fn().mockImplementation(() => ({
      setKey: jest.fn(),
      getKey: jest.fn(),
      clear: jest.fn()
    }))
  },
  utils: {
    format: {
      parseNearAmount: jest.fn().mockImplementation((amount) => (parseFloat(amount) * 1e24).toString()),
      formatNearAmount: jest.fn().mockImplementation((amount) => (parseFloat(amount) / 1e24).toString())
    }
  }
};

export default nearApi;
