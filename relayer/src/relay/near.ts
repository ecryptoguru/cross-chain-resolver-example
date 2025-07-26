import { Account, connect, keyStores, utils as nearUtils } from 'near-api-js';
import { ethers } from 'ethers';
import { logger } from '../utils/logger';
import { EscrowABI } from '../abis/EscrowFactory';
import { sleep } from '../utils/common';

export class NearRelayer {
  private nearAccount: Account;
  private ethereumSigner: ethers.Signer;
  private isRunning: boolean = false;
  private pollInterval: number;
  private pollTimer?: NodeJS.Timeout;
  private lastProcessedBlockHeight: number = 0;

  constructor(nearAccount: Account, ethereumSigner: ethers.Signer) {
    this.nearAccount = nearAccount;
    this.ethereumSigner = ethereumSigner;
    this.pollInterval = parseInt(process.env.RELAYER_POLL_INTERVAL || '5000');
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
    try {
      const block = await this.nearAccount.connection.provider.block({
        blockId: blockHeight
      });
      
      // Process each chunk in the block
      for (const chunk of block.chunks) {
        await this.processChunk(chunk, block.header);
      }
      
    } catch (error) {
      logger.error(`Error processing block ${blockHeight}:`, error);
    }
  }

  private async processChunk(chunk: any, blockHeader: any): Promise<void> {
    try {
      // Get chunk details
      const chunkResult = await this.nearAccount.connection.provider.chunk(chunk.chunk_hash || chunk.hash);
      
      // Process transactions in the chunk
      if (chunkResult.transactions && chunkResult.transactions.length > 0) {
        for (const tx of chunkResult.transactions) {
          await this.processTransaction(tx, blockHeader);
        }
      }
      
    } catch (error) {
      logger.error('Error processing chunk:', error);
    }
  }

  private async processTransaction(tx: any, blockHeader: any): Promise<void> {
    try {
      // Get transaction result
      const txResult = await this.nearAccount.connection.provider.txStatus(
        tx.hash,
        tx.signer_id
      );
      
      // Check for relevant events in the transaction
      if (txResult.receipts_outcome && txResult.receipts_outcome.length > 0) {
        for (const receipt of txResult.receipts_outcome) {
          await this.processReceipt(receipt, blockHeader);
        }
      }
      
    } catch (error) {
      logger.error('Error processing transaction:', error);
    }
  }

  private async processReceipt(receipt: any, blockHeader: any): Promise<void> {
    try {
      // Check for logs in the receipt
      if (receipt.outcome && receipt.outcome.logs && receipt.outcome.logs.length > 0) {
        for (const log of receipt.outcome.logs) {
          await this.processLog(log, blockHeader);
        }
      }
      
    } catch (error) {
      logger.error('Error processing receipt:', error);
    }
  }

  private async processLog(log: string, blockHeader: any): Promise<void> {
    try {
      logger.debug(`Processing log: ${log}`);
      
      // Try to parse the log as JSON (NEAR logs are often JSON-encoded)
      try {
        const logData = JSON.parse(log);
        
        // Check for escrow creation events
        if (logData.event === 'escrow_created') {
          await this.handleNearToEthereumSwap(
            logData.escrow_id,
            logData.initiator,
            logData.token,
            BigInt(logData.amount),
            logData.target_chain,
            logData.target_address,
            logData.secret_hash
          );
        }
        // Check for fulfillment events
        else if (logData.event === 'escrow_fulfilled') {
          await this.handleNearFulfillment(
            logData.escrow_id,
            logData.secret
          );
        }
      } catch (parseError) {
        // If it's not JSON, try to match against known log patterns
        if (log.includes('EscrowCreated')) {
          // Handle raw EscrowCreated log
          // This is a simplified example - in a real implementation, you'd parse the log data
          const match = log.match(/EscrowCreated\s+\(([^)]+)\)/);
          if (match) {
            logger.info(`Found EscrowCreated log: ${match[1]}`);
            // Parse the log data and handle the event
          }
        }
      }
    } catch (error) {
      logger.error('Error processing log:', error);
    }
  }

  /**
   * Handles the cross-chain swap from NEAR to Ethereum
   */
  private async handleNearToEthereumSwap(
    escrowId: string,
    initiator: string,
    tokenId: string,
    amount: bigint,
    targetChain: string,
    targetAddress: string,
    secretHash: string
  ): Promise<void> {
    try {
      logger.info(`Processing NEAR to Ethereum swap: ${escrowId}`);
      
      // Only process Ethereum chain targets
      if (targetChain.toLowerCase() !== 'ethereum') {
        logger.warn(`Unsupported target chain: ${targetChain}`);
        return;
      }
      
      // 1. Validate the target Ethereum address
      if (!/^0x[a-fA-F0-9]{40}$/.test(targetAddress)) {
        throw new Error(`Invalid Ethereum address: ${targetAddress}`);
      }
      
      // 2. Get the NEAR escrow details
      const escrowDetails = await this.getNearEscrowDetails(escrowId);
      
      // 3. Create an escrow on Ethereum
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
      const data = ethers.AbiCoder.defaultAbiCoder().encode(
        ['bytes32', 'string'],
        [secretHash, escrowId]
      );
      
      // 6. Send the transaction to create the escrow on Ethereum
      const tx = await escrowFactory.createEscrow(
        tokenId === 'near' ? ethers.ZeroAddress : tokenId, // Use ZeroAddress for native NEAR
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
      
      // 2. If this is a NEAR -> Ethereum swap, we need to fulfill the Ethereum escrow
      if (escrowDetails.target_chain?.toLowerCase() === 'ethereum' && escrowDetails.target_escrow) {
        await this.fulfillEthereumEscrow(
          escrowDetails.target_escrow,
          secret,
          escrowDetails.initiator,
          BigInt(escrowDetails.amount || '0')
        );
      }
      
      logger.info(`Successfully processed fulfillment for ${escrowId}`);
      
    } catch (error) {
      logger.error(`Failed to process fulfillment for NEAR escrow ${escrowId}:`, error);
      throw error;
    }
  }
  
  /**
   * Gets the details of a NEAR escrow
   */
  private async getNearEscrowDetails(escrowId: string): Promise<any> {
    // In a real implementation, this would call the NEAR contract
    // For now, we'll return a mock response
    return {
      id: escrowId,
      initiator: 'near-account.near',
      token: 'usdt.near',
      amount: '1000000000000000000', // 1.0 tokens (18 decimals)
      target_chain: 'ethereum',
      target_address: '0x1234...',
      target_escrow: '0x5678...',
      status: 'active',
      created_at: Date.now() - 3600000, // 1 hour ago
      expires_at: Date.now() + 86400000, // 24 hours from now
      secret_hash: '0x...',
      secret: null
    };
  }
  
  /**
   * Updates a NEAR escrow
   */
  private async updateNearEscrow(escrowId: string, updates: any): Promise<void> {
    // In a real implementation, this would call the NEAR contract
    logger.info(`Updating NEAR escrow ${escrowId}:`, updates);
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
