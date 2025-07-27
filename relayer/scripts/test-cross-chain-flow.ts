#!/usr/bin/env ts-node

import { NearRelayer, createNearRelayer } from '../src/relay/near-relayer';
import { ethers } from 'ethers';
import { logger } from '../src/utils/logger';
import { config } from 'dotenv';
import * as nearAPI from 'near-api-js';

// Load environment variables
config();

// Configuration
const CONFIG = {
  // NEAR configuration
  NEAR_NETWORK_ID: process.env.NEAR_NETWORK_ID || 'testnet',
  NEAR_NODE_URL: process.env.NEAR_NODE_URL || 'https://rpc.testnet.near.org',
  NEAR_WALLET_URL: process.env.NEAR_WALLET_URL || 'https://wallet.testnet.near.org',
  NEAR_HELPER_URL: process.env.NEAR_HELPER_URL || 'https://helper.testnet.near.org',
  NEAR_ACCOUNT_ID: process.env.NEAR_ACCOUNT_ID || 'test-account.testnet',
  NEAR_PRIVATE_KEY: process.env.NEAR_PRIVATE_KEY || 'ed25519:...',
  NEAR_ESCROW_CONTRACT: process.env.NEAR_ESCROW_CONTRACT || 'escrow.test-account.testnet',
  
  // Ethereum configuration
  ETH_RPC_URL: process.env.ETH_RPC_URL || 'http://localhost:8545',
  ETH_PRIVATE_KEY: process.env.ETH_PRIVATE_KEY || '0x...',
  ETH_ESCROW_CONTRACT: process.env.ETH_ESCROW_CONTRACT || '0x...',
  
  // Test parameters
  TEST_AMOUNT: '1000000000000000000', // 1 NEAR or 1 ETH
  TEST_SECRET: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  TEST_TIMELOCK: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
};

// Generate a random secret hash for testing
function generateSecretHash(secret: string): string {
  return ethers.utils.keccak256(ethers.utils.toUtf8Bytes(secret));
}

async function testCrossChainFlow() {
  logger.info('Starting NEAR-Ethereum cross-chain flow test...');
  
  // 1. Initialize the relayer
  logger.info('Initializing NEAR relayer...');
  const relayer = await createNearRelayer({
    networkId: CONFIG.NEAR_NETWORK_ID,
    nodeUrl: CONFIG.NEAR_NODE_URL,
    walletUrl: CONFIG.NEAR_WALLET_URL,
    helperUrl: CONFIG.NEAR_HELPER_URL,
    nearAccountId: CONFIG.NEAR_ACCOUNT_ID,
    nearPrivateKey: CONFIG.NEAR_PRIVATE_KEY,
    ethereumRpcUrl: CONFIG.ETH_RPC_URL,
    ethereumPrivateKey: CONFIG.ETH_PRIVATE_KEY,
    nearEscrowContractId: CONFIG.NEAR_ESCROW_CONTRACT,
    ethereumEscrowContractAddress: CONFIG.ETH_ESCROW_CONTRACT,
    pollIntervalMs: 2000,
  });

  try {
    // 2. Start the relayer
    logger.info('Starting relayer...');
    await relayer.start();

    // 3. Simulate a deposit from NEAR to Ethereum
    logger.info('Simulating NEAR to Ethereum deposit...');
    const secretHash = generateSecretHash(CONFIG.TEST_SECRET);
    
    // In a real scenario, this would be called by the NEAR contract
    const depositMessage = {
      messageId: `deposit-${Date.now()}`,
      type: 'DEPOSIT' as const,
      sourceChain: 'NEAR',
      destChain: 'ETH',
      sender: CONFIG.NEAR_ACCOUNT_ID,
      recipient: '0xRecipientAddress', // Replace with actual recipient
      amount: CONFIG.TEST_AMOUNT,
      token: 'NEAR',
      data: {
        secretHash,
        timelock: CONFIG.TEST_TIMELOCK,
        txHash: 'mock-tx-hash',
      },
      timestamp: Date.now(),
      signature: 'mock-signature',
    };

    // Process the deposit message
    // In a real scenario, this would be triggered by the relayer
    logger.info('Processing deposit message...');
    await (relayer as any).processCrossChainMessage(depositMessage);

    // 4. Simulate a withdrawal from Ethereum to NEAR
    logger.info('Simulating Ethereum to NEAR withdrawal...');
    const withdrawalMessage = {
      messageId: `withdraw-${Date.now()}`,
      type: 'WITHDRAWAL' as const,
      sourceChain: 'ETH',
      destChain: 'NEAR',
      sender: '0xSenderAddress', // Replace with actual sender
      recipient: CONFIG.NEAR_ACCOUNT_ID,
      amount: CONFIG.TEST_AMOUNT,
      token: 'ETH',
      data: {
        secret: CONFIG.TEST_SECRET,
        txHash: 'mock-tx-hash-2',
      },
      timestamp: Date.now(),
      signature: 'mock-signature-2',
    };

    // Process the withdrawal message
    logger.info('Processing withdrawal message...');
    await (relayer as any).processCrossChainMessage(withdrawalMessage);

    // 5. Simulate a refund (if needed)
    // ...

    logger.info('Cross-chain flow test completed successfully!');
  } catch (error) {
    logger.error('Error in cross-chain flow test:', error);
    process.exit(1);
  } finally {
    // Clean up
    await relayer.stop();
    process.exit(0);
  }
}

// Run the test
if (require.main === module) {
  testCrossChainFlow().catch(console.error);
}
