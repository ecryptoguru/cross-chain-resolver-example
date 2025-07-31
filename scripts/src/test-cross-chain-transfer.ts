#!/usr/bin/env ts-node

import { ethers } from 'ethers';
import { getConfig, getProvider, getSigner } from './config';
import * as crypto from 'crypto';
import { config as dotenvConfig } from 'dotenv';
import { resolve } from 'path';

// Load environment variables
dotenvConfig({ path: resolve(__dirname, '../../.env') });

// Contract ABIs - Complete ABI for NearBridge
const NEAR_BRIDGE_ABI = [
  // Functions
  'function depositEth(string memory nearRecipient, bytes32 secretHash, uint256 timelock) external payable',
  'function depositToken(address token, uint256 amount, string memory nearRecipient, bytes32 secretHash, uint256 timelock) external',
  'function getDeposit(bytes32 depositId) external view returns (address depositor, address token, uint256 amount, bytes32 secretHash, uint256 timelock, bool claimed, bool disputed)',
  'function completeWithdrawal(bytes32 depositId, address recipient, string calldata secret, bytes[] calldata signatures) external',
  'function claim(bytes32 depositId, bytes32 secret) external',
  'function addRelayer(address relayer) external',
  'function removeRelayer(address relayer) external',
  'function setConfig(address _feeCollector, uint256 _minDeposit, uint256 _maxDeposit, uint256 _disputePeriod, uint256 _bridgeFeeBps) external',
  'function pauseBridge() external',
  'function unpauseBridge() external',
  'function disputeDeposit(bytes32 depositId) external',
  'function resolveDispute(bytes32 depositId, bool approveWithdrawal) external',
  'function withdrawFees(address token, uint256 amount) external',
  'function updateTokenSupport(address token, bool isSupported) external',
  
  // Events
  'event Deposited(bytes32 indexed depositId, address indexed depositor, address indexed token, uint256 amount, string nearRecipient, bytes32 secretHash, uint256 timelock)',
  'event Withdrawn(bytes32 indexed depositId, address indexed recipient, address token, uint256 amount, uint256 fee)',
  'event Disputed(bytes32 indexed depositId, address indexed disputer, uint256 disputeEndTime)',
  'event DisputeResolved(bytes32 indexed depositId, bool approved)',
  'event MessageSent(bytes32 indexed messageId, bytes32 indexed depositId, address sender, address recipient, uint256 amount, uint256 nonce, uint256 deadline)',
  'event MessageProcessed(bytes32 indexed messageId, bool success, string result)',
  'event BridgeConfigUpdated(tuple(address feeCollector, uint256 minDeposit, uint256 maxDeposit, uint256 disputePeriod, uint256 bridgeFeeBps, uint8 status) newConfig)',
  'event RelayerUpdated(address indexed relayer, bool isActive)',
  'event TokenSupportUpdated(address indexed token, bool isSupported)',
  'event FeeWithdrawn(address indexed token, uint256 amount)',
  'event Paused(address account)',
  'event Unpaused(address account)'
];

// Configuration
interface Config {
  rpcUrl: string;
  privateKey: string;
  nearBridgeAddress: string;
  nearRecipient: string;
  depositAmount: bigint;
  timelock: number;
}

const config: Config = {
  rpcUrl: process.env.SEPOLIA_RPC_URL || 'https://sepolia.infura.io/v3/ad6681211fac49cf88b2fae20294fbc1',
  privateKey: process.env.PRIVATE_KEY || '',
  nearBridgeAddress: process.env.NEAR_BRIDGE || '0x4A75BC3F96554949D40d2B9fA02c070d8ae12881',
  nearRecipient: process.env.NEAR_RECIPIENT || 'fusionswap.testnet',
  depositAmount: ethers.parseEther('0.01'), // 0.01 ETH
  timelock: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60, // 1 week from now
};

async function main() {
  console.log('🚀 Starting Cross-Chain Transfer Test');
  console.log('====================================');
  
  // Set up provider and signer
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const wallet = new ethers.Wallet(config.privateKey, provider);
  const signer = wallet;
  
  console.log(`🔗 Connected to network: ${(await provider.getNetwork()).chainId}`);
  console.log(`👤 Signer address: ${await wallet.getAddress()}`);
  console.log(`💰 Balance: ${ethers.formatEther(await provider.getBalance(wallet.address))} ETH`);
  
  console.log(`🌉 NearBridge address: ${config.nearBridgeAddress}`);
  console.log(`🎯 NEAR recipient: ${config.nearRecipient}`);
  
  // Create contract instance
  const nearBridge = new ethers.Contract(config.nearBridgeAddress, NEAR_BRIDGE_ABI, signer);
  
  // Generate a random secret and its hash
  const secret = crypto.randomBytes(32).toString('hex');
  const secretHash = ethers.keccak256(ethers.toUtf8Bytes(secret));
  
  console.log('\n🔑 Generated secret and hash:');
  console.log(`   Secret: 0x${secret}`);
  console.log(`   Hash:    ${secretHash}`);
  console.log(`   Timelock: ${new Date(config.timelock * 1000).toISOString()}`);
  
  // Deposit ETH to bridge
  console.log(`\n💰 Depositing ${ethers.formatEther(config.depositAmount)} ETH to bridge...`);
  
  try {
    const tx = await nearBridge.depositEth(
      config.nearRecipient,
      secretHash,
      config.timelock,
      { value: config.depositAmount }
    );
    
    console.log(`⏳ Transaction sent: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`✅ Transaction mined in block ${receipt.blockNumber}`);
    
    // Log the receipt for debugging
    console.log('\n📄 Transaction Receipt:');
    console.log('====================');
    console.log(`Transaction hash: ${receipt.hash}`);
    console.log(`Block number: ${receipt.blockNumber}`);
    console.log(`Gas used: ${receipt.gasUsed.toString()}`);
    console.log(`Status: ${receipt.status === 1 ? 'Success' : 'Failed'}`);
    console.log(`Logs: ${receipt.logs.length} events`);
    
    // Parse all events in the receipt
    console.log('\n🔍 Parsing events...');
    const iface = new ethers.Interface(NEAR_BRIDGE_ABI);
    const signerAddress = await signer.getAddress();
    
    // Track found events
    interface EventStatus {
      depositFound: boolean;
      messageSentFound: boolean;
      totalParsed: number;
    }
    
    const eventStatus: EventStatus = {
      depositFound: false,
      messageSentFound: false,
      totalParsed: 0
    };
    
    // Log raw logs for debugging
    console.log('\n📋 Raw logs:');
    console.log('------------');
    
    // Define a type for our parsed log
    type ParsedLog = {
      name: string;
      args: Record<string, any>;
    };
    
    // Manually define the event ABIs we expect with correct signatures
    const depositEventAbi = [
      'event DepositInitiated(bytes32 indexed depositId, address indexed sender, string nearRecipient, address token, uint256 amount, uint256 fee, uint256 timestamp)'
    ];
    
    const messageSentEventAbi = [
      'event MessageSent(bytes32 indexed messageId, bytes32 indexed depositId, address indexed sender, address recipient, uint256 amount, uint256 timestamp)'
    ];
    
    const depositIface = new ethers.Interface(depositEventAbi);
    const messageSentIface = new ethers.Interface(messageSentEventAbi);
    
    // Get the event topic hashes with null checks
    const depositEvent = depositIface.getEvent('DepositInitiated');
    const messageSentEvent = messageSentIface.getEvent('MessageSent');
    
    if (!depositEvent || !messageSentEvent) {
      throw new Error('Could not find expected event definitions in ABI');
    }
    
    const depositTopic = depositEvent.topicHash;
    const messageSentTopic = messageSentEvent.topicHash;
    
    // Process each log entry with detailed logging
    for (let i = 0; i < receipt.logs.length; i++) {
      const log = receipt.logs[i];
      
      console.log(`\n📋 Log ${i + 1}:`);
      console.log(`  Contract: ${log.address}`);
      console.log(`  Topics (${log.topics.length}):`);
      
      // Log topics with indices
      log.topics.forEach((topic: string, idx: number) => {
        console.log(`    [${idx}] ${topic}`);
        if (idx === 0) {
          console.log(`        ${topic === depositTopic ? '✅ Matches Deposited' : topic === messageSentTopic ? '✅ Matches MessageSent' : '❌ Unknown topic'}`);
        }
      });
      
      console.log(`  Data (${log.data.length} bytes): ${log.data}`);
      
      try {
        // Try to identify the event by its topic hash
        if (log.topics[0] === depositTopic) {
          console.log('  🔄 Attempting to decode as DepositInitiated event...');
          try {
            // Use ethers.js to decode the event properly
            const parsedLog = depositIface.parseLog({
              topics: log.topics,
              data: log.data
            });
            
            if (parsedLog) {
              console.log('  ✅ Successfully parsed DepositInitiated event');
              console.log('\n📝 Parsed Event: DepositInitiated');
              console.log('  Arguments:');
              console.log(`    depositId      : ${parsedLog.args.depositId}`);
              console.log(`    sender         : ${parsedLog.args.sender}`);
              console.log(`    nearRecipient  : ${parsedLog.args.nearRecipient}`);
              console.log(`    token          : ${parsedLog.args.token}`);
              console.log(`    amount         : ${ethers.formatEther(parsedLog.args.amount)} ETH`);
              console.log(`    fee            : ${ethers.formatEther(parsedLog.args.fee)} ETH`);
              console.log(`    timestamp      : ${new Date(Number(parsedLog.args.timestamp) * 1000).toISOString()}`);
              
              eventStatus.depositFound = true;
              eventStatus.totalParsed++;
            }
          } catch (decodeError) {
            console.error('  ❌ Event decoding failed:', decodeError);
          }
        } 
        else if (log.topics[0] === messageSentTopic) {
          console.log('  🔄 Attempting to decode as MessageSent event...');
          try {
            // Use ethers.js to decode the event properly
            const parsedLog = messageSentIface.parseLog({
              topics: log.topics,
              data: log.data
            });
            
            if (parsedLog) {
              console.log('  ✅ Successfully parsed MessageSent event');
              console.log('\n📝 Parsed Event: MessageSent');
              console.log('  Arguments:');
              console.log(`    messageId      : ${parsedLog.args.messageId}`);
              console.log(`    depositId      : ${parsedLog.args.depositId}`);
              console.log(`    sender         : ${parsedLog.args.sender}`);
              console.log(`    recipient      : ${parsedLog.args.recipient}`);
              console.log(`    amount         : ${ethers.formatEther(parsedLog.args.amount)} ETH`);
              console.log(`    timestamp      : ${new Date(Number(parsedLog.args.timestamp) * 1000).toISOString()}`);
              
              eventStatus.messageSentFound = true;
              eventStatus.totalParsed++;
            }
          } catch (decodeError) {
            console.error('  ❌ Event decoding failed:', decodeError);
          }
        } else {
          console.log(`  ℹ️ Unknown event topic: ${log.topics[0]}`);
        }
      } catch (error) {
        if (error instanceof Error) {
          console.error(`❌ Error processing log at index ${i}:`, error.message);
        } else {
          console.error(`❌ Error processing log at index ${i}:`, 'Unknown error occurred');
        }
      }
    }
    
    // Print summary
    console.log('\n📊 Event Summary:');
    console.log('-----------------');
    console.log(`Total logs: ${receipt.logs.length}`);
    console.log(`Successfully parsed: ${eventStatus.totalParsed}`);
    console.log(`Deposited event found: ${eventStatus.depositFound ? '✅' : '❌'}`);
    console.log(`MessageSent event found: ${eventStatus.messageSentFound ? '✅' : '❌'}`);
    
    if (!eventStatus.depositFound || !eventStatus.messageSentFound) {
      console.log('\n⚠️ Some expected events were not found in the transaction logs');
    }
    
  } catch (error) {
    console.error('❌ Error during deposit:', error);
    process.exit(1);
  }
}

main().catch(error => {
  console.error('❌ Unhandled error:', error);
  process.exit(1);
});
