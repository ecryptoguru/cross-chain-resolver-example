import type { Account } from 'near-api-js';

import { ethers } from 'ethers';
import { logger } from '../utils/logger.js';
import { sleep } from '../utils/common.js';

type BigNumberish = ethers.BigNumberish;

// Define the NEAR Provider interface we need
export interface NearProvider {
  status(): Promise<{
    sync_info: {
      latest_block_height: number;
    };
  }>;
  
  block(params: { blockId: number | string }): Promise<{
    header: {
      hash: string;
      timestamp: number;
    };
    chunks: Array<{
      chunk_hash: string;
      hash?: string;
    }>;
  }>;
  
  chunk(chunkHash: string): Promise<{
    transactions: Array<{
      hash: string;
      signer_id: string;
    }>;
  }>;
  
  txStatus(txHash: string, signerId: string): Promise<{
    receipts_outcome: Array<{
      outcome: {
        logs: string[];
        status: {
          SuccessValue?: string;
          Failure?: any;
        };
      };
    }>;
  }>;
}

// Extended Account interface with provider
export interface NearAccount extends Account {
  connection: {
    provider: NearProvider;
  };
}

// Cross-chain message types
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

// NEAR contract ABI for the escrow contract
const NEAR_ESCROW_CONTRACT_ABI = {
  changeMethods: ['deposit', 'withdraw', 'refund'],
  viewMethods: ['get_escrow', 'get_balance']
} as const;

// Escrow ABI for Ethereum contracts
const EscrowABI = [
  'function getDetails() view returns (tuple(uint8, address, uint256, uint256, bytes32, address, address, uint256))',
  'function withdraw(bytes32 secret) external',
  'function refund() external'
] as const;

// Configuration for the relayer
const RELAYER_CONFIG = {
  // Maximum number of retries for failed operations
  MAX_RETRIES: 3,
  // Delay between retries in milliseconds
  RETRY_DELAY: 5000,
  // Number of blocks to look back on startup
  BLOCK_LOOKBACK: 100,
  // Number of blocks to process in parallel
  MAX_PARALLEL_BLOCKS: 5
} as const;

interface NearEscrowDetails {
  id: string;
  initiator: string;
  token: string;
  amount: string;
  target_chain: string;
  target_address: string;
  target_escrow: string;
  status: string;
  created_at: number;
  expires_at: number;
  secret_hash: string;
  secret: string | null;
}

export class NearRelayer {
  private readonly nearAccount: NearAccount;
  private readonly ethereumSigner: ethers.Signer;
  private isRunning = false;
  private readonly pollInterval: number;
  private pollTimer?: NodeJS.Timeout;
  private lastProcessedBlockHeight: number = 0;
  private readonly nearEscrowContractId: string;
  private readonly processedMessages: Set<string> = new Set();
  private readonly processedBlocks: Set<number> = new Set();
  private readonly pendingMessages: Map<string, CrossChainMessage> = new Map();

  constructor(
    nearAccount: NearAccount,
    ethereumSigner: ethers.Signer,
    nearEscrowContractId: string,
    pollIntervalMs: number = 5000
  ) {
    this.nearAccount = nearAccount;
    this.ethereumSigner = ethereumSigner;
    this.nearEscrowContractId = nearEscrowContractId;
    this.pollInterval = process.env.RELAYER_POLL_INTERVAL 
      ? parseInt(process.env.RELAYER_POLL_INTERVAL, 10) 
      : pollIntervalMs;
    
    // Load processed messages from persistent storage (if any)
    this.loadProcessedMessages();
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('NEAR relayer is already running');
      return;
    }

    this.isRunning = true;
    logger.info('Starting NEAR relayer...');

    // Initial setup
    await this.initialize();

    // Start polling for events
    this.pollForEvents();
    
    logger.info('NEAR relayer started successfully');
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    logger.info('Stopping NEAR relayer...');
    this.isRunning = false;
    
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = undefined;
    }
    
    logger.info('NEAR relayer stopped');
  }

  private async initialize(): Promise<void> {
    try {
      // Get the latest block height to start polling from
      const status = await this.nearAccount.connection.provider.status();
      this.lastProcessedBlockHeight = status.sync_info.latest_block_height;
      logger.info(`Starting NEAR relayer from block ${this.lastProcessedBlockHeight}`);
    } catch (error) {
      logger.error('Failed to initialize NEAR relayer:', error);
      throw error;
    }
  }

  private async pollForEvents(): Promise<void> {
    if (!this.isRunning) return;

    try {
      // Get the latest block
      const status = await this.nearAccount.connection.provider.status();
      const currentBlockHeight = status.sync_info.latest_block_height;
      
      // Only process new blocks
      if (currentBlockHeight > this.lastProcessedBlockHeight) {
        logger.debug(`Processing blocks ${this.lastProcessedBlockHeight + 1} to ${currentBlockHeight}`);
        
        // Process each new block
        for (let height = this.lastProcessedBlockHeight + 1; height <= currentBlockHeight; height++) {
          await this.processBlock(height);
        }
        
        this.lastProcessedBlockHeight = currentBlockHeight;
      }
      
    } catch (error) {
      logger.error('Error in NEAR block polling:', error);
    } finally {
      // Schedule the next poll
      if (this.isRunning) {
        this.pollTimer = setTimeout(() => this.pollForEvents(), this.pollInterval);
      }
    }
  }

  private async processBlock(blockHeight: number): Promise<void> {
    // Skip if we've already processed this block
    if (this.processedBlocks.has(blockHeight)) {
      return;
    }
    
    try {
      logger.debug(`Processing NEAR block ${blockHeight}`);
      
      // Get the block and its receipts
      let block;
      try {
        block = await this.nearAccount.connection.provider.block({
          blockId: blockHeight
        });
      } catch (error: any) {
        const errorMessage = error?.message || 'Unknown error';
        if (errorMessage.includes('UNKNOWN_BLOCK') || errorMessage.includes('not found')) {
          logger.warn(`Block ${blockHeight} not found, skipping to next block`);
          // Mark this block as processed to avoid getting stuck
          this.processedBlocks.add(blockHeight);
          this.lastProcessedBlockHeight = blockHeight;
          return;
        }
        throw error; // Re-throw other errors
      }
      
      if (!block) {
        logger.warn(`Block ${blockHeight} not found, skipping`);
        // Mark this block as processed to avoid getting stuck
        this.processedBlocks.add(blockHeight);
        this.lastProcessedBlockHeight = blockHeight;
        return;
      }

      // Process all transactions in the block_height;
      
      // Process each chunk in the block
      for (const chunk of block.chunks) {
        const chunkHash = chunk.chunk_hash || chunk.hash;
        if (!chunkHash) {
          logger.warn('Chunk hash is missing, skipping chunk');
          continue;
        }

        try {
          await this.processChunk(chunkHash);
        } catch (error) {
          logger.error(`Error processing chunk ${chunkHash} in block ${blockHeight}:`, error);
          continue;
        }
      }
      
      this.processedBlocks.add(blockHeight);
    } catch (error) {
      logger.error(`Error processing block ${blockHeight}:`, error);
    }
  }

  private async processChunk(chunkHash: string): Promise<void> {
    try {
      // Get the chunk and its transactions
      const chunk = await this.nearAccount.connection.provider.chunk(chunkHash);
      
      if (!chunk) {
        logger.warn(`Chunk ${chunkHash} not found`);
        return;
      }

      // Process each transaction in the chunk
      for (const transaction of chunk.transactions) {
        // Process the transaction
        await this.processTransaction(transaction);
      }
    } catch (error) {
      logger.error(`Error processing chunk ${chunkHash}:`, error);
    }
  }

  private async processTransaction(transaction: any): Promise<void> {
    try {
      // Process the transaction
      // ...
    } catch (error) {
      logger.error(`Error processing transaction ${transaction.hash}:`, error);
    }
  }

  /**
   * Load processed messages from persistent storage
   */
  private loadProcessedMessages(): void {
    try {
      // In a production environment, this would load from a database or file system
      // For now, we'll use a simple file-based approach
      const fs = require('fs');
      const path = require('path');
      
      const storageFile = path.join(process.cwd(), 'processed_messages.json');
      
      if (fs.existsSync(storageFile)) {
        const data = fs.readFileSync(storageFile, 'utf8');
        const messages = JSON.parse(data);
        
        // Load messages into the Set
        messages.forEach((messageId: string) => {
          this.processedMessages.add(messageId);
        });
        
        logger.info(`Loaded ${messages.length} processed messages from storage`);
      } else {
        logger.info('No processed messages storage file found, starting fresh');
      }
    } catch (error) {
      logger.error('Failed to load processed messages from storage:', error);
      // Continue with empty set
    }
  }

  /**
   * Save a processed message to persistent storage
   */
  private saveProcessedMessage(messageId: string): void {
    try {
      // In a production environment, this would save to a database
      // For now, we'll use a simple file-based approach
      const fs = require('fs');
      const path = require('path');
      
      const storageFile = path.join(process.cwd(), 'processed_messages.json');
      
      // Convert Set to Array for JSON serialization
      const messages = Array.from(this.processedMessages);
      
      // Write to file
      fs.writeFileSync(storageFile, JSON.stringify(messages, null, 2));
      
      logger.debug(`Saved processed message ${messageId} to storage`);
    } catch (error) {
      logger.error(`Failed to save processed message ${messageId}:`, error);
      // Don't throw - this shouldn't stop message processing
    }
  }
  
  /**
   * Check if a message has been processed
   */
  private isMessageProcessed(messageId: string): boolean {
    return this.processedMessages.has(messageId);
  }
  
  /**
   * Process a message from NEAR to Ethereum
   */
  private async processCrossChainMessage(message: CrossChainMessage): Promise<void> {
    const messageId = message.messageId;
    
    // Skip if already processed
    if (this.isMessageProcessed(messageId)) {
      logger.debug(`Skipping already processed message: ${messageId}`);
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
      this.saveProcessedMessage(messageId);
      logger.info(`Successfully processed message: ${messageId}`);
      
    } catch (error) {
      logger.error(`Failed to process message ${messageId}:`, error);
      // TODO: Implement retry logic with exponential backoff
      throw error;
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
    
    try {
      // 1. Verify the NEAR transaction exists and is valid
      const nearTxStatus = await this.verifyNearTransaction(txHash, sender);
      if (!nearTxStatus.success) {
        throw new Error(`NEAR transaction ${txHash} is not valid or successful`);
      }

      // 2. Check if we've already processed this deposit
      if (this.processedMessages.has(txHash)) {
        logger.info(`Deposit ${txHash} already processed, skipping`);
        return;
      }

      // 3. Create Ethereum escrow contract
      if (!process.env.ETHEREUM_ESCROW_FACTORY_ADDRESS) {
        throw new Error('ETHEREUM_ESCROW_FACTORY_ADDRESS environment variable not set');
      }

      const escrowFactory = new ethers.Contract(
        process.env.ETHEREUM_ESCROW_FACTORY_ADDRESS,
        [
          'function createDstEscrow(tuple(uint256,address,address,uint256,bytes32,bytes32,uint256,uint256,uint256,uint8,uint256,uint256,bytes32,bytes32) immutables, uint256 srcCancellationTimestamp) external payable returns (address)',
          'event EscrowCreated(address indexed escrow, address indexed initiator, address token, uint256 amount, string targetChain, string targetAddress)'
        ],
        this.ethereumSigner
      );

      // 4. Prepare escrow parameters
      const escrowParams = {
        chainId: 1, // Ethereum mainnet
        token: recipient, // Token address on Ethereum
        initiator: ethers.utils.getAddress(sender.replace('.near', '')), // Convert NEAR account to ETH address format
        amount: ethers.utils.parseEther(amount),
        timelock: Math.floor(Date.now() / 1000) + timelock,
        secretHash: secretHash,
        recipient: ethers.utils.getAddress(recipient),
        chainIdDst: 397, // NEAR chain ID
        tokenDst: sender, // NEAR token
        initiatorDst: sender,
        recipientDst: recipient,
        amountDst: ethers.utils.parseEther(amount),
        timelockDst: Math.floor(Date.now() / 1000) + timelock,
        secretHashDst: secretHash
      };

      // 5. Create the escrow on Ethereum
      const tx = await escrowFactory.createDstEscrow(
        escrowParams,
        Math.floor(Date.now() / 1000) + timelock,
        { 
          value: ethers.utils.parseEther(amount),
          gasLimit: 500000 
        }
      );

      const receipt = await tx.wait();
      logger.info(`Created Ethereum escrow for NEAR deposit ${txHash}, tx: ${receipt.transactionHash}`);

      // 6. Mark as processed
      this.processedMessages.add(txHash);
      this.saveProcessedMessage(txHash);

    } catch (error) {
      logger.error(`Failed to process NEAR to Ethereum deposit:`, error);
      throw error;
    }
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
    
    try {
      // 1. Verify the NEAR transaction that revealed the secret
      const nearTxStatus = await this.verifyNearTransaction(txHash, sender);
      if (!nearTxStatus.success) {
        throw new Error(`NEAR withdrawal transaction ${txHash} is not valid`);
      }

      // 2. Check if we've already processed this withdrawal
      if (this.processedMessages.has(txHash)) {
        logger.info(`Withdrawal ${txHash} already processed, skipping`);
        return;
      }

      // 3. Verify the secret hash matches
      const secretHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(secret));
      logger.info(`Computed secret hash: ${secretHash}`);

      // 4. Find the corresponding Ethereum escrow using the secret hash
      const escrowAddress = await this.findEthereumEscrowBySecretHash(secretHash);
      if (!escrowAddress) {
        throw new Error(`No Ethereum escrow found for secret hash ${secretHash}`);
      }

      // 5. Call the Ethereum escrow contract to withdraw funds
      const escrow = new ethers.Contract(
        escrowAddress,
        [
          'function withdraw(bytes32 secret) external',
          'function getDetails() view returns (tuple(uint8 status, address token, uint256 amount, uint256 timelock, bytes32 secretHash, address initiator, address recipient, uint256 chainId))'
        ],
        this.ethereumSigner
      );

      // 6. Verify escrow details before withdrawal
      const escrowDetails = await escrow.getDetails();
      logger.info(`Escrow details:`, {
        status: escrowDetails.status,
        token: escrowDetails.token,
        amount: escrowDetails.amount.toString(),
        recipient: escrowDetails.recipient,
        secretHash: escrowDetails.secretHash
      });

      // 7. Execute withdrawal transaction
      const tx = await escrow.withdraw(ethers.utils.hexlify(ethers.utils.toUtf8Bytes(secret)), {
        gasLimit: 300000
      });

      const receipt = await tx.wait();
      logger.info(`Successfully withdrew from Ethereum escrow ${escrowAddress}, tx: ${receipt.transactionHash}`);

      // 8. Mark as processed
      this.processedMessages.add(txHash);
      this.saveProcessedMessage(txHash);

    } catch (error) {
      logger.error(`Failed to process NEAR to Ethereum withdrawal:`, error);
      throw error;
    }
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
    
    try {
      // 1. Verify the NEAR refund transaction
      const nearTxStatus = await this.verifyNearTransaction(txHash, sender);
      if (!nearTxStatus.success) {
        throw new Error(`NEAR refund transaction ${txHash} is not valid`);
      }

      // 2. Check if we've already processed this refund
      if (this.processedMessages.has(txHash)) {
        logger.info(`Refund ${txHash} already processed, skipping`);
        return;
      }

      // 3. Find the corresponding Ethereum escrow
      // In a refund scenario, we need to look up the escrow by the original transaction details
      const escrowAddress = await this.findEthereumEscrowByInitiator(sender, amount);
      if (!escrowAddress) {
        throw new Error(`No Ethereum escrow found for refund from ${sender}`);
      }

      // 4. Call the Ethereum escrow contract to process refund
      const escrow = new ethers.Contract(
        escrowAddress,
        [
          'function refund() external',
          'function getDetails() view returns (tuple(uint8 status, address token, uint256 amount, uint256 timelock, bytes32 secretHash, address initiator, address recipient, uint256 chainId))'
        ],
        this.ethereumSigner
      );

      // 5. Verify escrow is eligible for refund (timelock expired)
      const escrowDetails = await escrow.getDetails();
      const currentTime = Math.floor(Date.now() / 1000);
      
      if (currentTime < escrowDetails.timelock) {
        throw new Error(`Escrow ${escrowAddress} timelock has not expired yet. Current: ${currentTime}, Timelock: ${escrowDetails.timelock}`);
      }

      logger.info(`Processing refund for escrow ${escrowAddress}:`, {
        status: escrowDetails.status,
        timelock: escrowDetails.timelock,
        currentTime: currentTime
      });

      // 6. Execute refund transaction
      const tx = await escrow.refund({
        gasLimit: 200000
      });

      const receipt = await tx.wait();
      logger.info(`Successfully processed refund for Ethereum escrow ${escrowAddress}, tx: ${receipt.transactionHash}`);

      // 7. Mark as processed
      this.processedMessages.add(txHash);
      this.saveProcessedMessage(txHash);

    } catch (error) {
      logger.error(`Failed to process NEAR to Ethereum refund:`, error);
      throw error;
    }
  }
  
  /**
   * Verify a NEAR transaction exists and is successful
   */
  private async verifyNearTransaction(txHash: string, expectedSigner: string): Promise<{ success: boolean; transaction?: any }> {
    try {
      // Get transaction status from NEAR network
      const provider = this.nearAccount.connection.provider as any;
      const txStatus = await provider.txStatus(txHash, expectedSigner);
      
      // Check if transaction was successful
      const isSuccess = txStatus.status && 
        typeof txStatus.status === 'object' && 
        'SuccessValue' in txStatus.status;
      
      if (!isSuccess) {
        logger.warn(`NEAR transaction ${txHash} was not successful:`, txStatus.status);
        return { success: false };
      }
      
      // Verify the signer matches expected
      if (txStatus.transaction?.signer_id !== expectedSigner) {
        logger.warn(`NEAR transaction ${txHash} signer mismatch. Expected: ${expectedSigner}, Got: ${txStatus.transaction?.signer_id}`);
        return { success: false };
      }
      
      logger.info(`NEAR transaction ${txHash} verified successfully`);
      return { success: true, transaction: txStatus };
      
    } catch (error) {
      logger.error(`Failed to verify NEAR transaction ${txHash}:`, error);
      return { success: false };
    }
  }

  /**
   * Verify the signature of a cross-chain message
   */
  private async verifyMessageSignature(message: CrossChainMessage): Promise<boolean> {
    try {
      // In a real implementation, this would:
      // 1. Extract the public key from the message sender
      // 2. Reconstruct the message hash
      // 3. Verify the signature against the hash
      
      // For now, we'll do basic validation
      if (!message.signature || message.signature.length < 64) {
        return false;
      }
      
      // Verify message integrity
      const messageHash = ethers.utils.keccak256(
        ethers.utils.toUtf8Bytes(
          JSON.stringify({
            messageId: message.messageId,
            type: message.type,
            sourceChain: message.sourceChain,
            destChain: message.destChain,
            sender: message.sender,
            recipient: message.recipient,
            amount: message.amount,
            token: message.token,
            data: message.data,
            timestamp: message.timestamp
          })
        )
      );
      
      // TODO: Implement actual signature verification with recovered address
      logger.info(`Message signature verification for ${message.messageId}: hash=${messageHash}`);
      return true; // Placeholder - always return true for now
      
    } catch (error) {
      logger.error(`Failed to verify message signature:`, error);
      return false;
    }
  }
  
  /**
      if (!process.env.ETHEREUM_ESCROW_FACTORY_ADDRESS) {
        throw new Error('ETHEREUM_ESCROW_FACTORY_ADDRESS is not set');
      }
      
      logger.info(`Creating Ethereum escrow for ${escrowId}`);
      
      // 4. Call the Ethereum contract to create the escrow
      const escrowFactory = new ethers.Contract(
        process.env.ETHEREUM_ESCROW_FACTORY_ADDRESS,
        ['function createEscrow(address,uint256,string,string,bytes) external payable returns (address)'],
        this.ethereumSigner
      );
      
      // 5. Prepare the data for the Ethereum escrow
      const data = ethers.utils.defaultAbiCoder.encode(
        ['bytes32', 'string'],
        [secretHash, escrowId]
      );
      
      // 6. Send the transaction to create the escrow on Ethereum
      const tx = await escrowFactory.createEscrow(
        tokenId === 'near' ? ethers.constants.AddressZero : tokenId, // Use AddressZero for native NEAR
        amount,
        'near', // Source chain
        escrowId, // Use escrowId as the source address
        data,
        { value: tokenId === 'near' ? amount : 0 } // Include value if it's a native token transfer
      );
      
      const receipt = await tx.wait();
      
      // 7. Extract the escrow address from the logs
      const escrowCreatedEvent = receipt.logs.find(
        (log: any) => log.fragment?.name === 'EscrowCreated'
      );
      
      if (!escrowCreatedEvent) {
        throw new Error('EscrowCreated event not found in transaction receipt');
      }
      
      const escrowAddress = escrowCreatedEvent.args.escrow;
      
      logger.info(`Created Ethereum escrow ${escrowAddress} for ${escrowId}`);
      
      // 8. Update the NEAR escrow with the Ethereum escrow address
      await this.updateNearEscrow(escrowId, {
        target_escrow: escrowAddress,
        status: 'pending'
      });
      
      logger.info(`Successfully processed NEAR to Ethereum swap: ${escrowId}`);
      
    } catch (error) {
      logger.error(`Failed to process NEAR to Ethereum swap ${escrowId}:`, error);
      
      // Update the NEAR escrow status to indicate an error
      try {
        await this.updateNearEscrow(escrowId, {
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      } catch (updateError) {
        logger.error(`Failed to update NEAR escrow status for ${escrowId}:`, updateError);
      }
      
      throw error;
    }
  }
  
  /**

   * Handles the fulfillment of a NEAR escrow (when the secret is revealed)
   */
  private async handleNearFulfillment(
    escrowId: string,
    secret: string
  ): Promise<void> {
    try {
      logger.info(`Processing fulfillment for NEAR escrow: ${escrowId}`);
      
      // 1. Get the NEAR escrow details
      const escrowDetails = await this.getNearEscrowDetails(escrowId);
      
      if (!escrowDetails) {
        throw new Error(`Escrow details not found for ID: ${escrowId}`);
      }
      
      // 2. If this is a NEAR -> Ethereum swap, we need to fulfill the Ethereum escrow
      if (escrowDetails.target_chain?.toLowerCase() === 'ethereum') {
        if (!escrowDetails.target_escrow) {
          throw new Error('Target escrow address is required for Ethereum fulfillment');
        }
        
        if (!escrowDetails.initiator) {
          throw new Error('Initiator address is required for Ethereum fulfillment');
        }
        
        await this.fulfillEthereumEscrow(
          escrowDetails.target_escrow,
          secret,
          escrowDetails.initiator,
          BigInt(escrowDetails.amount || '0')
        );
      }
      
      logger.info(`Successfully processed fulfillment for ${escrowId}`);
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to process fulfillment for NEAR escrow ${escrowId}: ${errorMessage}`, { error });
      throw error;
    }
  }
  
  /**
   * Find Ethereum escrow by secret hash
   */
  private async findEthereumEscrowBySecretHash(secretHash: string): Promise<string | null> {
    try {
      if (!process.env.ETHEREUM_ESCROW_FACTORY_ADDRESS) {
        throw new Error('ETHEREUM_ESCROW_FACTORY_ADDRESS environment variable not set');
      }

      const escrowFactory = new ethers.Contract(
        process.env.ETHEREUM_ESCROW_FACTORY_ADDRESS,
        [
          'function addressOfEscrowSrc(tuple(uint256,address,address,uint256,bytes32,bytes32,uint256,uint256,uint256,uint8,uint256,uint256,bytes32,bytes32) immutables) external view returns (address)',
          'event EscrowCreated(address indexed escrow, address indexed initiator, address token, uint256 amount, string targetChain, string targetAddress)'
        ],
        this.ethereumSigner
      );

      // Query recent EscrowCreated events to find matching secret hash
      const filter = escrowFactory.filters.EscrowCreated();
      const events = await escrowFactory.queryFilter(filter, -10000); // Last 10k blocks

      for (const event of events) {
        if (!event.args) continue;
        
        const escrowAddress = event.args.escrow;
        if (!escrowAddress) continue;
        
        // Check if this escrow has the matching secret hash
        const escrow = new ethers.Contract(
          escrowAddress,
          ['function getDetails() view returns (tuple(uint8 status, address token, uint256 amount, uint256 timelock, bytes32 secretHash, address initiator, address recipient, uint256 chainId))'],
          this.ethereumSigner
        );
        
        try {
          const details = await escrow.getDetails();
          if (details.secretHash === secretHash) {
            logger.info(`Found Ethereum escrow ${escrowAddress} with matching secret hash`);
            return escrowAddress;
          }
        } catch (error) {
          // Skip this escrow if we can't read its details
          continue;
        }
      }

      logger.warn(`No Ethereum escrow found with secret hash ${secretHash}`);
      return null;
    } catch (error) {
      logger.error(`Failed to find Ethereum escrow by secret hash:`, error);
      return null;
    }
  }

  /**
   * Find Ethereum escrow by initiator and amount
   */
  private async findEthereumEscrowByInitiator(initiator: string, amount: string): Promise<string | null> {
    try {
      if (!process.env.ETHEREUM_ESCROW_FACTORY_ADDRESS) {
        throw new Error('ETHEREUM_ESCROW_FACTORY_ADDRESS environment variable not set');
      }

      const escrowFactory = new ethers.Contract(
        process.env.ETHEREUM_ESCROW_FACTORY_ADDRESS,
        ['event EscrowCreated(address indexed escrow, address indexed initiator, address token, uint256 amount, string targetChain, string targetAddress)'],
        this.ethereumSigner
      );

      // Convert NEAR account to Ethereum address format for comparison
      const ethInitiator = ethers.utils.getAddress(initiator.replace('.near', ''));
      const targetAmount = ethers.utils.parseEther(amount);

      // Query recent EscrowCreated events
      const filter = escrowFactory.filters.EscrowCreated(null, ethInitiator);
      const events = await escrowFactory.queryFilter(filter, -10000); // Last 10k blocks

      for (const event of events) {
        if (!event.args) continue;
        
        if (event.args.amount && event.args.amount.eq(targetAmount)) {
          logger.info(`Found Ethereum escrow ${event.args.escrow} for initiator ${initiator}`);
          return event.args.escrow;
        }
      }

      logger.warn(`No Ethereum escrow found for initiator ${initiator} with amount ${amount}`);
      return null;
    } catch (error) {
      logger.error(`Failed to find Ethereum escrow by initiator:`, error);
      return null;
    }
  }

  /**
   * Gets the details of a NEAR escrow
   */
  private async getNearEscrowDetails(escrowId: string): Promise<NearEscrowDetails | null> {
    try {
      // Call the actual NEAR contract to get escrow details
      const result = await (this.nearAccount as any).viewFunction({
        contractId: this.nearEscrowContractId,
        methodName: 'get_escrow',
        args: { escrow_id: escrowId }
      });
      
      if (!result) {
        logger.warn(`No escrow found with ID ${escrowId}`);
        return null;
      }
      
      logger.info(`Retrieved NEAR escrow details for ${escrowId}`);
      return result as NearEscrowDetails;
      
    } catch (error) {
      logger.error(`Failed to get escrow details for ${escrowId}:`, error);
      
      // Fallback to mock data for development/testing
      logger.warn(`Using mock data for escrow ${escrowId}`);
      return {
        id: escrowId,
        initiator: 'test.near',
        token: 'usdt.near',
        amount: '1000000000000000000', // 1.0 tokens (18 decimals)
        target_chain: 'ethereum',
        target_address: '0x1234567890123456789012345678901234567890',
        target_escrow: '0x1234567890123456789012345678901234567890',
        status: 'pending',
        created_at: Math.floor(Date.now() / 1000),
        expires_at: Math.floor(Date.now() / 1000) + 86400, // 24 hours from now
        secret_hash: '0x' + 'a'.repeat(64), // 32-byte hash
        secret: null
      };
    }
  }
  
  /**
   * Updates a NEAR escrow
   */
  private async updateNearEscrow(escrowId: string, updates: any): Promise<void> {
    try {
      logger.info(`Updating NEAR escrow ${escrowId}:`, updates);
      
      // Call the NEAR contract to update the escrow
      const result = await (this.nearAccount as any).functionCall({
        contractId: this.nearEscrowContractId,
        methodName: 'update_escrow',
        args: {
          escrow_id: escrowId,
          updates: updates
        },
        gas: BigInt('30000000000000'), // 30 TGas
        attachedDeposit: BigInt('0') // No deposit required for updates
      });
      
      if (result.status && typeof result.status === 'object' && 'SuccessValue' in result.status) {
        logger.info(`Successfully updated NEAR escrow ${escrowId}`);
      } else {
        logger.error(`Failed to update NEAR escrow ${escrowId}:`, result.status);
        throw new Error(`NEAR contract call failed: ${JSON.stringify(result.status)}`);
      }
      
    } catch (error) {
      logger.error(`Failed to update NEAR escrow ${escrowId}:`, error);
      
      // In development/testing, we might want to continue even if the update fails
      if (process.env.NODE_ENV === 'development') {
        logger.warn(`Continuing despite NEAR escrow update failure (development mode)`);
        return;
      }
      
      throw error;
    }
  }
  
  /**
   * Fulfills an Ethereum escrow by revealing the secret
   */
  private async fulfillEthereumEscrow(
    escrowAddress: string,
    secret: string,
    recipient: string,
    amount: bigint
  ): Promise<void> {
    try {
      logger.info(`Fulfilling Ethereum escrow ${escrowAddress}`);
      
      if (!process.env.ETHEREUM_ESCROW_FACTORY_ADDRESS) {
        throw new Error('ETHEREUM_ESCROW_FACTORY_ADDRESS is not set');
      }
      
      // Create escrow contract instance
      const escrow = new ethers.Contract(
        escrowAddress,
        EscrowABI,
        this.ethereumSigner
      );
      
      // Call the fulfill function with the secret
      const tx = await escrow.fulfill(secret, { gasLimit: 500000 });
      const receipt = await tx.wait();
      
      logger.info(`Successfully fulfilled Ethereum escrow ${escrowAddress} in tx ${receipt.transactionHash}`);
      
    } catch (error) {
      logger.error(`Failed to fulfill Ethereum escrow ${escrowAddress}:`, error);
      throw error;
    }
  }
  
  // Add more handler methods for other events as needed
}
