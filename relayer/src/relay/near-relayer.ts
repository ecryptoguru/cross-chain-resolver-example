// Import from near-api-js using specific module paths
import { connect } from 'near-api-js/lib/connect';
import { InMemoryKeyStore } from 'near-api-js/lib/key_stores/in_memory_key_store';
import { KeyPair } from 'near-api-js/lib/utils/key_pair';
import type { FinalExecutionOutcome, FinalExecutionStatus } from 'near-api-js/lib/providers';
import type { Near } from 'near-api-js/lib/near';
import type { Account } from 'near-api-js/lib/account';
import { JsonRpcProvider, Wallet } from 'ethers';
import BN from 'bn.js';

// Re-export commonly used types for convenience
export type NearAccount = Account;
export type NearKeyStore = InMemoryKeyStore;
export type NearKeyPair = KeyPair;

// Extend the Account interface with additional methods we'll use
declare module 'near-api-js' {
  interface Account {
    connection: {
      provider: any; // Using 'any' as the exact Connection type is not exported
    };
    functionCall: (options: {
      contractId: string;
      methodName: string;
      args?: any;
      gas?: string | number | bigint;
      attachedDeposit?: string | number | bigint;
    }) => Promise<FinalExecutionOutcome>;
    viewFunction: <T = any>(options: {
      contractId: string;
      methodName: string;
      args?: any;
    }) => Promise<T>;
  }
}
import { ethers } from 'ethers';
import { logger } from '../utils/logger';
import { sleep } from '../utils/common';

// Types for NEAR provider responses
interface BlockResult {
  header: {
    height: number;
    hash: string;
    timestamp: number;
  };
  chunks: {
    chunk_hash: string;
  }[];
}

interface ChunkResult {
  header: {
    height_created: number;
    shard_id: number;
    chunk_hash: string;
  };
  receipts: {
    receipt_id: string;
    receiver_id: string;
  }[];
}

// Extended NEAR account type with additional methods we'll use
// Using the re-exported NearAccount type

// Type definitions
type MessageType = 'DEPOSIT' | 'WITHDRAWAL' | 'REFUND';

interface CrossChainMessage {
  messageId: string;
  type: MessageType;
  sourceChain: 'NEAR' | 'ETH';
  destChain: 'NEAR' | 'ETH';
  sender: string;
  recipient: string;
  amount: string;
  token: string;
  data: {
    secretHash?: string;
    secret?: string;
    timelock?: number;
    txHash: string;
  };
  timestamp: number;
  signature: string;
}

interface NearRelayerConfig {
  networkId: string;
  nodeUrl: string;
  walletUrl: string;
  helperUrl: string;
  explorerUrl: string;
  nearAccountId: string;
  nearPrivateKey: string;
  ethereumRpcUrl: string;
  ethereumPrivateKey: string;
  nearEscrowContractId: string;
  ethereumEscrowContractAddress: string;
  pollIntervalMs?: number;
}

export class NearRelayer {
  private config: NearRelayerConfig;
  private nearAccount!: NearAccount;
  private nearConnection!: Near;
  private ethereumProvider: JsonRpcProvider = {} as JsonRpcProvider; // Initialize with dummy value
  private ethereumSigner: Wallet = {} as Wallet; // Initialize with dummy value
  private isRunning: boolean = false;
  private pollInterval: number = 5000; // 5 seconds
  private pollTimeout: NodeJS.Timeout | null = null;
  private lastProcessedBlockHeight: number = 0;
  private logger: Console = console; // Using console as default logger
  private processedMessages: Set<string> = new Set();
  private processedBlocks: Set<number> = new Set();
  private pendingMessages: Map<string, CrossChainMessage> = new Map();

  private convertToYoctoNear(amount: string | number): bigint {
    const nearAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
    return BigInt(Math.floor(nearAmount * 1e24));
  }

  private convertFromYoctoNear(amount: bigint): number {
    return Number(amount) / 1e24;
  }

  // Define EscrowABI as a placeholder - should be imported from your contract ABI
  private static readonly EscrowABI = [
    // Minimal ABI for escrow contract methods we'll use
    'function getDetails() view returns (tuple(uint8, address, uint256, uint256, bytes32, address, address, uint256))',
    'function withdraw(bytes32 secret) external',
    'function refund() external'
  ];

  constructor(config: NearRelayerConfig) {
    this.config = {
      pollIntervalMs: 5000, // Default poll interval: 5 seconds
      ...config
    };
  }

  /**
   * Initialize the NEAR relayer
   */
  public async initialize(): Promise<void> {
    try {
      this.logger.info(
        `Initializing NEAR relayer for account: ${this.config.nearAccountId}`,
        {
          networkId: this.config.networkId,
          nodeUrl: this.config.nodeUrl,
        },
      );

      // Create a key store and add the key pair
      const keyStore = new InMemoryKeyStore();
      const keyPair = KeyPair.fromString(this.config.nearPrivateKey);
      await keyStore.setKey(
        this.config.networkId,
        this.config.nearAccountId,
        keyPair
      );

      // Initialize connection
      this.nearConnection = await connect({
        networkId: this.config.networkId,
        keyStore,
        nodeUrl: this.config.nodeUrl,
        walletUrl: this.config.walletUrl,
        headers: {}
      });
      
      // Get the account - we need to use type assertion here since the Account type isn't properly exported
      this.nearAccount = await this.nearConnection.account(this.config.nearAccountId) as unknown as NearAccount;

      // Initialize Ethereum connection (stub - replace with actual initialization)
      // This is a placeholder - you'll need to implement actual ethers v6 initialization
      this.ethereumProvider = new JsonRpcProvider(this.config.ethereumRpcUrl);
      this.ethereumSigner = new Wallet(this.config.ethereumPrivateKey, this.ethereumProvider);

      // Get the latest block height
      const status = await this.nearConnection.connection.provider.status();
      this.lastProcessedBlockHeight = Number(status.sync_info.latest_block_height);

      this.logger.info('NEAR relayer initialized successfully', {
        nearAccountId: this.config.nearAccountId,
        lastProcessedBlockHeight: this.lastProcessedBlockHeight,
      });
    } catch (error) {
      console.error('Failed to initialize NEAR relayer:', error);
      throw error;
    }
  }

  /**
   * Start the relayer
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('NEAR relayer is already running');
      return;
    }

    this.isRunning = true;
    logger.info('Starting NEAR relayer...');

    // Initial poll
    await this.pollBlocks();

    // Set up polling
    this.pollTimeout = setTimeout(
      () => this.pollBlocks().catch(console.error),
      this.pollInterval
    ) as NodeJS.Timeout;
  }

  /**
   * Stop the relayer
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    logger.info('Stopping NEAR relayer...');
    this.isRunning = false;

    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
      this.pollTimeout = null;
    }
  }

  /**
   * Main polling function
   */
  private async pollBlocks(): Promise<void> {
    if (!this.isRunning) return;

    try {
      const status = await this.nearConnection.connection.provider.status();
      const latestBlockHeight = status.sync_info.latest_block_height;

      // Process new blocks since last processed block
      for (let height = this.lastProcessedBlockHeight + 1; height <= latestBlockHeight; height++) {
        await this.processBlock(height);
      }
    } catch (error) {
      console.error('Error polling for new blocks:', error);
    } finally {
      // Schedule next poll
      if (this.isRunning) {
        this.pollTimeout = setTimeout(
          () => this.pollBlocks().catch(console.error),
          this.pollInterval
        ) as NodeJS.Timeout;
      }
    }
  }

  /**
   * Process a single block
   */
  private async processBlock(blockHeight: number): Promise<void> {
    try {
      const block = await this.nearAccount.connection.provider.block({
        blockId: blockHeight
      });

      // Process all chunks in the block
      if (block.chunks) {
        for (const chunk of block.chunks) {
          await this.processChunk(chunk, block.header);
        }
      }

      this.processedBlocks.add(blockHeight);
      this.lastProcessedBlockHeight = blockHeight;
    } catch (error) {
      console.error(`Error processing block ${blockHeight}:`, error);
      throw error;
    }
  }

  /**
   * Process a chunk
   */
  private async processChunk(chunk: any, blockHeader: any): Promise<void> {
    if (!chunk?.chunk_hash) return;
    
    try {
      // Get chunk details using the chunk hash
      const chunkResult = await this.nearAccount.connection.provider.chunk(
        chunk.chunk_hash
      );
      
      // Process all transactions in the chunk
      if (chunkResult?.transactions) {
        for (const tx of chunkResult.transactions) {
          if (tx) {
            await this.processTransaction(tx, blockHeader);
          }
        }
      }
    } catch (error) {
      console.error(`Error processing chunk ${chunk.chunk_hash}:`, error);
    }
  }

  /**
   * Process a transaction
   */
  private async processTransaction(tx: any, blockHeader: any): Promise<void> {
    if (!tx?.hash || !tx?.signer_id) return;
    
    try {
      // Check if we've already processed this transaction
      const txHash = typeof tx.hash === 'string' ? tx.hash : tx.hash.toString('base64');
      if (this.processedMessages.has(txHash)) {
        return;
      }

      // Process the transaction based on its type
      const receipt = await this.nearAccount.connection.provider.txStatus(
        tx.hash,
        tx.signer_id
      );

      // Check for successful execution
      if (receipt?.status && typeof receipt.status === 'object' && 'SuccessValue' in receipt.status) {
        // Handle successful transaction
        this.processedMessages.add(txHash);
      }
    } catch (error) {
      console.error('Error processing transaction:', error);
      // Don't throw to continue processing other transactions
    }
  }

  /**
   * Process a receipt and extract cross-chain messages
   */
  private async processReceipt(receipt: any, blockHeader: any): Promise<void> {
    try {
      // Skip failed receipts
      if (receipt.outcome.status.Failure) {
        return;
      }

      // Process all logs in the receipt
      for (const log of receipt.outcome.logs) {
        await this.processLog(log, blockHeader);
      }
    } catch (error) {
      logger.error('Error processing receipt:', error);
    }
  }

  /**
   * Process a log and extract cross-chain messages
   */
  private async processLog(log: string, blockHeader: any): Promise<void> {
    try {
      // Check if this is a cross-chain message
      if (!log.startsWith('CROSS_CHAIN_MSG:')) {
        return;
      }

      // Parse the message
      const messageStr = log.substring('CROSS_CHAIN_MSG:'.length);
      const message: CrossChainMessage = JSON.parse(messageStr);
      
      // Add timestamp from block header
      message.timestamp = blockHeader.timestamp / 1_000_000; // Convert from nanoseconds to milliseconds

      // Process the message
      await this.processCrossChainMessage(message);
    } catch (error) {
      logger.error('Error processing log:', error);
    }
  }

  /**
   * Process a cross-chain message
   */
  private async processCrossChainMessage(message: CrossChainMessage): Promise<void> {
    const messageId = message.messageId;

    // Skip if already processed
    if (this.processedMessages.has(messageId)) {
      return;
    }

    try {
      logger.info(`Processing cross-chain message: ${messageId}`, { message });

      // Verify the message signature
      const isValid = await this.verifyMessageSignature(message);
      if (!isValid) {
        throw new Error(`Invalid signature for message: ${messageId}`);
      }

      // Process based on message type
      switch (message.type) {
        case 'DEPOSIT':
          await this.handleDepositMessage(message);
          break;
        case 'WITHDRAWAL':
          await this.handleWithdrawalMessage(message);
          break;
        case 'REFUND':
          await this.handleRefundMessage(message);
          break;
        default:
          throw new Error(`Unknown message type: ${message.type}`);
      }

      // Mark as processed
      this.processedMessages.add(messageId);
      logger.info(`Successfully processed message: ${messageId}`);
    } catch (error) {
      logger.error(`Failed to process message ${messageId}:`, error);
      // TODO: Implement retry logic with exponential backoff
    }
  }

  /**
   * Handle a deposit message from NEAR to Ethereum
   */
  private async handleDepositMessage(message: CrossChainMessage): Promise<void> {
    const { sender, recipient, amount, data } = message;
    const { secretHash, timelock, txHash } = data;

    if (!secretHash || !timelock) {
      throw new Error('Missing required fields for deposit message');
    }

    logger.info(`Processing deposit from NEAR to Ethereum`, {
      sender,
      recipient,
      amount,
      secretHash,
      timelock,
      txHash
    });

    // TODO: Implement the actual deposit logic
    // This would involve calling the Ethereum contract to lock the funds
  }

  /**
   * Handle a withdrawal message from NEAR to Ethereum
   */
  private async handleWithdrawalMessage(message: CrossChainMessage): Promise<void> {
    const { sender, recipient, amount, data } = message;
    const { secret, txHash } = data;

    if (!secret) {
      throw new Error('Missing secret for withdrawal message');
    }

    logger.info(`Processing withdrawal from NEAR to Ethereum`, {
      sender,
      recipient,
      amount,
      secret,
      txHash
    });

    // TODO: Implement the actual withdrawal logic
    // This would involve calling the Ethereum contract to release the funds
  }

  /**
   * Handle a refund message from NEAR to Ethereum
   */
  private async handleRefundMessage(message: CrossChainMessage): Promise<void> {
    const { sender, recipient, amount, data } = message;
    const { txHash } = data;

    logger.info(`Processing refund from NEAR to Ethereum`, {
      sender,
      recipient,
      amount,
      txHash
    });

    // TODO: Implement the actual refund logic
    // This would involve calling the Ethereum contract to refund the locked funds
  }

  /**
   * Verify the signature of a cross-chain message
   */
  private async verifyMessageSignature(message: CrossChainMessage): Promise<boolean> {
    // TODO: Implement proper signature verification
    // This would involve verifying the signature against the sender's public key
    return true; // Placeholder
  }

  /**
   * Send a message to the NEAR contract
   */
  private async sendToNearContract(
    contractId: string,
    method: string,
    args: Record<string, any>,
    gas: string | number | bigint = '30000000000000', // 30 TGas
    deposit: string | number | bigint = '0'
  ): Promise<any> {
    try {
      // Import BN here to avoid circular dependencies
      const BN = (await import('bn.js')).default;
      
      // Convert gas and deposit to BN
      const gasBN = new BN(gas.toString());
      const depositBN = new BN(deposit.toString());
      
      const result = await this.nearAccount.functionCall({
        contractId,
        methodName: method,
        args,
        gas: gasBN,
        attachedDeposit: depositBN
      });

      return result;
    } catch (error) {
      logger.error(`Error calling ${method} on ${contractId}:`, error);
      throw error;
    }
  }

  /**
   * Send a transaction to the Ethereum contract
   */
  private async sendToEthereumContract(
    contractAddress: string,
    abi: any[],
    method: string,
    args: any[],
    value: ethers.BigNumber = ethers.BigNumber.from(0)
  ): Promise<ethers.ContractTransaction> {
    try {
      const contract = new ethers.Contract(
        contractAddress,
        abi,
        this.ethereumSigner
      );

      const tx = await contract[method](...args, { value });
      const receipt = await tx.wait();

      return receipt;
    } catch (error) {
      logger.error(`Error calling ${method} on ${contractAddress}:`, error);
      throw error;
    }
  }
}

// Helper function to create and initialize a new NearRelayer
export async function createNearRelayer(config: Omit<NearRelayerConfig, 'pollIntervalMs'> & { pollIntervalMs?: number }): Promise<NearRelayer> {
  const relayer = new NearRelayer({
    pollIntervalMs: 5000, // Default poll interval: 5 seconds
    ...config
  });
  
  await relayer.initialize();
  return relayer;
}
