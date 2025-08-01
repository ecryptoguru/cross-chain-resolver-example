import { ethers } from 'ethers';
import dotenv from 'dotenv';

dotenv.config({ path: '../../.env' });

// Configuration
const config = {
  ethereumRpcUrl: process.env.ETHEREUM_RPC_URL || process.env.SEPOLIA_RPC_URL || '',
  privateKey: process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY || '',
  bridgeAddress: process.env.RESOLVER_ADDRESS || process.env.NEAR_BRIDGE || '',
  ethRecipient: '0xf387229980fFCC03300f10aa229b9A2be5ab1D40'
};

// Bridge contract ABI for monitoring events
const BRIDGE_ABI = [
  'event DepositInitiated(bytes32 indexed depositId, address indexed sender, string nearRecipient, address token, uint256 amount, uint256 fee, uint256 timestamp)',
  'event MessageSent(bytes32 indexed messageId, bytes32 indexed depositId, address indexed sender, string nearRecipient, uint256 amount, uint256 timestamp)',
  'event WithdrawalCompleted(bytes32 indexed depositId, address indexed recipient, uint256 amount, uint256 timestamp)',
  'function getBalance(address account) view returns (uint256)'
];

async function checkEthereumWithdrawals(): Promise<void> {
  console.log('\n🔍 Checking Ethereum Withdrawals for NEAR→ETH Transfers');
  console.log('=====================================================');

  try {
    // Connect to Ethereum
    const provider = new ethers.JsonRpcProvider(config.ethereumRpcUrl);
    const signer = new ethers.Wallet(config.privateKey, provider);
    const bridgeContract = new ethers.Contract(config.bridgeAddress, BRIDGE_ABI, signer);

    console.log('🔗 Connected to Ethereum network:', await provider.getNetwork().then(n => n.chainId));
    console.log('👤 Ethereum signer address:', signer.address);
    console.log('💰 ETH Balance:', ethers.formatEther(await provider.getBalance(signer.address)), 'ETH');
    console.log('🌉 Bridge contract:', config.bridgeAddress);
    console.log('🎯 Expected recipient:', config.ethRecipient);

    // Check recent Ethereum events (limit to 500 blocks due to RPC restrictions)
    const currentBlock = await provider.getBlockNumber();
    const fromBlock = Math.max(0, currentBlock - 500); // Check last 500 blocks (~2 hours)
    
    console.log(`\n🔍 Checking Ethereum blocks ${fromBlock} to ${currentBlock} for events...`);
    
    // Get all relevant events
    const depositFilter = bridgeContract.filters.DepositInitiated();
    const messageFilter = bridgeContract.filters.MessageSent();
    const withdrawalFilter = bridgeContract.filters.WithdrawalCompleted();
    
    const [deposits, messages, withdrawals] = await Promise.all([
      bridgeContract.queryFilter(depositFilter, fromBlock, currentBlock),
      bridgeContract.queryFilter(messageFilter, fromBlock, currentBlock),
      bridgeContract.queryFilter(withdrawalFilter, fromBlock, currentBlock)
    ]);

    console.log(`\n📊 Ethereum Events Found:`);
    console.log(`   - Deposits: ${deposits.length}`);
    console.log(`   - Messages: ${messages.length}`);
    console.log(`   - Withdrawals: ${withdrawals.length}`);

    // Check for withdrawals to our expected recipient
    const relevantWithdrawals = withdrawals.filter(withdrawal => {
      const event = withdrawal as ethers.EventLog;
      return event.args?.recipient?.toLowerCase() === config.ethRecipient.toLowerCase();
    });

    if (relevantWithdrawals.length > 0) {
      console.log(`\n✅ Found ${relevantWithdrawals.length} withdrawal(s) to expected recipient:`);
      for (const withdrawal of relevantWithdrawals) {
        const event = withdrawal as ethers.EventLog;
        const amount = ethers.formatEther(event.args?.amount || 0);
        const timestamp = new Date(Number(event.args?.timestamp || 0) * 1000);
        
        console.log(`\n   🎉 WITHDRAWAL DETECTED:`);
        console.log(`     - Deposit ID: ${event.args?.depositId}`);
        console.log(`     - Recipient: ${event.args?.recipient}`);
        console.log(`     - Amount: ${amount} ETH`);
        console.log(`     - Timestamp: ${timestamp.toISOString()}`);
        console.log(`     - Block: ${event.blockNumber}`);
        console.log(`     - Tx Hash: ${event.transactionHash}`);
        
        // Check if this could be from our NEAR order (0.01 NEAR = 0.01 ETH)
        if (Math.abs(parseFloat(amount) - 0.01) < 0.001) {
          console.log(`     - 🎯 LIKELY MATCH: Amount matches our NEAR order (0.01)`);
          console.log(`     - 🌉 This appears to be a successful NEAR→Ethereum transfer!`);
        }
      }
    } else {
      console.log(`\n❌ No withdrawals found to expected recipient: ${config.ethRecipient}`);
    }

    // Show all withdrawals for context
    if (withdrawals.length > 0) {
      console.log(`\n📋 All Recent Withdrawals:`);
      for (const withdrawal of withdrawals) {
        const event = withdrawal as ethers.EventLog;
        const amount = ethers.formatEther(event.args?.amount || 0);
        console.log(`   - ${event.args?.recipient}: ${amount} ETH (Block ${event.blockNumber})`);
      }
    }

    // Check current balance of expected recipient
    const currentBalance = await provider.getBalance(config.ethRecipient);
    console.log(`\n💰 Current balance of ${config.ethRecipient}:`);
    console.log(`   ${ethers.formatEther(currentBalance)} ETH`);

    // Monitor for new events for 30 seconds
    console.log(`\n👂 Monitoring for new withdrawal events (30 seconds)...`);
    await monitorForNewWithdrawals(bridgeContract, 30000);

    console.log('\n✅ Ethereum withdrawal check completed!');

  } catch (error) {
    console.error('❌ Error checking Ethereum withdrawals:', error);
    throw error;
  }
}

async function monitorForNewWithdrawals(bridgeContract: ethers.Contract, duration: number): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      bridgeContract.removeAllListeners('WithdrawalCompleted');
      console.log('   ⏰ Monitoring timeout reached');
      resolve();
    }, duration);

    bridgeContract.on('WithdrawalCompleted', (depositId: string, recipient: string, amount: bigint, timestamp: bigint) => {
      console.log('\n🚨 NEW WITHDRAWAL EVENT DETECTED!');
      console.log('   Deposit ID:', depositId);
      console.log('   Recipient:', recipient);
      console.log('   Amount:', ethers.formatEther(amount), 'ETH');
      console.log('   Timestamp:', new Date(Number(timestamp) * 1000).toISOString());
      
      if (recipient.toLowerCase() === config.ethRecipient.toLowerCase()) {
        console.log('   🎯 THIS IS FOR OUR EXPECTED RECIPIENT!');
        console.log('   🌉 NEAR→Ethereum transfer completed successfully!');
      }
      
      clearTimeout(timeout);
      bridgeContract.removeAllListeners('WithdrawalCompleted');
      resolve();
    });

    console.log('   👂 Listening for WithdrawalCompleted events...');
  });
}

// Run the check
checkEthereumWithdrawals().catch(error => {
  console.error('❌ Withdrawal check failed:', error);
  process.exit(1);
});
