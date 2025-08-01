import { ethers } from 'ethers';
import dotenv from 'dotenv';

dotenv.config();

// Define event interfaces for type safety
interface DepositInitiatedEvent {
  depositId: string;
  sender: string;
  nearRecipient: string;
  token: string;
  amount: bigint;
  fee: bigint;
  timestamp: bigint;
}

interface MessageSentEvent {
  messageId: string;
  depositId: string;
  sender: string;
  recipient: string;
  amount: bigint;
  timestamp: bigint;
}

interface WithdrawalCompletedEvent {
  depositId: string;
  recipient: string;
  amount: bigint;
  timestamp: bigint;
}

// NEAR event interfaces for NEAR→Ethereum transfers
interface NearSwapOrderEvent {
  orderId: string;
  amount: string; // yoctoNEAR
  recipient: string; // Ethereum address
  hashlock: string;
  timelock: number;
  txHash: string;
  timestamp: number;
}

interface NearOrderStatus {
  orderId: string;
  status: 'created' | 'processing' | 'completed' | 'failed';
  amount: string;
  recipient: string;
  hashlock?: string;
  timelock?: number;
  created_at?: number;
}

// Contract ABI for type safety
const BRIDGE_ABI = [
  'event DepositInitiated(bytes32 indexed depositId, address indexed sender, string nearRecipient, address token, uint256 amount, uint256 fee, uint256 timestamp)',
  'event MessageSent(bytes32 indexed messageId, bytes32 indexed depositId, address indexed sender, string nearRecipient, uint256 amount, uint256 timestamp)',
  'event WithdrawalCompleted(bytes32 indexed depositId, address indexed recipient, uint256 amount, uint256 timestamp)'
] as const;

// Get and validate the bridge address from environment variables
function getBridgeAddress(): string {
  const address = process.env.NEAR_BRIDGE;
  if (!address) {
    throw new Error('NEAR_BRIDGE environment variable is not set');
  }
  if (!ethers.isAddress(address)) {
    throw new Error(`Invalid bridge address: ${address}`);
  }
  return address;
}

// Contract address from environment variable
const BRIDGE_ADDRESS = getBridgeAddress();

// Global variables for reconnection
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
let healthCheckInterval: NodeJS.Timeout;
let lastProcessedBlock = 0;
let lastProcessedNearBlock = 0;
let nearMonitoringActive = false;

// Track cross-chain transfers
const activeTransfers = new Map<string, {
  type: 'eth-to-near' | 'near-to-eth';
  startTime: number;
  ethTxHash?: string;
  nearTxHash?: string;
  orderId?: string;
  depositId?: string;
  status: 'initiated' | 'processing' | 'completed' | 'failed';
}>();

async function checkNearOrderStatus(depositId: string): Promise<void> {
  try {
    console.log('\n🔍 Checking NEAR order status for deposit:', depositId);
    
    const nearRpcUrl = process.env.NEAR_RPC_URL || 'https://rpc.testnet.near.org';
    const nearEscrowContract = process.env.NEAR_ESCROW_CONTRACT || 'escrow-v2.fusionswap.testnet';
    
    // Call NEAR RPC to check escrow status
    const response = await fetch(nearRpcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'dontcare',
        method: 'query',
        params: {
          request_type: 'call_function',
          finality: 'final',
          account_id: nearEscrowContract,
          method_name: 'get_escrow_details',
          args_base64: Buffer.from(JSON.stringify({ escrow_id: depositId })).toString('base64')
        }
      })
    });
    
    const result = await response.json() as any;
    
    if (result.error) {
      console.log('   ❌ NEAR RPC Error:', result.error.message);
      return;
    }
    
    if (result.result && result.result.result) {
      try {
        const escrowData = JSON.parse(Buffer.from(result.result.result).toString());
        console.log('   ✅ NEAR Escrow Found:');
        console.log('     - Status:', escrowData.status || 'unknown');
        console.log('     - Amount:', escrowData.amount || 'unknown');
        console.log('     - Recipient:', escrowData.recipient || 'unknown');
        console.log('     - Target Escrow:', escrowData.target_escrow || 'none');
        
        if (escrowData.status === 'pending') {
          console.log('   ⏳ Escrow is pending - waiting for Ethereum confirmation');
        } else if (escrowData.status === 'completed') {
          console.log('   🎉 Escrow completed successfully!');
        } else if (escrowData.status === 'error') {
          console.log('   ❌ Escrow has error status:', escrowData.error || 'unknown error');
        }
      } catch (parseError) {
        console.log('   ❌ Error parsing NEAR escrow data:', parseError);
        console.log('   Raw result:', Buffer.from(result.result.result).toString());
      }
    } else {
      console.log('   ❌ No escrow found for deposit ID:', depositId);
      console.log('   This could mean:');
      console.log('     - Relayer hasn\'t processed the deposit yet');
      console.log('     - Deposit ID doesn\'t match NEAR escrow ID');
      console.log('     - NEAR contract call failed');
    }
    
  } catch (error) {
    console.error('❌ Error checking NEAR order status:', error);
    console.log('   Make sure NEAR_RPC_URL and NEAR_ESCROW_CONTRACT are set correctly');
  }
}

// Check NEAR swap order status by order ID
async function checkNearSwapOrderStatus(orderId: string): Promise<NearOrderStatus | null> {
  try {
    console.log('\n🔍 Checking NEAR swap order status for order:', orderId);
    
    const nearRpcUrl = process.env.NEAR_RPC_URL || 'https://rpc.testnet.near.org';
    const nearEscrowContract = process.env.NEAR_ESCROW_CONTRACT || 'escrow-v2.fusionswap.testnet';
    
    // Call NEAR RPC to check swap order details
    const response = await fetch(nearRpcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'dontcare',
        method: 'query',
        params: {
          request_type: 'call_function',
          finality: 'final',
          account_id: nearEscrowContract,
          method_name: 'get_swap_order',
          args_base64: Buffer.from(JSON.stringify({ order_id: orderId })).toString('base64')
        }
      })
    });
    
    const result = await response.json() as any;
    
    if (result.error) {
      console.log('   ❌ NEAR RPC Error:', result.error.message);
      return null;
    }
    
    if (result.result && result.result.result) {
      try {
        const orderData = JSON.parse(Buffer.from(result.result.result).toString());
        console.log('   ✅ NEAR Swap Order Found:');
        console.log('     - Order ID:', orderId);
        console.log('     - Amount:', orderData.amount || 'unknown', 'yoctoNEAR');
        console.log('     - Recipient:', orderData.recipient || 'unknown');
        console.log('     - Hashlock:', orderData.hashlock || 'unknown');
        console.log('     - Timelock:', orderData.timelock || 'unknown');
        console.log('     - Status:', orderData.status || 'unknown');
        
        return {
          orderId,
          status: orderData.status || 'created',
          amount: orderData.amount || '0',
          recipient: orderData.recipient || '',
          hashlock: orderData.hashlock,
          timelock: orderData.timelock,
          created_at: orderData.created_at
        };
      } catch (parseError) {
        console.log('   ❌ Error parsing NEAR swap order data:', parseError);
        console.log('   Raw result:', Buffer.from(result.result.result).toString());
        return null;
      }
    } else {
      console.log('   ❌ No swap order found for order ID:', orderId);
      return null;
    }
    
  } catch (error) {
    console.error('❌ Error checking NEAR swap order status:', error);
    return null;
  }
}

// Monitor NEAR blockchain for swap order creation
async function monitorNearSwapOrders(): Promise<void> {
  try {
    const nearRpcUrl = process.env.NEAR_RPC_URL || 'https://rpc.testnet.near.org';
    const nearEscrowContract = process.env.NEAR_ESCROW_CONTRACT || 'escrow-v2.fusionswap.testnet';
    
    console.log('🌐 Starting NEAR swap order monitoring...');
    console.log('   NEAR RPC:', nearRpcUrl);
    console.log('   NEAR Escrow Contract:', nearEscrowContract);
    
    nearMonitoringActive = true;
    
    // Get current block height
    const statusResponse = await fetch(nearRpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'dontcare',
        method: 'status',
        params: []
      })
    });
    
    const statusResult = await statusResponse.json() as any;
    if (statusResult.result) {
      lastProcessedNearBlock = statusResult.result.sync_info.latest_block_height;
      console.log('   Starting from NEAR block:', lastProcessedNearBlock);
    }
    
    // Poll for new blocks and transactions
    const pollInterval = setInterval(async () => {
      if (!nearMonitoringActive) {
        clearInterval(pollInterval);
        return;
      }
      
      try {
        await pollNearBlocks(nearRpcUrl, nearEscrowContract);
      } catch (error) {
        console.error('❌ Error polling NEAR blocks:', error);
      }
    }, 5000); // Poll every 5 seconds
    
  } catch (error) {
    console.error('❌ Error starting NEAR monitoring:', error);
    nearMonitoringActive = false;
  }
}

// Poll NEAR blocks for relevant transactions
async function pollNearBlocks(nearRpcUrl: string, nearEscrowContract: string): Promise<void> {
  try {
    // Get current block height
    const statusResponse = await fetch(nearRpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'dontcare',
        method: 'status',
        params: []
      })
    });
    
    const statusResult = await statusResponse.json() as any;
    if (!statusResult.result) return;
    
    const currentBlock = statusResult.result.sync_info.latest_block_height;
    
    // Process new blocks
    for (let blockHeight = lastProcessedNearBlock + 1; blockHeight <= currentBlock; blockHeight++) {
      try {
        await processNearBlock(nearRpcUrl, nearEscrowContract, blockHeight);
      } catch (error) {
        // Handle chunk missing errors gracefully
        if (error instanceof Error && error.message.includes('Chunk Missing')) {
          console.log(`⚠️  NEAR chunk missing for block ${blockHeight} (expected on testnet)`);
        } else {
          console.error(`❌ Error processing NEAR block ${blockHeight}:`, error);
        }
      }
    }
    
    lastProcessedNearBlock = currentBlock;
    
  } catch (error) {
    console.error('❌ Error polling NEAR blocks:', error);
  }
}

// Process a single NEAR block for relevant transactions
async function processNearBlock(nearRpcUrl: string, nearEscrowContract: string, blockHeight: number): Promise<void> {
  const blockResponse = await fetch(nearRpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'dontcare',
      method: 'block',
      params: { block_id: blockHeight }
    })
  });
  
  const blockResult = await blockResponse.json() as any;
  if (!blockResult.result) return;
  
  const block = blockResult.result;
  
  // Process chunks in the block
  for (const chunk of block.chunks) {
    if (chunk.tx_root === '11111111111111111111111111111111') continue; // Empty chunk
    
    try {
      const chunkResponse = await fetch(nearRpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'dontcare',
          method: 'chunk',
          params: { chunk_id: chunk.chunk_hash }
        })
      });
      
      const chunkResult = await chunkResponse.json() as any;
      if (!chunkResult.result) continue;
      
      // Process transactions in the chunk
      for (const tx of chunkResult.result.transactions) {
        if (tx.signer_id === nearEscrowContract || 
            (tx.actions && tx.actions.some((action: any) => 
              action.FunctionCall && action.FunctionCall.method_name === 'create_swap_order'
            ))) {
          await processNearTransaction(nearRpcUrl, tx.hash, nearEscrowContract);
        }
      }
    } catch (chunkError) {
      // Chunk missing errors are common on NEAR testnet
      if (chunkError instanceof Error && chunkError.message.includes('Chunk Missing')) {
        // Silently skip missing chunks
        continue;
      }
      throw chunkError;
    }
  }
}

// Process a NEAR transaction for swap order creation
async function processNearTransaction(nearRpcUrl: string, txHash: string, nearEscrowContract: string): Promise<void> {
  try {
    const txResponse = await fetch(nearRpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'dontcare',
        method: 'tx',
        params: [txHash, nearEscrowContract]
      })
    });
    
    const txResult = await txResponse.json() as any;
    if (!txResult.result) return;
    
    const transaction = txResult.result;
    
    // Parse transaction logs for swap order creation
    for (const receipt of transaction.receipts_outcome) {
      for (const log of receipt.outcome.logs) {
        const swapOrderMatch = log.match(/Created swap order (\w+) for (\d+) yoctoNEAR to recipient (.+)/);
        if (swapOrderMatch) {
          const [, orderId, amountYocto, recipient] = swapOrderMatch;
          
          console.log('\n🌉 NEAR SWAP ORDER CREATED');
          console.log('  Order ID:', orderId);
          console.log('  Amount:', amountYocto, 'yoctoNEAR');
          console.log('  Amount (NEAR):', (parseFloat(amountYocto) / Math.pow(10, 24)).toFixed(6), 'NEAR');
          console.log('  Recipient:', recipient);
          console.log('  Transaction Hash:', txHash);
          console.log('  Block Height:', transaction.transaction.block_hash);
          console.log('  ⏳ Relayer should process this for Ethereum withdrawal...');
          
          // Track this transfer
          activeTransfers.set(orderId, {
            type: 'near-to-eth',
            startTime: Date.now(),
            nearTxHash: txHash,
            orderId,
            status: 'initiated'
          });
          
          // Check order status after a delay
          setTimeout(async () => {
            const orderStatus = await checkNearSwapOrderStatus(orderId);
            if (orderStatus) {
              const transfer = activeTransfers.get(orderId);
              if (transfer) {
                transfer.status = 'processing';
                console.log(`\n🔄 NEAR order ${orderId} status updated: ${orderStatus.status}`);
              }
            }
          }, 10000); // Check after 10 seconds
        }
      }
    }
    
  } catch (error) {
    console.error('❌ Error processing NEAR transaction:', error);
  }
}

async function performHealthCheck(provider: ethers.Provider, bridgeContract: ethers.Contract): Promise<void> {
  try {
    const currentBlock = await provider.getBlockNumber();
    const bridgeAddress = await bridgeContract.getAddress();
    
    console.log('\n💚 HEALTH CHECK');
    console.log('  Ethereum RPC: Connected');
    console.log('  Current Block:', currentBlock);
    console.log('  Bridge Contract:', bridgeAddress);
    console.log('  Last Processed Block:', lastProcessedBlock);
    console.log('  Blocks Behind:', Math.max(0, currentBlock - lastProcessedBlock));
    
    // Test bridge contract call
    try {
      const code = await provider.getCode(bridgeAddress);
      if (code === '0x') {
        throw new Error('Bridge contract not found at address');
      }
      console.log('  Bridge Contract: Verified');
    } catch (contractError) {
      console.error('  ❌ Bridge Contract Error:', contractError);
      throw contractError;
    }
    
    // Test NEAR connectivity
    try {
      const nearRpcUrl = process.env.NEAR_RPC_URL || 'https://rpc.testnet.near.org';
      const nearEscrowContract = process.env.NEAR_ESCROW_CONTRACT || 'escrow-v2.fusionswap.testnet';
      
      const nearStatusResponse = await fetch(nearRpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'dontcare',
          method: 'status',
          params: []
        })
      });
      
      const nearStatusResult = await nearStatusResponse.json() as any;
      if (nearStatusResult.result) {
        const nearCurrentBlock = nearStatusResult.result.sync_info.latest_block_height;
        console.log('  NEAR RPC: Connected');
        console.log('  NEAR Current Block:', nearCurrentBlock);
        console.log('  NEAR Last Processed:', lastProcessedNearBlock);
        console.log('  NEAR Blocks Behind:', Math.max(0, nearCurrentBlock - lastProcessedNearBlock));
        console.log('  NEAR Escrow Contract:', nearEscrowContract);
        console.log('  NEAR Monitoring:', nearMonitoringActive ? 'Active' : 'Inactive');
      } else {
        console.log('  ⚠️  NEAR RPC: Connection issues');
      }
    } catch (nearError) {
      console.error('  ❌ NEAR Health Check Error:', nearError);
    }
    
    // Show active transfers
    if (activeTransfers.size > 0) {
      console.log('\n🔄 ACTIVE TRANSFERS:');
      for (const [id, transfer] of activeTransfers) {
        const duration = Math.round((Date.now() - transfer.startTime) / 1000);
        console.log(`  ${transfer.type === 'eth-to-near' ? '🔄' : '🌉'} ${id}: ${transfer.status} (${duration}s)`);
      }
    }
    
    console.log('  ✅ All systems operational');
    
  } catch (error) {
    console.error('❌ Health check failed:', error);
    throw error;
  }
}

async function monitorRelayerActivity(): Promise<void> {
  // Use ETHEREUM_RPC_URL if available, otherwise fall back to SEPOLIA_RPC_URL
  const rpcUrl = process.env.ETHEREUM_RPC_URL || process.env.SEPOLIA_RPC_URL;
  if (!rpcUrl) {
    throw new Error('Neither ETHEREUM_RPC_URL nor SEPOLIA_RPC_URL environment variables are set');

    // Process chunks in the block
    for (const chunk of block.chunks) {
      if (chunk.tx_root === '11111111111111111111111111111111') continue; // Empty chunk

      try {
        const chunkResponse = await fetch(nearRpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 'dontcare',
            method: 'chunk',
            params: { chunk_id: chunk.chunk_hash }
          })
  console.log('\n👂 Listening for events... (Press Ctrl+C to stop)');

  // Set up error handling for the provider
  provider.on('error', async (error) => {
    console.error('\n❌ Provider error:', error.message);
    
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.error(`\n❌ Max reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Please check your connection.`);
      process.exit(1);
    }
    
    reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000); // Exponential backoff, max 30s
    
    console.log(`\n🔄 Attempting to reconnect in ${delay/1000} seconds... (Attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
    
    await new Promise(resolve => setTimeout(resolve, delay));
    monitorRelayerActivity();
  });
  
  // Note: Contract error handling is done through provider error events
  // Individual contract events don't have error listeners in ethers v6
  
  // Set up health check interval (every 30 seconds)
  healthCheckInterval = setInterval(async () => {
    try {
      await performHealthCheck(provider, bridgeContract);
    } catch (error) {
      console.error('❌ Health check failed, attempting to reconnect...');
      provider.emit('error', error);
    }
  }, 30000);
  
  // Set up event listeners with proper types
  bridgeContract.on('DepositInitiated', (
    depositId: string,
    sender: string,
    nearRecipient: string,
    token: string,
    amount: bigint,
    fee: bigint,
    timestamp: bigint
  ) => {
    const event: DepositInitiatedEvent = {
      depositId,
      sender,
      nearRecipient,
      token,
      amount,
      fee,
      timestamp
    };
    
    console.log('\n🔥 RELAYER DETECTED: New ETH Deposit');
    console.log('  Deposit ID:', event.depositId);
    console.log('  Sender:', event.sender);
    console.log('  NEAR Recipient:', event.nearRecipient);
    console.log('  Amount:', ethers.formatEther(event.amount), 'ETH');
    console.log('  Fee:', ethers.formatEther(event.fee), 'ETH');
    console.log('  Timestamp:', new Date(Number(event.timestamp) * 1000).toISOString());
    console.log('  ⏳ Relayer should create NEAR order...');
  });

  bridgeContract.on('MessageSent', (
    messageId: string,
    depositId: string,
    sender: string,
    nearRecipient: string,
    amount: bigint,
    timestamp: bigint
  ) => {
    try {
      const event: MessageSentEvent = {
        messageId,
        depositId,
        sender,
        recipient: nearRecipient,
        amount,
        timestamp
      };

      console.log('\n📨 CROSS-CHAIN MESSAGE');
      console.log('  Message ID:', event.messageId);
      console.log('  Deposit ID:', event.depositId);
      console.log('  Sender:', event.sender);
      console.log('  NEAR Recipient:', event.recipient);
      console.log('  Amount:', ethers.formatEther(event.amount), 'ETH');
      console.log('  Timestamp:', new Date(Number(event.timestamp) * 1000).toISOString());
      
      // Add more context about the event
      console.log('\n🔍 Additional Context:');
      console.log('  - Bridge Contract:', BRIDGE_ADDRESS);
      console.log('  - NEAR Escrow Contract:', 'escrow-v2.fusionswap.testnet');
      console.log('  - Current Block:', 'Querying...');
      
      // Get current block number for reference
      provider.getBlockNumber()
        .then(blockNumber => {
          console.log('  - Current Block:', blockNumber);
          console.log('  - Blocks since event:', blockNumber - Number(timestamp));
        })
        .catch(err => {
          console.error('  ❌ Error getting block number:', err.message);
        });
      
      console.log('\n⏳ Relayer should be processing cross-chain relay to NEAR...');
      
      // Verify NEAR order creation after a short delay
      setTimeout(() => {
        checkNearOrderStatus(depositId).catch(console.error);
      }, 5000);
      
      console.log('   Checking NEAR escrow contract for order status...');
      
    } catch (error) {
      console.error('\n❌ Error processing MessageSent event:', error);
      console.error('Event args:', {
        messageId,
        depositId,
        sender,
        nearRecipient,
        amount: amount.toString(),
        timestamp: timestamp.toString()
      });
    }
  });

  bridgeContract.on('WithdrawalCompleted', (
    depositId: string,
    recipient: string,
    amount: bigint,
    timestamp: bigint
  ) => {
    const event: WithdrawalCompletedEvent = {
      depositId,
      recipient,
      amount,
      timestamp
    };

    console.log('\n✅ WITHDRAWAL COMPLETED');
    console.log('  Deposit ID:', event.depositId);
    console.log('  Recipient:', event.recipient);
    console.log('  Amount:', ethers.formatEther(event.amount), 'ETH');
    console.log('  Timestamp:', new Date(Number(event.timestamp) * 1000).toISOString());
    console.log('  🎉 Relayer successfully completed cross-chain swap!');
  });

  // Update last processed block when new blocks are received
  provider.on('block', (blockNumber) => {
    lastProcessedBlock = blockNumber;
  });

  // Handle process termination
  const cleanup = () => {
    console.log('\n👋 Stopping relayer monitor...');
    if (healthCheckInterval) {
      clearInterval(healthCheckInterval);
    }
    provider.removeAllListeners();
    bridgeContract.removeAllListeners();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  
  // Initial health check
  try {
    await performHealthCheck(provider, bridgeContract);
  } catch (error) {
    console.error('❌ Initial health check failed:', error);
    provider.emit('error', error);
  }
}

// Run the monitor
monitorRelayerActivity().catch(error => {
  console.error('❌ Error in relayer monitor:', error);
  process.exit(1);
});
