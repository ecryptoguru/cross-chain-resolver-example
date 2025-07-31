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

  console.log('\n📤 Step 1: Creating ETH deposit for relayer processing...');
  
  const secret = '0x' + crypto.randomBytes(32).toString('hex');
  const secretHash = ethers.keccak256(ethers.toUtf8Bytes(secret));
  const timelock = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60);
  const depositAmount = ethers.parseEther('0.01');

  console.log('🔑 Swap credentials:');
  console.log('  Secret:', secret);
  console.log('  Hash:', secretHash);
  console.log('  Timelock:', new Date(timelock * 1000).toISOString());

  try {
    const tx = await bridgeContract.depositEth(
      'recipient.testnet',
      secretHash,
      timelock,
      { value: depositAmount }
    );

    console.log('⏳ Transaction sent:', tx.hash);
    const receipt = await tx.wait();
    console.log('✅ Transaction mined in block:', receipt.blockNumber);

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

    console.log('\n🔄 Step 2: Monitoring relayer processing...');
    console.log('⏳ Relayer should now:');
    console.log('  1. Detect the deposit event');
    console.log('  2. Create order on NEAR escrow contract');
    console.log('  3. Set up cross-chain message relay');
    console.log('  4. Monitor for NEAR order fulfillment');

    console.log('\n📊 Step 3: Checking deposit status...');
    
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
          console.log('⏳ Deposit pending - relayer processing cross-chain swap...');
        } else {
          console.log('🎉 Cross-chain swap completed by relayer!');
        }
      } catch (error) {
        console.error('❌ Error checking deposit status:', error.message);
      }
    };

    await checkStatus();

    console.log('\n📝 Next steps for relayer validation:');
    console.log('  - Monitor relayer logs for NEAR order creation');
    console.log('  - Check NEAR escrow contract for new orders');
    console.log('  - Verify cross-chain message processing');
    console.log('  - Test NEAR→ETH flow completion');
    console.log('\n🔍 Run monitor-relayer.js in another terminal to see live relayer activity');

  } catch (error) {
    console.error('❌ Error in relayer flow test:', error);
  }
}

testRelayerFlow();
