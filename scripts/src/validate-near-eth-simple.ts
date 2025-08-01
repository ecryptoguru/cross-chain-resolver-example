import { ethers } from 'ethers';
import dotenv from 'dotenv';

dotenv.config({ path: '../../.env' });

// Configuration
const config = {
  ethereumRpcUrl: process.env.ETHEREUM_RPC_URL || process.env.SEPOLIA_RPC_URL || '',
  privateKey: process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY || '',
  nearNodeUrl: process.env.NEAR_NODE_URL || 'https://rpc.testnet.fastnear.com',
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

    // Check recent NEAR swap orders via RPC
    console.log('\n📋 Checking recent NEAR swap orders...');
    const recentOrders = await checkNearSwapOrdersViaRPC();
    
    if (recentOrders.length === 0) {
      console.log('❌ No recent NEAR swap orders found');
      return;
    }

    console.log(`✅ Found ${recentOrders.length} recent NEAR swap orders:`);
    for (const order of recentOrders) {
      console.log(`   - Order ${order.order_id}: ${parseFloat(order.amount) / Math.pow(10, 24)} NEAR → ${order.recipient}`);
      console.log(`     Status: ${order.status}, Hashlock: ${order.hashlock.substring(0, 16)}...`);
    }

    // Check Ethereum for corresponding withdrawals
    console.log('\n🔍 Checking Ethereum for withdrawal events...');
    await checkEthereumWithdrawals(provider, bridgeContract, recentOrders);

    // Monitor for new withdrawal events
    console.log('\n👂 Monitoring for new withdrawal events (30 seconds)...');
    await monitorWithdrawalEvents(bridgeContract, 30000);

    console.log('\n✅ NEAR→Ethereum transfer validation completed!');

  } catch (error) {
    console.error('❌ Error during validation:', error);
    throw error;
  }
}

async function checkNearSwapOrdersViaRPC(): Promise<any[]> {
  const orders: any[] = [];
  
  try {
    // Try to query recent orders (order_13, order_14, order_15, etc.)
    for (let i = 13; i <= 20; i++) {
      const orderId = `order_${i}`;
      try {
        const response = await fetch(config.nearNodeUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 'dontcare',
            method: 'query',
            params: {
              request_type: 'call_function',
              finality: 'final',
              account_id: config.nearEscrowContract,
              method_name: 'get_swap_order',
              args_base64: Buffer.from(JSON.stringify({ order_id: orderId })).toString('base64')
            }
          })
        });

        const result = await response.json() as any;
        
        if (result.result && result.result.result) {
          try {
            const orderData = JSON.parse(Buffer.from(result.result.result).toString());
            if (orderData && orderData.amount && orderData.amount !== '0') {
              orders.push({
                order_id: orderId,
                amount: orderData.amount || '0',
                recipient: orderData.recipient || '',
                hashlock: orderData.hashlock || '',
                timelock: orderData.timelock || 0,
                status: orderData.status || 'unknown',
                created_at: orderData.created_at
              });
            }
          } catch (parseError) {
            // Skip invalid orders
            continue;
          }
        }
      } catch (error) {
        // Order doesn't exist, continue
        continue;
      }
    }

    return orders;
  } catch (error) {
    console.error('Error getting NEAR swap orders:', error);
    return [];
  }
}

async function checkEthereumWithdrawals(
  provider: ethers.Provider, 
  bridgeContract: ethers.Contract,
  nearOrders: any[]
): Promise<void> {
  try {
    const currentBlock = await provider.getBlockNumber();
    const fromBlock = Math.max(0, currentBlock - 2000); // Check last 2000 blocks
    
    console.log(`   🔍 Checking Ethereum blocks ${fromBlock} to ${currentBlock} for events...`);
    
    const withdrawalFilter = bridgeContract.filters.WithdrawalCompleted();
    const withdrawals = await bridgeContract.queryFilter(withdrawalFilter, fromBlock, currentBlock);

    console.log(`   📊 Found ${withdrawals.length} withdrawal events in recent blocks`);

    if (withdrawals.length > 0) {
      console.log('\n   📋 Recent Withdrawal Events:');
      for (const withdrawal of withdrawals) {
        const event = withdrawal as ethers.EventLog;
        console.log(`     - Recipient: ${event.args?.recipient || 'unknown'}`);
        console.log(`     - Amount: ${ethers.formatEther(event.args?.amount || 0)} ETH`);
        console.log(`     - Block: ${event.blockNumber}`);
        console.log(`     - Tx Hash: ${event.transactionHash}`);
        console.log('     ---');
      }
    }

    // Try to correlate NEAR orders with Ethereum withdrawals
    console.log('\n   🔗 Correlating NEAR orders with Ethereum withdrawals...');
    for (const order of nearOrders) {
      const nearAmount = parseFloat(order.amount) / Math.pow(10, 24);
      console.log(`\n   📊 Order ${order.order_id} (${nearAmount} NEAR):`);
      
      // Look for withdrawals that might correspond to this NEAR order
      const potentialWithdrawals = withdrawals.filter(withdrawal => {
        const event = withdrawal as ethers.EventLog;
        const amount = parseFloat(ethers.formatEther(event.args?.amount || 0));
        return Math.abs(amount - nearAmount) < 0.001; // Allow small differences
      });

      if (potentialWithdrawals.length > 0) {
        console.log(`     ✅ Found ${potentialWithdrawals.length} potential matching withdrawal(s)`);
        for (const withdrawal of potentialWithdrawals) {
          const event = withdrawal as ethers.EventLog;
          console.log(`       - Amount: ${ethers.formatEther(event.args?.amount || 0)} ETH`);
          console.log(`       - Recipient: ${event.args?.recipient}`);
          console.log(`       - Tx: ${event.transactionHash}`);
        }
      } else {
        console.log('     ❌ No matching Ethereum withdrawals found');
        console.log('     💡 Relayer may not have processed this NEAR order yet');
      }
    }

  } catch (error) {
    console.error('   ❌ Error checking Ethereum withdrawals:', error);
  }
}

async function monitorWithdrawalEvents(bridgeContract: ethers.Contract, duration: number): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      bridgeContract.removeAllListeners('WithdrawalCompleted');
      console.log('   ⏰ Monitoring timeout reached');
      resolve();
    }, duration);

    bridgeContract.on('WithdrawalCompleted', (depositId: string, recipient: string, amount: bigint, timestamp: bigint) => {
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
