import { ethers, type Contract, type Signer } from 'ethers';
import type { Account } from 'near-api-js';
import { logger } from '../utils/logger.js';
import { sleep } from '../utils/common.js';

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

// Cross-chain message interfaces
interface CrossChainMessage {
  messageId: string;
  sender: string;
  recipient: string;
  amount: string;
  txHash: string;
  timestamp: number;
  signature?: string;
}

interface DepositMessage extends CrossChainMessage {
  secretHash: string;
  timelock: number;
}

interface WithdrawalMessage extends CrossChainMessage {
  secret: string;
}

interface RefundMessage extends CrossChainMessage {
  reason: string;
}

// Ethereum escrow details interface
interface EthereumEscrowDetails {
  status: number;
  token: string;
  amount: string;
  timelock: number;
  secretHash: string;
  initiator: string;
  recipient: string;
  chainId: number;
  escrowAddress?: string;
}

export class EthereumRelayer {
  private readonly provider: ethers.providers.JsonRpcProvider;
  private readonly signer: Signer;
  private readonly nearAccount: Account;
  private isRunning = false;
  private readonly pollInterval: number;
  private pollTimer: NodeJS.Timeout | null | undefined = null;
  private resolverContract: ethers.Contract;
  private escrowFactoryContract: ethers.Contract;
  private readonly processedMessages: Set<string> = new Set();
  private readonly nearEscrowContractId: string;

  constructor(signer: ethers.Signer, nearAccount: Account) {
    if (!signer.provider) {
      throw new Error('Signer must be connected to a provider');
    }

    this.signer = signer;
    this.provider = signer.provider as ethers.providers.JsonRpcProvider;
    this.nearAccount = nearAccount;
    this.pollInterval = parseInt(process.env.RELAYER_POLL_INTERVAL || '5000', 10);
    this.nearEscrowContractId = process.env.NEAR_ESCROW_CONTRACT || 'escrow-v2.fusionswap.testnet';
    
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

    // Load processed messages from storage
    this.loadProcessedMessages();
    
    this.setupEventListeners();
    
    logger.info('Ethereum Relayer initialized successfully');

    // Start polling for events
    this.pollForEvents();
    
    logger.info('Ethereum Relayer started successfully');
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
        event: ethers.Event
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
      ) as unknown as Array<ethers.Event & {
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
      const secret = ethers.utils.hexlify(ethers.utils.randomBytes(32));
      const secretHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(secret));
      
      // Remove the '0x' prefix from the secret hash for NEAR contract
      const cleanSecretHash = secretHash.startsWith('0x') ? secretHash.slice(2) : secretHash;
      
      // 6. Calculate timelock duration (1 hour = 3600 seconds)
      const timelockDuration = 3600; // 1 hour in seconds
      
      logger.info(`Creating NEAR swap order for Ethereum deposit:`, {
        recipient: targetNearAccount,
        hashlock: cleanSecretHash,
        timelockDuration,
        amount: ethers.utils.formatEther(amount) + ' ETH equivalent'
      });
      
      // 7. Submit the transaction to the NEAR network
      try {
        if (this.nearAccount) {
          const nearTxResult = await this.nearAccount.functionCall({
            contractId: process.env.NEAR_ESCROW_CONTRACT || 'escrow-v2.fusionswap.testnet',
            methodName: 'create_swap_order',
            args: {
              recipient: targetNearAccount,
              hashlock: cleanSecretHash,
              timelock_duration: timelockDuration
            },
            gas: '300000000000000', // 300 TGas
            attachedDeposit: amount.toString() // Attach the equivalent amount in yoctoNEAR
          });
          
          logger.info(`NEAR swap order created successfully:`, {
            transactionHash: nearTxResult.transaction.hash,
            orderId: nearTxResult.status?.SuccessValue ? Buffer.from(nearTxResult.status.SuccessValue, 'base64').toString() : 'unknown',
            gasUsed: nearTxResult.transaction_outcome.outcome.gas_burnt
          });
          
          // Store the secret for later use (in production, this should be securely stored)
          logger.info(`Secret for order fulfillment: ${secret}`);
          logger.info(`Secret hash: ${cleanSecretHash}`);
          
        } else {
          logger.error('NEAR account not initialized - cannot create swap order');
          throw new Error('NEAR account not available');
        }
      } catch (nearError: any) {
        logger.error(`Failed to create NEAR swap order:`, {
          error: nearError.message,
          type: nearError.type || 'unknown',
          details: nearError
        });
        throw new Error(`NEAR transaction failed: ${nearError.message}`);
      }
      
      logger.info(`Successfully processed Ethereum to NEAR swap for ${escrowId}`);
      
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Error processing Ethereum to NEAR swap ${escrowId}: ${errorMessage}`, { error });
      throw error; // Re-throw to be handled by the caller
    }
  }
  
  /**
   * Handles deposit messages from NEAR to Ethereum
   */
  private async handleDepositMessage(message: DepositMessage): Promise<void> {
    const messageId = `deposit:${message.txHash}:${message.sender}:${message.amount}`;
    
    // Check if we've already processed this message
    if (this.processedMessages.has(messageId)) {
      logger.debug(`Deposit message already processed: ${messageId}`);
      return;
    }
    
    try {
      logger.info(`Processing deposit from NEAR to Ethereum`, {
        sender: message.sender,
        recipient: message.recipient,
        amount: message.amount,
        secretHash: message.secretHash,
        timelock: message.timelock,
        txHash: message.txHash
      });
      
      // 1. Verify the NEAR transaction
      const isValidTx = await this.verifyNearTransaction(message.txHash, message.sender);
      if (!isValidTx) {
        throw new Error(`Invalid NEAR transaction: ${message.txHash}`);
      }
      
      // 2. Verify message signature if provided
      if (message.signature) {
        const isValidSig = await this.verifyMessageSignature(message, message.signature);
        if (!isValidSig) {
          throw new Error(`Invalid message signature for ${messageId}`);
        }
      }
      
      // 3. Create Ethereum escrow contract
      await this.createEthereumEscrow({
        initiator: message.sender,
        recipient: message.recipient,
        amount: message.amount,
        secretHash: message.secretHash,
        timelock: message.timelock,
        sourceChain: 'near',
        sourceTxHash: message.txHash
      });
      
      // 4. Mark message as processed
      this.processedMessages.add(messageId);
      this.saveProcessedMessage(messageId);
      
      logger.info(`Successfully processed deposit message: ${messageId}`);
      
    } catch (error) {
      logger.error(`Failed to process deposit message ${messageId}:`, error);
      throw error;
    }
  }
  
  /**
   * Handles withdrawal messages from NEAR to Ethereum
   */
  private async handleWithdrawalMessage(message: WithdrawalMessage): Promise<void> {
    const messageId = `withdrawal:${message.txHash}:${message.sender}:${message.secret}`;
    
    // Check if we've already processed this message
    if (this.processedMessages.has(messageId)) {
      logger.debug(`Withdrawal message already processed: ${messageId}`);
      return;
    }
    
    try {
      logger.info(`Processing withdrawal from NEAR to Ethereum`, {
        sender: message.sender,
        recipient: message.recipient,
        amount: message.amount,
        secret: message.secret.substring(0, 10) + '...',
        txHash: message.txHash
      });
      
      // 1. Verify the NEAR transaction
      const isValidTx = await this.verifyNearTransaction(message.txHash, message.sender);
      if (!isValidTx) {
        throw new Error(`Invalid NEAR transaction: ${message.txHash}`);
      }
      
      // 2. Compute secret hash from the revealed secret
      const secretHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(message.secret));
      
      // 3. Find the corresponding Ethereum escrow by secret hash
      const escrowDetails = await this.findEthereumEscrowBySecretHash(secretHash);
      if (!escrowDetails) {
        throw new Error(`No Ethereum escrow found for secret hash: ${secretHash}`);
      }
      
      // 4. Verify escrow details match the withdrawal message
      if (escrowDetails.amount !== message.amount) {
        throw new Error(`Amount mismatch: escrow has ${escrowDetails.amount}, message has ${message.amount}`);
      }
      
      // 5. Execute withdrawal on Ethereum escrow contract
      await this.executeEthereumWithdrawal(escrowDetails.escrowAddress!, message.secret);
      
      // 6. Mark message as processed
      this.processedMessages.add(messageId);
      this.saveProcessedMessage(messageId);
      
      logger.info(`Successfully processed withdrawal message: ${messageId}`);
      
    } catch (error) {
      logger.error(`Failed to process withdrawal message ${messageId}:`, error);
      throw error;
    }
  }
  
  /**
   * Handles refund messages from NEAR to Ethereum
   */
  private async handleRefundMessage(message: RefundMessage): Promise<void> {
    const messageId = `refund:${message.txHash}:${message.sender}:${message.amount}`;
    
    // Check if we've already processed this message
    if (this.processedMessages.has(messageId)) {
      logger.debug(`Refund message already processed: ${messageId}`);
      return;
    }
    
    try {
      logger.info(`Processing refund from NEAR to Ethereum`, {
        sender: message.sender,
        recipient: message.recipient,
        amount: message.amount,
        reason: message.reason,
        txHash: message.txHash
      });
      
      // 1. Verify the NEAR transaction
      const isValidTx = await this.verifyNearTransaction(message.txHash, message.sender);
      if (!isValidTx) {
        throw new Error(`Invalid NEAR transaction: ${message.txHash}`);
      }
      
      // 2. Find the corresponding Ethereum escrow by initiator and amount
      const escrowDetails = await this.findEthereumEscrowByInitiator(message.sender, message.amount);
      if (!escrowDetails) {
        throw new Error(`No Ethereum escrow found for initiator ${message.sender} with amount ${message.amount}`);
      }
      
      // 3. Verify that the escrow timelock has expired
      const currentTimestamp = Math.floor(Date.now() / 1000);
      if (currentTimestamp <= escrowDetails.timelock) {
        throw new Error(`Escrow timelock has not expired yet. Current: ${currentTimestamp}, Expires: ${escrowDetails.timelock}`);
      }
      
      // 4. Execute refund on Ethereum escrow contract
      await this.executeEthereumRefund(escrowDetails.escrowAddress!);
      
      // 5. Mark message as processed
      this.processedMessages.add(messageId);
      this.saveProcessedMessage(messageId);
      
      logger.info(`Successfully processed refund message: ${messageId}`);
      
    } catch (error) {
      logger.error(`Failed to process refund message ${messageId}:`, error);
      throw error;
    }
  }
  
  /**
   * Verifies a NEAR transaction
   */
  private async verifyNearTransaction(txHash: string, expectedSigner: string): Promise<boolean> {
    try {
      // In a real implementation, this would call NEAR RPC to verify the transaction
      logger.debug(`Verifying NEAR transaction: ${txHash} from ${expectedSigner}`);
      
      // For now, we'll implement a basic verification
      // In production, you would:
      // 1. Call NEAR RPC to get transaction details
      // 2. Verify the transaction was successful
      // 3. Verify the signer matches expectedSigner
      // 4. Verify the transaction contains the expected method call
      
      // Placeholder implementation
      return txHash.length === 64 && expectedSigner.length > 0;
      
    } catch (error) {
      logger.error(`Failed to verify NEAR transaction ${txHash}:`, error);
      return false;
    }
  }
  
  /**
   * Verifies message signature
   */
  private async verifyMessageSignature(message: CrossChainMessage, signature: string): Promise<boolean> {
    try {
      // Create message hash for signature verification
      const messageHash = ethers.utils.keccak256(
        ethers.utils.toUtf8Bytes(
          JSON.stringify({
            messageId: message.messageId,
            sender: message.sender,
            recipient: message.recipient,
            amount: message.amount,
            timestamp: message.timestamp
          })
        )
      );
      
      // Recover signer from signature
      const recoveredAddress = ethers.utils.recoverAddress(messageHash, signature);
      
      // Verify the recovered address matches the message sender
      return recoveredAddress.toLowerCase() === message.sender.toLowerCase();
      
    } catch (error) {
      logger.error(`Failed to verify message signature:`, error);
      return false;
    }
  }
  
  /**
   * Creates an Ethereum escrow contract
   */
  private async createEthereumEscrow(params: {
    initiator: string;
    recipient: string;
    amount: string;
    secretHash: string;
    timelock: number;
    sourceChain: string;
    sourceTxHash: string;
  }): Promise<string> {
    try {
      logger.info(`Creating Ethereum escrow for ${params.sourceChain} deposit`);
      
      // Prepare escrow parameters (this structure should match your contract)
      const escrowParams = {
        chainId: 1, // Ethereum mainnet
        token: ethers.constants.AddressZero, // ETH
        initiator: params.initiator,
        amount: ethers.utils.parseEther(params.amount),
        secretHash: params.secretHash,
        hashlock: params.secretHash,
        srcTimelock: params.timelock,
        dstTimelock: params.timelock + 3600, // 1 hour buffer
        srcCancellationTimestamp: params.timelock + 7200, // 2 hour buffer
        status: 0, // Active
        srcChainId: params.sourceChain === 'near' ? 0 : 1,
        dstChainId: 1, // Ethereum
        srcAsset: ethers.utils.formatBytes32String('NEAR'),
        dstAsset: ethers.utils.formatBytes32String('ETH')
      };
      
      // Call the escrow factory to create the escrow
      const tx = await this.escrowFactoryContract.createDstEscrow(
        escrowParams,
        params.timelock
      );
      
      const receipt = await tx.wait();
      
      // Find the EscrowCreated event to get the escrow address
      const escrowCreatedEvent = receipt.events?.find(
        (event: any) => event.event === 'EscrowCreated'
      );
      
      if (!escrowCreatedEvent) {
        throw new Error('EscrowCreated event not found in transaction receipt');
      }
      
      const escrowAddress = escrowCreatedEvent.args[0];
      
      logger.info(`Ethereum escrow created successfully:`, {
        escrowAddress,
        txHash: receipt.transactionHash,
        gasUsed: receipt.gasUsed.toString()
      });
      
      return escrowAddress;
      
    } catch (error) {
      logger.error(`Failed to create Ethereum escrow:`, error);
      throw error;
    }
  }
  
  /**
   * Finds Ethereum escrow by secret hash
   */
  private async findEthereumEscrowBySecretHash(secretHash: string): Promise<EthereumEscrowDetails | null> {
    try {
      logger.debug(`Finding Ethereum escrow by secret hash: ${secretHash}`);
      
      // Query EscrowCreated events from the factory
      const currentBlock = await this.provider.getBlockNumber();
      const fromBlock = Math.max(0, currentBlock - 10000); // Search last 10k blocks
      
      const filter = this.escrowFactoryContract.filters.EscrowCreated();
      const events = await this.escrowFactoryContract.queryFilter(filter, fromBlock);
      
      // Check each escrow to find one with matching secret hash
      for (const event of events) {
        const escrowAddress = event.args?.[0];
        if (!escrowAddress) continue;
        
        try {
          const escrowContract = new ethers.Contract(escrowAddress, EscrowABI, this.provider);
          const details = await escrowContract.getDetails();
          
          if (details && details.secretHash === secretHash) {
            return {
              status: details.status,
              token: details.token,
              amount: ethers.utils.formatEther(details.amount),
              timelock: details.timelock.toNumber(),
              secretHash: details.secretHash,
              initiator: details.initiator,
              recipient: details.recipient,
              chainId: details.chainId.toNumber(),
              escrowAddress
            };
          }
        } catch (error) {
          logger.debug(`Failed to get details for escrow ${escrowAddress}:`, error);
          continue;
        }
      }
      
      return null;
      
    } catch (error) {
      logger.error(`Failed to find Ethereum escrow by secret hash:`, error);
      return null;
    }
  }
  
  /**
   * Finds Ethereum escrow by initiator and amount
   */
  private async findEthereumEscrowByInitiator(initiator: string, amount: string): Promise<EthereumEscrowDetails | null> {
    try {
      logger.debug(`Finding Ethereum escrow by initiator: ${initiator}, amount: ${amount}`);
      
      // Query EscrowCreated events from the factory
      const currentBlock = await this.provider.getBlockNumber();
      const fromBlock = Math.max(0, currentBlock - 10000); // Search last 10k blocks
      
      const filter = this.escrowFactoryContract.filters.EscrowCreated(null, initiator);
      const events = await this.escrowFactoryContract.queryFilter(filter, fromBlock);
      
      // Check each escrow to find one with matching amount
      for (const event of events) {
        const escrowAddress = event.args?.[0];
        if (!escrowAddress) continue;
        
        try {
          const escrowContract = new ethers.Contract(escrowAddress, EscrowABI, this.provider);
          const details = await escrowContract.getDetails();
          
          const escrowAmount = ethers.utils.formatEther(details.amount);
          if (details && escrowAmount === amount) {
            return {
              status: details.status,
              token: details.token,
              amount: escrowAmount,
              timelock: details.timelock.toNumber(),
              secretHash: details.secretHash,
              initiator: details.initiator,
              recipient: details.recipient,
              chainId: details.chainId.toNumber(),
              escrowAddress
            };
          }
        } catch (error) {
          logger.debug(`Failed to get details for escrow ${escrowAddress}:`, error);
          continue;
        }
      }
      
      return null;
      
    } catch (error) {
      logger.error(`Failed to find Ethereum escrow by initiator:`, error);
      return null;
    }
  }
  
  /**
   * Executes withdrawal on Ethereum escrow contract
   */
  private async executeEthereumWithdrawal(escrowAddress: string, secret: string): Promise<void> {
    try {
      logger.info(`Executing withdrawal on Ethereum escrow: ${escrowAddress}`);
      
      const escrowContract = new ethers.Contract(escrowAddress, EscrowABI, this.signer);
      
      // Call withdraw method with the secret
      const tx = await escrowContract.withdraw(secret);
      const receipt = await tx.wait();
      
      logger.info(`Ethereum withdrawal executed successfully:`, {
        escrowAddress,
        txHash: receipt.transactionHash,
        gasUsed: receipt.gasUsed.toString()
      });
      
    } catch (error) {
      logger.error(`Failed to execute Ethereum withdrawal:`, error);
      throw error;
    }
  }
  
  /**
   * Executes refund on Ethereum escrow contract
   */
  private async executeEthereumRefund(escrowAddress: string): Promise<void> {
    try {
      logger.info(`Executing refund on Ethereum escrow: ${escrowAddress}`);
      
      const escrowContract = new ethers.Contract(escrowAddress, EscrowABI, this.signer);
      
      // Call refund method
      const tx = await escrowContract.refund();
      const receipt = await tx.wait();
      
      logger.info(`Ethereum refund executed successfully:`, {
        escrowAddress,
        txHash: receipt.transactionHash,
        gasUsed: receipt.gasUsed.toString()
      });
      
    } catch (error) {
      logger.error(`Failed to execute Ethereum refund:`, error);
      throw error;
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
      
      const storageFile = path.join(process.cwd(), 'processed_messages_ethereum.json');
      
      if (fs.existsSync(storageFile)) {
        const data = fs.readFileSync(storageFile, 'utf8');
        const messages = JSON.parse(data);
        
        // Load messages into the Set
        messages.forEach((messageId: string) => {
          this.processedMessages.add(messageId);
        });
        
        logger.info(`Loaded ${messages.length} processed Ethereum messages from storage`);
      } else {
        logger.info('No processed Ethereum messages storage file found, starting fresh');
      }
    } catch (error) {
      logger.error('Failed to load processed Ethereum messages from storage:', error);
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
      
      const storageFile = path.join(process.cwd(), 'processed_messages_ethereum.json');
      
      // Convert Set to Array for JSON serialization
      const messages = Array.from(this.processedMessages);
      
      // Write to file
      fs.writeFileSync(storageFile, JSON.stringify(messages, null, 2));
      
      logger.debug(`Saved processed Ethereum message ${messageId} to storage`);
    } catch (error) {
      logger.error(`Failed to save processed Ethereum message ${messageId}:`, error);
      // Don't throw - this shouldn't stop message processing
    }
  }
  
  // Add more handler methods for other events as needed
}
