import { ethers } from 'ethers';
import dotenv from 'dotenv';
dotenv.config({ path: '../.env' });

async function debugRelayerNearProcessing() {
  console.log('🔍 Debugging Relayer NEAR Processing');
  console.log('===================================');
  
  // Check what block the relayer should be at
  const nearRpc = process.env.NEAR_NODE_URL || 'https://rpc.testnet.fastnear.com';
  
  console.log('🔗 NEAR RPC:', nearRpc);
  
  // Get current NEAR block
  const currentBlockResponse = await fetch(nearRpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'dontcare',
      method: 'status',
      params: []
    })
  });
  
  const currentBlockData = await currentBlockResponse.json();
  const currentBlock = currentBlockData.result.sync_info.latest_block_height;
  
  console.log('📊 Current NEAR block:', currentBlock);
  console.log('🎯 Target block with our transaction: 207791749');
  console.log('📈 Blocks behind:', currentBlock - 207791749);
  
  // Check if relayer should have processed our block
  if (currentBlock >= 207791749) {
    console.log('✅ Relayer should have processed our transaction block');
    console.log('❌ But no ETH events were created, so relayer is not working correctly');
  } else {
    console.log('⏳ Relayer has not reached our transaction block yet');
  }
  
  // Check the specific transaction that created order_18
  console.log('\n🔍 Checking our specific NEAR transaction...');
  
  const txResponse = await fetch(nearRpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'dontcare',
      method: 'tx',
      params: ['4Eo8QJKJrGPPrGhJZBFNQGZEZKQQQzKJRFkYVjXRQJKJ', 'fusionswap.testnet']
    })
  });
  
  console.log('\n🎯 Key Issues to Debug:');
  console.log('1. Is relayer polling NEAR blocks correctly?');
  console.log('2. Is relayer parsing transaction logs correctly?');
  console.log('3. Is relayer detecting swap order creation events?');
  console.log('4. Is relayer calling processNearToEthereumWithdrawal?');
  
  console.log('\n💡 Next Steps:');
  console.log('- Add verbose logging to relayer NEAR processing');
  console.log('- Check relayer console output for NEAR block processing');
  console.log('- Verify relayer is reaching block 207791749');
  console.log('- Test relayer log parsing with our transaction');
}

debugRelayerNearProcessing().catch(console.error);
