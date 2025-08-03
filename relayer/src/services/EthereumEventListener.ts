/**
 * Ethereum event listener service
 * Handles listening for and processing Ethereum blockchain events
 */

import { ethers } from 'ethers';

import { NetworkError, ContractError, ErrorHandler } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

// ABI definitions for contracts
const EscrowFactoryABI = [
  'function createDstEscrow(tuple(bytes32 orderHash, bytes32 hashlock, address maker, address taker, address token, uint256 amount, uint256 safetyDeposit, uint256 timelocks) dstImmutables, uint256 srcCancellationTimestamp) external payable returns (address)',
  'function addressOfEscrowSrc(tuple(bytes32 orderHash, bytes32 hashlock, address maker, address taker, address token, uint256 amount, uint256 safetyDeposit, uint256 timelocks) immutables) external view returns (address)',
  'event DstEscrowCreated(address indexed escrow, address indexed initiator, address token, uint256 amount, string targetChain, string targetAddress)'
] as const;

const BridgeABI = [
  'event DepositInitiated(bytes32 indexed depositId, address indexed sender, string nearRecipient, address token, uint256 amount, uint256 fee, uint256 timestamp)',
  'event MessageSent(bytes32 indexed messageId, string targetChain, string targetAddress, bytes data)',
  'event WithdrawalCompleted(bytes32 indexed messageId, address indexed recipient, uint256 amount, bytes32 secretHash)'
] as const;

export interface EthereumEventHandlers {
  onDepositInitiated?: (event: DepositInitiatedEvent) => Promise<void>;
  onMessageSent?: (event: MessageSentEvent) => Promise<void>;
  onWithdrawalCompleted?: (event: WithdrawalCompletedEvent) => Promise<void>;
  onEscrowCreated?: (event: EscrowCreatedEvent) => Promise<void>;
  onOrderPartiallyFilled?: (event: OrderPartiallyFilledEvent) => Promise<void>;
  onOrderRefunded?: (event: OrderRefundedEvent) => Promise<void>;
}

export interface DepositInitiatedEvent {
  depositId: string;
  sender: string;
  nearRecipient: string;
  token: string;
  amount: bigint;
  fee: bigint;
  timestamp: bigint;
  blockNumber: number;
  transactionHash: string;
}

export interface MessageSentEvent {
  messageId: string;
  targetChain: string;
  targetAddress: string;
  data: string;
  blockNumber: number;
  transactionHash: string;
}

export interface WithdrawalCompletedEvent {
  messageId: string;
  recipient: string;
  amount: bigint;
  secretHash: string;
  blockNumber: number;
  transactionHash: string;
}

export interface EscrowCreatedEvent {
  escrow: string;
  initiator: string;
  token: string;
  amount: bigint;
  targetChain: string;
  targetAddress: string;
  blockNumber: number;
  transactionHash: string;
}

export interface OrderPartiallyFilledEvent {
  orderHash: string;
  fillAmount: string;
  remainingAmount: string;
  fillCount: number;
  recipient: string;
  token: string;
  secretHash?: string; // For cross-chain coordination
  blockNumber: number;
  transactionHash: string;
}

export interface OrderRefundedEvent {
  orderHash: string;
  recipient: string;
  refundAmount: string;
  reason: string;
  secretHash?: string; // For cross-chain coordination
  blockNumber: number;
  transactionHash: string;
}

export class EthereumEventListener {
  private readonly provider: ethers.providers.JsonRpcProvider;
  private readonly factoryContract: ethers.Contract;
  private readonly bridgeContract: ethers.Contract;
  private readonly handlers: EthereumEventHandlers;
  private isRunning = false;
  private readonly pollInterval: number;
  private pollTimer?: NodeJS.Timeout;
  private lastProcessedBlock = 0;

  constructor(
    provider: ethers.providers.JsonRpcProvider,
    factoryAddress: string,
    bridgeAddress: string,
    handlers: EthereumEventHandlers,
    pollIntervalMs = 5000
  ) {
    this.validateConstructorParams(provider, factoryAddress, bridgeAddress, handlers);
    
    this.provider = provider;
    this.handlers = handlers;
    this.pollInterval = pollIntervalMs;

    // Initialize contracts
    this.factoryContract = new ethers.Contract(factoryAddress, EscrowFactoryABI, provider);
    this.bridgeContract = new ethers.Contract(bridgeAddress, BridgeABI, provider);
  }

  /**
   * Start the event listener
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('EthereumEventListener is already running');
      return;
    }

    try {
      // Get current block number
      this.lastProcessedBlock = await this.provider.getBlockNumber();
      logger.info('Starting Ethereum event listener', {
        factoryAddress: this.factoryContract.address,
        bridgeAddress: this.bridgeContract.address,
        startBlock: this.lastProcessedBlock,
        pollInterval: this.pollInterval
      });

      this.isRunning = true;
      this.scheduleNextPoll();

      logger.info('Ethereum event listener started successfully');
    } catch (error) {
      throw new NetworkError(
        'Failed to start Ethereum event listener',
        'ethereum',
        'start',
        { error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  /**
   * Stop the event listener
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    logger.info('Stopping Ethereum event listener');
    
    this.isRunning = false;
    
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = undefined;
    }

    logger.info('Ethereum event listener stopped');
  }

  /**
   * Check if the listener is running
   */
  getIsRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Get the last processed block number
   */
  getLastProcessedBlock(): number {
    return this.lastProcessedBlock;
  }

  // Private methods

  private validateConstructorParams(
    provider: ethers.providers.JsonRpcProvider,
    factoryAddress: string,
    bridgeAddress: string,
    handlers: EthereumEventHandlers
  ): void {
    if (!provider) {
      throw ErrorHandler.createValidationError('provider', provider, 'Provider is required');
    }

    if (!ethers.utils.isAddress(factoryAddress)) {
      throw ErrorHandler.createValidationError('factoryAddress', factoryAddress, 'Invalid factory address');
    }

    if (!ethers.utils.isAddress(bridgeAddress)) {
      throw ErrorHandler.createValidationError('bridgeAddress', bridgeAddress, 'Invalid bridge address');
    }

    if (!handlers || typeof handlers !== 'object') {
      throw ErrorHandler.createValidationError('handlers', handlers, 'Event handlers object is required');
    }
  }

  private scheduleNextPoll(): void {
    if (!this.isRunning) {
      return;
    }

    this.pollTimer = setTimeout(async () => {
      try {
        await this.pollForEvents();
      } catch (error) {
        ErrorHandler.handle(error as Error, 'EthereumEventListener.pollForEvents');
      } finally {
        this.scheduleNextPoll();
      }
    }, this.pollInterval);
  }

  private async pollForEvents(): Promise<void> {
    try {
      const currentBlock = await this.provider.getBlockNumber();
      const fromBlock = this.lastProcessedBlock + 1;
      const toBlock = currentBlock;

      if (fromBlock > toBlock) {
        // No new blocks to process
        return;
      }

      // Limit the number of blocks processed at once to avoid overwhelming the RPC
      const maxBlocksPerPoll = 5; // Reduced from 10 to minimize RPC load
      const actualToBlock = Math.min(toBlock, fromBlock + maxBlocksPerPoll - 1);

      logger.debug('Polling for Ethereum events', {
        fromBlock,
        toBlock: actualToBlock,
        blocksToProcess: actualToBlock - fromBlock + 1
      });

      // Process events sequentially to avoid RPC overload
      try {
        // Process factory events first (most important for escrow creation)
        await this.processFactoryEvents(fromBlock, actualToBlock);
      } catch (factoryError) {
        logger.warn('Factory event processing failed, continuing with bridge events', {
          error: factoryError instanceof Error ? factoryError.message : String(factoryError),
          fromBlock,
          toBlock: actualToBlock
        });
      }
      
      try {
        // Process bridge events
        await this.processBridgeEvents(fromBlock, actualToBlock);
      } catch (bridgeError) {
        logger.warn('Bridge event processing failed', {
          error: bridgeError instanceof Error ? bridgeError.message : String(bridgeError),
          fromBlock,
          toBlock: actualToBlock
        });
      }

      this.lastProcessedBlock = actualToBlock;

    } catch (error) {
      throw new NetworkError(
        'Failed to poll for Ethereum events',
        'ethereum',
        'pollEvents',
        {
          lastProcessedBlock: this.lastProcessedBlock,
          error: error instanceof Error ? error.message : String(error)
        }
      );
    }
  }

  private async processFactoryEvents(fromBlock: number, toBlock: number): Promise<void> {
    try {
      // Add validation for block range
      if (fromBlock > toBlock) {
        logger.debug('Invalid block range for factory events', { fromBlock, toBlock });
        return;
      }

      // Check if factory contract is properly initialized
      if (!this.factoryContract || !this.factoryContract.address) {
        logger.warn('Factory contract not properly initialized, skipping factory events');
        return;
      }

      logger.debug('Processing factory events', { 
        factoryAddress: this.factoryContract.address,
        fromBlock, 
        toBlock 
      });

      const filter = this.factoryContract.filters.DstEscrowCreated();
      const events = await this.factoryContract.queryFilter(filter, fromBlock, toBlock);

      for (const event of events) {
        if (!event.args) {
          logger.debug('Skipping event with no args', { 
            transactionHash: event.transactionHash,
            blockNumber: event.blockNumber 
          });
          continue;
        }

        try {
          const escrowCreatedEvent: EscrowCreatedEvent = {
            escrow: event.args.escrow,
            initiator: event.args.initiator,
            token: event.args.token,
            amount: event.args.amount.toBigInt(),
            targetChain: event.args.targetChain,
            targetAddress: event.args.targetAddress,
            blockNumber: event.blockNumber,
            transactionHash: event.transactionHash
          };

          if (this.handlers.onEscrowCreated) {
            await this.safeHandleEvent('DstEscrowCreated', () => 
              this.handlers.onEscrowCreated!(escrowCreatedEvent)
            );
          }
        } catch (eventError) {
          logger.warn('Failed to process individual factory event', {
            transactionHash: event.transactionHash,
            blockNumber: event.blockNumber,
            error: eventError instanceof Error ? eventError.message : String(eventError)
          });
        }
      }

      if (events.length > 0) {
        logger.debug('Processed DstEscrowCreated events', { 
          count: events.length, 
          fromBlock, 
          toBlock 
        });
      }
    } catch (error) {
      // More specific error handling
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      if (errorMessage.includes('network') || errorMessage.includes('timeout')) {
        logger.warn('Network error processing factory events, will retry next poll', {
          fromBlock,
          toBlock,
          error: errorMessage
        });
        throw new NetworkError(
          'Network error processing factory events',
          'ethereum',
          'queryFilter',
          { fromBlock, toBlock, error: errorMessage }
        );
      } else {
        logger.error('Contract error processing factory events', {
          factoryAddress: this.factoryContract?.address,
          fromBlock,
          toBlock,
          error: errorMessage
        });
        throw new ContractError(
          'Failed to process factory events',
          this.factoryContract?.address || 'unknown',
          'queryFilter',
          { fromBlock, toBlock, error: errorMessage }
        );
      }
    }
  }

  private async processBridgeEvents(fromBlock: number, toBlock: number): Promise<void> {
    try {
      // Process DepositInitiated events
      await this.processDepositInitiatedEvents(fromBlock, toBlock);
      
      // Process MessageSent events
      await this.processMessageSentEvents(fromBlock, toBlock);
      
      // Process WithdrawalCompleted events
      await this.processWithdrawalCompletedEvents(fromBlock, toBlock);
    } catch (error) {
      throw new ContractError(
        'Failed to process bridge events',
        this.bridgeContract.address,
        'queryFilter',
        { fromBlock, toBlock, error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  private async processDepositInitiatedEvents(fromBlock: number, toBlock: number): Promise<void> {
    const filter = this.bridgeContract.filters.DepositInitiated();
    const events = await this.bridgeContract.queryFilter(filter, fromBlock, toBlock);

    for (const event of events) {
      if (!event.args) continue;

      const depositEvent: DepositInitiatedEvent = {
        depositId: event.args.depositId,
        sender: event.args.sender,
        nearRecipient: event.args.nearRecipient,
        token: event.args.token,
        amount: event.args.amount.toBigInt(),
        fee: event.args.fee.toBigInt(),
        timestamp: event.args.timestamp.toBigInt(),
        blockNumber: event.blockNumber,
        transactionHash: event.transactionHash
      };

      if (this.handlers.onDepositInitiated) {
        await this.safeHandleEvent('DepositInitiated', () =>
          this.handlers.onDepositInitiated!(depositEvent)
        );
      }
    }

    if (events.length > 0) {
      logger.debug('Processed DepositInitiated events', { 
        count: events.length, 
        fromBlock, 
        toBlock 
      });
    }
  }

  private async processMessageSentEvents(fromBlock: number, toBlock: number): Promise<void> {
    const filter = this.bridgeContract.filters.MessageSent();
    const events = await this.bridgeContract.queryFilter(filter, fromBlock, toBlock);

    for (const event of events) {
      if (!event.args) continue;

      const messageEvent: MessageSentEvent = {
        messageId: event.args.messageId,
        targetChain: event.args.targetChain,
        targetAddress: event.args.targetAddress,
        data: event.args.data,
        blockNumber: event.blockNumber,
        transactionHash: event.transactionHash
      };

      if (this.handlers.onMessageSent) {
        await this.safeHandleEvent('MessageSent', () =>
          this.handlers.onMessageSent!(messageEvent)
        );
      }
    }

    if (events.length > 0) {
      logger.debug('Processed MessageSent events', { 
        count: events.length, 
        fromBlock, 
        toBlock 
      });
    }
  }

  private async processWithdrawalCompletedEvents(fromBlock: number, toBlock: number): Promise<void> {
    const filter = this.bridgeContract.filters.WithdrawalCompleted();
    const events = await this.bridgeContract.queryFilter(filter, fromBlock, toBlock);

    for (const event of events) {
      if (!event.args) continue;

      const withdrawalEvent: WithdrawalCompletedEvent = {
        messageId: event.args.messageId,
        recipient: event.args.recipient,
        amount: event.args.amount.toBigInt(),
        secretHash: event.args.secretHash,
        blockNumber: event.blockNumber,
        transactionHash: event.transactionHash
      };

      if (this.handlers.onWithdrawalCompleted) {
        await this.safeHandleEvent('WithdrawalCompleted', () =>
          this.handlers.onWithdrawalCompleted!(withdrawalEvent)
        );
      }
    }

    if (events.length > 0) {
      logger.debug('Processed WithdrawalCompleted events', { 
        count: events.length, 
        fromBlock, 
        toBlock 
      });
    }
  }

  private async safeHandleEvent(eventType: string, handler: () => Promise<void>): Promise<void> {
    try {
      await handler();
    } catch (error) {
      ErrorHandler.handle(error as Error, `EthereumEventListener.${eventType}Handler`);
      // Continue processing other events even if one fails
    }
  }
}
