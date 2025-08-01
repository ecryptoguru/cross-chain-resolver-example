import * as dotenv from 'dotenv';
import { ethers, providers, Wallet } from 'ethers';
import { Account } from '@near-js/accounts';
import { JsonRpcProvider, Provider } from '@near-js/providers';
import { KeyPairSigner } from '@near-js/signers';
import { EthereumRelayer } from './relay/EthereumRelayer.js';
import { NearRelayer } from './relay/NearRelayer.js';
import { logger } from './utils/logger.js';

// Load environment variables
dotenv.config();

// Validate required environment variables
const requiredEnvVars = [
  'ETHEREUM_RPC_URL',
  'ETHEREUM_CHAIN_ID',
  'DEPLOYER_PRIVATE_KEY',
  'NEAR_NETWORK_ID',
  'NEAR_NODE_URL',
  'NEAR_RELAYER_ACCOUNT_ID',
  'NEAR_RELAYER_PRIVATE_KEY',
];

const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);
if (missingEnvVars.length > 0) {
  throw new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
}

async function main() {
  try {
    logger.info('Starting cross-chain relayer...');

    // Initialize Ethereum provider and signer
    const ethereumProvider = new providers.JsonRpcProvider(process.env.ETHEREUM_RPC_URL);
    const ethereumSigner = new Wallet(process.env.DEPLOYER_PRIVATE_KEY!, ethereumProvider);
    logger.info(`Connected to Ethereum network: ${await ethereumProvider.getNetwork().then(n => n.name)} (${process.env.ETHEREUM_CHAIN_ID})`);
    logger.info(`Ethereum relayer address: ${await ethereumSigner.getAddress()}`);

    // Initialize NEAR signer and provider
    const signer = KeyPairSigner.fromSecretKey(process.env.NEAR_RELAYER_PRIVATE_KEY! as any);
    const provider = new JsonRpcProvider({ url: process.env.NEAR_NODE_URL! });
    
    // Create proper NEAR account instance with functionCall method
    // Use the working pattern from chainSignatureService.ts
    // Create NEAR Account instance using the correct constructor pattern
    const account = new Account(
      process.env.NEAR_RELAYER_ACCOUNT_ID!,
      provider as unknown as Provider, // Type assertion to handle compatibility
      signer
    );
    
    // Create wrapper object with expected interface for NEAR relayer compatibility
    const nearAccount = {
      ...account,
      connection: {
        provider: provider as unknown as any,
        signer,
      },
      functionCall: account.functionCall.bind(account)
    } as any;

    logger.info(`Connected to NEAR network: ${process.env.NEAR_NETWORK_ID}`);
    logger.info(`NEAR account ID: ${nearAccount.accountId}`);

    // Initialize relayers with configuration objects
    const ethereumRelayer = new EthereumRelayer({
      provider: ethereumSigner.provider as ethers.providers.JsonRpcProvider,
      signer: ethereumSigner,
      nearAccount: nearAccount as any,
      factoryAddress: process.env.ETHEREUM_ESCROW_FACTORY_ADDRESS!,
      bridgeAddress: process.env.ETHEREUM_BRIDGE_ADDRESS!,
      storageDir: process.env.STORAGE_DIR || './storage',
      pollIntervalMs: parseInt(process.env.RELAYER_POLL_INTERVAL || '5000', 10)
    });
    
    const nearRelayer = new NearRelayer({
      nearAccount: nearAccount as any,
      ethereumProvider: ethereumSigner.provider as ethers.providers.JsonRpcProvider,
      ethereumSigner: ethereumSigner,
      escrowContractId: process.env.NEAR_ESCROW_CONTRACT_ID!,
      ethereumEscrowFactoryAddress: process.env.ETHEREUM_ESCROW_FACTORY_ADDRESS!,
      storageDir: process.env.STORAGE_DIR || './storage',
      pollIntervalMs: parseInt(process.env.RELAYER_POLL_INTERVAL || '5000', 10)
    });

    // Start relayers
    await Promise.all([
      ethereumRelayer.start(),
      nearRelayer.start()
    ]);

    logger.info('Cross-chain relayer started successfully');
    
    // Handle shutdown gracefully
    const shutdown = async () => {
      logger.info('Shutting down cross-chain relayer...');
      await Promise.all([
        ethereumRelayer.stop(),
        nearRelayer.stop()
      ]);
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

  } catch (error) {
    logger.error('Failed to start cross-chain relayer:', error);
    process.exit(1);
  }
}

main().catch(error => {
  logger.error('Unhandled error in main:', error);
  process.exit(1);
});
