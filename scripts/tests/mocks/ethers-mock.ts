// Mock implementation for ethers library used in enhanced scripts testing

import { TestHelpers } from '../test-utils/test-helpers';

export class MockJsonRpcProvider {
  private mockResponses: Map<string, any> = new Map();
  private eventListeners: Map<string, Function[]> = new Map();
  private blockNumber = 1000000;

  constructor(public url: string) {}

  // Mock network information
  async getNetwork() {
    return {
      chainId: BigInt(11155111), // Sepolia
      name: 'sepolia'
    };
  }

  // Mock balance queries
  async getBalance(address?: string) {
    return BigInt('1000000000000000000'); // 1 ETH in wei
  }

  // Mock block number
  async getBlockNumber() {
    return this.blockNumber;
  }

  // Mock contract code
  async getCode(address?: string) {
    return '0x608060405234801561001057600080fd5b50'; // Mock contract bytecode
  }

  // Event listener management
  on(event: string, listener: Function) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event)!.push(listener);
  }

  removeAllListeners() {
    this.eventListeners.clear();
  }

  // Simulate block events
  emitBlock(blockNumber: number) {
    this.blockNumber = blockNumber;
    const listeners = this.eventListeners.get('block') || [];
    listeners.forEach(listener => listener(blockNumber));
  }

  // Simulate provider errors
  emitError(error: Error) {
    const listeners = this.eventListeners.get('error') || [];
    listeners.forEach(listener => listener(error));
  }

  // Mock response setup for testing
  setMockResponse(method: string, response: any) {
    this.mockResponses.set(method, response);
  }
}

export class MockWallet {
  public address: string;
  public provider: MockJsonRpcProvider;

  constructor(privateKey: string, provider: MockJsonRpcProvider) {
    this.address = '0x' + '1'.repeat(40); // Mock address
    this.provider = provider;
  }

  async getAddress() {
    return this.address;
  }
}

export class MockContract {
  private eventListeners: Map<string, Function[]> = new Map();
  private mockMethods: Map<string, any> = new Map();
  public interface: MockContractInterface;

  constructor(
    public address: string,
    public abi: any[],
    public signerOrProvider: any
  ) {
    this.interface = new MockContractInterface(abi);
    this.setupDefaultMethods();
  }

  private setupDefaultMethods() {
    // Mock common contract methods
    this.mockMethods.set('nonces', () => Promise.resolve(BigInt(1)));
    this.mockMethods.set('getDepositId', () => Promise.resolve('0x' + '1'.repeat(64)));
    this.mockMethods.set('deposits', () => Promise.resolve([
      '0x' + '0'.repeat(40), // token
      '0x' + '1'.repeat(40), // depositor
      'test.testnet',         // nearRecipient
      BigInt('10000000000000000'), // amount
      BigInt(Date.now()),     // timestamp
      false,                  // claimed
      false,                  // disputed
      BigInt(0),             // disputeEndTime
      '0x' + '3'.repeat(64), // secretHash
      BigInt(3600)           // timelock
    ]));
  }

  // Mock contract methods
  async queryFilter(filter: any): Promise<any[]> {
    return [];
  }

  // Mock specific contract methods
  async depositToNear(...args: any[]): Promise<any> {
    return {
      hash: `0x${Math.random().toString(16).substr(2, 8)}`,
      wait: () => Promise.resolve(TestHelpers.createMockTransactionReceipt())
    };
  }

  async withdrawFromNear(...args: any[]): Promise<any> {
    return {
      hash: `0x${Math.random().toString(16).substr(2, 8)}`,
      wait: () => Promise.resolve(TestHelpers.createMockTransactionReceipt())
    };
  }

  async getEscrow(...args: any[]): Promise<any> {
    return null;
  }

  // Event listener methods
  on(event: string, listener: (...args: any[]) => void): this {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(listener);
    return this;
  }

  removeAllListeners(event?: string): this {
    if (event) {
      delete this.listeners[event];
    } else {
      this.listeners = {};
    }
    return this;
  }

  // Allow dynamic property access for contract methods
  [key: string]: any;

  // Simulate contract events
  emitEvent(eventName: string, ...args: any[]) {
    const listeners = this.eventListeners.get(eventName) || [];
    listeners.forEach(listener => listener(...args));
  }

  // Mock method setup for testing
  setMockMethod(methodName: string, implementation: any) {
    this.mockMethods.set(methodName, implementation);
  }
}

export class MockContractInterface {
  constructor(private abi: any[]) {}

  parseLog(log: { topics: string[]; data: string }) {
    // Mock log parsing - return a simple parsed log
    return {
      name: 'DepositInitiated',
      args: {
        depositId: '0x' + '1'.repeat(64),
        sender: '0x' + '2'.repeat(40),
        nearRecipient: 'test.testnet',
        token: '0x' + '0'.repeat(40),
        amount: BigInt('10000000000000000'),
        fee: BigInt('1000000000000000'),
        timestamp: BigInt(Date.now())
      }
    };
  }
}

// Mock ethers utilities
export const mockEthers = {
  JsonRpcProvider: MockJsonRpcProvider,
  Wallet: MockWallet,
  Contract: MockContract,
  
  // Utility functions
  isAddress: (address: string) => {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
  },
  
  formatEther: (wei: bigint) => {
    return (Number(wei) / 1e18).toString();
  },
  
  parseEther: (ether: string) => {
    return BigInt(Math.floor(parseFloat(ether) * 1e18));
  },
  
  keccak256: (data: string) => {
    return '0x' + '3'.repeat(64); // Mock hash
  },
  
  toUtf8Bytes: (str: string) => {
    return new TextEncoder().encode(str);
  }
};

// Export individual mocks for easier testing
export { MockJsonRpcProvider as JsonRpcProvider };
export { MockWallet as Wallet };
export { MockContract as Contract };
