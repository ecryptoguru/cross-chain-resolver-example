#!/usr/bin/env tsx
import { ethers } from 'ethers';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '../.env' });

async function testEventSimulation() {
  console.log('🧪 Testing Event Simulation');
  console.log('============================');

  try {
    // Connect to Ethereum
    const provider = new ethers.JsonRpcProvider(process.env.ETHEREUM_RPC_URL);
    
    console.log(`🔗 Connected to network: ${(await provider.getNetwork()).chainId}`);
    console.log(`📡 Provider: ${process.env.ETHEREUM_RPC_URL}`);

    // Set up bridge contract ABI for event listening
    const bridgeABI = [
      'event DepositInitiated(bytes32 indexed depositId, address indexed sender, string nearRecipient, address token, uint256 amount, uint256 fee, uint256 timestamp)',
      'event MessageSent(bytes32 indexed messageId, bytes32 indexed depositId, address indexed sender, string nearRecipient, uint256 amount, uint256 timestamp)'
    ];

    const bridgeContract = new ethers.Contract(
      process.env.RESOLVER_ADDRESS!,
      bridgeABI,
      provider
    );

    console.log(`🌉 Bridge contract: ${process.env.RESOLVER_ADDRESS}`);

    // Query recent events to see if relayer should have processed them
    console.log('\n📋 Querying recent DepositInitiated events...');
    
    const currentBlock = await provider.getBlockNumber();
    const fromBlock = Math.max(0, currentBlock - 1000); // Last 1000 blocks
    
    console.log(`🔍 Searching blocks ${fromBlock} to ${currentBlock}`);

    const depositFilter = bridgeContract.filters.DepositInitiated();
    const depositEvents = await bridgeContract.queryFilter(depositFilter, fromBlock, currentBlock);

    console.log(`\n✅ Found ${depositEvents.length} DepositInitiated events:`);
    
    for (const event of depositEvents) {
      if ('args' in event && event.args) {
        const args = event.args as any;
        console.log(`  📦 Deposit ID: ${args.depositId}`);
        console.log(`  👤 Sender: ${args.sender}`);
        console.log(`  🎯 NEAR Recipient: ${args.nearRecipient}`);
        console.log(`  💰 Amount: ${ethers.formatEther(args.amount)} ETH`);
        console.log(`  🕐 Block: ${event.blockNumber}`);
        console.log(`  ---`);
      }
    }

    // Query MessageSent events
    console.log('\n📋 Querying recent MessageSent events...');
    const messageFilter = bridgeContract.filters.MessageSent();
    const messageEvents = await bridgeContract.queryFilter(messageFilter, fromBlock, currentBlock);

    console.log(`\n✅ Found ${messageEvents.length} MessageSent events:`);
    
    for (const event of messageEvents) {
      if ('args' in event && event.args) {
        const args = event.args as any;
        console.log(`  📨 Message ID: ${args.messageId}`);
        console.log(`  📦 Deposit ID: ${args.depositId}`);
        console.log(`  👤 Sender: ${args.sender}`);
        console.log(`  🎯 NEAR Recipient: ${args.nearRecipient}`);
        console.log(`  💰 Amount: ${ethers.formatEther(args.amount)} ETH`);
        console.log(`  🕐 Block: ${event.blockNumber}`);
        console.log(`  ---`);
      }
    }

    if (depositEvents.length > 0 || messageEvents.length > 0) {
      console.log('\n🎯 The relayer should have processed these events if it was listening correctly.');
      console.log('   Check the relayer logs to see if it detected and processed them.');
    } else {
      console.log('\n⚠️  No recent cross-chain events found.');
      console.log('   This could mean:');
      console.log('   1. No recent cross-chain transfers were made');
      console.log('   2. The events are older than 1000 blocks');
      console.log('   3. The bridge contract address is incorrect');
    }

    console.log('\n✅ Event simulation test completed successfully!');

  } catch (error) {
    console.error('❌ Error during event simulation:', error);
    process.exit(1);
  }
}

// Run the test
testEventSimulation().catch(console.error);
