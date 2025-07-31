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

async function checkNearOrderStatus(depositId: string): Promise<void> {
  try {
    console.log('\n🔍 Checking NEAR order status for deposit:', depositId);
    // This is a placeholder - implement actual NEAR RPC call to check order status
    console.log('   Implement NEAR RPC call to check order status for:', depositId);
  } catch (error) {
    console.error('❌ Error checking NEAR order status:', error);
  }
}

async function performHealthCheck(provider: ethers.Provider, bridgeContract: ethers.Contract): Promise<void> {
  try {
    const currentBlock = await provider.getBlockNumber();
    console.log('\n🩺 Health Check:');
    console.log(`  - Current block: ${currentBlock}`);
    console.log(`  - Last processed block: ${lastProcessedBlock || 'None'}`);
    console.log(`  - Blocks behind: ${lastProcessedBlock ? currentBlock - lastProcessedBlock : 'N/A'}`);
    console.log(`  - Reconnect attempts: ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`);
    
    // Update last processed block if we're making progress
    if (currentBlock > lastProcessedBlock) {
      lastProcessedBlock = currentBlock;
    }
    
    // Check contract connection
    try {
      const code = await provider.getCode(BRIDGE_ADDRESS);
      if (code === '0x') {
        throw new Error('Contract does not exist at address');
      }
      console.log('  - Contract connection: ✅ OK');
    } catch (error) {
      console.error('  - Contract connection: ❌ Failed');
      throw error;
    }
  } catch (error) {
    console.error('❌ Health check failed:', error);
    throw error;
  }
}

async function monitorRelayerActivity(): Promise<void> {
  if (!process.env.SEPOLIA_RPC_URL) {
    throw new Error('SEPOLIA_RPC_URL environment variable is not set');
  }

  // Clear any existing interval
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
  }

  const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
  const bridgeContract = new ethers.Contract(
    BRIDGE_ADDRESS,
    BRIDGE_ABI,
    provider
  );

  console.log('\n🔍 Monitoring relayer activity...');
  console.log('  - Bridge Contract:', BRIDGE_ADDRESS);
  console.log('  - RPC URL:', process.env.SEPOLIA_RPC_URL);
  console.log('  - NEAR Escrow:', 'escrow-v2.fusionswap.testnet');
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
  
  // Set up error handling for the contract
  bridgeContract.on('error', (error: Error) => {
    console.error('\n❌ Contract event listener error:', error.message);
    // Don't exit on contract errors, just log them
  });
  
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
