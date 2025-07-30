import dotenv from 'dotenv';
import { ethers, providers, Wallet } from 'ethers';
import { Account } from '@near-js/accounts';
import { JsonRpcProvider } from '@near-js/providers';
import { KeyPair } from '@near-js/crypto';
import { InMemoryKeyStore } from '@near-js/keystores';
import { KeyPairSigner } from '@near-js/signers';
import { KeyStores } from '@near-js/keystores';
import { EthereumRelayer } from './relay/ethereum.js';
import { NearRelayer } from './relay/near.js';
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

    // Initialize NEAR key store and signer
    const keyStore = new InMemoryKeyStore();
    const keyPair = KeyPair.fromSecretKey(process.env.NEAR_RELAYER_PRIVATE_KEY!);
    await keyStore.setKey(process.env.NEAR_NETWORK_ID!, process.env.NEAR_RELAYER_ACCOUNT_ID!, keyPair);
    const signer = new KeyPairSigner(keyPair);

    // Connect to NEAR
    const provider = new JsonRpcProvider({ url: process.env.NEAR_NODE_URL! });
    const nearAccount = new Account({
      networkId: process.env.NEAR_NETWORK_ID!,
      provider,
      signer,
      accountId: process.env.NEAR_RELAYER_ACCOUNT_ID!,
    });

    logger.info(`Connected to NEAR network: ${process.env.NEAR_NETWORK_ID}`);
    logger.info(`NEAR account ID: ${nearAccount.accountId}`);

    // Initialize relayers with proper type casting and required parameters
    const ethereumRelayer = new EthereumRelayer(ethereumSigner, nearAccount as any);
    const nearRelayer = new NearRelayer(
      nearAccount as any, 
      ethereumSigner,
      process.env.NEAR_ESCROW_CONTRACT_ID!,
      parseInt(process.env.RELAYER_POLL_INTERVAL || '5000', 10)
    );

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
