import { ethers } from 'ethers';
import { connect, keyStores, utils } from 'near-api-js';
import dotenv from 'dotenv';

dotenv.config({ path: '../../.env' });

interface Config {
  ethereumRpcUrl: string;
  privateKey: string;
  nearNodeUrl: string;
  nearNetworkId: string;
  nearAccountId: string;
  nearPrivateKey: string;
  nearEscrowContract: string;
  bridgeAddress: string;
  ethRecipient: string;
}

interface NearSwapOrder {
  order_id: string;
  amount: string;
  recipient: string;
  hashlock: string;
  timelock: number;
  status: string;
  created_at?: number;
}

// Configuration
const config: Config = {
  ethereumRpcUrl: process.env.ETHEREUM_RPC_URL || process.env.SEPOLIA_RPC_URL || '',
  privateKey: process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY || '',
  nearNodeUrl: process.env.NEAR_NODE_URL || 'https://rpc.testnet.fastnear.com',
  nearNetworkId: process.env.NEAR_NETWORK_ID || 'testnet',
  nearAccountId: process.env.NEAR_ACCOUNT_ID || 'fusionswap.testnet',
  nearPrivateKey: process.env.NEAR_PRIVATE_KEY || '',
  nearEscrowContract: process.env.NEAR_ESCROW_CONTRACT_ID || 'escrow-v2.fusionswap.testnet',
  bridgeAddress: process.env.RESOLVER_ADDRESS || process.env.NEAR_BRIDGE || '',
  ethRecipient: process.env.ETH_RECIPIENT || process.env.DEPLOYER_ADDRESS || ''
};

// Bridge contract ABI for monitoring events
const BRIDGE_ABI = [
  'event DepositInitiated(bytes32 indexed depositId, address indexed sender, string nearRecipient, address token, uint256 amount, uint256 fee, uint256 timestamp)',
  'event MessageSent(bytes32 indexed messageId, bytes32 indexed depositId, address indexed sender, string nearRecipient, uint256 amount, uint256 timestamp)',
  'event WithdrawalCompleted(bytes32 indexed depositId, address indexed recipient, uint256 amount, uint256 timestamp)',
  'function getBalance(address account) view returns (uint256)'
];

async function validateNearToEthereumTransfer(): Promise<void> {
  console.log('\n🔍 NEAR→Ethereum Transfer Validation');
  console.log('=====================================');

  try {
    // Connect to Ethereum
    const provider = new ethers.JsonRpcProvider(config.ethereumRpcUrl);
    const signer = new ethers.Wallet(config.privateKey, provider);
    const bridgeContract = new ethers.Contract(config.bridgeAddress, BRIDGE_ABI, signer);

    console.log('🔗 Connected to Ethereum network:', await provider.getNetwork().then(n => n.chainId));
    console.log('👤 Ethereum signer address:', signer.address);
    console.log('💰 ETH Balance:', ethers.formatEther(await provider.getBalance(signer.address)), 'ETH');
    console.log('🌉 Bridge contract:', config.bridgeAddress);

    // Connect to NEAR using standard approach
    const keyStore = new keyStores.InMemoryKeyStore();
    const keyPair = utils.KeyPair.fromString(config.nearPrivateKey);
    await keyStore.setKey(config.nearNetworkId, config.nearAccountId, keyPair);
    
    const nearConnection = await connect({
      networkId: config.nearNetworkId,
      keyStore,
      nodeUrl: config.nearNodeUrl,
    });
    
    const nearAccount = await nearConnection.account(config.nearAccountId);

    console.log('🔗 Connected to NEAR network:', config.nearNetworkId);
    console.log('👤 NEAR account ID:', config.nearAccountId);
    console.log('🏦 NEAR Escrow contract:', config.nearEscrowContract);

    // Get recent NEAR swap orders
    console.log('\n📋 Checking recent NEAR swap orders...');
    const recentOrders = await getRecentNearSwapOrders(nearAccount);
    
    if (recentOrders.length === 0) {
      console.log('❌ No recent NEAR swap orders found');
      return;
    }

    console.log(`✅ Found ${recentOrders.length} recent NEAR swap orders:`);
    for (const order of recentOrders) {
      console.log(`   - Order ${order.order_id}: ${parseFloat(order.amount) / Math.pow(10, 24)} NEAR → ${order.recipient}`);
      console.log(`     Status: ${order.status}, Hashlock: ${order.hashlock.substring(0, 16)}...`);
    }

    // Check each order for corresponding Ethereum activity
    for (const order of recentOrders) {
      console.log(`\n🔍 Validating order ${order.order_id}...`);
      await validateOrderProcessing(order, provider, bridgeContract, nearAccount);
    }

    // Monitor for new withdrawal events
    console.log('\n👂 Monitoring for new withdrawal events (30 seconds)...');
    await monitorWithdrawalEvents(bridgeContract, 30000);

    console.log('\n✅ NEAR→Ethereum transfer validation completed!');

  } catch (error) {
    console.error('❌ Error during validation:', error);
    throw error;
  }
}

async function getRecentNearSwapOrders(nearAccount: any): Promise<NearSwapOrder[]> {
  try {
    // Get all swap orders (this is a simplified approach)
    const orders: NearSwapOrder[] = [];
    
    // Try to query recent orders (order_13, order_14, order_15, etc.)
    for (let i = 13; i <= 20; i++) {
      const orderId = `order_${i}`;
      try {
        const result = await nearAccount.viewFunction({
          contractId: config.nearEscrowContract,
          methodName: 'get_swap_order',
          args: { order_id: orderId }
        });

        if (result) {
          orders.push({
            order_id: orderId,
            amount: result.amount || '0',
            recipient: result.recipient || '',
            hashlock: result.hashlock || '',
            timelock: result.timelock || 0,
            status: result.status || 'unknown',
            created_at: result.created_at
          });
        }
      } catch (error) {
        // Order doesn't exist, continue
        continue;
      }
    }

    return orders.filter(order => order.amount !== '0');
  } catch (error) {
    console.error('Error getting NEAR swap orders:', error);
    return [];
  }
}

async function validateOrderProcessing(
  order: NearSwapOrder, 
  provider: ethers.Provider, 
  bridgeContract: ethers.Contract,
  nearAccount: Account
): Promise<void> {
  try {
    console.log(`   📊 Order Details:`);
    console.log(`     - Amount: ${parseFloat(order.amount) / Math.pow(10, 24)} NEAR`);
    console.log(`     - Recipient: ${order.recipient}`);
    console.log(`     - Status: ${order.status}`);
    console.log(`     - Hashlock: ${order.hashlock}`);

    // Check if relayer should have processed this order
    if (order.status === 'created' || order.status === 'pending') {
      console.log('   ⏳ Order is pending relayer processing');
      
      // Check for corresponding Ethereum deposits
      const currentBlock = await provider.getBlockNumber();
      const fromBlock = Math.max(0, currentBlock - 1000); // Check last 1000 blocks
      
      console.log(`   🔍 Checking Ethereum blocks ${fromBlock} to ${currentBlock} for deposits...`);
      
      const depositFilter = bridgeContract.filters.DepositInitiated();
      const messageFilter = bridgeContract.filters.MessageSent();
      const withdrawalFilter = bridgeContract.filters.WithdrawalCompleted();
      
      const [deposits, messages, withdrawals] = await Promise.all([
        bridgeContract.queryFilter(depositFilter, fromBlock, currentBlock),
        bridgeContract.queryFilter(messageFilter, fromBlock, currentBlock),
        bridgeContract.queryFilter(withdrawalFilter, fromBlock, currentBlock)
      ]);

      console.log(`   📊 Ethereum Events Found:`);
      console.log(`     - Deposits: ${deposits.length}`);
      console.log(`     - Messages: ${messages.length}`);
      console.log(`     - Withdrawals: ${withdrawals.length}`);

      // Look for withdrawals that might correspond to this NEAR order
      const potentialWithdrawals = withdrawals.filter(event => {
        const amount = ethers.formatEther(event.args?.amount || 0);
        const nearAmount = parseFloat(order.amount) / Math.pow(10, 24);
        return Math.abs(parseFloat(amount) - nearAmount) < 0.001; // Allow small differences
      });

      if (potentialWithdrawals.length > 0) {
        console.log(`   ✅ Found ${potentialWithdrawals.length} potential matching withdrawal(s):`);
        for (const withdrawal of potentialWithdrawals) {
          console.log(`     - Recipient: ${withdrawal.args?.recipient}`);
          console.log(`     - Amount: ${ethers.formatEther(withdrawal.args?.amount || 0)} ETH`);
          console.log(`     - Block: ${withdrawal.blockNumber}`);
          console.log(`     - Tx Hash: ${withdrawal.transactionHash}`);
        }
      } else {
        console.log('   ❌ No matching Ethereum withdrawals found');
        console.log('   💡 This indicates the relayer has not processed this NEAR order yet');
      }

    } else if (order.status === 'completed') {
      console.log('   ✅ Order is marked as completed');
    } else {
      console.log(`   ❓ Order has status: ${order.status}`);
    }

  } catch (error) {
    console.error(`   ❌ Error validating order ${order.order_id}:`, error);
  }
}

async function monitorWithdrawalEvents(bridgeContract: ethers.Contract, duration: number): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      bridgeContract.removeAllListeners('WithdrawalCompleted');
      console.log('   ⏰ Monitoring timeout reached');
      resolve();
    }, duration);

    bridgeContract.on('WithdrawalCompleted', (depositId, recipient, amount, timestamp) => {
      console.log('\n🎉 NEW WITHDRAWAL DETECTED!');
      console.log('   Deposit ID:', depositId);
      console.log('   Recipient:', recipient);
      console.log('   Amount:', ethers.formatEther(amount), 'ETH');
      console.log('   Timestamp:', new Date(Number(timestamp) * 1000).toISOString());
      console.log('   🎯 This could be from a NEAR→Ethereum transfer!');
      
      clearTimeout(timeout);
      bridgeContract.removeAllListeners('WithdrawalCompleted');
      resolve();
    });

    console.log('   👂 Listening for WithdrawalCompleted events...');
  });
}

// Run the validation
validateNearToEthereumTransfer().catch(error => {
  console.error('❌ Validation failed:', error);
  process.exit(1);
});
