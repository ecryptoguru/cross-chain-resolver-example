import { ethers } from 'ethers';
import { Account, KeyPair, keyStores, utils as nearUtils } from 'near-api-js';
import { logger } from '../utils/logger';
import { EscrowFactoryABI, EscrowABI } from '../abis/EscrowFactory';
import { sleep } from '../utils/common';

export class EthereumRelayer {
  private provider: ethers.Provider;
  private signer: ethers.Signer;
  private nearAccount: Account;
  private isRunning: boolean = false;
  private pollInterval: number;
  private pollTimer?: NodeJS.Timeout;

  constructor(signer: ethers.Signer, nearAccount: Account) {
    this.signer = signer;
    this.provider = signer.provider!;
    this.nearAccount = nearAccount;
    this.pollInterval = parseInt(process.env.RELAYER_POLL_INTERVAL || '5000');
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Ethereum relayer is already running');
      return;
    }

    this.isRunning = true;
    logger.info('Starting Ethereum relayer...');

    // Initial setup and event subscriptions
    await this.setupEventListeners();

    // Start polling for events
    this.pollForEvents();
    
    logger.info('Ethereum relayer started successfully');
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    logger.info('Stopping Ethereum relayer...');
    this.isRunning = false;
    
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = undefined;
    }
    
    logger.info('Ethereum relayer stopped');
  }

  private async setupEventListeners(): Promise<void> {
    if (!process.env.ETHEREUM_ESCROW_FACTORY_ADDRESS) {
      throw new Error('ETHEREUM_ESCROW_FACTORY_ADDRESS is not set in environment variables');
    }

    // Create contract instance
    const escrowFactory = new ethers.Contract(
      process.env.ETHEREUM_ESCROW_FACTORY_ADDRESS,
      EscrowFactoryABI,
      this.provider
    );

    // Listen for EscrowCreated events
    escrowFactory.on('EscrowCreated', async (
      escrowAddress: string,
      initiator: string,
      token: string,
      amount: bigint,
      targetChain: string,
      targetAddress: string,
      event: ethers.EventLog
    ) => {
      try {
        logger.info(`New escrow created: ${escrowAddress}`);
        
        // Only process NEAR chain targets for now
        if (targetChain.toLowerCase() === 'near') {
          await this.handleEthereumToNearSwap(
            escrowAddress,
            initiator,
            token,
            amount,
            targetAddress
          );
        }
      } catch (error) {
        logger.error(`Error processing EscrowCreated event: ${error}`);
      }
    });

    logger.info('Ethereum event listeners initialized');
  }

  private async pollForEvents(): Promise<void> {
    if (!this.isRunning) return;

    try {
      // TODO: Implement event polling logic
      // This will check for new events on each poll interval
      
      // Example: Check for new deposits or swap events
      await this.checkForNewEvents();
      
    } catch (error) {
      logger.error('Error in Ethereum event polling:', error);
    } finally {
      // Schedule the next poll
      if (this.isRunning) {
        this.pollTimer = setTimeout(() => this.pollForEvents(), this.pollInterval);
      }
    }
  }

  private async checkForNewEvents(): Promise<void> {
    try {
      // Get the current block number
      const currentBlock = await this.provider.getBlockNumber();
      const fromBlock = Math.max(0, currentBlock - 100); // Check last 100 blocks
      
      if (!process.env.ETHEREUM_ESCROW_FACTORY_ADDRESS) {
        throw new Error('ETHEREUM_ESCROW_FACTORY_ADDRESS is not set');
      }
      
      const escrowFactory = new ethers.Contract(
        process.env.ETHEREUM_ESCROW_FACTORY_ADDRESS,
        EscrowFactoryABI,
        this.provider
      );
      
      // Get EscrowCreated events
      const escrowCreatedFilter = escrowFactory.filters.EscrowCreated();
      const escrowCreatedEvents = await escrowFactory.queryFilter(
        escrowCreatedFilter,
        fromBlock,
        'latest'
      );
      
      // Process each event
      for (const event of escrowCreatedEvents) {
        try {
          // Type assertion for EventLog which has args property
          const log = event as ethers.EventLog;
          
          if (log.args) {
            // Use type assertion to tell TypeScript we know the shape of args
            const args = log.args as unknown as {
              escrow: string;
              initiator: string;
              token: string;
              amount: bigint;
              targetChain: string;
              targetAddress: string;
            };
            
            const { escrow: escrowAddress, initiator, token, amount, targetChain, targetAddress } = args;
            
            // Only process NEAR chain targets
            if (targetChain.toLowerCase() === 'near') {
              await this.handleEthereumToNearSwap(
                escrowAddress,
                initiator,
                token,
                amount,
                targetAddress
              );
            }
          }
        } catch (error) {
          logger.error(`Error processing event: ${error}`);
        }
      }
      
      logger.debug(`Processed ${escrowCreatedEvents.length} EscrowCreated events`);
      
    } catch (error) {
      logger.error('Error checking for new Ethereum events:', error);
    }
  }

  /**
   * Handles the cross-chain swap from Ethereum to NEAR
   */
  private async handleEthereumToNearSwap(
    escrowAddress: string,
    initiator: string,
    tokenAddress: string,
    amount: bigint,
    targetNearAccount: string
  ): Promise<void> {
    const escrowId = `eth:${escrowAddress.toLowerCase()}`;
    
    try {
      logger.info(`Processing Ethereum to NEAR swap: ${escrowId}`);
      
      // 1. Get escrow details
      const escrow = new ethers.Contract(escrowAddress, EscrowABI, this.provider);
      const details = await escrow.getDetails();
      
      // 2. Validate the escrow
      if (details.status !== 0) { // 0 = Active
        logger.warn(`Escrow ${escrowId} is not active. Status: ${details.status}`);
        return;
      }
      
      // 3. Generate a secret and hash for the hashlock
      const secret = ethers.hexlify(ethers.randomBytes(32));
      const secretHash = ethers.keccak256(secret);
      
      // 4. Prepare NEAR transaction data
      const nearDepositData = {
        escrow_id: escrowId,
        initiator: initiator,
        token: tokenAddress,
        amount: amount.toString(),
        secret_hash: secretHash,
        expires_at: details.expiresAt.toString(),
        source_chain: 'ethereum',
        source_address: escrowAddress
      };
      
      // 5. Call the NEAR contract to create the corresponding escrow
      logger.info(`Creating NEAR escrow for ${escrowId}`);
      
      // This is a placeholder for the actual NEAR contract call
      // In a real implementation, we would use near-api-js to call a NEAR contract
      const nearTxResult = await this.nearAccount.functionCall({
        contractId: process.env.NEAR_ESCROW_FACTORY_ADDRESS!,
        methodName: 'create_escrow',
        args: nearDepositData,
        gas: '300000000000000', // 300 TGas
        attachedDeposit: '1' // 1 yoctoNEAR for security
      });
      
      logger.info(`NEAR escrow created for ${escrowId}: ${JSON.stringify(nearTxResult)}`);
      
      // 6. Store the secret for later use when the NEAR side is fulfilled
      // In a production environment, this would be stored securely
      // For now, we'll just log it
      logger.debug(`Secret for ${escrowId}: ${secret}`);
      
      // 7. Update the escrow status to indicate the NEAR side is ready
      // Use type assertion to tell TypeScript about the setStatus method
      const escrowWithStatus = escrow as unknown as {
        connect: (signer: ethers.Signer) => {
          setStatus: (status: number) => Promise<ethers.ContractTransactionResponse>;
        };
      };
      
      const tx = await escrowWithStatus.connect(this.signer).setStatus(1); // 1 = Pending
      const receipt = await tx.wait();
      if (!receipt) {
        throw new Error('Transaction receipt is null');
      }
      
      logger.info(`Successfully processed Ethereum to NEAR swap: ${escrowId}`);
      
    } catch (error) {
      logger.error(`Failed to process Ethereum to NEAR swap ${escrowId}:`, error);
      
      // Update the escrow status to indicate an error
      try {
        const escrow = new ethers.Contract(escrowAddress, EscrowABI, this.signer);
        await escrow.setStatus(3); // 3 = Error
      } catch (updateError) {
        logger.error(`Failed to update escrow status for ${escrowId}:`, updateError);
      }
      
      throw error;
    }
  }
  
  // Add more handler methods for other events as needed
}
