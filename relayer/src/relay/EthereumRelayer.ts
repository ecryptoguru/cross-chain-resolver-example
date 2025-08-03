/**
 * Refactored Ethereum Relayer
 * Uses dependency injection and proper separation of concerns
 */

import { ethers } from 'ethers';
import { NearAccount, IMessageProcessor, DepositMessage, WithdrawalMessage, RefundMessage } from '../types/interfaces.js';
import { EthereumEventListener, EthereumEventHandlers, DepositInitiatedEvent, MessageSentEvent, WithdrawalCompletedEvent, EscrowCreatedEvent } from '../services/EthereumEventListener.js';
import { EthereumContractService } from '../services/EthereumContractService.js';
import { ValidationService } from '../services/ValidationService.js';
import { StorageService } from '../services/StorageService.js';
import { RelayerError, ErrorHandler } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { DynamicAuctionService, CrossChainAuctionParams } from '../services/DynamicAuctionService.js';

export interface EthereumRelayerConfig {
  provider: ethers.providers.JsonRpcProvider;
  signer: ethers.Signer;
  nearAccount: NearAccount;
  factoryAddress: string;
  bridgeAddress: string;
  pollIntervalMs?: number;
  storageDir?: string;
}

export class EthereumRelayer implements IMessageProcessor {
  private readonly config: EthereumRelayerConfig;
  private readonly eventListener: EthereumEventListener;
  private readonly contractService: EthereumContractService;
  private readonly validator: ValidationService;
  private readonly storage: StorageService;
  private readonly auctionService: DynamicAuctionService;
  private processedMessages: Set<string> = new Set();
  private isRunning = false;

  constructor(config: EthereumRelayerConfig) {
    this.config = config;

    // Initialize services first
    this.validator = new ValidationService();
    
    // Then validate config
    this.validateConfig(config);
    this.storage = new StorageService(config.storageDir, 'ethereum_processed_messages.json');
    this.auctionService = new DynamicAuctionService();
    this.contractService = new EthereumContractService(
      config.provider,
      config.signer,
      config.factoryAddress
    );

    // Set up event handlers
    const eventHandlers: EthereumEventHandlers = {
      onDepositInitiated: this.handleDepositInitiated.bind(this),
      onMessageSent: this.handleMessageSent.bind(this),
      onWithdrawalCompleted: this.handleWithdrawalCompleted.bind(this),
      onEscrowCreated: this.handleEscrowCreated.bind(this)
    };

    this.eventListener = new EthereumEventListener(
      config.provider,
      config.factoryAddress,
      config.bridgeAddress,
      eventHandlers,
      config.pollIntervalMs
    );
  }

  /**
   * Start the Ethereum relayer
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('EthereumRelayer is already running');
      return;
    }

    try {
      logger.info('Starting Ethereum relayer...');

      // Initialize storage
      await this.storage.initialize();

      // Start event listener
      await this.eventListener.start();

      this.isRunning = true;
      logger.info('Ethereum relayer started successfully');
    } catch (error) {
      throw ErrorHandler.handleAndRethrow(
        error as Error,
        'Failed to start Ethereum relayer'
      );
    }
  }

  /**
   * Stop the Ethereum relayer
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      logger.info('Stopping Ethereum relayer...');

      // Stop event listener
      await this.eventListener.stop();

      this.isRunning = false;
      logger.info('Ethereum relayer stopped successfully');
    } catch (error) {
      ErrorHandler.handle(error as Error, 'EthereumRelayer.stop');
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
  async processMessage(message: DepositMessage | WithdrawalMessage | RefundMessage): Promise<void> {
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
        case 'DEPOSIT':
          await this.processDepositMessage(message as DepositMessage);
          break;
        case 'WITHDRAWAL':
          await this.processWithdrawalMessage(message as WithdrawalMessage);
          break;
        case 'REFUND':
          await this.processRefundMessage(message as RefundMessage);
          break;
        default:
          throw new RelayerError(
            `Unknown message type: ${(message as any).type}`,
            'INVALID_MESSAGE_TYPE',
            { messageId: message.messageId, type: (message as any).type }
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

  private async handleDepositInitiated(event: DepositInitiatedEvent): Promise<void> {
    try {
      logger.info('Handling DepositInitiated event', {
        depositId: event.depositId,
        sender: event.sender,
        nearRecipient: event.nearRecipient,
        amount: ethers.utils.formatEther(event.amount),
        blockNumber: event.blockNumber
      });

      // Create NEAR escrow for ETH→NEAR cross-chain transfer
      // Generate consistent secret hash for cross-chain transfer
      const secretHash = ethers.utils.keccak256('0x' + event.depositId);
      
      await this.createNearEscrowFromEthOrder(
        event.sender,
        event.nearRecipient,
        event.amount.toString(),
        secretHash,
        event.depositId
      );

      logger.info('DepositInitiated event processed successfully', {
        depositId: event.depositId
      });
    } catch (error) {
      ErrorHandler.handle(error as Error, 'EthereumRelayer.handleDepositInitiated');
    }
  }

  private async handleMessageSent(event: MessageSentEvent): Promise<void> {
    try {
      logger.info('Handling MessageSent event', {
        messageId: event.messageId,
        targetChain: event.targetChain,
        targetAddress: event.targetAddress,
        blockNumber: event.blockNumber
      });

      // Process the cross-chain message if it's for NEAR
      if (event.targetChain.toLowerCase() === 'near') {
        // Decode and process the message data
        await this.processEncodedMessage(event.messageId, event.data);
      }

      logger.info('MessageSent event processed successfully', {
        messageId: event.messageId
      });
    } catch (error) {
      ErrorHandler.handle(error as Error, 'EthereumRelayer.handleMessageSent');
    }
  }

  private async handleWithdrawalCompleted(event: WithdrawalCompletedEvent): Promise<void> {
    try {
      logger.info('Handling WithdrawalCompleted event', {
        messageId: event.messageId,
        recipient: event.recipient,
        amount: ethers.utils.formatEther(event.amount),
        blockNumber: event.blockNumber
      });

      // Update NEAR escrow status or perform cleanup
      await this.updateNearEscrowStatus(event.messageId, 'completed');

      logger.info('WithdrawalCompleted event processed successfully', {
        messageId: event.messageId
      });
    } catch (error) {
      ErrorHandler.handle(error as Error, 'EthereumRelayer.handleWithdrawalCompleted');
    }
  }

  private async handleEscrowCreated(event: EscrowCreatedEvent): Promise<void> {
    try {
      logger.info('Handling EscrowCreated event', {
        escrow: event.escrow,
        initiator: event.initiator,
        amount: ethers.utils.formatEther(event.amount),
        targetChain: event.targetChain,
        blockNumber: event.blockNumber
      });

      // Process escrow creation if it's for cross-chain swap
      if (event.targetChain.toLowerCase() === 'near') {
        await this.processEscrowForNearSwap(event);
      }

      logger.info('EscrowCreated event processed successfully', {
        escrow: event.escrow
      });
    } catch (error) {
      ErrorHandler.handle(error as Error, 'EthereumRelayer.handleEscrowCreated');
    }
  }

  // Message processors

  private async processDepositMessage(message: DepositMessage): Promise<void> {
    try {
      logger.info('Processing deposit message', {
        messageId: message.messageId,
        sender: message.sender,
        recipient: message.recipient,
        amount: message.amount
      });

      // Create escrow on Ethereum side
      // Implementation depends on specific bridge contract
      // This is a placeholder for the actual implementation
      
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

  private async processWithdrawalMessage(message: WithdrawalMessage): Promise<void> {
    try {
      logger.info('Processing withdrawal message', {
        messageId: message.messageId,
        recipient: message.recipient,
        amount: message.amount
      });

      // Find and execute withdrawal on Ethereum escrow
      const escrow = await this.contractService.findEscrowByParams({
        secretHash: ethers.utils.keccak256(ethers.utils.toUtf8Bytes(message.secret))
      });

      if (!escrow) {
        throw new RelayerError(
          'No matching escrow found for withdrawal',
          'ESCROW_NOT_FOUND',
          { messageId: message.messageId, secretHash: '***redacted***' }
        );
      }

      // Execute withdrawal
      await this.contractService.executeWithdrawal(escrow.escrowAddress!, message.secret);

      logger.info('Withdrawal message processed successfully', {
        messageId: message.messageId,
        escrowAddress: escrow.escrowAddress
      });
    } catch (error) {
      throw ErrorHandler.handleAndRethrow(
        error as Error,
        'Failed to process withdrawal message',
        { messageId: message.messageId }
      );
    }
  }

  private async processRefundMessage(message: RefundMessage): Promise<void> {
    try {
      logger.info('Processing refund message', {
        messageId: message.messageId,
        sender: message.sender,
        reason: message.reason
      });

      // Find and execute refund on Ethereum escrow
      const escrow = await this.contractService.findEscrowByParams({
        initiator: message.sender
      });

      if (!escrow) {
        throw new RelayerError(
          'No matching escrow found for refund',
          'ESCROW_NOT_FOUND',
          { messageId: message.messageId, initiator: message.sender }
        );
      }

      // Execute refund
      await this.contractService.executeRefund(escrow.escrowAddress!);

      logger.info('Refund message processed successfully', {
        messageId: message.messageId,
        escrowAddress: escrow.escrowAddress
      });
    } catch (error) {
      throw ErrorHandler.handleAndRethrow(
        error as Error,
        'Failed to process refund message',
        { messageId: message.messageId }
      );
    }
  }

  // NEAR integration methods

  /**
   * Create NEAR escrow for ETH→NEAR cross-chain transfer
   * Relayer provides NEAR liquidity based on ETH amount and exchange rate
   */
  private async createNearEscrowFromEthOrder(
    ethereumSender: string,
    nearRecipient: string,
    ethAmount: string,
    secretHash: string,
    orderId: string
  ): Promise<void> {
    try {
      this.validator.validateEthereumAddress(ethereumSender);
      this.validator.validateNearAccountId(nearRecipient);
      this.validator.validateAmount(ethAmount);

      // ETH→NEAR Cross-chain transfer: Dynamic auction pricing
      // User locked ETH tokens, relayer provides NEAR liquidity based on auction
      const ethAmountWei = ethers.BigNumber.from(ethAmount);
      
      // Create auction parameters
      const auctionParams: CrossChainAuctionParams = {
        fromChain: 'ETH',
        toChain: 'NEAR',
        fromAmount: ethAmount,
        baseExchangeRate: 1000, // Base rate: 1 ETH = 1000 NEAR
        startTime: Math.floor(Date.now() / 1000),
        orderId: orderId
      };
      
      // Calculate current auction rate and amounts
      const auctionResult = this.auctionService.calculateCurrentRate(auctionParams);
      const nearAmountYocto = ethers.BigNumber.from(auctionResult.outputAmount);
      const feeAmount = ethers.BigNumber.from(auctionResult.feeAmount);
      const totalNearValue = ethers.BigNumber.from(auctionResult.totalCost);
      
      logger.info('Dynamic auction pricing applied for ETH→NEAR', {
        ethAmount: ethers.utils.formatEther(ethAmountWei),
        currentRate: auctionResult.currentRate,
        nearAmount: ethers.utils.formatUnits(nearAmountYocto, 24),
        feeAmount: ethers.utils.formatUnits(feeAmount, 24),
        totalCost: ethers.utils.formatUnits(totalNearValue, 24),
        timeRemaining: auctionResult.timeRemaining,
        orderId: orderId
      });

      // Call NEAR contract to create escrow with relayer's NEAR liquidity
      const result = await this.config.nearAccount.functionCall({
        contractId: process.env.NEAR_ESCROW_CONTRACT_ID!,
        methodName: 'create_swap_order',
        args: {
          recipient: nearRecipient,
          hashlock: secretHash, // Use consistent secret hash
          timelock_duration: 86400, // 24 hours
          eth_sender: ethereumSender, // Track original ETH sender
          order_id: orderId // Cross-reference with ETH order
        },
        gas: BigInt('30000000000000'), // 30 TGas
        attachedDeposit: nearAmountYocto.toBigInt() // Relayer provides NEAR liquidity
      });

      logger.info('NEAR escrow created successfully for ETH→NEAR transfer', {
        ethereumSender,
        nearRecipient,
        ethAmount: ethers.utils.formatEther(ethAmountWei),
        nearAmount: ethers.utils.formatUnits(nearAmountYocto, 24),
        orderId,
        result
      });
    } catch (error) {
      throw ErrorHandler.handleAndRethrow(
        error as Error,
        'Failed to create NEAR escrow for ETH→NEAR transfer',
        { ethereumSender, nearRecipient, ethAmount, orderId }
      );
    }
  }

  private async processEncodedMessage(messageId: string, encodedData: string): Promise<void> {
    try {
      // Decode the message data (implementation depends on encoding format)
      // This is a placeholder for the actual decoding logic
      logger.debug('Processing encoded message', { messageId, encodedData });
    } catch (error) {
      throw ErrorHandler.handleAndRethrow(
        error as Error,
        'Failed to process encoded message',
        { messageId }
      );
    }
  }

  private async updateNearEscrowStatus(messageId: string, status: string): Promise<void> {
    try {
      // Update NEAR escrow status
      // This is a placeholder for the actual implementation
      logger.debug('Updating NEAR escrow status', { messageId, status });
    } catch (error) {
      throw ErrorHandler.handleAndRethrow(
        error as Error,
        'Failed to update NEAR escrow status',
        { messageId, status }
      );
    }
  }

  /**
   * Process Ethereum escrow creation for ETH→NEAR cross-chain transfer
   * Relayer detects ETH escrow and creates corresponding NEAR escrow with liquidity
   */
  private async processEscrowForNearSwap(event: EscrowCreatedEvent): Promise<void> {
    try {
      logger.info('Processing ETH escrow for NEAR swap', {
        escrow: event.escrow,
        initiator: event.initiator,
        amount: ethers.utils.formatEther(event.amount),
        targetChain: event.targetChain,
        targetAddress: event.targetAddress
      });

      // Validate this is a NEAR-targeted escrow
      if (event.targetChain.toLowerCase() !== 'near') {
        logger.debug('Skipping non-NEAR escrow', { targetChain: event.targetChain });
        return;
      }

      // Generate consistent secret hash for cross-chain transfer
      // Use escrow address as unique identifier for the transfer
      const secretHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(event.escrow));
      
      // Create NEAR escrow with relayer's NEAR liquidity
      await this.createNearEscrowFromEthOrder(
        event.initiator, // ETH sender
        event.targetAddress, // NEAR recipient
        event.amount.toString(), // ETH amount locked
        secretHash, // Consistent secret hash
        event.escrow // Use escrow address as order ID
      );

      logger.info('ETH→NEAR cross-chain transfer processed successfully', {
        ethEscrow: event.escrow,
        ethAmount: ethers.utils.formatEther(event.amount),
        nearRecipient: event.targetAddress
      });
    } catch (error) {
      throw ErrorHandler.handleAndRethrow(
        error as Error,
        'Failed to process ETH escrow for NEAR swap',
        { escrow: event.escrow, targetAddress: event.targetAddress }
      );
    }
  }

  // Private helper methods

  private validateConfig(config: EthereumRelayerConfig): void {
    if (!config) {
      throw ErrorHandler.createValidationError('config', config, 'Configuration is required');
    }

    if (!config.provider) {
      throw ErrorHandler.createValidationError('config.provider', config.provider, 'Provider is required');
    }

    if (!config.signer) {
      throw ErrorHandler.createValidationError('config.signer', config.signer, 'Signer is required');
    }

    if (!config.nearAccount) {
      throw ErrorHandler.createValidationError('config.nearAccount', config.nearAccount, 'NEAR account is required');
    }

    this.validator.validateEthereumAddress(config.factoryAddress);
    this.validator.validateEthereumAddress(config.bridgeAddress);
  }
}
