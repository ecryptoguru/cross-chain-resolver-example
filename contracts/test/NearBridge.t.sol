// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {NearBridge} from "../src/NearBridge.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";

// Mock ERC20 token for testing
contract MockERC20 is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        _mint(msg.sender, 1000000 * 10 ** decimals());
    }
    
    function mint(address to, uint256 amount) public {
        _mint(to, amount);
    }
}

contract NearBridgeTest is Test {
    NearBridge public bridge;
    MockERC20 public token;
    
    address public owner = makeAddr("owner");
    address public feeCollector = makeAddr("feeCollector");
    address public relayer = makeAddr("relayer");
    address public user = makeAddr("user");
    
    // Test constants
    uint256 public constant MIN_DEPOSIT = 0.1 ether;
    uint256 public constant MAX_DEPOSIT = 100 ether;
    uint256 public constant DISPUTE_PERIOD = 7 days;
    uint256 public constant BRIDGE_FEE_BPS = 10; // 0.1%
    string public constant NEAR_RECIPIENT = "test.near";
    
    function setUp() public {
        // Deploy mock token
        token = new MockERC20("Test Token", "TEST");
        
        // Deploy bridge
        vm.prank(owner);
        bridge = new NearBridge(
            feeCollector,
            MIN_DEPOSIT,
            MAX_DEPOSIT,
            DISPUTE_PERIOD,
            BRIDGE_FEE_BPS
        );
        
        // Set up test environment
        vm.deal(user, 100 ether);
        token.transfer(user, 1000 ether);
        
        // Add relayer
        vm.prank(owner);
        bridge.setRelayer(relayer, true);
        
        // Add token to supported tokens
        vm.prank(owner);
        bridge.setSupportedToken(address(token), true);
    }
    
    // ============ Constructor Tests ============
    
    function test_Constructor_SetsCorrectValues() public {
        assertEq(bridge.owner(), owner);
        assertEq(bridge.NEAR_CHAIN_ID(), 397);
        
        (address feeCollectorAddr, uint256 minDeposit, uint256 maxDeposit, , uint256 bridgeFeeBps, ) = 
            bridge.config();
            
        assertEq(feeCollectorAddr, feeCollector);
        assertEq(minDeposit, MIN_DEPOSIT);
        assertEq(maxDeposit, MAX_DEPOSIT);
        assertEq(bridgeFeeBps, BRIDGE_FEE_BPS);
    }
    
    // ============ Deposit Tests ============
    
    function test_DepositEth_WhenActive() public {
        uint256 depositAmount = 1 ether;
        uint256 expectedFee = (depositAmount * BRIDGE_FEE_BPS) / 10000;
        uint256 expectedAmountAfterFee = depositAmount - expectedFee;
        
        vm.prank(user);
        bytes32 depositId = bridge.depositEth{value: depositAmount}(NEAR_RECIPIENT);
        
        // Check deposit was created correctly
        (address tokenAddr, address depositor, string memory recipient, uint256 amount, , , , ) = 
            bridge.deposits(depositId);
            
        assertEq(tokenAddr, address(0));
        assertEq(depositor, user);
        assertEq(recipient, NEAR_RECIPIENT);
        assertEq(amount, expectedAmountAfterFee);
        
        // Check fee was collected
        assertEq(feeCollector.balance, expectedFee);
    }
    
    function test_DepositToken_WhenActive() public {
        uint256 depositAmount = 1 ether;
        uint256 expectedFee = (depositAmount * BRIDGE_FEE_BPS) / 10000;
        uint256 expectedAmountAfterFee = depositAmount - expectedFee;
        
        // Approve token transfer
        vm.prank(user);
        token.approve(address(bridge), depositAmount);
        
        // Make deposit
        vm.prank(user);
        bytes32 depositId = bridge.depositToken(address(token), depositAmount, NEAR_RECIPIENT);
        
        // Check deposit was created correctly
        (address tokenAddr, address depositor, string memory recipient, uint256 amount, , , , ) = 
            bridge.deposits(depositId);
            
        assertEq(tokenAddr, address(token));
        assertEq(depositor, user);
        assertEq(recipient, NEAR_RECIPIENT);
        assertEq(amount, expectedAmountAfterFee);
        
        // Check tokens were transferred
        assertEq(token.balanceOf(address(bridge)), expectedAmountAfterFee);
        assertEq(token.balanceOf(feeCollector), expectedFee);
    }
    
    function test_DepositEth_RevertWhenBelowMin() public {
        uint256 depositAmount = MIN_DEPOSIT - 1;
        
        vm.prank(user);
        vm.expectRevert("Amount below minimum");
        bridge.depositEth{value: depositAmount}(NEAR_RECIPIENT);
    }
    
    function test_DepositEth_RevertWhenAboveMax() public {
        uint256 depositAmount = MAX_DEPOSIT + 1;
        
        vm.prank(user);
        vm.expectRevert("Amount exceeds maximum");
        bridge.depositEth{value: depositAmount}(NEAR_RECIPIENT);
    }
    
    function test_DepositToken_RevertWhenTokenNotSupported() public {
        // Deploy a new token that's not in the supported tokens list
        MockERC20 unsupportedToken = new MockERC20("Unsupported", "UNSPT");
        
        vm.prank(user);
        unsupportedToken.approve(address(bridge), 1 ether);
        
        vm.prank(user);
        vm.expectRevert("Token not supported");
        bridge.depositToken(address(unsupportedToken), 1 ether, NEAR_RECIPIENT);
    }
    
    // ============ Claim Tests ============
    
    function test_Claim_WhenValid() public {
        // Make a deposit first
        uint256 depositAmount = 1 ether;
        uint256 expectedAmountAfterFee = depositAmount - ((depositAmount * BRIDGE_FEE_BPS) / 10000);
        
        vm.prank(user);
        bytes32 depositId = bridge.depositEth{value: depositAmount}(NEAR_RECIPIENT);
        
        // Simulate relayer processing the deposit
        vm.prank(relayer);
        bridge.processDeposit(address(0), expectedAmountAfterFee, NEAR_RECIPIENT, user);
        
        // Claim the deposit
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = keccak256(abi.encodePacked("test"));
        
        uint256 userBalanceBefore = user.balance;
        
        vm.prank(user);
        bridge.claim(depositId, expectedAmountAfterFee, proof);
        
        // Check user received the funds
        assertEq(user.balance, userBalanceBefore + expectedAmountAfterFee);
        
        // Check deposit is marked as claimed
        ( , , , , , bool claimed, , ) = bridge.deposits(depositId);
        assertTrue(claimed);
    }
    
    function test_Claim_RevertWhenAlreadyClaimed() public {
        // Make a deposit and claim it
        uint256 depositAmount = 1 ether;
        uint256 expectedAmountAfterFee = depositAmount - ((depositAmount * BRIDGE_FEE_BPS) / 10000);
        
        vm.prank(user);
        bytes32 depositId = bridge.depositEth{value: depositAmount}(NEAR_RECIPIENT);
        
        // Simulate relayer processing the deposit
        vm.prank(relayer);
        bridge.processDeposit(address(0), expectedAmountAfterFee, NEAR_RECIPIENT, user);
        
        // First claim (should succeed)
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = keccak256(abi.encodePacked("test"));
        
        vm.prank(user);
        bridge.claim(depositId, expectedAmountAfterFee, proof);
        
        // Second claim (should fail)
        vm.prank(user);
        vm.expectRevert("Already claimed");
        bridge.claim(depositId, expectedAmountAfterFee, proof);
    }
    
    // ============ Dispute Tests ============
    
    function test_InitiateDispute_WhenValid() public {
        // Make a deposit
        uint256 depositAmount = 1 ether;
        
        vm.prank(user);
        bytes32 depositId = bridge.depositEth{value: depositAmount}(NEAR_RECIPIENT);
        
        // Initiate dispute
        string memory reason = "Test dispute";
        vm.prank(user);
        bridge.initiateDispute(depositId, reason);
        
        // Check dispute was initiated
        ( , , , , , , bool disputed, uint256 disputeEndTime) = bridge.deposits(depositId);
        assertTrue(disputed);
        assertGt(disputeEndTime, block.timestamp);
    }
    
    function test_ResolveDispute_WhenApproved() public {
        // Make a deposit and initiate a dispute
        uint256 depositAmount = 1 ether;
        uint256 expectedAmountAfterFee = depositAmount - ((depositAmount * BRIDGE_FEE_BPS) / 10000);
        
        vm.prank(user);
        bytes32 depositId = bridge.depositEth{value: depositAmount}(NEAR_RECIPIENT);
        
        vm.prank(user);
        bridge.initiateDispute(depositId, "Test dispute");
        
        // Resolve dispute (approve)
        uint256 userBalanceBefore = user.balance;
        
        vm.prank(relayer);
        bridge.resolveDispute(depositId, true, "Approved");
        
        // Check user received the funds
        assertEq(user.balance, userBalanceBefore + expectedAmountAfterFee);
        
        // Check deposit is marked as claimed
        ( , , , , , bool claimed, , ) = bridge.deposits(depositId);
        assertTrue(claimed);
    }
    
    function test_ResolveDispute_WhenRejected() public {
        // Make a deposit and initiate a dispute
        uint256 depositAmount = 1 ether;
        
        vm.prank(user);
        bytes32 depositId = bridge.depositEth{value: depositAmount}(NEAR_RECIPIENT);
        
        vm.prank(user);
        bridge.initiateDispute(depositId, "Test dispute");
        
        // Resolve dispute (reject)
        vm.prank(relayer);
        bridge.resolveDispute(depositId, false, "Rejected: insufficient proof");
        
        // Check deposit is marked as claimed (but no funds transferred)
        ( , , , , , bool claimed, , ) = bridge.deposits(depositId);
        assertTrue(claimed);
    }
    
    // ============ Admin Functions Tests ============
    
    function test_UpdateConfig_WhenOwner() public {
        address newFeeCollector = makeAddr("newFeeCollector");
        uint256 newMinDeposit = MIN_DEPOSIT + 0.1 ether;
        uint256 newMaxDeposit = MAX_DEPOSIT + 1 ether;
        uint256 newDisputePeriod = DISPUTE_PERIOD + 1 days;
        uint256 newBridgeFeeBps = BRIDGE_FEE_BPS + 1;
        
        vm.prank(owner);
        bridge.updateConfig(NearBridge.BridgeConfig({
            feeCollector: newFeeCollector,
            minDeposit: newMinDeposit,
            maxDeposit: newMaxDeposit,
            disputePeriod: newDisputePeriod,
            bridgeFeeBps: newBridgeFeeBps,
            status: NearBridge.BridgeStatus.ACTIVE
        }));
        
        (address feeCollectorAddr, uint256 minDeposit, uint256 maxDeposit, uint256 disputePeriod, uint256 bridgeFeeBps, ) = 
            bridge.config();
            
        assertEq(feeCollectorAddr, newFeeCollector);
        assertEq(minDeposit, newMinDeposit);
        assertEq(maxDeposit, newMaxDeposit);
        assertEq(disputePeriod, newDisputePeriod);
        assertEq(bridgeFeeBps, newBridgeFeeBps);
    }
    
    function test_UpdateConfig_RevertWhenNotOwner() public {
        vm.prank(user);
        vm.expectRevert("Ownable: caller is not the owner");
        bridge.updateConfig(NearBridge.BridgeConfig({
            feeCollector: feeCollector,
            minDeposit: MIN_DEPOSIT,
            maxDeposit: MAX_DEPOSIT,
            disputePeriod: DISPUTE_PERIOD,
            bridgeFeeBps: BRIDGE_FEE_BPS,
            status: NearBridge.BridgeStatus.ACTIVE
        }));
    }
    
    function test_EmergencyWithdraw_WhenOwner() public {
        // Send some ETH to the bridge
        uint256 withdrawAmount = 1 ether;
        (bool success, ) = address(bridge).call{value: withdrawAmount}("");
        require(success, "ETH transfer failed");
        
        // Withdraw ETH
        uint256 ownerBalanceBefore = owner.balance;
        
        vm.prank(owner);
        bridge.emergencyWithdraw(address(0), owner, withdrawAmount);
        
        assertEq(owner.balance, ownerBalanceBefore + withdrawAmount);
    }
    
    function test_EmergencyWithdraw_RevertWhenNotOwner() public {
        vm.prank(user);
        vm.expectRevert("Ownable: caller is not the owner");
        bridge.emergencyWithdraw(address(0), user, 1 ether);
    }
    
    // ============ Relayer Functions Tests ============
    
    function test_ProcessDeposit_WhenRelayer() public {
        bytes32 depositId = _createTestDeposit();
        
        // Check deposit was created
        (address tokenAddr, , , uint256 amount, , , , ) = bridge.deposits(depositId);
        assertEq(tokenAddr, address(0));
        assertEq(amount, 0.9 ether); // 1 ETH - 0.1% fee
    }
    
    function test_ProcessDeposit_RevertWhenNotRelayer() public {
        vm.prank(user);
        vm.expectRevert("Not a relayer");
        bridge.processDeposit(address(0), 1 ether, NEAR_RECIPIENT, user);
    }
    
    // ============ Helper Functions ============
    
    function _createTestDeposit() internal returns (bytes32) {
        uint256 depositAmount = 1 ether;
        
        // User makes a deposit
        vm.prank(user);
        bytes32 depositId = bridge.depositEth{value: depositAmount}(NEAR_RECIPIENT);
        
        // Relayer processes the deposit
        uint256 amountAfterFee = depositAmount - ((depositAmount * BRIDGE_FEE_BPS) / 10000);
        vm.prank(relayer);
        bridge.processDeposit(address(0), amountAfterFee, NEAR_RECIPIENT, user);
        
        return depositId;
    }
}
