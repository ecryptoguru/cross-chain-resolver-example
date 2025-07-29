// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "forge-std/Test.sol";
import "../src/NearBridge.sol";
import "../src/TestEscrowFactory.sol";
import "@openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin-contracts/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin-contracts/contracts/utils/cryptography/MessageHashUtils.sol";

// Mock ERC20 token for testing
contract MockToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        _mint(msg.sender, 1000000 * 10 ** decimals());
    }
}

// Helper contract to test EIP-712 signatures
contract SignatureHelper {
    using ECDSA for bytes32;
    
    function getWithdrawHash(
        address bridge,
        bytes32 depositId,
        address recipient,
        uint256 amount,
        uint256 nonce,
        uint256 deadline,
        uint256 chainId
    ) public pure returns (bytes32) {
        bytes32 domainSeparator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("NearBridge")),
                keccak256(bytes("1.0.0")),
                chainId,
                bridge
            )
        );
        
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Withdraw(bytes32 depositId,address recipient,uint256 amount,uint256 nonce,uint256 deadline)"),
                depositId,
                recipient,
                amount,
                nonce,
                deadline
            )
        );
        
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }
}

contract CrossChainCommunicationTest is Test {
    // Contracts
    NearBridge public bridge;
    TestEscrowFactory public escrowFactory;
    MockToken public token;
    
    // Test addresses
    address public deployer = address(0x1);
    address public user = address(0x2);
    address public relayer1 = address(0x3);
    address public relayer2 = address(0x4);
    address public relayer3 = address(0x5);
    
    // Test keys for relayers (private keys for signing, in practice these would be off-chain)
    uint256 private relayer1Key = 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef;
    uint256 private relayer2Key = 0x234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde1;
    uint256 private relayer3Key = 0x34567890abcdef1234567890abcdef1234567890abcdef1234567890abcde2;
    
    // Test parameters
    uint256 public constant INITIAL_BALANCE = 1000 * 10 ** 18;
    uint256 public constant DEPOSIT_AMOUNT = 100 * 10 ** 18;
    string public constant NEAR_ACCOUNT = "test.near";
    
    function setUp() public {
        // Set up test environment
        vm.startPrank(deployer);
        
        // Deploy mock token
        token = new MockToken("Test Token", "TEST");
        
        // Deploy bridge with initial configuration
        bridge = new NearBridge(
            address(this),  // owner
            address(token), // fee token
            address(0),     // access token (none)
            deployer,       // fee collector
            1 hours,        // min deposit
            10000 * 10**18, // max deposit
            1 days,         // dispute period
            30,             // bridge fee bps (0.3%)
            NearBridge.BridgeStatus.ACTIVE
        );
        
        // Deploy escrow factory
        escrowFactory = new TestEscrowFactory(
            address(0), // limit order protocol (mock)
            IERC20(address(token)),
            IERC20(address(0)), // access token (none)
            deployer,   // owner
            1 hours,    // rescue delay src
            1 hours     // rescue delay dst
        );
        
        // Add relayers
        bridge.addRelayer(relayer1);
        bridge.addRelayer(relayer2);
        bridge.addRelayer(relayer3);
        
        // Set required confirmations to 2/3
        bridge.setRequiredConfirmations(2);
        
        // Add token to supported tokens
        bridge.setToken(address(token), true);
        
        // Fund user with tokens
        token.transfer(user, INITIAL_BALANCE);
        
        vm.stopPrank();
    }
    
    function test_DepositToNear() public returns (bytes32 depositId) {
        // Start with user context
        vm.startPrank(user);
        
        // Approve token transfer
        token.approve(address(bridge), DEPOSIT_AMOUNT);
        
        // Generate a secret and its hash
        string memory secret = "my-secret-123";
        bytes32 secretHash = keccak256(abi.encodePacked(secret));
        uint256 timelock = block.timestamp + 1 days;
        
        // Deposit tokens to bridge
        uint256 bridgeFee = (DEPOSIT_AMOUNT * 30) / 10000; // 0.3% bridge fee
        uint256 amountAfterFee = DEPOSIT_AMOUNT - bridgeFee;
        
        // Expect deposit event
        vm.expectEmit(true, true, true, true);
        emit DepositInitiated(
            bytes32(0), // Will be set by the contract
            user,
            NEAR_ACCOUNT,
            address(token),
            amountAfterFee,
            bridgeFee,
            block.timestamp
        );
        
        // Expect message sent event
        vm.expectEmit(true, true, true, true);
        emit MessageSent(
            depositId, // Use the depositId returned from test_DepositToNear()
            bytes32(0), // Will be set by the contract
            user,
            address(0), // Will be set by the relayer
            amountAfterFee,
            block.timestamp
        );
        
        // Perform deposit
        depositId = bridge.deposit(
            address(token),
            DEPOSIT_AMOUNT,
            NEAR_ACCOUNT,
            secretHash,
            timelock
        );
        
        // Verify deposit was created
        (address depositor, uint256 amount, bool claimed, bool disputed) = getDepositInfo(depositId);
        assertEq(depositor, user, "Incorrect depositor");
        assertEq(amount, amountAfterFee, "Incorrect deposit amount");
        assertFalse(claimed, "Deposit should not be claimed");
        assertFalse(disputed, "Deposit should not be disputed");
        
        // Verify token balances
        assertEq(token.balanceOf(user), INITIAL_BALANCE - DEPOSIT_AMOUNT, "Incorrect user balance");
        assertEq(token.balanceOf(address(bridge)), amountAfterFee, "Incorrect bridge balance");
        assertEq(token.balanceOf(deployer), bridgeFee, "Incorrect fee collector balance");
        
        vm.stopPrank();
    }
    
    function test_WithdrawFromNear() public {
        // First, create a deposit and get the deposit ID
        bytes32 depositId = test_DepositToNear();
        
        // Get deposit info
        (address depositor, uint256 amount, bool claimed, bool disputed) = getDepositInfo(depositId);
        require(!claimed, "Deposit already claimed");
        
        // Generate signatures from relayers
        SignatureHelper sigHelper = new SignatureHelper();
        uint256 nonce = bridge.nonces(user);
        uint256 deadline = block.timestamp + 1 hours;
        
        // Sign the withdrawal with relayer1
        bytes32 digest = sigHelper.getWithdrawHash(
            address(bridge),
            depositId,
            user, // recipient
            amount,
            nonce,
            deadline,
            block.chainid
        );
        
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(relayer1Key, digest);
        bytes memory sig1 = abi.encodePacked(r1, s1, v1);
        
        // Sign the withdrawal with relayer2 (we need 2/3 confirmations)
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(relayer2Key, digest);
        bytes memory sig2 = abi.encodePacked(r2, s2, v2);
        
        // Prepare signatures array
        bytes[] memory signatures = new bytes[](2);
        signatures[0] = sig1;
        signatures[1] = sig2;
        
        // Expect withdrawal event
        vm.expectEmit(true, true, true, true);
        emit WithdrawalCompleted(
            depositId,
            user,
            amount,
            block.timestamp
        );
        
        // Complete withdrawal (can be called by anyone with valid signatures)
        bridge.completeWithdrawal(
            depositId,
            user, // recipient
            "my-secret-123", // secret
            signatures
        );
        
        // Verify deposit is marked as claimed
        (, , bool isClaimed, ) = getDepositInfo(depositId);
        assertTrue(isClaimed, "Deposit should be marked as claimed");
        
        // Verify token balances
        assertEq(token.balanceOf(user), INITIAL_BALANCE, "Incorrect user balance after withdrawal");
        assertEq(token.balanceOf(address(bridge)), 0, "Bridge balance should be zero after withdrawal");
    }
    
    function test_DisputeFlow() public {
        // Create a deposit
        bytes32 depositId = test_DepositToNear();
        
        // Get deposit info
        (address depositor, uint256 amount, bool claimed, bool disputed) = getDepositInfo(depositId);
        require(!claimed, "Deposit already claimed");
        
        // Start dispute
        vm.startPrank(user);
        
        // Expect dispute initiated event
        vm.expectEmit(true, true, true, true);
        emit DisputeInitiated(
            depositId,
            user,
            block.timestamp
        );
        
        bridge.initiateDispute(depositId, "Dispute reason");
        
        // Verify dispute state
        (depositor, amount, claimed, disputed) = getDepositInfo(depositId);
        assertTrue(disputed, "Deposit should be in dispute");
        
        // Try to withdraw while in dispute (should fail)
        bytes[] memory emptySigs;
        vm.expectRevert("Deposit is in dispute");
        bridge.completeWithdrawal(depositId, user, "my-secret-123", emptySigs);
        
        // Resolve dispute (only owner can do this)
        vm.stopPrank();
        vm.startPrank(deployer);
        
        // Expect dispute resolved event
        vm.expectEmit(true, true, true, true);
        emit DisputeResolved(
            depositId,
            true, // in favor of claimant
            block.timestamp
        );
        
        bridge.resolveDispute(depositId, true, "Resolution reason");
        
        // Verify deposit is now claimable
        (depositor, amount, claimed, disputed) = getDepositInfo(depositId);
        assertTrue(claimed, "Deposit should be marked as claimed after dispute resolution");
        
        // Verify user received their tokens
        assertEq(token.balanceOf(user), INITIAL_BALANCE, "User should receive tokens after dispute resolution");
    }
    
    // Helper function to get deposit info
    function getDepositInfo(bytes32 depositId) internal view returns (address depositor, uint256 amount, bool claimed, bool disputed) {
        NearBridge.Deposit memory deposit = bridge.deposits(depositId);
        return (deposit.depositor, deposit.amount, deposit.claimed, deposit.disputed);
    }
}
