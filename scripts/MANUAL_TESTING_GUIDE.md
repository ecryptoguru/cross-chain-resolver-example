# Manual Cross-Chain Bridge Testing Guide

## Prerequisites

Before starting manual testing, ensure you have:

1. **Environment Setup**:
   ```bash
   cd /Users/defiankit/Desktop/fusionswapn/cross-chain-resolver-example/scripts
   npm install
   ```

2. **Environment Variables** (check `.env` file):
   ```bash
   cat .env
   ```
   Should contain:
   - `SEPOLIA_RPC_URL`
   - `PRIVATE_KEY`
   - `NEAR_BRIDGE` (contract address)
   - `NEAR_RECIPIENT`

3. **Check ETH Balance**:
   ```bash
   # Your current address should have sufficient Sepolia ETH for testing
   echo "Address: 0xf387229980fFCC03300f10aa229b9A2be5ab1D40"
   ```

## Manual Testing Steps

### Step 1: Test ETH→NEAR Transfer

```bash
# Navigate to scripts directory
cd /Users/defiankit/Desktop/fusionswapn/cross-chain-resolver-example/scripts

# Run ETH→NEAR transfer test
npx tsx src/test-cross-chain-transfer.ts
```

**Expected Output:**
- ✅ Connection to Sepolia network
- ✅ Transaction creation and mining
- ✅ Event parsing (DepositInitiated + MessageSent)
- ✅ Deposit and message IDs generated

**What to Check:**
- Transaction hash is generated
- Events are properly parsed
- Deposit amount shows correct fee deduction (0.3%)
- NEAR recipient is correctly set

### Step 2: Test NEAR→ETH Transfer Flow

```bash
# Run NEAR→ETH transfer test
npx tsx src/test-near-to-eth-transfer.ts
```

**Expected Output:**
- ✅ NEAR escrow contract configuration (`escrow-v2.fusionswap.testnet`)
- ✅ Withdrawal flow simulation
- ✅ Claim functionality validation
- ✅ Cross-chain message processing

**What to Check:**
- NEAR contract ID is correctly configured
- Withdrawal workflow is validated
- Secret/hashlock generation works
- Claim process is simulated successfully

### Step 3: Run Comprehensive End-to-End Test

```bash
# Run complete end-to-end test
npx tsx src/test-end-to-end-flow.ts
```

**Expected Output:**
- ✅ Real ETH deposit creation
- ✅ Event parsing and validation
- ✅ Contract state verification
- ✅ Message status tracking
- ✅ Complete flow validation

**What to Check:**
- New deposit is created with unique ID
- All events are emitted and parsed
- Contract state is properly updated
- Message tracking is functional

## Manual Verification Steps

### Step 4: Verify Contract State

```bash
# Create a simple verification script
cat > verify-deposit.js << 'EOF'
const { ethers } = require('ethers');
require('dotenv').config();

async function verifyDeposit() {
  const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
  const contract = new ethers.Contract(
    process.env.NEAR_BRIDGE,
    [
      'function deposits(bytes32 depositId) external view returns (address token, address depositor, string memory nearRecipient, uint256 amount, uint256 timestamp, bool claimed, bool disputed, uint256 disputeEndTime, bytes32 secretHash, uint256 timelock)'
    ],
    provider
  );

  // Replace with actual deposit ID from your test
  const depositId = "REPLACE_WITH_DEPOSIT_ID";
  
  try {
    const deposit = await contract.deposits(depositId);
    console.log('Deposit Info:');
    console.log('  Token:', deposit.token);
    console.log('  Depositor:', deposit.depositor);
    console.log('  NEAR Recipient:', deposit.nearRecipient);
    console.log('  Amount:', ethers.formatEther(deposit.amount), 'ETH');
    console.log('  Claimed:', deposit.claimed);
    console.log('  Secret Hash:', deposit.secretHash);
    console.log('  Timelock:', new Date(Number(deposit.timelock) * 1000).toISOString());
  } catch (error) {
    console.error('Error:', error.message);
  }
}

verifyDeposit();
EOF

# Run verification (after updating depositId)
node verify-deposit.js
```

### Step 5: Check Relayer Status

```bash
# Check if relayer is running
ps aux | grep -i relayer

# Check relayer directory
cd /Users/defiankit/Desktop/fusionswapn/cross-chain-resolver-example/relayer

# Check relayer configuration
cat .env

# If relayer is not running, start it
npm run dev
```

### Step 6: Monitor Bridge Contract Events

```bash
# Create event monitoring script
cat > monitor-events.js << 'EOF'
const { ethers } = require('ethers');
require('dotenv').config();

async function monitorEvents() {
  const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
  const contract = new ethers.Contract(
    process.env.NEAR_BRIDGE,
    [
      'event DepositInitiated(bytes32 indexed depositId, address indexed sender, string nearRecipient, address token, uint256 amount, uint256 fee, uint256 timestamp)',
      'event MessageSent(bytes32 indexed messageId, bytes32 indexed depositId, address indexed sender, address recipient, uint256 amount, uint256 timestamp)'
    ],
    provider
  );

  console.log('Monitoring bridge events...');
  console.log('Bridge contract:', process.env.NEAR_BRIDGE);
  
  // Listen for new events
  contract.on('DepositInitiated', (depositId, sender, nearRecipient, token, amount, fee, timestamp) => {
    console.log('\n🔥 NEW DEPOSIT:');
    console.log('  Deposit ID:', depositId);
    console.log('  Sender:', sender);
    console.log('  NEAR Recipient:', nearRecipient);
    console.log('  Amount:', ethers.formatEther(amount), 'ETH');
    console.log('  Fee:', ethers.formatEther(fee), 'ETH');
  });

  contract.on('MessageSent', (messageId, depositId, sender, recipient, amount, timestamp) => {
    console.log('\n📨 NEW MESSAGE:');
    console.log('  Message ID:', messageId);
    console.log('  Deposit ID:', depositId);
    console.log('  Sender:', sender);
    console.log('  Amount:', ethers.formatEther(amount), 'ETH');
  });
}

monitorEvents();
EOF

# Run event monitor (keep running in separate terminal)
node monitor-events.js
```

## Interactive Testing Commands

### Test Individual Components

```bash
# 1. Test connection only
npx tsx -e "
import { ethers } from 'ethers';
const provider = new ethers.JsonRpcProvider('https://sepolia.infura.io/v3/ad6681211fac49cf88b2fae20294fbc1');
provider.getNetwork().then(n => console.log('Connected to:', n.chainId));
"

# 2. Check balance
npx tsx -e "
import { ethers } from 'ethers';
const provider = new ethers.JsonRpcProvider('https://sepolia.infura.io/v3/ad6681211fac49cf88b2fae20294fbc1');
provider.getBalance('0xf387229980fFCC03300f10aa229b9A2be5ab1D40').then(b => console.log('Balance:', ethers.formatEther(b), 'ETH'));
"

# 3. Test contract connection
npx tsx -e "
import { ethers } from 'ethers';
const provider = new ethers.JsonRpcProvider('https://sepolia.infura.io/v3/ad6681211fac49cf88b2fae20294fbc1');
const contract = new ethers.Contract('0x4A75BC3F96554949D40d2B9fA02c070d8ae12881', ['function owner() view returns (address)'], provider);
contract.owner().then(owner => console.log('Contract owner:', owner)).catch(e => console.log('Contract check failed:', e.message));
"
```

## Troubleshooting

### Common Issues and Solutions

1. **"Invalid private key" error**:
   ```bash
   # Check private key format
   echo $PRIVATE_KEY | wc -c  # Should be 67 characters (including 0x)
   ```

2. **"Insufficient funds" error**:
   ```bash
   # Check ETH balance
   npx tsx -e "
   import { ethers } from 'ethers';
   const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
   provider.getBalance('0xf387229980fFCC03300f10aa229b9A2be5ab1D40').then(b => console.log('Balance:', ethers.formatEther(b), 'ETH'));
   "
   ```

3. **"Contract not found" error**:
   ```bash
   # Verify contract address
   echo "Bridge contract: $NEAR_BRIDGE"
   ```

4. **Network connection issues**:
   ```bash
   # Test RPC connection
   curl -X POST -H "Content-Type: application/json" \
   --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
   $SEPOLIA_RPC_URL
   ```

## Expected Results Summary

After running all manual tests, you should see:

✅ **ETH→NEAR Transfer**:
- Transaction successfully mined
- DepositInitiated event emitted
- MessageSent event emitted
- Proper fee deduction (0.3%)

✅ **NEAR→ETH Transfer**:
- Withdrawal flow validated
- Claim functionality tested
- Cross-chain processing simulated

✅ **End-to-End Flow**:
- Complete workflow validation
- Contract state verification
- Message tracking confirmed

✅ **Contract State**:
- Deposits properly stored
- Messages correctly indexed
- Timelock and hashlock functional

## Next Steps

1. **Monitor relayer logs** for cross-chain processing
2. **Test with different amounts** to validate fee calculations
3. **Test timelock expiration** and refund functionality
4. **Validate with live NEAR contract** integration

---

*Manual testing guide for cross-chain bridge functionality*
*Bridge Contract: 0x4A75BC3F96554949D40d2B9fA02c070d8ae12881*
*Network: Ethereum Sepolia Testnet*
