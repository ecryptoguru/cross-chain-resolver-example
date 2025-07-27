import { ethers, type Contract, type EventLog, type JsonRpcProvider, type Signer } from 'ethers';
import type { Account } from 'near-api-js';
import { logger } from '../utils/logger';
import { sleep } from '../utils/common';

// Define the Escrow ABI that we'll use to interact with escrow contracts
const EscrowABI = [
  'function getDetails() view returns (tuple(uint8 status, address token, uint256 amount, uint256 timelock, bytes32 secretHash, address initiator, address recipient, uint256 chainId))',
  'function setStatus(uint8 status) external',
  'event StatusChanged(uint8 newStatus)'
] as const;

declare global {
  // For browser compatibility
  // eslint-disable-next-line no-var
  var window: Window & typeof globalThis & { ethereum?: any };
  
  // For Node.js environment
  // eslint-disable-next-line no-var
  var process: NodeJS.Process;
}

// ABI definitions for contracts
const EscrowFactoryABI = [
  'function createDstEscrow(tuple(uint256,address,address,uint256,bytes32,bytes32,uint256,uint256,uint256,uint8,uint256,uint256,bytes32,bytes32) immutables, uint256 srcCancellationTimestamp) external payable returns (address)',
  'function addressOfEscrowSrc(tuple(uint256,address,address,uint256,bytes32,bytes32,uint256,uint256,uint256,uint8,uint256,uint256,bytes32,bytes32) immutables) external view returns (address)',
  'event EscrowCreated(address indexed escrow, address indexed initiator, address token, uint256 amount, string targetChain, string targetAddress)'
];

const ResolverABI = [
  'event NearDepositInitiated(address indexed sender, string nearRecipient, uint256 amount, bytes32 secretHash, uint256 timelock)',
  'event NearWithdrawalCompleted(bytes32 indexed secretHash, string nearRecipient, uint256 amount)',
  'event NearRefunded(bytes32 indexed secretHash, string nearRecipient, uint256 amount)'
] as const; // Add 'as const' for better type inference

// Type definitions for better type safety
type BigNumberish = ethers.BigNumberish;
type BigNumber = ethers.BigNumber;

// Extend the Window interface to include ethereum
declare global {
  interface Window {
    ethereum?: any;
  }
}

// NEAR-specific event interfaces
interface NearDepositInitiatedEvent {
  sender: string;
  nearRecipient: string;
  amount: BigNumber;
  secretHash: string;
  timelock: number;
}

interface NearWithdrawalCompletedEvent {
  secretHash: string;
  nearRecipient: string;
  amount: BigNumber;
}

interface NearRefundedEvent {
  secretHash: string;
  nearRecipient: string;
  amount: BigNumber;
}

export class EthereumRelayer {
  private readonly provider: JsonRpcProvider;
  private readonly signer: Signer;
  private readonly nearAccount: Account;
  private isRunning = false;
  private readonly pollInterval: number;
  private pollTimer: NodeJS.Timeout | null | undefined = null;
  private resolverContract: ethers.Contract;
  private escrowFactoryContract: ethers.Contract;

  constructor(signer: ethers.Signer, nearAccount: Account) {
    if (!signer.provider) {
      throw new Error('Signer must be connected to a provider');
    }

    this.signer = signer;
    this.provider = signer.provider as ethers.providers.JsonRpcProvider;
    this.nearAccount = nearAccount;
    this.pollInterval = parseInt(process.env.RELAYER_POLL_INTERVAL || '5000', 10);
    
    // Initialize contracts
    const resolverAddress = process.env.RESOLVER_ADDRESS;
    const escrowFactoryAddress = process.env.ESCROW_FACTORY_ADDRESS;
    
    if (!resolverAddress || !escrowFactoryAddress) {
      throw new Error('RESOLVER_ADDRESS and ESCROW_FACTORY_ADDRESS must be set in environment variables');
    }
    
    // Type-safe contract instances
    this.resolverContract = new ethers.Contract(
      resolverAddress,
      ResolverABI,
      this.signer
    ) as ethers.Contract & {
      on: (eventName: string, listener: (...args: any[]) => void) => ethers.Contract;
      filters: {
        NearDepositInitiated: (sender?: string, nearRecipient?: string) => ethers.EventFilter;
        NearWithdrawalCompleted: (secretHash?: string, nearRecipient?: string) => ethers.EventFilter;
        NearRefunded: (secretHash?: string, nearRecipient?: string) => ethers.EventFilter;
      };
    };
    
    this.escrowFactoryContract = new ethers.Contract(
      escrowFactoryAddress,
      EscrowFactoryABI,
      this.signer
    ) as ethers.Contract & {
      on: (eventName: string, listener: (...args: any[]) => void) => ethers.Contract;
      filters: {
        EscrowCreated: (escrow?: string, initiator?: string) => ethers.EventFilter;
      };
    };
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
      this.pollTimer = null;
    }
    
    logger.info('Ethereum relayer stopped');
  }

  private setupEventListeners(): void {
    if (!process.env.ETHEREUM_ESCROW_FACTORY_ADDRESS) {
      throw new Error('ETHEREUM_ESCROW_FACTORY_ADDRESS is not set in environment variables');
    }

    // Listen for EscrowCreated events
    this.escrowFactoryContract.on(
      'EscrowCreated',
      (
        escrowAddress: string,
        initiator: string,
        token: string,
        amount: bigint,
        targetChain: string,
        targetAddress: string,
        event: EventLog
      ) => {
      try {
        logger.info(`New escrow created: ${escrowAddress}`);
        
        // Only process NEAR chain targets for now
        if (targetChain.toLowerCase() === 'near') {
          this.handleEthereumToNearSwap(
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
      await this.checkForNewEvents();
    } catch (error) {
      logger.error('Error in Ethereum event polling:', error);
    } finally {
      // Schedule the next poll if still running
      if (this.isRunning) {
        this.pollTimer = setTimeout(() => {
          this.pollForEvents().catch(console.error);
        }, this.pollInterval);
      }
    }
  }

  private async checkForNewEvents(): Promise<void> {
    try {
      // Get the current block number
      const currentBlock = await this.provider.getBlockNumber();
      const fromBlock = Math.max(0, currentBlock - 100); // Check last 100 blocks
      
      // Get EscrowCreated events with proper typing
      const escrowCreatedFilter = this.escrowFactoryContract.filters.EscrowCreated();
      const escrowCreatedEvents = await this.escrowFactoryContract.queryFilter(
        escrowCreatedFilter,
        fromBlock,
        'latest'
      ) as unknown as Array<EventLog & {
        args: [string, string, string, bigint, string, string];
      }>;
      
      // Process each event
      for (const event of escrowCreatedEvents) {
        try {
          const [escrowAddress, initiator, token, amount, targetChain, targetAddress] = event.args;
          
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
        } catch (error) {
          logger.error(`Error processing event: ${error}`);
        }
      }
      
      logger.debug(`Processed ${escrowCreatedEvents.length} EscrowCreated events`);
      
    } catch (error) {
      logger.error('Error checking for new Ethereum events:', error);
      throw error; // Re-throw to be caught by the caller
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
      
      // 1. Get escrow details with proper typing
      const escrow = new ethers.Contract(escrowAddress, EscrowABI, this.provider);
      
      // Define the return type for getDetails
      type EscrowDetails = [
        status: number,
        token: string,
        amount: bigint,
        timelock: number,
        secretHash: string,
        initiator: string,
        recipient: string,
        chainId: bigint
      ];
      
      // Call getDetails and type assert the result
      const details = await escrow.getDetails() as unknown as EscrowDetails;
      
      // Destructure with proper typing
      const [
        status,
        token,
        escrowAmount,
        timelock,
        existingSecretHash,
        escrowInitiator,
        recipient,
        chainId
      ] = details;
      
      // Alias timelock to expiresAt for better code readability
      const expiresAt = timelock;
      
      // 2. Validate the escrow
      if (status !== 0) { // 0 = Active
        logger.warn(`Escrow ${escrowId} is not active. Status: ${status}`);
        return;
      }
      
      // 3. Verify the initiator matches
      if (escrowInitiator.toLowerCase() !== initiator.toLowerCase()) {
        logger.warn(`Initiator mismatch for escrow ${escrowId}`);
        return;
      }
      
      // 4. Check if the escrow has expired
      const currentTimestamp = Math.floor(Date.now() / 1000);
      if (currentTimestamp > expiresAt) {
        logger.warn(`Escrow ${escrowId} has expired`);
        return;
      }
      
      // 5. Generate a secret and hash for the hashlock
      const secret = ethers.hexlify(ethers.randomBytes(32));
      const secretHash = ethers.keccak256(ethers.toUtf8Bytes(secret));
      
      // 6. Prepare NEAR transaction data
      const nearDepositData = {
        from: initiator,
        to: targetNearAccount,
        token: tokenAddress,
        amount: amount.toString(),
        secretHash: secretHash,
        expiresAt: expiresAt.toString(),
        chainId: 'near' // Hardcoded for NEAR chain
      };
      
      logger.info(`Prepared NEAR deposit data: ${JSON.stringify(nearDepositData, null, 2)}`);
      
      // 7. Here you would typically:
      // - Sign the transaction data with the relayer's private key
      // - Submit the transaction to the NEAR network
      // - Wait for confirmation
      // - Update the escrow status on Ethereum
      logger.info('This is where the NEAR transaction would be submitted');
      
      // Example of what the NEAR transaction might look like:
      /*
      if (this.nearAccount) {
        const nearTxResult = await this.nearAccount.functionCall({
          contractId: process.env.NEAR_ESCROW_FACTORY_ADDRESS!,
          methodName: 'create_escrow',
          args: nearDepositData,
          gas: '300000000000000', // 300 TGas
          attachedDeposit: '1' // 1 yoctoNEAR for security
        });
        logger.info(`NEAR transaction submitted: ${JSON.stringify(nearTxResult)}`);
      }
      */
      
      logger.info(`Successfully processed Ethereum to NEAR swap for ${escrowId}`);
      
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Error processing Ethereum to NEAR swap ${escrowId}: ${errorMessage}`, { error });
      throw error; // Re-throw to be handled by the caller
    }
  }
  
  // Add more handler methods for other events as needed
}
