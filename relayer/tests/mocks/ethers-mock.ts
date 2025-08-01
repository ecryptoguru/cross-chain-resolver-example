/**
 * Mock implementation for ethers library used in relayer testing
 */

export interface MockLogEntry {
  address: string;
  topics: string[];
  data: string;
  blockNumber: number;
  transactionHash: string;
  transactionIndex: number;
  blockHash: string;
  logIndex: number;
}

export interface MockTransactionReceipt {
  to: string;
  from: string;
  contractAddress: string | null;
  transactionIndex: number;
  gasUsed: any;
  logsBloom: string;
  blockHash: string;
  transactionHash: string;
  logs: MockLogEntry[];
  blockNumber: number;
  confirmations: number;
  cumulativeGasUsed: any;
  status?: number;
}

export interface MockTransaction {
  hash: string;
  to?: string;
  from: string;
  nonce: number;
  gasLimit: any;
  gasPrice: any;
  data: string;
  value: any;
  chainId: number;
  wait: () => Promise<MockTransactionReceipt>;
}

export class MockProvider {
  private blockNumber = 1000000;
  private logs: MockLogEntry[] = [];
  private receipts: Map<string, MockTransactionReceipt> = new Map();
  private contracts: Map<string, MockContract> = new Map();
  private _mockError: Error | null = null;

  // Internal ethers.js type markers
  readonly _isProvider = true;
  readonly _networkPromise: Promise<any>;

  constructor() {
    this._networkPromise = Promise.resolve({
      name: 'mock',
      chainId: 1,
      ensAddress: null
    });
  }

  async getBlockNumber(): Promise<number> {
    if (this._mockError) {
      throw this._mockError;
    }
    return this.blockNumber;
  }

  // Essential ethers.js provider interface methods
  async getNetwork(): Promise<any> {
    return this._networkPromise;
  }

  async detectNetwork(): Promise<any> {
    return this._networkPromise;
  }

  async send(method: string, _params: any[]): Promise<any> {
    // Mock implementation for ethers.js internal calls
    switch (method) {
      case 'eth_chainId':
        return '0x1';
      case 'eth_blockNumber':
        return '0x' + this.blockNumber.toString(16);
      case 'eth_getBalance':
        return '0xde0b6b3a7640000'; // 1 ETH
      default:
        return '0x0';
    }
  }

  async getLogs(filter: any): Promise<MockLogEntry[]> {
    return this.logs.filter(log => {
      if (filter.address && log.address !== filter.address) return false;
      if (filter.fromBlock && log.blockNumber < filter.fromBlock) return false;
      if (filter.toBlock && log.blockNumber > filter.toBlock) return false;
      if (filter.topics && filter.topics.length > 0) {
        return filter.topics.every((topic: string, index: number) => 
          !topic || log.topics[index] === topic
        );
      }
      return true;
    });
  }

  async getTransactionReceipt(txHash: string): Promise<MockTransactionReceipt | null> {
    return this.receipts.get(txHash) || null;
  }

  async getBalance(_address: string): Promise<any> {
    return mockEthers.BigNumber.from('1000000000000000000'); // 1 ETH
  }

  async getCode(_address: string): Promise<string> {
    return '0x608060405234801561001057600080fd5b50'; // Mock contract bytecode
  }

  async call(_transaction: any): Promise<string> {
    return '0x0000000000000000000000000000000000000000000000000000000000000001';
  }

  async estimateGas(_transaction: any): Promise<any> {
    return mockEthers.BigNumber.from('21000');
  }

  async sendTransaction(transaction: any): Promise<MockTransaction> {
    const txHash = '0x' + Math.random().toString(16).substr(2, 64);
    const mockTx: MockTransaction = {
      hash: txHash,
      to: transaction.to,
      from: transaction.from || '0x' + '1'.repeat(40),
      nonce: 1,
      gasLimit: mockEthers.BigNumber.from('21000'),
      gasPrice: mockEthers.BigNumber.from('20000000000'),
      data: transaction.data || '0x',
      value: mockEthers.BigNumber.from(transaction.value || '0'),
      chainId: 1,
      wait: async () => {
        const receipt: MockTransactionReceipt = {
          to: transaction.to,
          from: transaction.from || '0x' + '1'.repeat(40),
          contractAddress: null,
          transactionIndex: 0,
          gasUsed: mockEthers.BigNumber.from('21000'),
          logsBloom: '0x' + '0'.repeat(512),
          blockHash: '0x' + Math.random().toString(16).substr(2, 64),
          transactionHash: txHash,
          logs: [],
          blockNumber: this.blockNumber,
          confirmations: 1,
          cumulativeGasUsed: mockEthers.BigNumber.from('21000'),
          status: 1
        };
        this.receipts.set(txHash, receipt);
        return receipt;
      }
    };
    return mockTx;
  }

  // Test helper methods
  addLog(log: MockLogEntry): void {
    this.logs.push(log);
  }

  addReceipt(txHash: string, receipt: MockTransactionReceipt): void {
    this.receipts.set(txHash, receipt);
  }

  setBlockNumber(blockNumber: number): void {
    this.blockNumber = blockNumber;
  }

  clearLogs(): void {
    this.logs = [];
  }

  clearReceipts(): void {
    this.receipts.clear();
  }

  // Mock control methods for testing
  setMockContract(contract: MockContract): void {
    this.contracts.set(contract.address, contract);
  }

  setMockContractForAddress(address: string, contract: MockContract): void {
    this.contracts.set(address, contract);
  }

  setMockError(error: Error | null): void {
    this._mockError = error;
    // TODO: Implement error injection in mock methods when needed
  }

  getMockContract(address: string): MockContract | undefined {
    return this.contracts.get(address);
  }
}

export class MockSigner {
  private address = '0x' + '1'.repeat(40);
  private _provider: MockProvider;
  private contracts: Map<string, MockContract> = new Map();

  // Internal ethers.js type markers
  readonly _isSigner = true;

  constructor(provider?: MockProvider) {
    this._provider = provider || new MockProvider();
  }

  // Essential ethers.js signer interface methods
  get provider(): MockProvider {
    return this._provider;
  }

  async getAddress(): Promise<string> {
    return this.address;
  }

  async signMessage(_message: string): Promise<string> {
    return '0x' + 'a'.repeat(130); // Mock signature
  }

  async signTransaction(_transaction: any): Promise<string> {
    return '0x' + 'b'.repeat(200); // Mock signed transaction
  }

  async sendTransaction(transaction: any): Promise<MockTransaction> {
    return this._provider.sendTransaction({ ...transaction, from: this.address });
  }

  connect(provider: MockProvider): MockSigner {
    return new MockSigner(provider);
  }

  getBalance(): Promise<any> {
    return this._provider.getBalance(this.address);
  }

  setAddress(address: string): void {
    this.address = address;
  }

  // Mock control methods for testing
  setMockContract(contract: MockContract): void {
    this.contracts.set(contract.address, contract);
  }

  getMockContract(address: string): MockContract | undefined {
    return this.contracts.get(address);
  }
}

export class MockContract {
  public address: string;
  public interface: any;
  public signer: MockSigner | null;
  public provider: MockProvider;

  constructor(address: string, abi: any[], signerOrProvider: MockSigner | MockProvider) {
    this.address = address;
    this.interface = { format: () => abi };
    
    if (signerOrProvider instanceof MockSigner) {
      this.signer = signerOrProvider;
      this.provider = signerOrProvider['provider'] || new MockProvider();
    } else {
      this.signer = null;
      this.provider = signerOrProvider;
    }
  }

  // Mock contract methods
  async deposits(_depositId?: string): Promise<any[]> {
    return [
      '0x' + '0'.repeat(40), // token
      '0x' + '1'.repeat(40), // depositor
      'recipient.testnet',   // nearRecipient
      mockEthers.BigNumber.from('1000000000000000000'), // amount
      mockEthers.BigNumber.from(Date.now()), // timestamp
      false, // claimed
      false, // disputed
      mockEthers.BigNumber.from(Date.now() + 86400), // disputeEndTime
      '0x' + '3'.repeat(64), // secretHash
      mockEthers.BigNumber.from(Date.now() + 86400) // timelock
    ];
  }

  async getDepositId(): Promise<string> {
    return '0x' + '1'.repeat(64);
  }

  async nonces(): Promise<any> {
    return mockEthers.BigNumber.from('1');
  }

  async createEscrow(..._args: any[]): Promise<MockTransaction> {
    return this.signer?.sendTransaction({
      to: this.address,
      data: '0x' + 'createEscrow'.split('').map(c => c.charCodeAt(0).toString(16)).join('')
    }) || this.provider.sendTransaction({
      to: this.address,
      data: '0x' + 'createEscrow'.split('').map(c => c.charCodeAt(0).toString(16)).join('')
    });
  }

  async completeWithdrawal(..._args: any[]): Promise<MockTransaction> {
    return this.signer?.sendTransaction({
      to: this.address,
      data: '0x' + 'completeWithdrawal'.split('').map(c => c.charCodeAt(0).toString(16)).join('')
    }) || this.provider.sendTransaction({
      to: this.address,
      data: '0x' + 'completeWithdrawal'.split('').map(c => c.charCodeAt(0).toString(16)).join('')
    });
  }

  async refund(..._args: any[]): Promise<MockTransaction> {
    return this.signer?.sendTransaction({
      to: this.address,
      data: '0x' + 'refund'.split('').map(c => c.charCodeAt(0).toString(16)).join('')
    }) || this.provider.sendTransaction({
      to: this.address,
      data: '0x' + 'refund'.split('').map(c => c.charCodeAt(0).toString(16)).join('')
    });
  }

  connect(signerOrProvider: MockSigner | MockProvider): MockContract {
    return new MockContract(this.address, [], signerOrProvider);
  }

  // Event filtering
  filters = {
    DepositInitiated: (..._args: any[]) => ({
      address: this.address,
      topics: ['0x' + 'DepositInitiated'.split('').map(c => c.charCodeAt(0).toString(16)).join('')]
    }),
    EscrowCreated: (..._args: any[]) => ({
      address: this.address,
      topics: ['0x' + 'EscrowCreated'.split('').map(c => c.charCodeAt(0).toString(16)).join('')]
    }),
    WithdrawalCompleted: (..._args: any[]) => ({
      address: this.address,
      topics: ['0x' + 'WithdrawalCompleted'.split('').map(c => c.charCodeAt(0).toString(16)).join('')]
    })
  };

  async queryFilter(filter: any, fromBlock?: number, toBlock?: number): Promise<MockLogEntry[]> {
    return this.provider.getLogs({
      address: filter.address,
      topics: filter.topics,
      fromBlock,
      toBlock
    });
  }
}

// Mock ethers utilities
export const mockEthers = {
  providers: {
    JsonRpcProvider: MockProvider
  },
  Signer: MockSigner,
  Contract: MockContract,
  BigNumber: {
    from: (value: string | number) => ({
      toString: () => value.toString(),
      toBigInt: () => BigInt(value),
      eq: (other: any) => value.toString() === other.toString(),
      gt: (other: any) => BigInt(value) > BigInt(other.toString()),
      lt: (other: any) => BigInt(value) < BigInt(other.toString()),
      add: (other: any) => mockEthers.BigNumber.from((BigInt(value) + BigInt(other.toString())).toString()),
      sub: (other: any) => mockEthers.BigNumber.from((BigInt(value) - BigInt(other.toString())).toString())
    })
  },
  utils: {
    isAddress: (address: string) => /^0x[a-fA-F0-9]{40}$/.test(address),
    getAddress: (address: string) => address.toLowerCase(),
    keccak256: (_data?: string) => '0x' + '3'.repeat(64),
    toUtf8Bytes: (str: string) => new Uint8Array(Buffer.from(str, 'utf8')),
    parseEther: (value: string) => mockEthers.BigNumber.from((BigInt(parseFloat(value) * 1e18)).toString()),
    formatEther: (value: any) => (BigInt(value.toString()) / BigInt(1e18)).toString(),
    hexlify: (value: any) => '0x' + value.toString(16),
    arrayify: (value: string) => new Uint8Array(Buffer.from(value.replace('0x', ''), 'hex'))
  }
};

// Export default mock
export default mockEthers;
