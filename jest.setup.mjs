// Jest ESM setup file
import { jest } from '@jest/globals';
import { MOCK_CONFIG } from './relayer/tests/test-config.js';

// Set test timeout to 30s for all tests
jest.setTimeout(30000);

// Mock console methods to keep test output clean
const originalConsole = { ...console };

// Global test setup
beforeEach(() => {
  // Restore console methods before each test
  global.console = { ...originalConsole };
  
  // Reset all mocks before each test
  jest.clearAllMocks();
  
  // Use fake timers by default
  jest.useFakeTimers();
  
  // Set up global test configuration
  global.testConfig = MOCK_CONFIG;
  
  // Mock process.env with test configuration
  process.env = {
    NODE_ENV: 'test',
    ETHEREUM_RPC_URL: MOCK_CONFIG.ethereum.rpcUrl,
    ETHEREUM_CHAIN_ID: MOCK_CONFIG.ethereum.chainId.toString(),
    NEAR_NETWORK_ID: MOCK_CONFIG.near.networkId,
    NEAR_NODE_URL: MOCK_CONFIG.near.nodeUrl,
    NEAR_WALLET_URL: MOCK_CONFIG.near.walletUrl,
    NEAR_HELPER_URL: MOCK_CONFIG.near.helperUrl,
    NEAR_EXPLORER_URL: MOCK_CONFIG.near.explorerUrl,
    NEAR_ACCOUNT_ID: MOCK_CONFIG.near.accountId,
    NEAR_CONTRACT_NAME: MOCK_CONFIG.near.contractName,
    NEAR_PRIVATE_KEY: MOCK_CONFIG.near.privateKey,
  };
});

afterEach(() => {
  // Clean up after each test
  jest.clearAllTimers();
  jest.useRealTimers();
  
  // Clear global test configuration
  delete global.testConfig;
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason) => {
  // Fail the test if there's an unhandled promise rejection
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

// Mock common modules
jest.mock('ethers', () => {
  const original = jest.requireActual('ethers');
  return {
    ...original,
    providers: {
      ...original.providers,
      JsonRpcProvider: jest.fn().mockImplementation(() => ({
        getBlockNumber: jest.fn().mockResolvedValue(12345),
        getNetwork: jest.fn().mockResolvedValue({ chainId: 31337 }),
        // Use bigint to align with ethers v6 return types
        getGasPrice: jest.fn().mockResolvedValue(20000000000n),
        estimateGas: jest.fn().mockResolvedValue(100000n),
        getSigner: jest.fn().mockImplementation(() => ({
          getAddress: jest.fn().mockResolvedValue('0x1234567890123456789012345678901234567890'),
          signTransaction: jest.fn().mockResolvedValue('mock_signed_tx'),
          sendTransaction: jest.fn().mockResolvedValue({
            wait: jest.fn().mockResolvedValue({
              transactionHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
              status: 1,
              logs: [],
            }),
          }),
        })),
      })),
    },
    Contract: jest.fn().mockImplementation(() => ({
      address: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
      processPartialFill: jest.fn().mockResolvedValue({
        wait: jest.fn().mockResolvedValue({
          events: [],
          transactionHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        }),
      }),
      splitOrder: jest.fn().mockResolvedValue({
        wait: jest.fn().mockResolvedValue({
          events: [],
          transactionHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        }),
      }),
      processRefund: jest.fn().mockResolvedValue({
        wait: jest.fn().mockResolvedValue({
          events: [],
          transactionHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        }),
      }),
      getOrderState: jest.fn().mockResolvedValue({
        filledAmount: '500000000000000000',
        remainingAmount: '500000000000000000',
        isFullyFilled: false,
        isCancelled: false,
      }),
    })),
  };
});

// Mock near-api-js
jest.mock('near-api-js', () => {
  return {
    connect: jest.fn().mockResolvedValue({
      account: jest.fn().mockImplementation(() => ({
        viewFunction: jest.fn().mockResolvedValue({
          filled_amount: '500000000000000000000000',
          remaining_amount: '500000000000000000000000',
          fill_count: 1,
          is_fully_filled: false,
          is_cancelled: false,
          last_fill_timestamp: Date.now() * 1000000,
          child_orders: [],
        }),
        functionCall: jest.fn().mockResolvedValue({
          transaction: { hash: 'mock_tx_hash' },
        }),
      })),
    }),
    keyStores: {
      InMemoryKeyStore: jest.fn().mockImplementation(() => ({
        setKey: jest.fn().mockResolvedValue(undefined),
        getKey: jest.fn().mockResolvedValue({
          toString: () => 'ed25519:mock_public_key',
        }),
      })),
    },
    Account: {
      from: jest.fn().mockImplementation(() => ({
        state: jest.fn().mockResolvedValue({
          amount: '1000000000000000000000000',
          locked: '0',
          code_hash: 'mock_code_hash',
          storage_usage: 1000,
          storage_paid_at: 0,
        }),
      })),
    },
  };
});
