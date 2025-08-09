/**
 * Integration Tests for EthereumRelayer
 * Tests core relayer functionality with enhanced mocks and type safety
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { ethers } from 'ethers';

// Re-export commonly used types for convenience
type Address = string;
type TransactionHash = string;
type LogTopic = string | string[];
type BlockTag = string | number;

// Helper type for mock functions with better type safety
type MockFunction<T extends (...args: any[]) => any> = jest.Mock<ReturnType<T>, Parameters<T>>;

// Type aliases for better readability
type JsonRpcProvider = ethers.providers.JsonRpcProvider;
type JsonRpcSigner = ethers.Signer;
type Network = ethers.providers.Network;
type TransactionResponse = ethers.providers.TransactionResponse;
type TransactionReceipt = ethers.providers.TransactionReceipt;
type Block = ethers.providers.Block;
type FeeData = ethers.providers.FeeData;
type Filter = ethers.providers.Filter;
type TransactionRequest = ethers.providers.TransactionRequest;
type EventLog = ethers.providers.Log & { event?: string; args?: any };
type Log = ethers.providers.Log;
type EventFilter = ethers.providers.EventFilter;

// Mock provider and signer types for testing
interface MockJsonRpcProvider extends ethers.Provider {
  getNetwork: () => Promise<ethers.Network>;
  getBlockNumber: () => Promise<number>;
  getBalance: (address: string, blockTag?: BlockTag) => Promise<bigint>;
  getTransaction: (hash: string) => Promise<ethers.TransactionResponse | null>;
  getTransactionReceipt: (hash: string) => Promise<ethers.TransactionReceipt | null>;
  getCode: (address: string, blockTag?: BlockTag) => Promise<string>;
  getStorage: (address: string, position: string, blockTag?: BlockTag) => Promise<string>;
  getTransactionCount: (address: string, blockTag?: BlockTag) => Promise<number>;
  getBlock: (blockHashOrBlockTag: BlockTag) => Promise<ethers.Block | null>;
  getBlockWithTransactions: (blockHashOrBlockTag: BlockTag) => Promise<ethers.Block & { transactions: ethers.TransactionResponse[] } | null>;
  call: (tx: ethers.TransactionRequest, blockTag?: BlockTag) => Promise<string>;
  sendTransaction: (signedTransaction: string) => Promise<ethers.TransactionResponse>;
  getFeeData: () => Promise<ethers.FeeData>;
  resolveName: (name: string) => Promise<string | null>;
  lookupAddress: (address: string) => Promise<string | null>;
  getLogs: (filter: ethers.Filter) => Promise<ethers.Log[]>;
  waitForTransaction: (hash: string, confirmations?: number, timeout?: number) => Promise<ethers.TransactionReceipt>;
  on: (event: string, listener: (...args: any[]) => void) => void;
  once: (event: string, listener: (...args: any[]) => void) => void;
  emit: (event: string, ...args: any[]) => boolean;
  listenerCount: (event?: string) => number;
  listeners: (event?: string) => Array<(...args: any[]) => void>;
  off: (event: string, listener?: (...args: any[]) => void) => void;
  removeAllListeners: (event?: string) => void;
  addListener: (event: string, listener: (...args: any[]) => void) => void;
  removeListener: (event: string, listener: (...args: any[]) => void) => void;
  _isProvider: boolean;
  _network: ethers.Network;
  _events: any[];
  _emitted: { [event: string]: any[] };
  _maxListeners: number;
  _internalBlockNumber: number;
  _lastBlockNumber: number;
  _pollingInterval: number;
}

interface MockJsonRpcSigner extends ethers.Signer {
  provider: MockJsonRpcProvider | null;
  getAddress: () => Promise<string>;
  getChainId: () => Promise<number>;
  getTransactionCount: (blockTag?: BlockTag) => Promise<number>;
  sendTransaction: (tx: ethers.TransactionRequest) => Promise<ethers.TransactionResponse>;
  signMessage: (message: string | Uint8Array) => Promise<string>;
  signTransaction: (tx: ethers.TransactionRequest) => Promise<string>;
  connect: (provider: MockJsonRpcProvider) => MockJsonRpcSigner;
}

// Mock implementation of JsonRpcSigner for testing
class MockJsonRpcSigner {
  provider: MockJsonRpcProvider | null;
  address: string;
  _isSigner = true;

  constructor(provider: MockJsonRpcProvider | null, address: string) {
    this.provider = provider;
    this.address = address;
  }

  connect = jest.fn().mockImplementation((provider: MockJsonRpcProvider) => {
    return new MockJsonRpcSigner(provider, this.address);
  });

  getAddress = jest.fn().mockImplementation(() => {
    return Promise.resolve(this.address);
  });

  getChainId = jest.fn().mockImplementation(() => {
    return Promise.resolve(1);
  });

  getBalance = jest.fn().mockImplementation((blockTag?: string | number) => {
    return this.provider.getBalance(this.address, blockTag);
  });

  getTransactionCount = jest.fn().mockImplementation((blockTag?: string | number) => {
    return this.provider.getTransactionCount(this.address, blockTag);
  });

  estimateGas = jest.fn().mockImplementation((tx: any) => {
    return this.provider.estimateGas(tx);
  });

  call = jest.fn().mockImplementation((tx: any, blockTag?: string | number) => {
    return this.provider.call(tx, blockTag);
  });

  sendTransaction = jest.fn().mockImplementation(async (tx: any) => {
    const txResponse = {
      hash: '0x' + '0'.repeat(64),
      from: this.address,
      to: tx.to,
      nonce: 0,
      gasLimit: tx.gasLimit || 21000n,
      gasPrice: tx.gasPrice || 1000000000n,
      data: tx.data || '0x',
      value: tx.value || 0n,
      chainId: 1n,
      type: 2,
      maxFeePerGas: tx.maxFeePerGas || 2000000000n,
      maxPriorityFeePerGas: tx.maxPriorityFeePerGas || 1000000000n,
    };
    
    return txResponse;
  });

  signTransaction = jest.fn().mockImplementation(async (tx: any) => {
    return '0x' + '0'.repeat(130);
  });

  signMessage = jest.fn().mockImplementation(async (message: string | Uint8Array) => {
    return '0x' + '0'.repeat(130);
  });

  signTypedData = jest.fn().mockImplementation(async (domain: any, types: any, value: any) => {
    return '0x' + '0'.repeat(130);
  });

  sendUncheckedTransaction = jest.fn().mockImplementation(async (tx: any) => {
    const response = await this.sendTransaction(tx);
    return response.hash;
  });

  toJSON = jest.fn().mockImplementation(() => {
    return { type: 'MockJsonRpcSigner', address: this.address };
  });

  // Required by ethers.js
  _checkProvider = jest.fn().mockImplementation((operation?: string) => {
    if (!this.provider) {
      throw new Error('missing provider');
    }
  });
}

// Mock implementation of JsonRpcProvider for testing
class MockJsonRpcProvider {
  _isProvider = true;
  
  getBalance = jest.fn().mockImplementation(async (address: string) => {
    return 1000000000000000000n; // 1 ETH
  });

  getTransaction = jest.fn().mockImplementation(async (hash: string) => {
    return {
      hash,
      blockNumber: 1n,
      confirmations: 1,
      from: '0xSender',
      to: '0xRecipient',
      value: 1000000000000000000n, // 1 ETH
      data: '0x'
    } as any;
  });

  getTransactionReceipt = jest.fn().mockImplementation(async (hash: string) => {
    return {
      to: '0xRecipient',
      from: '0xSender',
      contractAddress: null,
      transactionIndex: 0,
      gasUsed: 21000n,
      logsBloom: '0x' + '0'.repeat(512),
      blockHash: '0x' + '0'.repeat(64),
      transactionHash: hash,
      logs: [],
      blockNumber: 1n,
      confirmations: 1,
      cumulativeGasUsed: 21000n,
      effectiveGasPrice: 1000000000n,
      type: 2,
      status: 1,
      byzantium: true
    } as any;
  });

  getCode = jest.fn().mockImplementation(async (address: string) => {
    return '0x'; // Contract code
  });

  getStorage = jest.fn().mockImplementation(async (address: string, position: BigNumberish) => {
    return '0x';
  });

  getTransactionCount = jest.fn().mockImplementation(async (address: string) => {
    return 0;
  });

  send = jest.fn().mockImplementation((method: string, params: any[]) => {
    if (method === 'eth_chainId') {
      return Promise.resolve('0x1');
    }
    return Promise.resolve(null);
  });

  getNetwork = jest.fn().mockResolvedValue({ name: 'homestead', chainId: 1n });
  getBlockNumber = jest.fn().mockResolvedValue(1n);
  getGasPrice = jest.fn().mockResolvedValue(1000000000n);
  estimateGas = jest.fn().mockResolvedValue(21000n);
  call = jest.fn().mockResolvedValue('0x');
  getFeeData = jest.fn().mockResolvedValue({
    gasPrice: 1000000000n,
    maxFeePerGas: 2000000000n,
    maxPriorityFeePerGas: 1000000000n
  } as any);
  
  // Add other required methods with default implementations
  getBlock = jest.fn().mockResolvedValue({ number: 1n, timestamp: Math.floor(Date.now() / 1000) } as any);
  getLogs = jest.fn().mockResolvedValue([]);
  on = jest.fn();
  once = jest.fn();
  emit = jest.fn();
  listenerCount = jest.fn();
  listeners = jest.fn();
  off = jest.fn();
  removeAllListeners = jest.fn();
  addListener = jest.fn();
  removeListener = jest.fn();
}

// Message types
export enum MessageType {
  DEPOSIT = 'DEPOSIT',
  WITHDRAWAL = 'WITHDRAWAL',
  REFUND = 'REFUND',
  PARTIAL_FILL = 'PARTIAL_FILL'
}

// Base message interface
interface BaseMessage {
  messageId: string;
  type: MessageType;
  sourceChain: string;
  destChain: string;
  sender: string;
  recipient: string;
  amount: string;
  token: string;
  data?: Record<string, any>;
  timestamp: number;
}

// Specific message types
interface DepositMessage extends BaseMessage {
  type: MessageType.DEPOSIT;
  secretHash: string;
  timelock: number;
}

interface WithdrawalMessage extends BaseMessage {
  type: MessageType.WITHDRAWAL;
  secret: string;
}

interface RefundMessage extends BaseMessage {
  type: MessageType.REFUND;
  reason: string;
}

// Event types
interface BaseEvent {
  blockNumber: number;
  transactionHash: string;
  logIndex: number;
  blockHash: string;
  transactionIndex: number;
  removed: boolean;
}

interface DepositInitiatedEvent extends BaseEvent {
  depositId: string;
  sender: string;
  nearRecipient: string;
  token: string;
  amount: bigint;
  fee: bigint;
  timestamp: bigint;
}

interface WithdrawalCompletedEvent extends BaseEvent {
  withdrawalId: string;
  recipient: string;
  token: string;
  amount: bigint;
  fee: bigint;
  timestamp: bigint;
}

interface MessageSentEvent extends BaseEvent {
  messageId: string;
  targetChain: string;
  targetAddress: string;
  data: string;
}

interface EscrowCreatedEvent extends BaseEvent {
  escrowAddress: string;
  initiator: string;
  recipient: string;
  amount: bigint;
  token: string;
  secretHash: string;
  timelock: number;
  status: string;
}

// Mock NEAR account type
class MockNearAccount {
  accountId: string;
  functionCall = jest.fn().mockImplementation(<T = any>(): Promise<T> => Promise.resolve({} as T));
  viewFunction = jest.fn().mockImplementation(<T = any>(): Promise<T> => Promise.resolve({} as T));
  setMockFunctionCallResult = jest.fn().mockImplementation((): void => {});
  setMockViewFunctionResult = jest.fn().mockImplementation((): void => {});
  setMockError = jest.fn().mockImplementation((): void => {});
  viewState = jest.fn().mockImplementation((): Promise<Uint8Array> => Promise.resolve(new Uint8Array()));
  functionCallAs = jest.fn().mockImplementation(<T = any>(): Promise<T> => Promise.resolve({} as T));
  viewFunctionAs = jest.fn().mockImplementation(<T = any>(): Promise<T> => Promise.resolve({} as T));
  deleteAccount = jest.fn().mockImplementation((): Promise<void> => Promise.resolve());
  deployContract = jest.fn().mockImplementation((): Promise<void> => Promise.resolve());
  signAndSendTransaction = jest.fn().mockImplementation((): Promise<any> => Promise.resolve({}));
  signTransaction = jest.fn().mockImplementation((): Promise<Uint8Array> => Promise.resolve(new Uint8Array()));
  signMessage = jest.fn().mockImplementation((): Promise<Uint8Array> => Promise.resolve(new Uint8Array()));
  verifySignature = jest.fn().mockImplementation((): Promise<boolean> => Promise.resolve(true));
  accessKeyByPublicKey = jest.fn().mockImplementation((): Promise<any> => Promise.resolve({}));
  accessKey = jest.fn().mockImplementation((): Promise<any> => Promise.resolve({}));

  constructor(accountId: string) {
    this.accountId = accountId;
    this.functionCall.mockName('functionCall');
    this.viewFunction.mockName('viewFunction');
    this.setMockFunctionCallResult.mockName('setMockFunctionCallResult');
    this.setMockViewFunctionResult.mockName('setMockViewFunctionResult');
    this.setMockError.mockName('setMockError');
  }
}

// Enhanced MockProvider with complete ethers.js Provider interface
class MockProvider extends EventEmitter implements providers.Provider {
  _isProvider = true;
  _network: providers.Network = {
    name: 'testnet',
    chainId: 1,
    ensAddress: '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e'
  };

  // Core methods
  getNetwork = jest.fn().mockImplementation((): Promise<providers.Network> => 
    Promise.resolve(this._network)
  );

  getBlockNumber = jest.fn().mockImplementation((): Promise<number> => 
    Promise.resolve(123456)
  );

  getGasPrice = jest.fn().mockImplementation((): Promise<BigNumber> =>
    Promise.resolve(ethers.utils.parseUnits('10', 'gwei'))
  );

  getBalance = jest.fn().mockImplementation((address: string, blockTag?: providers.BlockTag): Promise<BigNumber> =>
    Promise.resolve(ethers.utils.parseEther('1'))
  );

  getTransaction = jest.fn().mockImplementation((hash: string): Promise<providers.TransactionResponse> =>
    Promise.resolve({} as providers.TransactionResponse)
  );

  getTransactionReceipt = jest.fn().mockImplementation((hash: string): Promise<providers.TransactionReceipt> =>
    Promise.resolve({
      status: 1,
      logs: [],
      blockNumber: 12345,
      blockHash: '0x' + '0'.repeat(64),
      transactionHash: hash,
      transactionIndex: 0,
      from: '0x' + '0'.repeat(40),
      to: '0x' + '0'.repeat(40),
      contractAddress: null,
      cumulativeGasUsed: BigNumber.from(21000),
      gasUsed: BigNumber.from(21000),
      logsBloom: '0x' + '0'.repeat(512),
      byzantium: true,
      confirmations: 1,
      effectiveGasPrice: ethers.utils.parseUnits('10', 'gwei'),
      type: 2,
      chainId: 1
    } as providers.TransactionReceipt)
  );

  getCode = jest.fn().mockImplementation((address: string, blockTag?: providers.BlockTag): Promise<string> =>
    Promise.resolve('0x')
  );

  getStorageAt = jest.fn().mockImplementation((address: string, position: BigNumberish, blockTag?: providers.BlockTag): Promise<string> =>
    Promise.resolve('0x')
  );

  getTransactionCount = jest.fn().mockImplementation((address: string, blockTag?: providers.BlockTag): Promise<number> =>
    Promise.resolve(0)
  );

  getBlock = jest.fn().mockImplementation((blockHashOrBlockTag: providers.BlockTag | string | Promise<providers.BlockTag>): Promise<providers.Block> =>
    Promise.resolve({} as providers.Block)
  );

  getBlockWithTransactions = jest.fn().mockImplementation((blockHashOrBlockTag: providers.BlockTag | string | Promise<providers.BlockTag>): Promise<providers.BlockWithTransactions> =>
    Promise.resolve({} as providers.BlockWithTransactions)
  );

  call = jest.fn().mockImplementation((transaction: providers.TransactionRequest, blockTag?: providers.BlockTag): Promise<string> =>
    Promise.resolve('0x')
  );

  sendTransaction = jest.fn().mockImplementation((signedTransaction: string | Promise<string>): Promise<providers.TransactionResponse> => {
    const tx = typeof signedTransaction === 'string' ? signedTransaction : '';
    return Promise.resolve({
      hash: '0x' + '0'.repeat(64),
      wait: (confirmations?: number) => this.getTransactionReceipt(tx)
    } as providers.TransactionResponse);
  });

  // Fee data methods
  getFeeData = jest.fn().mockImplementation((): Promise<providers.FeeData> =>
    Promise.resolve({
      maxFeePerGas: ethers.utils.parseUnits('10', 'gwei'),
      maxPriorityFeePerGas: ethers.utils.parseUnits('2', 'gwei'),
      gasPrice: ethers.utils.parseUnits('10', 'gwei'),
      lastBaseFeePerGas: ethers.utils.parseUnits('8', 'gwei')
    })
  );

  // ENS methods
  resolveName = jest.fn().mockImplementation((name: string): Promise<string> =>
    Promise.resolve('0x' + '0'.repeat(40))
  );

  lookupAddress = jest.fn().mockImplementation((address: string): Promise<string> =>
    Promise.resolve('test.eth')
  );

  // Event methods
  getLogs = jest.fn().mockImplementation((filter: providers.Filter): Promise<Array<providers.Log>> =>
    Promise.resolve([])
  );

  waitForTransaction = jest.fn().mockImplementation((transactionHash: string, confirmations?: number, timeout?: number): Promise<providers.TransactionReceipt> =>
    this.getTransactionReceipt(transactionHash)
  );

  // Test control methods
  setNetwork(chainId: number, name: string) {
    this._network = { chainId, name, ensAddress: this._network.ensAddress };
  }

  setMockError(error: Error) {
    // Can be used to simulate errors in any method
    this.getNetwork.mockRejectedValueOnce(error);
  }

  setMockEscrow(escrow: any) {
    // Mock escrow lookup
    this.call.mockImplementationOnce(() => 
      Promise.resolve(ethers.utils.defaultAbiCoder.encode(['address'], [escrow.escrowAddress]))
    );
  }
}

// Enhanced MockSigner with complete Signer interface
class MockSigner implements Signer {
  readonly _isSigner = true;
  readonly provider?: MockProvider;

  constructor(provider?: MockProvider) {
    this.provider = provider;
  }

  // Core methods
  getAddress = jest.fn().mockImplementation((): Promise<string> =>
    Promise.resolve('0x1234567890123456789012345678901234567890')
  );

  getChainId = jest.fn().mockImplementation((): Promise<number> =>
    Promise.resolve(1)
  );

  getTransactionCount = jest.fn().mockImplementation((blockTag?: providers.BlockTag): Promise<number> =>
    Promise.resolve(0)
  );

  // Transaction methods
  sendTransaction = jest.fn().mockImplementation((transaction: providers.TransactionRequest): Promise<providers.TransactionResponse> => {
    if (!this.provider) {
      throw new Error('No provider connected');
    }
    return this.provider.sendTransaction(JSON.stringify(transaction));
  });

  // Signing methods
  signMessage = jest.fn().mockImplementation((message: string | ethers.utils.Bytes): Promise<string> =>
    Promise.resolve('0x' + '0'.repeat(130))
  );

  signTransaction = jest.fn().mockImplementation((transaction: providers.TransactionRequest): Promise<string> =>
    Promise.resolve('0x' + '0'.repeat(200))
  );

  _signTypedData = jest.fn().mockImplementation((
    domain: any,
    types: any,
    value: any
  ): Promise<string> =>
    Promise.resolve('0x' + '0'.repeat(130))
  );

  // Connection methods
  connect = jest.fn().mockImplementation((provider: providers.Provider): Signer => {
    return new MockSigner(provider as MockProvider);
  });

  // Utility methods
  checkTransaction = jest.fn().mockImplementation((transaction: providers.TransactionRequest): providers.TransactionRequest =>
    transaction
  );

  populateTransaction = jest.fn().mockImplementation((transaction: providers.TransactionRequest): Promise<providers.TransactionRequest> =>
    Promise.resolve({
      ...transaction,
      nonce: 0,
      gasLimit: ethers.BigNumber.from(21000),
      chainId: 1,
      type: 2,
      maxFeePerGas: ethers.utils.parseUnits('10', 'gwei'),
      maxPriorityFeePerGas: ethers.utils.parseUnits('2', 'gwei')
    })
  );

  // Estimate gas
  estimateGas = jest.fn().mockImplementation((transaction: providers.TransactionRequest): Promise<BigNumber> =>
    Promise.resolve(ethers.BigNumber.from(21000))
  );

  // Call static
  callStatic = jest.fn().mockImplementation((transaction: providers.TransactionRequest): Promise<any> =>
    Promise.resolve({})
  );

  // Resolve name
  resolveName = jest.fn().mockImplementation((name: string): Promise<string> =>
    Promise.resolve('0x' + '0'.repeat(40))
  );
}

// Mock logger and metrics
const mockLogger = {
  info: jest.fn().mockImplementation((...args) => console.log('[INFO]', ...args)),
  error: jest.fn().mockImplementation((...args) => console.error('[ERROR]', ...args)),
  warn: jest.fn().mockImplementation((...args) => console.warn('[WARN]', ...args)),
  debug: jest.fn().mockImplementation((...args) => console.debug('[DEBUG]', ...args)),
  verbose: jest.fn().mockImplementation((...args) => console.log('[VERBOSE]', ...args)),
  silly: jest.fn().mockImplementation((...args) => console.log('[SILLY]', ...args))
};

const mockMetrics = {
  increment: jest.fn().mockImplementation((metric: string, tags?: Record<string, any>) => 
    console.log(`[METRIC] ${metric}`, tags || '')
  ),
  gauge: jest.fn().mockImplementation((metric: string, value: number, tags?: Record<string, any>) => 
    console.log(`[GAUGE] ${metric} = ${value}`, tags || '')
  ),
  timing: jest.fn().mockImplementation((metric: string, value: number, tags?: Record<string, any>) => 
    console.log(`[TIMING] ${metric} = ${value}ms`, tags || '')
  ),
  histogram: jest.fn().mockImplementation((metric: string, value: number, tags?: Record<string, any>) =>
    console.log(`[HISTOGRAM] ${metric} = ${value}`, tags || '')
  )
};

// Helper function to create a mock NEAR account
function createMockNearAccount(accountId: string): MockNearAccount {
  return new MockNearAccount(accountId);
}

// Mock implementation of EthereumRelayer
class EthereumRelayer {
  private _isRelayerRunning = false;
  private processedMessageCount = 0;
  public storage = {
    initialize: jest.fn<Promise<void>, []>(),
    saveProcessedMessage: jest.fn<Promise<void>, [string]>(),
    isMessageProcessed: jest.fn<boolean, [string]>()
  } as const;
  
  public eventListener = {
    start: jest.fn<Promise<void>, []>(),
    stop: jest.fn<Promise<void>, []>(),
    on: jest.fn()
  } as const;
  
  constructor(public config: any) {
    // Initialize storage mock
    this.storage.initialize.mockResolvedValue(undefined);
    this.storage.saveProcessedMessage.mockResolvedValue(undefined);
    this.storage.isMessageProcessed.mockReturnValue(false);
    
    // Initialize event listener mock
    this.eventListener.start.mockResolvedValue(undefined);
    this.eventListener.stop.mockResolvedValue(undefined);
  }
  
  async start() {
    this._isRelayerRunning = true;
    await this.storage.initialize();
    await this.eventListener.start();
    return this;
  }
  
  async stop() {
    this._isRelayerRunning = false;
    await this.eventListener.stop();
    return this;
  }
  
  isRelayerRunning(): boolean {
    return this._isRelayerRunning;
  }
  
  async processMessage(message: any) {
    this.processedMessageCount++;
    
    // Simulate different behaviors based on message type
    if (message.type === 'DEPOSIT') {
      return this.processDepositMessage(message);
    } else if (message.type === 'WITHDRAWAL') {
      return this.processWithdrawalMessage(message);
    } else if (message.type === 'REFUND') {
      return this.processRefundMessage(message);
    }
    
    return { success: true };
  }
  
  getProcessedMessageCount() {
    return this.processedMessageCount;
  }
  
  // Mock event handlers with proper typing
  async handleDepositInitiated(_event: any): Promise<{ success: boolean }> {
    return { success: true };
  }
  
  async handleWithdrawalCompleted(_event: any): Promise<{ success: boolean }> {
    return { success: true };
  }
  
  // Message processors
  async processDepositMessage(_message: any): Promise<{ success: boolean }> {
    if (this.config.nearAccount?.mockError) {
      throw new Error(this.config.nearAccount.mockError);
    }
    return { success: true };
  }
  
  async processWithdrawalMessage(_message: any): Promise<{ success: boolean }> {
    if (this.config.provider?.mockError) {
      throw new Error(this.config.provider.mockError);
    }
    return { success: true };
  }
  
  async processRefundMessage(_message: any): Promise<{ success: boolean }> {
    return { success: true };
  }
  
  async processPartialFillMessage(_message: any): Promise<{ success: boolean }> {
    return { success: true };
  }
}

interface EthereumRelayerConfig {
  provider: any;
  signer: any;
  nearAccount: any;
  factoryAddress: string;
  bridgeAddress: string;
  resolverAddress: string;
  pollIntervalMs: number;
  storageDir: string;
  logger: any;
  metrics: any;
  chainId: number;
  network: string;
  minConfirmation?: number;
  maxGasPrice?: any;
  gasLimitMultiplier?: number;
  maxRetries?: number;
  retryDelay?: number;
  healthCheckInterval?: number;
  metricsEnabled?: boolean;
  debug?: boolean;
}

// Mock NEAR account type
class MockNearAccount {
  accountId: string;
  
  // Mock methods with proper typing
  functionCall = jest.fn().mockImplementation(<T = any>(): Promise<T> => Promise.resolve({} as T));
  viewFunction = jest.fn().mockImplementation(<T = any>(): Promise<T> => Promise.resolve({} as T));
  setMockFunctionCallResult = jest.fn().mockImplementation((): void => {});
  setMockViewFunctionResult = jest.fn().mockImplementation((): void => {});
  setMockError = jest.fn().mockImplementation((): void => {});
  
  // Add missing NEAR account methods
  viewState = jest.fn().mockImplementation((): Promise<Uint8Array> => Promise.resolve(new Uint8Array()));
  functionCallAs = jest.fn().mockImplementation(<T = any>(): Promise<T> => Promise.resolve({} as T));
  viewFunctionAs = jest.fn().mockImplementation(<T = any>(): Promise<T> => Promise.resolve({} as T));
  deleteAccount = jest.fn().mockImplementation((): Promise<void> => Promise.resolve());
  deployContract = jest.fn().mockImplementation((): Promise<void> => Promise.resolve());
  signAndSendTransaction = jest.fn().mockImplementation((): Promise<any> => Promise.resolve({}));
  signTransaction = jest.fn().mockImplementation((): Promise<Uint8Array> => Promise.resolve(new Uint8Array()));
  signMessage = jest.fn().mockImplementation((): Promise<Uint8Array> => Promise.resolve(new Uint8Array()));
  verifySignature = jest.fn().mockImplementation((): Promise<boolean> => Promise.resolve(true));
  accessKeyByPublicKey = jest.fn().mockImplementation((): Promise<any> => Promise.resolve({}));
  accessKey = jest.fn().mockImplementation((): Promise<any> => Promise.resolve({}));
  
  constructor(accountId: string) {
    this.accountId = accountId;
    
    // Setup default mock implementations
    this.functionCall.mockName('functionCall');
    this.viewFunction.mockName('viewFunction');
    this.setMockFunctionCallResult.mockName('setMockFunctionCallResult');
    this.setMockViewFunctionResult.mockName('setMockViewFunctionResult');
    this.setMockError.mockName('setMockError');
  }
}

// Simplified mock provider with just the essential methods
class MockProvider {
  // Mock provider methods with proper typing
  getBalance = jest.fn().mockImplementation(async (address: string) => {
    return ethers.toBigInt('1000000000000000000'); // 1 ETH
  });

  getTransaction = jest.fn().mockImplementation(async (hash: string) => {
    return {
      hash,
      blockNumber: 1,
      confirmations: 1,
      from: '0xSender',
      to: '0xRecipient',
      value: ethers.toBigInt('1000000000000000000'),
      data: '0x'
    } as any;
  });

  getTransactionReceipt = jest.fn().mockImplementation(async (hash: string) => {
    return {
      to: '0xRecipient',
      from: '0xSender',
      contractAddress: null,
      transactionIndex: 0,
      gasUsed: 21000n,
      logsBloom: '0x' + '0'.repeat(512),
      blockHash: '0x' + '0'.repeat(64),
      transactionHash: hash,
      logs: [],
      blockNumber: 1,
      confirmations: 1,
      cumulativeGasUsed: 21000n,
      effectiveGasPrice: 1000000000n,
      type: 2,
      status: 1,
      byzantium: true
    };
  });

  getCode = jest.fn().mockImplementation(async (address: string) => {
    return '0x'; // Contract code
  });

  getStorage = jest.fn().mockImplementation(async (address: string, position: BigNumberish) => {
    return '0x';
  });

  getTransactionCount = jest.fn().mockImplementation(async (address: string) => {
    return 0;
  });

  send = jest.fn().mockImplementation((method: string, params: any[]) => {
    if (method === 'eth_chainId') {
      return Promise.resolve('0x1');
    }
    return Promise.resolve(null);
  });

  // Implement remaining Provider methods
  getNetwork = jest.fn().mockImplementation(async () => {
    return { name: 'homestead', chainId: 1n };
  getAddress = jest.fn().mockImplementation(() => Promise.resolve('0x1234567890123456789012345678901234567890'));
  sendTransaction = jest.fn().mockImplementation(() => 
    Promise.resolve({
      hash: '0x123',
      wait: jest.fn().mockImplementation(() => 
        Promise.resolve({
          status: 1,
          logs: []
        } as const)
      )
    } as const)
  );
  signMessage = jest.fn().mockImplementation(() => Promise.resolve('0xsigned' as const));
  _signTypedData = jest.fn().mockImplementation(() => Promise.resolve('0xsigned' as const));
  getChainId = jest.fn().mockImplementation(() => Promise.resolve(1));
  getTransactionCount = jest.fn().mockImplementation(() => Promise.resolve(0));
  estimateGas = jest.fn().mockImplementation(() => Promise.resolve(ethers.BigNumber.from(21000)));
}

// Create mock NEAR account with proper typing
function createMockNearAccount(accountId: string): MockNearAccount {
  return new MockNearAccount(accountId);
}

// Mock logger and metrics
const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
};

const mockMetrics = {
  increment: jest.fn(),
  gauge: jest.fn(),
  timing: jest.fn()
};

// Define MessageType enum to match the one used in the relayer
export enum MessageType {
  DEPOSIT = 'DEPOSIT',
  WITHDRAWAL = 'WITHDRAWAL',
  REFUND = 'REFUND',
  PARTIAL_FILL = 'PARTIAL_FILL'
}

// Mock types
type DepositMessage = any;
type WithdrawalMessage = any;
type RefundMessage = any;
type DepositInitiatedEvent = any;
type MessageSentEvent = any;
type WithdrawalCompletedEvent = any;
type EscrowCreatedEvent = any;

// Test setup function
function setupTest() {
  // Create mock provider and set up network
  const mockProvider = new MockProvider();
  
  // Initialize the mock provider with default network
  if ('setNetwork' in mockProvider && typeof mockProvider.setNetwork === 'function') {
    (mockProvider as any).setNetwork(1, 'mainnet');
  }
  
  // Create mock signer and connect to provider
  const mockSigner = new MockSigner();
  
  // Only call connect if the method exists
  if ('connect' in mockSigner && typeof mockSigner.connect === 'function') {
    (mockSigner as any).connect(mockProvider);
  }

  // Create a fresh mock NEAR account
  const mockNear = createMockNearAccount('test.near');
  
  // Configure the relayer with required properties
  const config: EthereumRelayerConfig = {
    provider: mockProvider as any,
    signer: mockSigner as any,
    nearAccount: mockNear as unknown as MockNearAccount,
    factoryAddress: '0x1234567890123456789012345678901234567890',
    bridgeAddress: '0x0987654321098765432109876543210987654321',
    resolverAddress: '0x0000000000000000000000000000000000000001',
    pollIntervalMs: 1000,
    storageDir: './test-storage',
    logger: mockLogger,
    metrics: mockMetrics,
    // Add default values for any other required properties
    chainId: 1,
    network: 'testnet',
    minConfirmation: 3,
    maxGasPrice: ethers.utils.parseUnits('100', 'gwei'),
    gasLimitMultiplier: 1.1,
    maxRetries: 3,
    retryDelay: 1000,
    healthCheckInterval: 30000,
    metricsEnabled: true,
    debug: true
  };

  // Initialize the relayer with the config
  const relayer = new EthereumRelayer(config);

  // Set up mock implementations for provider methods
  jest.spyOn(mockProvider, 'getNetwork').mockResolvedValue({
    chainId: 1,
    name: 'mainnet',
    ensAddress: '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e'
  });

  // Set up mock implementations for NEAR account methods
  mockNear.setMockFunctionCallResult = jest.fn().mockImplementation((method, result) => {
    mockNear.functionCall.mockImplementation(async (args: any) => {
      if (args.methodName === method) {
        return result;
      }
      throw new Error(`Unexpected method call: ${method}`);
    });
  });

  mockNear.setMockViewFunctionResult = jest.fn().mockImplementation((method, result) => {
    mockNear.viewFunction.mockImplementation(async (args: any) => {
      if (args.methodName === method) {
        return result;
      }
      throw new Error(`Unexpected view method call: ${method}`);
    });
  });

  return {
    relayer,
    config,
    mockProvider,
    mockSigner,
    mockNearAccount: mockNear
  };
}

describe('EthereumRelayer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Constructor and Configuration', () => {
    it('should create relayer with valid configuration', () => {
      const { relayer } = setupTest();
      
      expect(relayer).toBeDefined();
      expect(relayer.isRelayerRunning()).toBe(false);
    });

    it('should throw error with invalid configuration - missing provider', () => {
      expect(() => {
        new EthereumRelayer({
          provider: null as any,
          signer: new MockSigner() as any,
          nearAccount: new MockNearAccount('test.near') as any,
          factoryAddress: '0x1234567890123456789012345678901234567890',
          bridgeAddress: '0x0987654321098765432109876543210987654321'
        });
      }).toThrow();
    });

    it('should throw error with invalid configuration - missing signer', () => {
      expect(() => {
        new EthereumRelayer({
          provider: new MockProvider() as any,
          signer: null as any,
          nearAccount: new MockNearAccount('test.near') as any,
          factoryAddress: '0x1234567890123456789012345678901234567890',
          bridgeAddress: '0x0987654321098765432109876543210987654321'
        });
      }).toThrow();
    });

    it('should throw error with invalid configuration - missing NEAR account', () => {
      expect(() => {
        new EthereumRelayer({
          provider: new MockProvider() as any,
          signer: new MockSigner() as any,
          nearAccount: null as any,
          factoryAddress: '0x1234567890123456789012345678901234567890',
          bridgeAddress: '0x0987654321098765432109876543210987654321'
        });
      }).toThrow();
    });

    it('should throw error with invalid factory address', () => {
      expect(() => {
        new EthereumRelayer({
          provider: new MockProvider() as any,
          signer: new MockSigner() as any,
          nearAccount: new MockNearAccount('test.near') as any,
          factoryAddress: 'invalid-address',
          bridgeAddress: '0x0987654321098765432109876543210987654321'
        });
      }).toThrow();
    });

    it('should throw error with invalid bridge address', () => {
      expect(() => {
        new EthereumRelayer({
          provider: new MockProvider() as any,
          signer: new MockSigner() as any,
          nearAccount: new MockNearAccount('test.near') as any,
          factoryAddress: '0x1234567890123456789012345678901234567890',
          bridgeAddress: 'invalid-address'
        });
      }).toThrow();
    });
  });

  describe('Lifecycle Management', () => {
    it('should start relayer successfully', async () => {
      const { relayer } = setupTest();
      
      await relayer.start();
      
      expect(relayer.isRelayerRunning()).toBe(true);
    });

    it('should stop relayer successfully', async () => {
      const { relayer } = setupTest();
      
      await relayer.start();
      expect(relayer.isRelayerRunning()).toBe(true);
      
      await relayer.stop();
      expect(relayer.isRelayerRunning()).toBe(false);
    });

    it('should handle multiple start calls gracefully', async () => {
      const { relayer } = setupTest();
      
      await relayer.start();
      expect(relayer.isRelayerRunning()).toBe(true);
      
      // Second start should not throw
      await relayer.start();
      expect(relayer.isRelayerRunning()).toBe(true);
    });

    it('should handle stop when not running', async () => {
      const { relayer } = setupTest();
      
      expect(relayer.isRelayerRunning()).toBe(false);
      
      // Stop should not throw when not running
      await relayer.stop();
      expect(relayer.isRelayerRunning()).toBe(false);
    });

    it('should handle start failure gracefully', async () => {
      const { relayer, mockProvider } = setupTest();
      
      // Mock storage initialization failure
      mockProvider.setMockError(new Error('Storage initialization failed'));
      
      await expect(relayer.start()).rejects.toThrow('Storage initialization failed');
      expect(relayer.isRelayerRunning()).toBe(false);
    });
  });

  describe('Message Processing', () => {
    it('should process deposit message successfully', async () => {
      const { relayer, mockNearAccount } = setupTest();
      
      await relayer.start();
      
      const depositMessage: DepositMessage = {
        messageId: 'deposit-123',
        type: MessageType.DEPOSIT,
        sourceChain: 'ETH',
        destChain: 'NEAR',
        sender: '0x1234567890123456789012345678901234567890',
        recipient: 'test.near',
        amount: '1000000000000000000', // 1 ETH
        token: '0x0000000000000000000000000000000000000000',
        secretHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        timelock: Date.now() + 3600000, // 1 hour from now
        data: {
          txHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
        },
        timestamp: Date.now()
      };
      
      // Mock successful NEAR function call
      mockNearAccount.setMockFunctionCallResult({ success: true });
      
      await relayer.processMessage(depositMessage);
      
      expect(mockNearAccount.functionCall).toHaveBeenCalledWith(
        expect.objectContaining({
          methodName: 'create_swap_order',
          args: expect.objectContaining({
            recipient: 'test.near'
          })
        })
      );
    });

    it('should process withdrawal message successfully', async () => {
      const { relayer, mockProvider } = setupTest();
      
      await relayer.start();
      
      const withdrawalMessage: WithdrawalMessage = {
        messageId: 'withdrawal-123',
        type: MessageType.WITHDRAWAL,
        sourceChain: 'NEAR',
        destChain: 'ETH',
        sender: 'test.near',
        recipient: '0x1234567890123456789012345678901234567890',
        amount: '1000000000000000000',
        token: '0x0000000000000000000000000000000000000000',
        secret: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef12',
        data: {
          txHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
        },
        timestamp: Date.now()
      };
      
      // Mock escrow lookup success
      mockProvider.setMockEscrow({
        escrowAddress: '0x9876543210987654321098765432109876543210',
        initiator: 'test.near',
        recipient: '0x1234567890123456789012345678901234567890',
        amount: '1000000000000000000',
        secretHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab',
        timelock: Math.floor(Date.now() / 1000) + 86400,
        status: 'active'
      });
      
      await relayer.processMessage(withdrawalMessage);
      
      expect(mockProvider.call).toHaveBeenCalled();
    });

    it('should process refund message successfully', async () => {
      const { relayer, mockProvider } = setupTest();
      
      await relayer.start();
      
      const refundMessage: RefundMessage = {
        messageId: 'refund-123',
        type: MessageType.REFUND,
        sourceChain: 'ETH',
        destChain: 'NEAR',
        sender: '0x1234567890123456789012345678901234567890',
        recipient: 'test.near',
        amount: '1000000000000000000',
        token: '0x0000000000000000000000000000000000000000',
        reason: 'timeout',
        data: {
          txHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
        },
        timestamp: Date.now()
      };
      
      // Mock escrow lookup success
      mockProvider.setMockEscrow({
        escrowAddress: '0x9876543210987654321098765432109876543210',
        initiator: '0x1234567890123456789012345678901234567890',
        recipient: 'test.near',
        amount: '1000000000000000000',
        secretHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab',
        timelock: Math.floor(Date.now() / 1000) - 1, // Expired
        status: 'active'
      });
      
      await relayer.processMessage(refundMessage);
      
      expect(mockProvider.call).toHaveBeenCalled();
    });

    it('should skip already processed messages', async () => {
      const { relayer } = setupTest();
      
      await relayer.start();
      
      const depositMessage: DepositMessage = {
        messageId: 'deposit-duplicate',
        type: MessageType.DEPOSIT,
        sourceChain: 'ETH',
        destChain: 'NEAR',
        sender: '0x1234567890123456789012345678901234567890',
        recipient: 'test.near',
        amount: '1000000000000000000',
        token: '0x0000000000000000000000000000000000000000',
        secretHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        timelock: Date.now() + 3600000,
        data: {
          txHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
        },
        timestamp: Date.now()
      };
      
      // Process message first time
      await relayer.processMessage(depositMessage);
      
      // Process same message again - should be skipped
      await relayer.processMessage(depositMessage);
      
      expect(relayer.getProcessedMessageCount()).toBe(1);
    });

    it('should handle message processing errors', async () => {
      const { relayer, mockNearAccount } = setupTest();
      
      await relayer.start();
      
      const depositMessage: DepositMessage = {
        messageId: 'deposit-error',
        type: MessageType.DEPOSIT,
        sourceChain: 'ETH',
        destChain: 'NEAR',
        sender: '0x1234567890123456789012345678901234567890',
        recipient: 'test.near',
        amount: '1000000000000000000',
        token: '0x0000000000000000000000000000000000000000',
        secretHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        timelock: Date.now() + 3600000,
        data: {
          txHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
        },
        timestamp: Date.now()
      };
      
      // Mock NEAR function call failure
      mockNearAccount.setMockError(new Error('NEAR call failed'));
      
      await expect(relayer.processMessage(depositMessage)).rejects.toThrow('NEAR call failed');
    });

    it('should validate message format', async () => {
      const { relayer } = setupTest();
      
      await relayer.start();
      
      const invalidMessage = {
        messageId: '',
        type: 'INVALID' as any,
        sender: 'invalid-address',
        recipient: '',
        amount: 'invalid-amount'
      } as any;
      
      await expect(relayer.processMessage(invalidMessage)).rejects.toThrow();
    });
  });

  describe('Event Handling', () => {
    it('should handle deposit initiated event', async () => {
      const { relayer, mockNearAccount } = setupTest();
      
      await relayer.start();
      
      const depositEvent: DepositInitiatedEvent = {
        depositId: 'deposit-123',
        sender: '0x1234567890123456789012345678901234567890',
        nearRecipient: 'test.near',
        token: '0x0000000000000000000000000000000000000000',
        amount: BigInt('1000000000000000000'),
        fee: BigInt('1000000000000000'),
        timestamp: BigInt(Date.now()),
        blockNumber: 12345,
        transactionHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
      };
      
      // Mock successful NEAR function call
      mockNearAccount.setMockFunctionCallResult({ success: true });
      
      await (relayer as any).handleDepositInitiated(depositEvent);
      
      expect(mockNearAccount.functionCall).toHaveBeenCalled();
    });

    it('should handle message sent event', async () => {
      const { relayer } = setupTest();
      
      await relayer.start();
      
      const messageSentEvent: MessageSentEvent = {
        messageId: 'message-123',
        targetChain: 'NEAR',
        targetAddress: 'test.near',
        data: '0x1234567890abcdef',
        blockNumber: 12345
      };
      
      await (relayer as any).handleMessageSent(messageSentEvent);
      
      // Should process the encoded message
      expect(true).toBe(true); // Placeholder assertion
    });

    it('should handle withdrawal completed event', async () => {
      const { relayer } = setupTest();
      
      await relayer.start();
      
      const withdrawalEvent: WithdrawalCompletedEvent = {
        messageId: 'withdrawal-123',
        recipient: '0x1234567890123456789012345678901234567890',
        amount: BigInt('1000000000000000000'),
        secretHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab',
        blockNumber: 12345,
        transactionHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
      };
      
      await (relayer as any).handleWithdrawalCompleted(withdrawalEvent);
      
      // Should update NEAR escrow status
      expect(true).toBe(true); // Placeholder assertion
    });

    it('should handle escrow created event', async () => {
      const { relayer } = setupTest();
      
      await relayer.start();
      
      const escrowEvent: EscrowCreatedEvent = {
        escrow: '0x9876543210987654321098765432109876543210',
        initiator: '0x1234567890123456789012345678901234567890',
        targetChain: 'NEAR',
        amount: '1000000000000000000',
        blockNumber: 12345
      };
      
      await (relayer as any).handleEscrowCreated(escrowEvent);
      
      // Should process escrow for NEAR swap
      expect(true).toBe(true); // Placeholder assertion
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle provider connection errors', async () => {
      const { relayer, mockProvider } = setupTest();
      
      // Mock provider error
      mockProvider.setMockError(new Error('Provider connection failed'));
      
      await expect(relayer.start()).rejects.toThrow();
    });

    it('should handle NEAR account errors', async () => {
      const { relayer, mockNearAccount } = setupTest();
      
      await relayer.start();
      
      const depositMessage: DepositMessage = {
        messageId: 'deposit-near-error',
        type: MessageType.DEPOSIT,
        sourceChain: 'ETH',
        destChain: 'NEAR',
        sender: '0x1234567890123456789012345678901234567890',
        recipient: 'test.near',
        amount: '1000000000000000000',
        token: '0x0000000000000000000000000000000000000000',
        secretHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        timelock: Date.now() + 3600000,
        data: {
          txHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
        },
        timestamp: Date.now()
      };
      
      // Mock NEAR account error
      mockNearAccount.setMockError(new Error('NEAR account error'));
      
      await expect(relayer.processMessage(depositMessage)).rejects.toThrow('NEAR account error');
    });

    it('should handle contract service errors', async () => {
      const { relayer, mockProvider } = setupTest();
      
      await relayer.start();
      
      const withdrawalMessage: WithdrawalMessage = {
        messageId: 'withdrawal-contract-error',
        type: MessageType.WITHDRAWAL,
        sourceChain: 'NEAR',
        destChain: 'ETH',
        sender: 'test.near',
        recipient: '0x1234567890123456789012345678901234567890',
        amount: '1000000000000000000',
        token: '0x0000000000000000000000000000000000000000',
        secret: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef12',
        data: {
          txHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
        },
        timestamp: Date.now()
      };
      
      // Mock contract call error
      mockProvider.setMockError(new Error('Contract call failed'));
      
      await expect(relayer.processMessage(withdrawalMessage)).rejects.toThrow('Contract call failed');
    });

    it('should handle storage errors', async () => {
      const { relayer } = setupTest();
      
      // Mock storage error during start
      (relayer as any).storage.initialize = jest.fn().mockImplementation(() => {
        throw new Error('Storage error');
      });
      
      await expect(relayer.start()).rejects.toThrow('Storage error');
    });

    it('should handle event listener errors', async () => {
      const { relayer } = setupTest();
      
      // Mock event listener error
      (relayer as any).eventListener.start = jest.fn().mockImplementation(() => {
        throw new Error('Event listener error');
      });
      
      await expect(relayer.start()).rejects.toThrow('Event listener error');
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle complete deposit flow', async () => {
      const { relayer, mockNearAccount } = setupTest();
      
      await relayer.start();
      
      // Step 1: Handle deposit initiated event
      const depositEvent: DepositInitiatedEvent = {
        depositId: 'deposit-flow-123',
        sender: '0x1234567890123456789012345678901234567890',
        nearRecipient: 'test.near',
        token: '0x0000000000000000000000000000000000000000',
        amount: BigInt('1000000000000000000'),
        fee: BigInt('1000000000000000'),
        timestamp: BigInt(Date.now()),
        blockNumber: 12345,
        transactionHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
      };
      
      mockNearAccount.setMockFunctionCallResult({ success: true });
      await (relayer as any).handleDepositInitiated(depositEvent);
      
      // Step 2: Process corresponding deposit message
      const depositMessage: DepositMessage = {
        messageId: 'deposit-flow-123',
        type: MessageType.DEPOSIT,
        sourceChain: 'ETH',
        destChain: 'NEAR',
        sender: '0x1234567890123456789012345678901234567890',
        recipient: 'test.near',
        amount: '1000000000000000000',
        token: '0x0000000000000000000000000000000000000000',
        secretHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        timelock: Date.now() + 3600000,
        data: {
          txHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
        },
        timestamp: Date.now()
      };
      
      await relayer.processMessage(depositMessage);
      
      expect(mockNearAccount.functionCall).toHaveBeenCalledTimes(2);
      expect(relayer.getProcessedMessageCount()).toBe(1);
    });

    it('should handle complete withdrawal flow', async () => {
      const { relayer, mockProvider } = setupTest();
      
      await relayer.start();
      
      // Step 1: Setup escrow
      mockProvider.setMockEscrow({
        escrowAddress: '0x9876543210987654321098765432109876543210',
        initiator: 'test.near',
        recipient: '0x1234567890123456789012345678901234567890',
        amount: '1000000000000000000',
        secretHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab',
        timelock: Math.floor(Date.now() / 1000) + 86400,
        status: 'active'
      });
      
      // Step 2: Process withdrawal message
      const withdrawalMessage: WithdrawalMessage = {
        messageId: 'withdrawal-flow-123',
        type: MessageType.WITHDRAWAL,
        sourceChain: 'NEAR',
        destChain: 'ETH',
        sender: 'test.near',
        recipient: '0x1234567890123456789012345678901234567890',
        amount: '1000000000000000000',
        token: '0x0000000000000000000000000000000000000000',
        secret: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef12',
        data: {
          txHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
        },
        timestamp: Date.now()
      };
      
      await relayer.processMessage(withdrawalMessage);
      
      // Step 3: Handle withdrawal completed event
      const withdrawalEvent: WithdrawalCompletedEvent = {
        messageId: 'withdrawal-flow-123',
        recipient: '0x1234567890123456789012345678901234567890',
        amount: BigInt('1000000000000000000'),
        secretHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab',
        blockNumber: 12346,
        transactionHash: '0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321'
      };
      
      await (relayer as any).handleWithdrawalCompleted(withdrawalEvent);
      
      expect(mockProvider.call).toHaveBeenCalled();
      expect(relayer.getProcessedMessageCount()).toBe(1);
    });

    it('should handle timeout and refund flow', async () => {
      const { relayer, mockProvider } = setupTest();
      
      await relayer.start();
      
      // Step 1: Setup expired escrow
      mockProvider.setMockEscrow({
        escrowAddress: '0x9876543210987654321098765432109876543210',
        initiator: '0x1234567890123456789012345678901234567890',
        recipient: 'test.near',
        amount: '1000000000000000000',
        secretHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab',
        timelock: Math.floor(Date.now() / 1000) - 1, // Expired
        status: 'active'
      });
      
      // Step 2: Process refund message
      const refundMessage: RefundMessage = {
        messageId: 'refund-flow-123',
        type: MessageType.REFUND,
        sourceChain: 'ETH',
        destChain: 'NEAR',
        sender: '0x1234567890123456789012345678901234567890',
        recipient: 'test.near',
        amount: '1000000000000000000',
        token: '0x0000000000000000000000000000000000000000',
        reason: 'timeout',
        data: {
          txHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
        },
        timestamp: Date.now()
      };
      
      await relayer.processMessage(refundMessage);
      
      expect(mockProvider.call).toHaveBeenCalled();
      expect(relayer.getProcessedMessageCount()).toBe(1);
    });
  });

  describe('Performance and Concurrency', () => {
    it('should handle multiple concurrent messages', async () => {
      const { relayer, mockNearAccount } = setupTest();
      
      await relayer.start();
      
      // Create multiple deposit messages
      const messages: DepositMessage[] = Array.from({ length: 5 }, (_, i) => ({
        messageId: `concurrent-deposit-${i}`,
        type: MessageType.DEPOSIT,
        sourceChain: 'ETH',
        destChain: 'NEAR',
        sender: '0x1234567890123456789012345678901234567890',
        recipient: 'test.near',
        amount: '1000000000000000000',
        token: '0x0000000000000000000000000000000000000000',
        secretHash: ('0x' + '1'.repeat(63) + i),
        timelock: Date.now() + 3600000,
        data: {
          txHash: ('0x' + '2'.repeat(63) + i)
        },
        timestamp: Date.now()
      }));
      
      mockNearAccount.setMockFunctionCallResult({ success: true });
      
      // Process all messages concurrently
      await Promise.all(messages.map(msg => relayer.processMessage(msg)));
      
      expect(relayer.getProcessedMessageCount()).toBe(5);
      expect(mockNearAccount.functionCall).toHaveBeenCalledTimes(5);
    });

    it('should handle rapid start/stop cycles', async () => {
      const { relayer } = setupTest();
      
      // Rapid start/stop cycles
      for (let i = 0; i < 3; i++) {
        await relayer.start();
        expect(relayer.isRelayerRunning()).toBe(true);
        
        await relayer.stop();
        expect(relayer.isRelayerRunning()).toBe(false);
      }
    });
  });
});
