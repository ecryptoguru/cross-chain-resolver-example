import dotenv from 'dotenv';
import { ethers } from 'ethers';
import { connect, keyStores } from 'near-api-js';
import { EthereumRelayer } from './relay/ethereum';
import { NearRelayer } from './relay/near';
import { logger } from './utils/logger';

// Load environment variables
dotenv.config();

// Validate required environment variables
const requiredEnvVars = [
  'ETHEREUM_RPC_URL',
  'ETHEREUM_CHAIN_ID',
  'DEPLOYER_PRIVATE_KEY',
  'NEAR_NETWORK',
  'NEAR_NODE_URL',
  'NEAR_ACCOUNT_ID',
  'NEAR_PRIVATE_KEY',
];

const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);
if (missingEnvVars.length > 0) {
  throw new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
}

async function main() {
  try {
    logger.info('Starting cross-chain relayer...');

    // Initialize Ethereum provider and signer
    const ethereumProvider = new ethers.JsonRpcProvider(process.env.ETHEREUM_RPC_URL);
    const ethereumSigner = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY!, ethereumProvider);
    logger.info(`Connected to Ethereum network: ${await ethereumProvider.getNetwork().then(n => n.name)} (${process.env.ETHEREUM_CHAIN_ID})`);
    logger.info(`Ethereum relayer address: ${await ethereumSigner.getAddress()}`);

    // Initialize NEAR connection
    const nearKeyStore = new keyStores.InMemoryKeyStore();
    await nearKeyStore.setKey(
      process.env.NEAR_NETWORK!,
      process.env.NEAR_ACCOUNT_ID!,
      process.env.NEAR_PRIVATE_KEY!
    );

    const nearConfig = {
      networkId: process.env.NEAR_NETWORK!,
      nodeUrl: process.env.NEAR_NODE_URL!,
      walletUrl: process.env.NEAR_WALLET_URL || `https://wallet.${process.env.NEAR_NETWORK}.near.org`,
      helperUrl: process.env.NEAR_HELPER_URL || `https://helper.${process.env.NEAR_NETWORK}.near.org`,
      keyStore: nearKeyStore,
    };

    const nearConnection = await connect(nearConfig);
    const nearAccount = await nearConnection.account(process.env.NEAR_ACCOUNT_ID!);
    logger.info(`Connected to NEAR network: ${process.env.NEAR_NETWORK}`);
    logger.info(`NEAR account ID: ${nearAccount.accountId}`);

    // Initialize relayers
    const ethereumRelayer = new EthereumRelayer(ethereumSigner, nearAccount);
    const nearRelayer = new NearRelayer(nearAccount, ethereumSigner);

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
