/**
 * Refactored NEAR Relayer
 * Uses dependency injection and proper separation of concerns
 */

import { ethers } from 'ethers';
import { NearAccount, IMessageProcessor, CrossChainMessage, MessageType } from '../types/interfaces.js';
import { NearEventListener, NearEventHandlers, SwapOrderCreatedEvent, SwapOrderCompletedEvent, SwapOrderRefundedEvent, TransactionProcessedEvent } from '../services/NearEventListener.js';
import { NearContractService } from '../services/NearContractService.js';
import { EthereumContractService } from '../services/EthereumContractService.js';
import { ValidationService } from '../services/ValidationService.js';
import { StorageService } from '../services/StorageService.js';
import { RelayerError, ErrorHandler } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export interface NearRelayerConfig {
  nearAccount: NearAccount;
  ethereumSigner: ethers.Signer;
  ethereumProvider: ethers.providers.JsonRpcProvider;
  ethereumEscrowFactoryAddress: string;
  escrowContractId: string;
  pollIntervalMs?: number;
  storageDir?: string;
}

export class NearRelayer implements IMessageProcessor {
  private readonly config: NearRelayerConfig;
  private readonly eventListener: NearEventListener;
  private readonly contractService: NearContractService;
  private readonly ethereumContractService: EthereumContractService;
  private readonly validator: ValidationService;
  private readonly storage: StorageService;
  private isRunning = false;

  constructor(config: NearRelayerConfig) {
    this.config = config;

    // Initialize services first
    this.validator = new ValidationService();
    
    // Then validate config
    this.validateConfig(config);
    this.storage = new StorageService(config.storageDir, 'near_processed_messages.json');
    this.contractService = new NearContractService(
      config.nearAccount,
      config.escrowContractId
    );
    this.ethereumContractService = new EthereumContractService(
      config.ethereumProvider,
      config.ethereumSigner,
      config.ethereumEscrowFactoryAddress
    );

    // Set up event handlers
    const eventHandlers: NearEventHandlers = {
      onSwapOrderCreated: this.handleSwapOrderCreated.bind(this),
      onSwapOrderCompleted: this.handleSwapOrderCompleted.bind(this),
      onSwapOrderRefunded: this.handleSwapOrderRefunded.bind(this),
      onTransactionProcessed: this.handleTransactionProcessed.bind(this)
    };

    this.eventListener = new NearEventListener(
      config.nearAccount.connection.provider,
      config.escrowContractId,
      eventHandlers,
      config.pollIntervalMs
    );
  }

  /**
   * Start the NEAR relayer
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('NearRelayer is already running');
      return;
    }

    try {
      logger.info('Starting NEAR relayer...');

      // Initialize storage
      await this.storage.initialize();

      // Start event listener
      await this.eventListener.start();

      this.isRunning = true;
      logger.info('NEAR relayer started successfully');
    } catch (error) {
      throw ErrorHandler.handleAndRethrow(
        error as Error,
        'Failed to start NEAR relayer'
      );
    }
  }

  /**
   * Stop the NEAR relayer
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      logger.info('Stopping NEAR relayer...');

      // Stop event listener
      await this.eventListener.stop();

      this.isRunning = false;
      logger.info('NEAR relayer stopped successfully');
    } catch (error) {
      ErrorHandler.handle(error as Error, 'NearRelayer.stop');
    }
  }

  /**
   * Check if the relayer is running
   */
  isRelayerRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Process a cross-chain message
   */
  async processMessage(message: CrossChainMessage): Promise<void> {
    try {
      // Validate message
      this.validator.validateCrossChainMessage(message);

      // Check if already processed
      if (this.storage.isMessageProcessed(message.messageId)) {
        logger.debug('Message already processed, skipping', { messageId: message.messageId });
        return;
      }

      logger.info('Processing cross-chain message', {
        messageId: message.messageId,
        type: message.type,
        sourceChain: message.sourceChain,
        destChain: message.destChain
      });

      // Route message based on type
      switch (message.type) {
        case MessageType.DEPOSIT:
          await this.processDepositMessage(message);
          break;
        case MessageType.WITHDRAWAL:
          await this.processWithdrawalMessage(message);
          break;
        case MessageType.REFUND:
          await this.processRefundMessage(message);
          break;
        default:
          throw new RelayerError(
            `Unknown message type: ${message.type}`,
            'INVALID_MESSAGE_TYPE',
            { messageId: message.messageId, type: message.type }
          );
      }

      // Mark as processed
      await this.storage.saveProcessedMessage(message.messageId);

      logger.info('Message processed successfully', { messageId: message.messageId });
    } catch (error) {
      throw ErrorHandler.handleAndRethrow(
        error as Error,
        `Failed to process message: ${message.messageId}`,
        { messageId: message.messageId, messageType: message.type }
      );
    }
  }

  /**
   * Get the number of processed messages
   */
  getProcessedMessageCount(): number {
    return this.storage.getProcessedMessageCount();
  }

  // Event handlers

  private async handleSwapOrderCreated(event: SwapOrderCreatedEvent): Promise<void> {
    try {
      logger.info('Handling SwapOrderCreated event', {
        orderId: event.orderId,
        initiator: event.initiator,
        recipient: event.recipient,
        amount: event.amount,
        blockHeight: event.blockHeight
      });

      // For NEAR→Ethereum transfer: Create corresponding Ethereum escrow
      logger.info('NEAR swap order created, creating corresponding Ethereum escrow', {
        orderId: event.orderId,
        secretHash: event.secretHash
      });

      // Check if Ethereum escrow already exists
      const existingEscrow = await this.findEthereumEscrowBySecretHash(event.secretHash);
      
      if (!existingEscrow) {
        // Create Ethereum escrow for NEAR→ETH transfer
        await this.createEthereumEscrowFromNearOrder(event);
      } else {
        logger.info('Ethereum escrow already exists for this secret hash', {
          orderId: event.orderId,
          secretHash: event.secretHash,
          escrowAddress: existingEscrow
        });
      }

      logger.info('SwapOrderCreated event processed successfully', {
        orderId: event.orderId
      });
    } catch (error) {
      ErrorHandler.handle(error as Error, 'NearRelayer.handleSwapOrderCreated');
    }
  }

  private async handleSwapOrderCompleted(event: SwapOrderCompletedEvent): Promise<void> {
    try {
      logger.info('Handling SwapOrderCompleted event', {
        orderId: event.orderId,
        secret: '***redacted***',
        blockHeight: event.blockHeight
      });

      // Update order status
      await this.updateOrderStatus(event.orderId, 'completed');

      // Process NEAR→Ethereum withdrawal now that we have the secret
      await this.processNearToEthereumWithdrawalFromCompletedOrder(event);

      logger.info('SwapOrderCompleted event processed successfully', {
        orderId: event.orderId
      });
    } catch (error) {
      ErrorHandler.handle(error as Error, 'NearRelayer.handleSwapOrderCompleted');
    }
  }

  private async handleSwapOrderRefunded(event: SwapOrderRefundedEvent): Promise<void> {
    try {
      logger.info('Handling SwapOrderRefunded event', {
        orderId: event.orderId,
        reason: event.reason,
        blockHeight: event.blockHeight
      });

      // Update any tracking or cleanup
      await this.updateOrderStatus(event.orderId, 'refunded');

      logger.info('SwapOrderRefunded event processed successfully', {
        orderId: event.orderId
      });
    } catch (error) {
      ErrorHandler.handle(error as Error, 'NearRelayer.handleSwapOrderRefunded');
    }
  }

  private async handleTransactionProcessed(event: TransactionProcessedEvent): Promise<void> {
    try {
      logger.debug('Handling TransactionProcessed event', {
        transactionHash: event.transactionHash,
        methodName: event.methodName,
        blockHeight: event.blockHeight
      });

      // Process transaction-specific logic if needed
      if (event.methodName === 'create_swap_order') {
        // Additional processing for swap order creation
        logger.debug('Detected swap order creation transaction', {
          transactionHash: event.transactionHash
        });
      }
    } catch (error) {
      ErrorHandler.handle(error as Error, 'NearRelayer.handleTransactionProcessed');
    }
  }

  // Message processors

  private async processDepositMessage(message: CrossChainMessage): Promise<void> {
    try {
      logger.info('Processing deposit message from Ethereum to NEAR', {
        messageId: message.messageId,
        sender: message.sender,
        recipient: message.recipient,
        amount: message.amount
      });

      // Create NEAR swap order
      await this.contractService.createSwapOrder({
        recipient: message.recipient,
        hashlock: message.data.secretHash || '',
        timelockDuration: message.data.timelock || 86400, // 24 hours default
        attachedDeposit: BigInt(message.amount)
      });

      logger.info('Deposit message processed successfully', {
        messageId: message.messageId
      });
    } catch (error) {
      throw ErrorHandler.handleAndRethrow(
        error as Error,
        'Failed to process deposit message',
        { messageId: message.messageId }
      );
    }
  }

  private async processWithdrawalMessage(message: CrossChainMessage): Promise<void> {
    try {
      logger.info('Processing withdrawal message', {
        messageId: message.messageId,
        recipient: message.recipient,
        amount: message.amount
      });

      // Find the corresponding NEAR escrow and complete it
      const secret = message.data.secret;
      if (!secret) {
        throw new RelayerError(
          'Missing secret for withdrawal message',
          'MISSING_SECRET',
          { messageId: message.messageId }
        );
      }

      // Calculate secret hash to find the order
      const secretHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(secret));
      
      // For now, we'll need to implement a way to find orders by secret hash
      // This is a simplified approach - in production, you'd want a more efficient lookup
      const orderId = await this.findOrderBySecretHash(secretHash);
      
      if (!orderId) {
        throw new RelayerError(
          'No matching NEAR order found for withdrawal',
          'ORDER_NOT_FOUND',
          { messageId: message.messageId, secretHash }
        );
      }

      // Complete the swap order
      await this.contractService.completeSwapOrder(orderId, secret);

      logger.info('Withdrawal message processed successfully', {
        messageId: message.messageId,
        orderId
      });
    } catch (error) {
      throw ErrorHandler.handleAndRethrow(
        error as Error,
        'Failed to process withdrawal message',
        { messageId: message.messageId }
      );
    }
  }

  private async processRefundMessage(message: CrossChainMessage): Promise<void> {
    try {
      logger.info('Processing refund message', {
        messageId: message.messageId,
        sender: message.sender,
        reason: (message as any).reason
      });

      // Find and refund the corresponding NEAR order
      // This is a simplified approach - in production, you'd want better order tracking
      const orderId = await this.findOrderByInitiator(message.sender);
      
      if (!orderId) {
        throw new RelayerError(
          'No matching NEAR order found for refund',
          'ORDER_NOT_FOUND',
          { messageId: message.messageId, initiator: message.sender }
        );
      }

      // Refund the swap order
      await this.contractService.refundSwapOrder(orderId);

      logger.info('Refund message processed successfully', {
        messageId: message.messageId,
        orderId
      });
    } catch (error) {
      throw ErrorHandler.handleAndRethrow(
        error as Error,
        'Failed to process refund message',
        { messageId: message.messageId }
      );
    }
  }

  // NEAR→Ethereum withdrawal processing

  private async processNearToEthereumWithdrawal(event: SwapOrderCreatedEvent): Promise<void> {
    try {
      logger.info('Processing NEAR→Ethereum withdrawal', {
        orderId: event.orderId,
        recipient: event.recipient,
        amount: event.amount
      });

      // Verify the NEAR transaction
      const isValid = await this.verifyNearTransaction(event.transactionHash, event.initiator);
      if (!isValid) {
        throw new RelayerError(
          `NEAR withdrawal transaction ${event.transactionHash} is not valid`,
          'INVALID_TRANSACTION',
          { transactionHash: event.transactionHash, orderId: event.orderId }
        );
      }

      // Calculate secret hash
      const secretHash = event.secretHash;

      // Find the corresponding Ethereum escrow
      const escrowAddress = await this.findEthereumEscrowBySecretHash(secretHash);
      if (!escrowAddress) {
        throw new RelayerError(
          `No Ethereum escrow found for secret hash ${secretHash}`,
          'ESCROW_NOT_FOUND',
          { secretHash, orderId: event.orderId }
        );
      }

      // Get the secret from the NEAR event (assuming it's available after order completion)
      // For now, we'll need to implement a way to get the secret from the NEAR transaction
      const secret = await this.extractSecretFromNearEvent(event);
      if (!secret) {
        throw new RelayerError(
          'Could not extract secret from NEAR event',
          'SECRET_EXTRACTION_FAILED',
          { orderId: event.orderId, transactionHash: event.transactionHash }
        );
      }

      // Execute withdrawal on Ethereum
      await this.executeEthereumWithdrawal(escrowAddress, secret, event.amount);

      logger.info('NEAR→Ethereum withdrawal processed successfully', {
        orderId: event.orderId,
        escrowAddress
      });
    } catch (error) {
      throw ErrorHandler.handleAndRethrow(
        error as Error,
        'Failed to process NEAR→Ethereum withdrawal',
        { orderId: event.orderId }
      );
    }
  }

  // Helper methods

  private async extractSecretFromNearEvent(event: SwapOrderCreatedEvent): Promise<string | null> {
    try {
      logger.debug('Attempting to extract secret from NEAR event', {
        orderId: event.orderId,
        eventType: 'SwapOrderCreated'
      });
      
      // For SwapOrderCreated events, we need to wait for the secret to be revealed
      // Try multiple approaches to get the secret:
      
      // 1. Check if the order has already been completed by querying contract state
      const completedSecret = await this.getSecretFromCompletedOrder(event.orderId);
      if (completedSecret) {
        logger.info('Found secret from completed order state', {
          orderId: event.orderId
        });
        return completedSecret;
      }
      
      // 2. Wait for a SwapOrderCompleted event (with timeout)
      const eventSecret = await this.waitForOrderCompletionEvent(event.orderId, 30000); // 30 second timeout
      if (eventSecret) {
        logger.info('Found secret from completion event', {
          orderId: event.orderId
        });
        return eventSecret;
      }
      
      // 3. Parse recent transactions for secret revelation
      const txSecret = await this.extractSecretFromTransactionLogs(event.orderId);
      if (txSecret) {
        logger.info('Found secret from transaction logs', {
          orderId: event.orderId
        });
        return txSecret;
      }
      
      logger.debug('No secret found for order', { orderId: event.orderId });
      return null;
    } catch (error) {
      logger.error('Failed to extract secret from NEAR event', {
        orderId: event.orderId,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Get secret from a completed order by querying contract state
   */
  private async getSecretFromCompletedOrder(orderId: string): Promise<string | null> {
    try {
      logger.debug('Querying NEAR contract for completed order secret', { orderId });
      
      // Get escrow details to check if order is completed
      const escrowDetails = await this.contractService.getEscrowDetails(orderId);
      
      if (!escrowDetails) {
        logger.debug('Order not found in contract state', { orderId });
        return null;
      }
      
      // Check if order is completed (status would indicate completion)
      if (escrowDetails.status !== 'completed' && escrowDetails.status !== 'filled') {
        logger.debug('Order not yet completed', { orderId, status: escrowDetails.status });
        return null;
      }
      
      // For completed orders, we might need to query transaction history
      // to find the secret that was used to complete the order
      return await this.findSecretInOrderHistory(orderId);
    } catch (error) {
      logger.error('Failed to get secret from completed order', {
        orderId,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Wait for a SwapOrderCompleted event for the given order ID
   */
  private async waitForOrderCompletionEvent(orderId: string, timeoutMs: number): Promise<string | null> {
    try {
      logger.debug('Waiting for order completion event', { orderId, timeoutMs });
      
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          logger.debug('Timeout waiting for order completion event', { orderId });
          resolve(null);
        }, timeoutMs);
        
        // Set up a temporary event handler for SwapOrderCompleted events
        const checkForCompletion = async () => {
          try {
            // Query recent blocks for SwapOrderCompleted events
            const completionEvent = await this.findRecentCompletionEvent(orderId);
            if (completionEvent && completionEvent.secret) {
              clearTimeout(timeout);
              logger.info('Found completion event with secret', {
                orderId,
                secret: '***redacted***'
              });
              resolve(completionEvent.secret);
              return;
            }
            
            // Continue checking every 2 seconds
            setTimeout(checkForCompletion, 2000);
          } catch (error) {
            logger.error('Error checking for completion event', {
              orderId,
              error: error instanceof Error ? error.message : String(error)
            });
            setTimeout(checkForCompletion, 2000);
          }
        };
        
        // Start checking
        checkForCompletion();
      });
    } catch (error) {
      logger.error('Failed to wait for order completion event', {
        orderId,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Extract secret from NEAR transaction logs
   */
  private async extractSecretFromTransactionLogs(orderId: string): Promise<string | null> {
    try {
      logger.debug('Extracting secret from transaction logs', { orderId });
      
      // Get recent blocks and search for transactions related to this order
      const currentBlock = await (this.config.nearAccount.connection.provider as any).block({ finality: 'final' });
      const currentHeight = currentBlock.header?.height || 0;
      const startBlock = Math.max(0, currentHeight - 100); // Search last 100 blocks
      
      for (let blockHeight = currentHeight; blockHeight >= startBlock; blockHeight--) {
        try {
          const block = await this.config.nearAccount.connection.provider.block({ blockId: blockHeight.toString() }) as any;
          
          for (const chunk of block.chunks) {
            const chunkDetails = await this.config.nearAccount.connection.provider.chunk(chunk.chunk_hash);
            
            for (const transaction of chunkDetails.transactions) {
              // Check if transaction is related to our escrow contract and order
              if (transaction.receiver_id === this.config.escrowContractId) {
                const secret = await this.parseTransactionForSecret(transaction.hash, orderId);
                if (secret) {
                  logger.info('Found secret in transaction logs', {
                    orderId,
                    transactionHash: transaction.hash
                  });
                  return secret;
                }
              }
            }
          }
        } catch (blockError) {
          logger.debug('Error processing block', {
            blockHeight,
            error: blockError instanceof Error ? blockError.message : String(blockError)
          });
          continue;
        }
      }
      
      logger.debug('No secret found in transaction logs', { orderId });
      return null;
    } catch (error) {
      logger.error('Failed to extract secret from transaction logs', {
        orderId,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Find secret in order completion history
   */
  private async findSecretInOrderHistory(orderId: string): Promise<string | null> {
    try {
      // This would query the NEAR contract for historical data about the order
      // For now, return null as this would require additional contract methods
      logger.debug('Searching order history for secret', { orderId });
      
      // TODO: Implement contract method to get order completion details including secret
      // This might involve calling a view method like get_order_completion_details(order_id)
      
      return null;
    } catch (error) {
      logger.error('Failed to find secret in order history', {
        orderId,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Find recent completion event for the given order
   */
  private async findRecentCompletionEvent(orderId: string): Promise<SwapOrderCompletedEvent | null> {
    try {
      // This would typically involve querying recent blocks for events
      // For now, return null as this requires integration with the event listener
      logger.debug('Searching for recent completion event', { orderId });
      
      // TODO: Implement event querying logic
      // This could involve:
      // 1. Querying recent blocks
      // 2. Parsing transaction receipts for events
      // 3. Filtering for SwapOrderCompleted events with matching order ID
      
      return null;
    } catch (error) {
      logger.error('Failed to find recent completion event', {
        orderId,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Parse a specific transaction for secret revelation
   */
  private async parseTransactionForSecret(txHash: string, orderId: string): Promise<string | null> {
    try {
      // Get transaction status and parse for secret
      const txStatus = await this.config.nearAccount.connection.provider.txStatus(txHash, this.config.nearAccount.accountId);
      
      // Look through transaction receipts for function calls that might contain the secret
      for (const receipt of txStatus.receipts_outcome) {
        if (receipt.outcome.logs) {
          for (const log of receipt.outcome.logs) {
            // Parse logs for secret revelation
            // Logs might contain JSON with order completion details
            try {
              const logData = JSON.parse(log);
              if (logData.event === 'order_completed' && logData.order_id === orderId && logData.secret) {
                return logData.secret;
              }
            } catch {
              // Not JSON, continue
              continue;
            }
          }
        }
        
        // Also check if the transaction action contains the secret
        // This would be in the function call arguments
        if (receipt.outcome.status && 'SuccessValue' in receipt.outcome.status) {
          // Parse function call arguments for secret
          // This is a simplified approach - in practice, you'd need to decode the action properly
        }
      }
      
      return null;
    } catch (error) {
      logger.debug('Failed to parse transaction for secret', {
        txHash,
        orderId,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  private async verifyNearTransaction(txHash: string, signerId: string): Promise<boolean> {
    try {
      this.validator.validateTransactionHash(txHash, 'NEAR');
      this.validator.validateNearAccountId(signerId);

      const txStatus = await this.config.nearAccount.connection.provider.txStatus(txHash, signerId);
      
      // Check if transaction was successful
      if (!txStatus.receipts_outcome) {
        return false;
      }

      for (const outcome of txStatus.receipts_outcome) {
        if (outcome.outcome.status && 'SuccessValue' in outcome.outcome.status) {
          return true;
        }
      }

      return false;
    } catch (error) {
      logger.error('Failed to verify NEAR transaction', {
        txHash,
        signerId,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  private async findEthereumEscrowBySecretHash(secretHash: string): Promise<string | null> {
    try {
      this.validator.validateSecretHash(secretHash);

      logger.debug('Finding Ethereum escrow by secret hash', { secretHash });
      
      // Use EthereumContractService to find escrow by secret hash
      const escrowDetails = await this.ethereumContractService.findEscrowBySecretHash(secretHash);
      
      if (escrowDetails && escrowDetails.escrowAddress) {
        logger.info('Found Ethereum escrow by secret hash', {
          secretHash,
          escrowAddress: escrowDetails.escrowAddress,
          amount: escrowDetails.amount,
          status: escrowDetails.status
        });
        return escrowDetails.escrowAddress;
      }
      
      logger.debug('No Ethereum escrow found for secret hash', { secretHash });
      return null;
    } catch (error) {
      logger.error('Failed to find Ethereum escrow by secret hash', {
        secretHash,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  private async executeEthereumWithdrawal(
    escrowAddress: string,
    secret: string,
    amount: string
  ): Promise<void> {
    try {
      this.validator.validateEthereumAddress(escrowAddress);
      this.validator.validateAmount(amount);

      if (!secret || typeof secret !== 'string') {
        throw ErrorHandler.createValidationError('secret', secret, 'Secret must be a non-empty string');
      }

      logger.info('Executing Ethereum withdrawal', {
        escrowAddress,
        amount
      });

      // Use EthereumContractService to execute withdrawal
      const receipt = await this.ethereumContractService.executeWithdrawal(escrowAddress, secret);
      
      logger.info('Ethereum withdrawal executed successfully', {
        escrowAddress,
        txHash: receipt.transactionHash,
        gasUsed: receipt.gasUsed.toString(),
        amount
      });
    } catch (error) {
      throw ErrorHandler.handleAndRethrow(
        error as Error,
        'Failed to execute Ethereum withdrawal',
        { escrowAddress, amount, secret: '***redacted***' }
      );
    }
  }

  /**
   * Create Ethereum escrow from NEAR order for NEAR→ETH transfer
   */
  private async createEthereumEscrowFromNearOrder(event: SwapOrderCreatedEvent): Promise<void> {
    try {
      logger.info('Creating Ethereum escrow from NEAR order', {
        orderId: event.orderId,
        recipient: event.recipient,
        amount: event.amount,
        secretHash: event.secretHash
      });

      // Get full order details from NEAR contract
      const orderDetails = await this.contractService.getEscrowDetails(event.orderId);
      if (!orderDetails) {
        throw new RelayerError(
          `Could not get order details for NEAR order ${event.orderId}`,
          'ORDER_DETAILS_NOT_FOUND',
          { orderId: event.orderId }
        );
      }

      // Convert NEAR amount to Wei (assuming 1:1 conversion for demo)
      // In production, you'd use proper exchange rates
      const amountInWei = ethers.utils.parseEther(ethers.utils.formatUnits(event.amount, 24)); // NEAR has 24 decimals

      // Prepare escrow immutables for createDstEscrow
      const immutables = [
        1, // chainId (example)
        ethers.constants.AddressZero, // token (ETH)
        event.recipient, // recipient
        amountInWei, // amount
        event.secretHash, // secretHash
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes('NEAR')), // srcChain
        orderDetails.timelock || Math.floor(Date.now() / 1000) + 3600, // timelock
        0, // srcCancellationTimestamp
        0, // dstCancellationTimestamp
        1, // status (active)
        0, // nonce
        0, // fee
        ethers.utils.formatBytes32String(''), // data1
        ethers.utils.formatBytes32String('') // data2
      ];

      // Create Ethereum escrow using factory
      const tx = await this.ethereumContractService.executeTransaction(
        this.config.ethereumEscrowFactoryAddress,
        'createDstEscrow',
        [immutables, 0] // immutables and srcCancellationTimestamp
      );

      const receipt = await tx.wait();
      
      // Extract escrow address from event logs
      let escrowAddress = '';
      for (const log of receipt.logs) {
        try {
          const parsed = this.ethereumContractService['factoryContract'].interface.parseLog(log);
          if (parsed.name === 'EscrowCreated') {
            escrowAddress = parsed.args.escrow;
            break;
          }
        } catch (e) {
          // Skip logs that don't match our interface
          continue;
        }
      }

      logger.info('Ethereum escrow created successfully from NEAR order', {
        orderId: event.orderId,
        escrowAddress,
        recipient: event.recipient,
        amount: amountInWei.toString(),
        secretHash: event.secretHash
      });

    } catch (error) {
      throw ErrorHandler.handleAndRethrow(
        error as Error,
        'Failed to create Ethereum escrow from NEAR order',
        { orderId: event.orderId }
      );
    }
  }

  /**
   * Verify that a corresponding Ethereum escrow exists for the given secret hash
   */
  private async verifyCorrespondingEthereumEscrow(secretHash: string, orderId: string): Promise<void> {
    try {
      this.validator.validateSecretHash(secretHash);

      logger.debug('Verifying corresponding Ethereum escrow exists', { secretHash, orderId });
      
      const escrowDetails = await this.ethereumContractService.findEscrowBySecretHash(secretHash);
      
      if (!escrowDetails || !escrowDetails.escrowAddress) {
        logger.warn('No corresponding Ethereum escrow found for NEAR order', {
          secretHash,
          orderId
        });
        return;
      }
      
      logger.info('Verified corresponding Ethereum escrow exists', {
        secretHash,
        orderId,
        escrowAddress: escrowDetails.escrowAddress,
        amount: escrowDetails.amount,
        status: escrowDetails.status
      });
    } catch (error) {
      logger.error('Failed to verify corresponding Ethereum escrow', {
        secretHash,
        orderId,
        error: error instanceof Error ? error.message : String(error)
      });
      // Don't throw here - this is just a verification step
    }
  }

  /**
   * Process NEAR→Ethereum withdrawal from a completed order event
   */
  private async processNearToEthereumWithdrawalFromCompletedOrder(
    event: SwapOrderCompletedEvent
  ): Promise<void> {
    try {
      logger.info('Processing NEAR→Ethereum withdrawal from completed order', {
        orderId: event.orderId,
        blockHeight: event.blockHeight
      });

      // Get the secret hash from the order details
      const orderDetails = await this.contractService.getEscrowDetails(event.orderId);
      if (!orderDetails || !orderDetails.secret_hash) {
        throw new RelayerError(
          `Could not get order details for completed order ${event.orderId}`,
          'ORDER_DETAILS_NOT_FOUND',
          { orderId: event.orderId }
        );
      }

      const secretHash = orderDetails.secret_hash;

      // Find the corresponding Ethereum escrow
      const escrowAddress = await this.findEthereumEscrowBySecretHash(secretHash);
      if (!escrowAddress) {
        throw new RelayerError(
          `No Ethereum escrow found for secret hash ${secretHash}`,
          'ESCROW_NOT_FOUND',
          { secretHash, orderId: event.orderId }
        );
      }

      // Use the secret from the completed event
      const secret = event.secret;
      if (!secret) {
        throw new RelayerError(
          'Secret not available in SwapOrderCompleted event',
          'SECRET_NOT_AVAILABLE',
          { orderId: event.orderId }
        );
      }

      // Execute withdrawal on Ethereum
      await this.executeEthereumWithdrawal(escrowAddress, secret, orderDetails.amount);

      logger.info('NEAR→Ethereum withdrawal from completed order processed successfully', {
        orderId: event.orderId,
        escrowAddress,
        secretHash
      });
    } catch (error) {
      throw ErrorHandler.handleAndRethrow(
        error as Error,
        'Failed to process NEAR→Ethereum withdrawal from completed order',
        { orderId: event.orderId }
      );
    }
  }

  private async findOrderBySecretHash(secretHash: string): Promise<string | null> {
    try {
      // This is a placeholder implementation
      // In production, you'd want to maintain an index of orders by secret hash
      logger.debug('Finding NEAR order by secret hash', { secretHash });
      return null;
    } catch (error) {
      logger.error('Failed to find order by secret hash', {
        secretHash,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  private async findOrderByInitiator(initiator: string): Promise<string | null> {
    try {
      this.validator.validateNearAccountId(initiator);
      
      // This is a placeholder implementation
      // In production, you'd want to maintain an index of orders by initiator
      logger.debug('Finding NEAR order by initiator', { initiator });
      return null;
    } catch (error) {
      logger.error('Failed to find order by initiator', {
        initiator,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  private async updateOrderStatus(orderId: string, status: string): Promise<void> {
    try {
      await this.contractService.updateEscrow(orderId, { status });
      logger.debug('Updated order status', { orderId, status });
    } catch (error) {
      // Don't throw - this is just for tracking
      logger.warn('Failed to update order status', {
        orderId,
        status,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // Private helper methods

  private validateConfig(config: NearRelayerConfig): void {
    if (!config) {
      throw ErrorHandler.createValidationError('config', config, 'Configuration is required');
    }

    if (!config.nearAccount) {
      throw ErrorHandler.createValidationError('config.nearAccount', config.nearAccount, 'NEAR account is required');
    }

    if (!config.ethereumSigner) {
      throw ErrorHandler.createValidationError('config.ethereumSigner', config.ethereumSigner, 'Ethereum signer is required');
    }

    if (!config.ethereumProvider) {
      throw ErrorHandler.createValidationError('config.ethereumProvider', config.ethereumProvider, 'Ethereum provider is required');
    }

    this.validator.validateEthereumAddress(config.ethereumEscrowFactoryAddress);
    this.validator.validateNearAccountId(config.escrowContractId);
  }
}
