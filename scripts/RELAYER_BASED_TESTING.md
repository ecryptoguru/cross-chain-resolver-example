# Relayer-Based Cross-Chain Swap Testing Guide

## Overview

This guide covers testing the complete cross-chain swap functionality using the relayer service for all operations. The relayer handles:

1. **ETH→NEAR**: Detecting Ethereum deposits and creating NEAR orders
2. **NEAR→ETH**: Detecting NEAR orders and facilitating Ethereum withdrawals
3. **Cross-chain message relay**: Ensuring atomic swap completion
4. **Signature collection**: Multi-relayer consensus for security

## Relayer Status Check

### Current Relayer Configuration
```bash
# Check if relayer is running
ps aux | grep -i relayer

# Relayer configuration
cat /Users/defiankit/Desktop/fusionswapn/cross-chain-resolver-example/relayer/.env
```

**Current Setup:**
- ✅ **Ethereum**: Sepolia testnet (Chain ID: 11155111)
- ✅ **NEAR**: Testnet with account `fusionswap.testnet`
- ✅ **Contracts**: 
  - Bridge: `0x4A75BC3F96554949D40d2B9fA02c070d8ae12881`
  - NEAR Escrow: `escrow-v2.fusionswap.testnet`
- ✅ **Polling**: 5-second intervals

## Step-by-Step Relayer Testing

### Step 1: Verify Relayer Status

```bash
# Navigate to relayer directory
cd /Users/defiankit/Desktop/fusionswapn/cross-chain-resolver-example/relayer

# Check relayer logs (if available)
npm run logs 2>/dev/null || echo "No logs command - relayer running in watch mode"

# Verify relayer process
ps aux | grep "src/index.ts" | grep -v grep
```

### Step 2: Test ETH→NEAR with Relayer Processing

```bash
# Navigate to scripts directory
cd /Users/defiankit/Desktop/fusionswapn/cross-chain-resolver-example/scripts

# Create a relayer-monitored deposit
npx tsx src/test-cross-chain-transfer.ts
```

**What the Relayer Should Do:**
1. 🔍 **Detect** the `DepositInitiated` event on Ethereum
2. 🏗️ **Create** corresponding order on NEAR escrow contract
3. 📡 **Relay** cross-chain message with deposit details
4. ⏳ **Monitor** for NEAR order fulfillment

### Step 3: Monitor Relayer Activity

```bash
# Create relayer monitoring script
cat > monitor-relayer.js << 'EOF'
const { ethers } = require('ethers');
require('dotenv').config();

async function monitorRelayerActivity() {
  const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
  const bridgeContract = new ethers.Contract(
    '0x4A75BC3F96554949D40d2B9fA02c070d8ae12881',
    [
      'event DepositInitiated(bytes32 indexed depositId, address indexed sender, string nearRecipient, address token, uint256 amount, uint256 fee, uint256 timestamp)',
      'event MessageSent(bytes32 indexed messageId, bytes32 indexed depositId, address indexed sender, address recipient, uint256 amount, uint256 timestamp)',
      'event WithdrawalCompleted(bytes32 indexed depositId, address indexed recipient, uint256 amount, uint256 timestamp)'
    ],
    provider
  );

  console.log('🔍 Monitoring relayer activity...');
  console.log('Bridge Contract:', '0x4A75BC3F96554949D40d2B9fA02c070d8ae12881');
  console.log('Relayer Account:', 'fusionswap.testnet');
  console.log('NEAR Escrow:', 'escrow-v2.fusionswap.testnet');
  
  // Monitor Ethereum events
  bridgeContract.on('DepositInitiated', (depositId, sender, nearRecipient, token, amount, fee, timestamp) => {
    console.log('\n🔥 RELAYER DETECTED: New ETH Deposit');
    console.log('  Deposit ID:', depositId);
    console.log('  Sender:', sender);
    console.log('  NEAR Recipient:', nearRecipient);
    console.log('  Amount:', ethers.formatEther(amount), 'ETH');
    console.log('  ⏳ Relayer should create NEAR order...');
  });

  bridgeContract.on('MessageSent', (messageId, depositId, sender, recipient, amount, timestamp) => {
    console.log('\n📨 CROSS-CHAIN MESSAGE');
    console.log('  Message ID:', messageId);
    console.log('  Deposit ID:', depositId);
    console.log('  Amount:', ethers.formatEther(amount), 'ETH');
    console.log('  ⏳ Relayer processing cross-chain relay...');
  });

  bridgeContract.on('WithdrawalCompleted', (depositId, recipient, amount, timestamp) => {
    console.log('\n✅ WITHDRAWAL COMPLETED');
    console.log('  Deposit ID:', depositId);
    console.log('  Recipient:', recipient);
    console.log('  Amount:', ethers.formatEther(amount), 'ETH');
    console.log('  🎉 Relayer successfully completed cross-chain swap!');
  });
}

monitorRelayerActivity().catch(console.error);
EOF

# Run monitoring (keep in separate terminal)
node monitor-relayer.js
```

### Step 4: Test Complete ETH→NEAR→ETH Flow

```bash
# Create comprehensive relayer test
cat > test-relayer-flow.js << 'EOF'
const { ethers } = require('ethers');
const crypto = require('crypto');
require('dotenv').config();

async function testRelayerFlow() {
  console.log('🚀 Testing Complete Relayer-Based Cross-Chain Flow');
  console.log('================================================');

  const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
  const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const bridgeContract = new ethers.Contract(
    '0x4A75BC3F96554949D40d2B9fA02c070d8ae12881',
    [
      'function depositEth(string calldata nearRecipient, bytes32 secretHash, uint256 timelock) external payable',
      'function deposits(bytes32 depositId) external view returns (address token, address depositor, string memory nearRecipient, uint256 amount, uint256 timestamp, bool claimed, bool disputed, uint256 disputeEndTime, bytes32 secretHash, uint256 timelock)',
      'event DepositInitiated(bytes32 indexed depositId, address indexed sender, string nearRecipient, address token, uint256 amount, uint256 fee, uint256 timestamp)'
    ],
    signer
  );

  // Step 1: Create ETH deposit for relayer to process
  console.log('\n📤 Step 1: Creating ETH deposit for relayer processing...');
  
  const secret = '0x' + crypto.randomBytes(32).toString('hex');
  const secretHash = ethers.keccak256(ethers.toUtf8Bytes(secret));
  const timelock = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60); // 7 days
  const depositAmount = ethers.parseEther('0.01');

  console.log('🔑 Swap credentials:');
  console.log('  Secret:', secret);
  console.log('  Hash:', secretHash);
  console.log('  Timelock:', new Date(timelock * 1000).toISOString());

  try {
    const tx = await bridgeContract.depositEth(
      'recipient.testnet', // NEAR recipient
      secretHash,
      timelock,
      { value: depositAmount }
    );

    console.log('⏳ Transaction sent:', tx.hash);
    const receipt = await tx.wait();
    console.log('✅ Transaction mined in block:', receipt.blockNumber);

    // Parse deposit event to get deposit ID
    const iface = bridgeContract.interface;
    let depositId = '';
    
    for (const log of receipt.logs) {
      try {
        const parsedLog = iface.parseLog({ topics: log.topics, data: log.data });
        if (parsedLog && parsedLog.name === 'DepositInitiated') {
          depositId = parsedLog.args.depositId;
          console.log('📋 Deposit ID:', depositId);
          break;
        }
      } catch (e) {}
    }

    // Step 2: Monitor relayer processing
    console.log('\n🔄 Step 2: Monitoring relayer processing...');
    console.log('⏳ Relayer should now:');
    console.log('  1. Detect the deposit event');
    console.log('  2. Create order on NEAR escrow contract');
    console.log('  3. Set up cross-chain message relay');
    console.log('  4. Monitor for NEAR order fulfillment');

    // Step 3: Check deposit status periodically
    console.log('\n📊 Step 3: Monitoring deposit status...');
    
    const checkStatus = async () => {
      try {
        const deposit = await bridgeContract.deposits(depositId);
        console.log('📋 Current deposit status:');
        console.log('  Depositor:', deposit.depositor);
        console.log('  Amount:', ethers.formatEther(deposit.amount), 'ETH');
        console.log('  NEAR Recipient:', deposit.nearRecipient);
        console.log('  Claimed:', deposit.claimed);
        console.log('  Secret Hash:', deposit.secretHash);
        
        if (!deposit.claimed) {
          console.log('⏳ Waiting for relayer to complete cross-chain processing...');
          setTimeout(checkStatus, 30000); // Check every 30 seconds
        } else {
          console.log('🎉 Cross-chain swap completed by relayer!');
        }
      } catch (error) {
        console.error('❌ Error checking deposit status:', error.message);
      }
    };

    // Start monitoring
    setTimeout(checkStatus, 10000); // Initial check after 10 seconds

    console.log('\n📝 Next steps:');
    console.log('  - Monitor relayer logs for NEAR order creation');
    console.log('  - Check NEAR escrow contract for new orders');
    console.log('  - Verify cross-chain message processing');
    console.log('  - Test NEAR→ETH flow completion');

  } catch (error) {
    console.error('❌ Error in relayer flow test:', error);
  }
}

testRelayerFlow();
EOF

# Run relayer flow test
node test-relayer-flow.js
```

### Step 5: Verify NEAR Side Processing

```bash
# Check NEAR escrow contract for relayer-created orders
cat > check-near-orders.js << 'EOF'
const { connect, keyStores, KeyPair } = require('near-api-js');

async function checkNearOrders() {
  console.log('🔍 Checking NEAR escrow contract for relayer-created orders...');
  
  const config = {
    networkId: 'testnet',
    nodeUrl: 'https://rpc.testnet.near.org',
    walletUrl: 'https://wallet.testnet.near.org',
    helperUrl: 'https://helper.testnet.near.org',
    explorerUrl: 'https://explorer.testnet.near.org',
    keyStore: new keyStores.InMemoryKeyStore()
  };

  try {
    const near = await connect(config);
    const account = await near.account('fusionswap.testnet');
    
    // Call view method to get contract stats
    const stats = await account.viewFunction(
      'escrow-v2.fusionswap.testnet',
      'get_stats',
      {}
    );
    
    console.log('📊 NEAR Escrow Contract Stats:');
    console.log('  Total Orders:', stats.total_orders || 0);
    console.log('  Pending Orders:', stats.pending_orders || 0);
    console.log('  Locked Orders:', stats.locked_orders || 0);
    console.log('  Fulfilled Orders:', stats.fulfilled_orders || 0);
    
    if (stats.total_orders > 0) {
      console.log('✅ Relayer has created orders on NEAR!');
    } else {
      console.log('⏳ No orders found yet - relayer may still be processing...');
    }
    
  } catch (error) {
    console.error('❌ Error checking NEAR orders:', error.message);
  }
}

checkNearOrders();
EOF

# Check NEAR orders
node check-near-orders.js
```

## Relayer Workflow Validation

### Expected Relayer Behavior

1. **ETH Deposit Detection**:
   ```
   🔍 Relayer detects DepositInitiated event
   📋 Parses: depositId, sender, amount, nearRecipient, secretHash
   ```

2. **NEAR Order Creation**:
   ```
   🏗️ Relayer calls escrow-v2.fusionswap.testnet
   📝 Creates order with matching parameters
   🔒 Sets up hashlock with secretHash
   ```

3. **Cross-Chain Relay**:
   ```
   📡 Relayer monitors both chains
   🔄 Relays messages between Ethereum and NEAR
   ✅ Facilitates atomic swap completion
   ```

4. **Completion Handling**:
   ```
   🎁 Monitors for NEAR order fulfillment
   🔐 Collects relayer signatures
   ✅ Completes withdrawal on Ethereum
   ```

## Troubleshooting Relayer Issues

### Common Issues and Solutions

1. **Relayer not detecting events**:
   ```bash
   # Check relayer logs
   cd /Users/defiankit/Desktop/fusionswapn/cross-chain-resolver-example/relayer
   npm run dev  # Restart with verbose logging
   ```

2. **NEAR connection issues**:
   ```bash
   # Test NEAR connectivity
   curl -X POST -H "Content-Type: application/json" \
   --data '{"jsonrpc":"2.0","method":"status","params":[],"id":1}' \
   https://rpc.testnet.near.org
   ```

3. **Contract interaction failures**:
   ```bash
   # Verify contract addresses
   echo "Bridge: 0x4A75BC3F96554949D40d2B9fA02c070d8ae12881"
   echo "NEAR Escrow: escrow-v2.fusionswap.testnet"
   ```

## Production Relayer Setup

For production use, ensure:

- ✅ **Multiple relayer nodes** for redundancy
- ✅ **Signature threshold** for security (e.g., 2/3 consensus)
- ✅ **Monitoring and alerting** for relayer health
- ✅ **Backup key management** for relayer accounts
- ✅ **Rate limiting** and gas optimization

## Testing Checklist

- [ ] Relayer process is running and healthy
- [ ] ETH deposit creates NEAR order via relayer
- [ ] Cross-chain messages are properly relayed
- [ ] NEAR order fulfillment triggers ETH withdrawal
- [ ] Complete atomic swap is achieved
- [ ] All events are properly logged and monitored

---

*Relayer-based cross-chain swap testing guide*
*Relayer Account: fusionswap.testnet*
*Bridge Contract: 0x4A75BC3F96554949D40d2B9fA02c070d8ae12881*
*NEAR Escrow: escrow-v2.fusionswap.testnet*
