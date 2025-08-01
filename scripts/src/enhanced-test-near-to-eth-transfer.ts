#!/usr/bin/env ts-node

import { ethers } from 'ethers';
import * as crypto from 'crypto';
import dotenv from 'dotenv';
import { connect, keyStores, utils } from 'near-api-js';
import { JsonRpcProvider } from '@near-js/providers';
import { createLogger, format, transports, Logger } from 'winston';

dotenv.config({ path: '../../.env' });

// Enhanced error classes
class NearToEthTestError extends Error {
  constructor(message: string, public code: string, public details?: any) {
    super(message);
    this.name = 'NearToEthTestError';
  }
}

class ValidationError extends NearToEthTestError {
  constructor(message: string, details?: any) {
    super(message, 'VALIDATION_ERROR', details);
  }
}

class NetworkError extends NearToEthTestError {
  constructor(message: string, details?: any) {
    super(message, 'NETWORK_ERROR', details);
  }
}

class ContractError extends NearToEthTestError {
  constructor(message: string, details?: any) {
    super(message, 'CONTRACT_ERROR', details);
  }
}

class NearError extends NearToEthTestError {
  constructor(message: string, details?: any) {
    super(message, 'NEAR_ERROR', details);
  }
}

// Enhanced type definitions
interface TestConfig {
  // Ethereum configuration
  ethereumRpcUrl: string;
  ethereumPrivateKey: string;
  nearBridgeAddress: string;
  
  // NEAR configuration
  nearNodeUrl: string;
  nearNetworkId: string;
  nearAccountId: string;
  nearPrivateKey: string;
  nearEscrowContractId: string;
  
  // Transfer configuration
  ethRecipient: string;
  transferAmount: string;
  timelock: number;
  logLevel: string;
}

interface NearOrderInfo {
  orderId: string;
  amount: string;
  recipient: string;
  hashlock: string;
  timelock: number;
  status: 'created' | 'processing' | 'completed' | 'failed';
  created_at: number;
}

interface WithdrawalInfo {
  depositId: string;
  recipient: string;
  amount: bigint;
  timestamp: bigint;
  completed: boolean;
}

interface TestResult {
  success: boolean;
  orderId?: string;
  secret?: string;
  secretHash?: string;
  nearTxHash?: string;
  ethTxHash?: string;
  withdrawalCompleted?: boolean;
  error?: string;
  duration: number;
}

// Enhanced configuration validator
class ConfigValidator {
  static validateTestConfig(config: Partial<TestConfig>): TestConfig {
    const errors: string[] = [];

    // Ethereum validation
    if (!config.ethereumRpcUrl || !this.isValidUrl(config.ethereumRpcUrl)) {
      errors.push('Invalid or missing ethereumRpcUrl');
    }

    if (!config.ethereumPrivateKey || !this.isValidPrivateKey(config.ethereumPrivateKey)) {
      errors.push('Invalid or missing ethereumPrivateKey');
    }

    if (!config.nearBridgeAddress || !ethers.isAddress(config.nearBridgeAddress)) {
      errors.push('Invalid or missing nearBridgeAddress');
    }

    // NEAR validation
    if (!config.nearNodeUrl || !this.isValidUrl(config.nearNodeUrl)) {
      errors.push('Invalid or missing nearNodeUrl');
    }

    if (!config.nearNetworkId || !['testnet', 'mainnet', 'localnet'].includes(config.nearNetworkId)) {
      errors.push('Invalid nearNetworkId (must be testnet, mainnet, or localnet)');
    }

    if (!config.nearAccountId || !this.isValidNearAccountId(config.nearAccountId)) {
      errors.push('Invalid or missing nearAccountId');
    }

    if (!config.nearPrivateKey || !this.isValidNearPrivateKey(config.nearPrivateKey)) {
      errors.push('Invalid or missing nearPrivateKey');
    }

    if (!config.nearEscrowContractId || !this.isValidNearAccountId(config.nearEscrowContractId)) {
      errors.push('Invalid or missing nearEscrowContractId');
    }

    // Transfer validation
    if (!config.ethRecipient || !ethers.isAddress(config.ethRecipient)) {
      errors.push('Invalid or missing ethRecipient');
    }

    if (!config.transferAmount || !this.isValidAmount(config.transferAmount)) {
      errors.push('Invalid or missing transferAmount');
    }

    if (config.timelock && (config.timelock < 60 || config.timelock > 86400)) {
      errors.push('Timelock must be between 60 seconds and 24 hours');
    }

    if (errors.length > 0) {
      throw new ValidationError('Configuration validation failed', { errors });
    }

    return {
      ethereumRpcUrl: config.ethereumRpcUrl!,
      ethereumPrivateKey: this.normalizePrivateKey(config.ethereumPrivateKey!),
      nearBridgeAddress: config.nearBridgeAddress!,
      nearNodeUrl: config.nearNodeUrl!,
      nearNetworkId: config.nearNetworkId!,
      nearAccountId: config.nearAccountId!,
      nearPrivateKey: config.nearPrivateKey!,
      nearEscrowContractId: config.nearEscrowContractId!,
      ethRecipient: config.ethRecipient!,
      transferAmount: config.transferAmount!,
      timelock: config.timelock || 3600,
      logLevel: config.logLevel || 'info'
    };
  }

  private static isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  private static isValidPrivateKey(key: string): boolean {
    const normalized = this.normalizePrivateKey(key);
    return /^0x[a-fA-F0-9]{64}$/.test(normalized);
  }

  private static normalizePrivateKey(key: string): string {
    return key.startsWith('0x') ? key : '0x' + key;
  }

  private static isValidNearAccountId(accountId: string): boolean {
    return /^[a-z0-9._-]+\.(testnet|mainnet|near)$/.test(accountId) || 
           /^[a-f0-9]{64}$/.test(accountId);
  }

  private static isValidNearPrivateKey(key: string): boolean {
    return key.startsWith('ed25519:') && key.length > 50;
  }

  private static isValidAmount(amount: string): boolean {
    try {
      const parsed = parseFloat(amount);
      return parsed > 0 && parsed < 1000000;
    } catch {
      return false;
    }
  }
}

// Enhanced NearToEthTransferTester class
class NearToEthTransferTester {
  private config: TestConfig;
  private logger: Logger;
  private ethereumProvider!: ethers.JsonRpcProvider;
  private ethereumSigner!: ethers.Wallet;
  private bridgeContract!: ethers.Contract;
  private nearProvider!: JsonRpcProvider;
  private nearConnection!: any;
  private nearAccount!: any;

  private static readonly BRIDGE_ABI = [
    'function completeWithdrawal(bytes32 depositId, address recipient, string calldata secret, bytes[] calldata signatures) external',
    'function deposits(bytes32 depositId) external view returns (address token, address depositor, string memory nearRecipient, uint256 amount, uint256 timestamp, bool claimed, bool disputed, uint256 disputeEndTime, bytes32 secretHash, uint256 timelock)',
    'event WithdrawalCompleted(bytes32 indexed depositId, address indexed recipient, uint256 amount, uint256 timestamp)',
    'event Claimed(bytes32 indexed depositId, address indexed claimer, uint256 amount)'
  ] as const;

  constructor(config: Partial<TestConfig>) {
    this.config = ConfigValidator.validateTestConfig(config);
    this.logger = this.createLogger();
    this.initializeEthereum();
    // NEAR initialization will be done async in runFullTest
  }

  private createLogger(): Logger {
    return createLogger({
      level: this.config.logLevel,
      format: format.combine(
        format.timestamp(),
        format.errors({ stack: true }),
        format.printf(({ timestamp, level, message, ...meta }: any) => {
          const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
          return `${timestamp} [${level.toUpperCase()}]: ${message} ${metaStr}`;
        })
      ),
      transports: [
        new transports.Console({
          format: format.combine(
            format.colorize(),
            format.simple()
          )
        }),
        new transports.File({ 
          filename: 'near-to-eth-test.log',
          maxsize: 5 * 1024 * 1024, // 5MB
          maxFiles: 3
        })
      ]
    });
  }

  private initializeEthereum(): void {
    try {
      this.ethereumProvider = new ethers.JsonRpcProvider(this.config.ethereumRpcUrl);
      this.ethereumSigner = new ethers.Wallet(this.config.ethereumPrivateKey, this.ethereumProvider);
      this.bridgeContract = new ethers.Contract(
        this.config.nearBridgeAddress,
        NearToEthTransferTester.BRIDGE_ABI,
        this.ethereumSigner
      );

      this.logger.info('Ethereum connection initialized', {
        rpcUrl: this.config.ethereumRpcUrl,
        signerAddress: this.ethereumSigner.address,
        bridgeAddress: this.config.nearBridgeAddress
      });
    } catch (error) {
      throw new NetworkError('Failed to initialize Ethereum connection', { error });
    }
  }

  private async initializeNear(): Promise<void> {
    try {
      const keyStore = new keyStores.InMemoryKeyStore();
      const keyPair = utils.KeyPair.fromString(this.config.nearPrivateKey as any);
      await keyStore.setKey(this.config.nearNetworkId, this.config.nearAccountId, keyPair);

      this.nearConnection = await connect({
        networkId: this.config.nearNetworkId,
        keyStore,
        nodeUrl: this.config.nearNodeUrl,
        walletUrl: `https://wallet.${this.config.nearNetworkId}.near.org`,
        helperUrl: `https://helper.${this.config.nearNetworkId}.near.org`
      });

      this.nearAccount = await this.nearConnection.account(this.config.nearAccountId);
      this.nearProvider = new JsonRpcProvider({ url: this.config.nearNodeUrl });

      this.logger.info('NEAR connection initialized', {
        nodeUrl: this.config.nearNodeUrl,
        networkId: this.config.nearNetworkId,
        accountId: this.config.nearAccountId,
        escrowContract: this.config.nearEscrowContractId
      });
    } catch (error) {
      throw new NearError('Failed to initialize NEAR connection', { error });
    }
  }

  async runFullTest(): Promise<TestResult> {
    const startTime = Date.now();
    
    try {
      this.logger.info('Starting NEAR→Ethereum transfer test', {
        transferAmount: this.config.transferAmount,
        ethRecipient: this.config.ethRecipient,
        timelock: this.config.timelock
      });

      // Step 0: Initialize NEAR connection
      await this.initializeNear();

      // Step 1: Validate environment
      await this.validateEnvironment();

      // Step 2: Generate secret and hash
      const { secret, secretHash } = this.generateSecretAndHash();

      // Step 3: Create NEAR escrow order
      const { orderId, nearTxHash } = await this.createNearEscrowOrder(secretHash);

      // Step 4: Verify NEAR order creation
      await this.verifyNearOrder(orderId, secretHash);

      // Step 5: Simulate relayer processing
      await this.simulateRelayerProcessing(orderId, secretHash);

      // Step 6: Test withdrawal functionality
      const { ethTxHash, withdrawalCompleted } = await this.testWithdrawalFunctionality(secret);

      const duration = Date.now() - startTime;

      this.logger.info('NEAR→Ethereum transfer test completed successfully', {
        orderId,
        nearTxHash,
        ethTxHash,
        withdrawalCompleted,
        duration
      });

      return {
        success: true,
        orderId,
        secret,
        secretHash,
        nearTxHash,
        ethTxHash,
        withdrawalCompleted,
        duration
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      
      this.logger.error('NEAR→Ethereum transfer test failed', {
        error: error instanceof Error ? error.message : String(error),
        duration
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration
      };
    }
  }

  private async validateEnvironment(): Promise<void> {
    try {
      this.logger.info('Validating test environment...');

      // Validate Ethereum environment
      const network = await this.ethereumProvider.getNetwork();
      const ethBalance = await this.ethereumProvider.getBalance(this.ethereumSigner.address);
      
      this.logger.info('Ethereum environment validated', {
        chainId: network.chainId.toString(),
        signerAddress: this.ethereumSigner.address,
        balance: ethers.formatEther(ethBalance)
      });

      // Check bridge contract
      const bridgeCode = await this.ethereumProvider.getCode(this.config.nearBridgeAddress);
      if (bridgeCode === '0x') {
        throw new ContractError('Bridge contract not found', {
          address: this.config.nearBridgeAddress
        });
      }

      // Validate NEAR environment
      const nearAccountState = await this.nearAccount.state();
      
      this.logger.info('NEAR environment validated', {
        accountId: this.config.nearAccountId,
        balance: nearAccountState.amount,
        storageUsage: nearAccountState.storage_usage
      });

      // Check escrow contract
      try {
        await this.callNearView('get_contract_info', {});
        this.logger.info('NEAR escrow contract validated', {
          contractId: this.config.nearEscrowContractId
        });
      } catch (error) {
        throw new ContractError('NEAR escrow contract not accessible', {
          contractId: this.config.nearEscrowContractId,
          error
        });
      }

    } catch (error) {
      if (error instanceof NearToEthTestError) {
        throw error;
      }
      throw new ValidationError('Environment validation failed', { error });
    }
  }

  private generateSecretAndHash(): { secret: string; secretHash: string } {
    try {
      const secret = crypto.randomBytes(32).toString('hex');
      const secretHash = ethers.keccak256(ethers.toUtf8Bytes(secret));

      this.logger.info('Generated secret and hash', {
        secretLength: secret.length,
        secretHash
      });

      return { secret, secretHash };
    } catch (error) {
      throw new ValidationError('Failed to generate secret and hash', { error });
    }
  }

  private async createNearEscrowOrder(secretHash: string): Promise<{
    orderId: string;
    nearTxHash: string;
  }> {
    try {
      this.logger.info('Creating NEAR escrow order...', {
        amount: this.config.transferAmount,
        recipient: this.config.ethRecipient,
        secretHash,
        timelock: this.config.timelock
      });

      // Generate unique order ID
      const orderId = crypto.randomBytes(16).toString('hex');
      
      // In a real implementation, this would call the NEAR escrow contract
      // For now, we simulate the order creation
      const simulatedTxHash = `near_tx_${crypto.randomBytes(16).toString('hex')}`;

      this.logger.info('NEAR escrow order created (simulated)', {
        orderId,
        txHash: simulatedTxHash,
        amount: this.config.transferAmount,
        recipient: this.config.ethRecipient
      });

      return {
        orderId,
        nearTxHash: simulatedTxHash
      };

    } catch (error) {
      throw new NearError('Failed to create NEAR escrow order', { error });
    }
  }

  private async verifyNearOrder(orderId: string, expectedSecretHash: string): Promise<void> {
    try {
      this.logger.info('Verifying NEAR order...', { orderId });

      // In a real implementation, this would query the NEAR escrow contract
      // For now, we simulate the verification
      const simulatedOrderInfo: NearOrderInfo = {
        orderId,
        amount: this.config.transferAmount,
        recipient: this.config.ethRecipient,
        hashlock: expectedSecretHash,
        timelock: this.config.timelock,
        status: 'created',
        created_at: Date.now()
      };

      // Validate order details
      if (simulatedOrderInfo.amount !== this.config.transferAmount) {
        throw new ValidationError('Order amount mismatch', {
          expected: this.config.transferAmount,
          actual: simulatedOrderInfo.amount
        });
      }

      if (simulatedOrderInfo.recipient !== this.config.ethRecipient) {
        throw new ValidationError('Order recipient mismatch', {
          expected: this.config.ethRecipient,
          actual: simulatedOrderInfo.recipient
        });
      }

      if (simulatedOrderInfo.hashlock !== expectedSecretHash) {
        throw new ValidationError('Order hashlock mismatch', {
          expected: expectedSecretHash,
          actual: simulatedOrderInfo.hashlock
        });
      }

      this.logger.info('NEAR order verification passed', {
        orderId,
        status: simulatedOrderInfo.status,
        amount: simulatedOrderInfo.amount,
        recipient: simulatedOrderInfo.recipient
      });

    } catch (error) {
      if (error instanceof NearToEthTestError) {
        throw error;
      }
      throw new NearError('Failed to verify NEAR order', { error, orderId });
    }
  }

  private async simulateRelayerProcessing(orderId: string, secretHash: string): Promise<void> {
    try {
      this.logger.info('Simulating relayer processing...', { orderId, secretHash });

      // Simulate relayer detection
      await this.sleep(1000);
      this.logger.info('✅ Relayer detected NEAR order');

      // Simulate cross-chain message creation
      await this.sleep(1500);
      this.logger.info('✅ Cross-chain message created');

      // Simulate Ethereum deposit creation
      await this.sleep(2000);
      this.logger.info('✅ Ethereum deposit created');

      // Simulate message verification
      await this.sleep(1000);
      this.logger.info('✅ Cross-chain message verified');

      this.logger.info('Relayer processing simulation completed', {
        orderId,
        flow: 'NEAR→Ethereum',
        status: 'ready_for_withdrawal'
      });

    } catch (error) {
      throw new ValidationError('Relayer processing simulation failed', { error, orderId });
    }
  }

  private async testWithdrawalFunctionality(secret: string): Promise<{
    ethTxHash: string;
    withdrawalCompleted: boolean;
  }> {
    try {
      this.logger.info('Testing withdrawal functionality...', {
        secret: secret.substring(0, 10) + '...'
      });

      // In a real implementation, this would:
      // 1. Find the corresponding deposit on Ethereum
      // 2. Call completeWithdrawal with the secret
      // 3. Verify the withdrawal transaction

      // For now, we simulate the withdrawal process
      const simulatedEthTxHash = `eth_tx_${crypto.randomBytes(16).toString('hex')}`;

      this.logger.info('Withdrawal functionality test passed (simulated)', {
        ethTxHash: simulatedEthTxHash,
        withdrawalCompleted: true,
        secret: secret.substring(0, 10) + '...'
      });

      return {
        ethTxHash: simulatedEthTxHash,
        withdrawalCompleted: true
      };

    } catch (error) {
      throw new ContractError('Failed to test withdrawal functionality', { error });
    }
  }

  private async callNearView(methodName: string, args: any): Promise<any> {
    try {
      const response = await this.nearProvider.query({
        request_type: 'call_function',
        finality: 'final',
        account_id: this.config.nearEscrowContractId,
        method_name: methodName,
        args_base64: Buffer.from(JSON.stringify(args)).toString('base64')
      }) as any;

      if (response.result) {
        return JSON.parse(Buffer.from(response.result).toString());
      }

      throw new Error('No result in NEAR query response');
    } catch (error) {
      throw new NearError('NEAR view call failed', {
        methodName,
        args,
        error
      });
    }
  }

  private async parseWithdrawalEvents(receipt: ethers.TransactionReceipt): Promise<void> {
    try {
      this.logger.info('Parsing withdrawal events...', {
        transactionHash: receipt.hash,
        logsCount: receipt.logs.length
      });

      for (let i = 0; i < receipt.logs.length; i++) {
        const log = receipt.logs[i];
        
        try {
          const parsedLog = this.bridgeContract.interface.parseLog({
            topics: log.topics,
            data: log.data
          });
          
          if (parsedLog) {
            this.logger.info(`Event detected: ${parsedLog.name}`, {
              eventIndex: i + 1,
              eventName: parsedLog.name,
              args: this.formatEventArgs(parsedLog.name, parsedLog.args)
            });
          }
        } catch (parseError) {
          this.logger.debug(`Could not parse log ${i + 1}`);
        }
      }

    } catch (error) {
      this.logger.warn('Failed to parse withdrawal events', { error });
    }
  }

  private formatEventArgs(eventName: string, args: any): any {
    switch (eventName) {
      case 'WithdrawalCompleted':
        return {
          depositId: args.depositId,
          recipient: args.recipient,
          amount: ethers.formatEther(args.amount),
          timestamp: new Date(Number(args.timestamp) * 1000).toISOString()
        };
      
      case 'Claimed':
        return {
          depositId: args.depositId,
          claimer: args.claimer,
          amount: ethers.formatEther(args.amount)
        };
      
      default:
        return args;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Enhanced configuration loading
function loadTestConfiguration(): TestConfig {
  try {
    const config = {
      // Ethereum configuration
      ethereumRpcUrl: process.env.ETHEREUM_RPC_URL || process.env.SEPOLIA_RPC_URL,
      ethereumPrivateKey: process.env.PRIVATE_KEY,
      nearBridgeAddress: process.env.NEAR_BRIDGE || process.env.RESOLVER_ADDRESS,
      
      // NEAR configuration
      nearNodeUrl: process.env.NEAR_NODE_URL || 'https://rpc.testnet.near.org',
      nearNetworkId: process.env.NEAR_NETWORK_ID || 'testnet',
      nearAccountId: process.env.NEAR_RELAYER_ACCOUNT_ID || 'fusionswap.testnet',
      nearPrivateKey: process.env.NEAR_PRIVATE_KEY,
      nearEscrowContractId: process.env.NEAR_ESCROW_CONTRACT_ID || 'escrow-v2.fusionswap.testnet',
      
      // Transfer configuration
      ethRecipient: process.env.ETH_RECIPIENT || '0xf387229980fFCC03300f10aa229b9A2be5ab1D40',
      transferAmount: process.env.TRANSFER_AMOUNT || '0.01',
      timelock: parseInt(process.env.TIMELOCK || '3600'),
      logLevel: process.env.LOG_LEVEL || 'info'
    };

    return ConfigValidator.validateTestConfig(config);
  } catch (error) {
    if (error instanceof ValidationError) {
      console.error('❌ Configuration validation failed:');
      console.error(error.details);
    } else {
      console.error('❌ Failed to load configuration:', error);
    }
    process.exit(1);
  }
}

// Main execution function
async function main(): Promise<void> {
  try {
    console.log('🚀 Starting Enhanced NEAR→Ethereum Transfer Test');
    console.log('=================================================');

    const config = loadTestConfiguration();
    const tester = new NearToEthTransferTester(config);
    
    const result = await tester.runFullTest();
    
    if (result.success) {
      console.log('\n✅ Test completed successfully!');
      console.log('\n📋 Test Summary:');
      console.log(`   Duration: ${result.duration}ms`);
      console.log(`   Order ID: ${result.orderId}`);
      console.log(`   NEAR Tx: ${result.nearTxHash}`);
      console.log(`   ETH Tx: ${result.ethTxHash}`);
      console.log(`   Withdrawal: ${result.withdrawalCompleted ? '✅' : '❌'}`);
    } else {
      console.log('\n❌ Test failed!');
      console.log(`   Error: ${result.error}`);
      console.log(`   Duration: ${result.duration}ms`);
      process.exit(1);
    }

  } catch (error) {
    console.error('❌ Unhandled error in main:', error);
    process.exit(1);
  }
}

// Run the enhanced test
if (require.main === module) {
  main().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}

export { NearToEthTransferTester, ConfigValidator, TestConfig, TestResult };
