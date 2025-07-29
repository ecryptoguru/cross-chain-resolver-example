// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "forge-std/Test.sol";
import "forge-std/console.sol";
import "@openzeppelin-contracts/contracts/access/Ownable.sol";
import "@openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import "../src/NearBridge.sol";

// MockToken contract for testing
contract MockToken {
    string public name;
    string public symbol;
    uint8 public decimals = 18;
    uint256 public totalSupply;
    
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    
    constructor(string memory _name, string memory _symbol) {
        name = _name;
        symbol = _symbol;
        _mint(msg.sender, 1000000 * 10**uint256(decimals));
    }
    
    function _mint(address to, uint256 value) internal {
        totalSupply += value;
        balanceOf[to] += value;
        emit Transfer(address(0), to, value);
    }
    
    function transfer(address to, uint256 value) public returns (bool) {
        require(balanceOf[msg.sender] >= value, "Insufficient balance");
        balanceOf[msg.sender] -= value;
        balanceOf[to] += value;
        emit Transfer(msg.sender, to, value);
        return true;
    }
    
    function approve(address spender, uint256 value) public returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }
    
    function transferFrom(address from, address to, uint256 value) public returns (bool) {
        require(balanceOf[from] >= value, "Insufficient balance");
        require(allowance[from][msg.sender] >= value, "Insufficient allowance");
        
        balanceOf[from] -= value;
        balanceOf[to] += value;
        allowance[from][msg.sender] -= value;
        
        emit Transfer(from, to, value);
        return true;
    }
}

contract NearBridgeMinimalTest is Test {
    // Test contracts
    NearBridge public nearBridge;
    MockToken public token;
    
    // Test addresses
    address public owner = address(0x1);
    address public relayer = address(0x2);
    address public user = address(0x3);
    address public feeCollector = address(0x4);
    
    // Test constants
    uint256 public constant MIN_DEPOSIT = 0.1 ether;
    uint256 public constant MAX_DEPOSIT = 1000 ether;
    uint256 public constant DISPUTE_PERIOD = 1 days;
    uint256 public constant BRIDGE_FEE_BPS = 100; // 1%
    
    // Setup function
    function setUp() public {
        // Set up test accounts
        vm.startPrank(owner);
        
        // Deploy test token
        token = new MockToken("Test Token", "TEST");
        
        // Deploy NearBridge with test parameters
        nearBridge = new NearBridge(
            owner,              // owner
            address(token),     // feeToken
            address(0),         // accessToken (optional)
            feeCollector,       // feeCollector
            MIN_DEPOSIT,        // minDeposit
            MAX_DEPOSIT,        // maxDeposit
            DISPUTE_PERIOD,     // disputePeriod
            BRIDGE_FEE_BPS,     // bridgeFeeBps (1%)
            NearBridge.BridgeStatus.ACTIVE  // initialStatus
        );
        
        // Add relayer
        nearBridge.addRelayer(relayer);
        
        // Fund test accounts
        token.transfer(user, 1000 ether);
        
        vm.stopPrank();
    }
    
    // Test deployment
    function test_Deployment() public {
        // Check owner
        assertEq(nearBridge.owner(), owner);
        
        // Check initial config
        (address feeCollectorAddr, uint256 minDeposit, uint256 maxDeposit, , uint256 bridgeFeeBps, ) = nearBridge.config();
        assertEq(feeCollectorAddr, feeCollector, "Incorrect fee collector");
        assertEq(minDeposit, MIN_DEPOSIT, "Incorrect min deposit");
        assertEq(maxDeposit, MAX_DEPOSIT, "Incorrect max deposit");
        assertEq(bridgeFeeBps, BRIDGE_FEE_BPS, "Incorrect bridge fee");
        
        // Check relayer was added
        assertTrue(nearBridge.relayers(relayer), "Relayer not added");
    }
    
    // Test adding relayers
    function test_AddRelayer() public {
        address newRelayer = address(0x5);
        
        // Add relayer as owner
        vm.prank(owner);
        nearBridge.addRelayer(newRelayer);
        
        // Check relayer was added
        assertTrue(nearBridge.relayers(newRelayer), "Relayer not added");
    }
    
    // Test removing relayers
    function test_RemoveRelayer() public {
        // Add a relayer first
        address newRelayer = address(0x5);
        vm.prank(owner);
        nearBridge.addRelayer(newRelayer);
        
        // Remove relayer
        vm.prank(owner);
        nearBridge.removeRelayer(newRelayer);
        
        // Check relayer was removed
        assertFalse(nearBridge.relayers(newRelayer), "Relayer not removed");
    }
    
    // Test ETH deposits
    function test_DepositEth() public {
        uint256 depositAmount = 1 ether;
        
        // Make ETH deposit
        vm.prank(user);
        vm.deal(user, depositAmount);
        nearBridge.depositEth{value: depositAmount}(
            "test.near",
            keccak256("secret"),
            block.timestamp + 1 days
        );
        
        // Check contract received ETH (minus fees)
        assertTrue(address(nearBridge).balance > 0, "No ETH deposited");
    }
    
    // Test token deposits
    function test_DepositToken() public {
        uint256 depositAmount = 100 ether;
        
        // Set token as supported
        vm.prank(owner);
        nearBridge.setSupportedToken(address(token), true);
        
        // Approve and deposit tokens
        vm.prank(user);
        token.approve(address(nearBridge), depositAmount);
        
        vm.prank(user);
        nearBridge.depositToken(
            address(token),
            depositAmount,
            "test.near",
            keccak256("secret"),
            block.timestamp + 1 days
        );
        
        // Check tokens were transferred (minus fees)
        assertTrue(token.balanceOf(address(nearBridge)) > 0, "No tokens deposited");
    }
    
    // Test setting supported tokens
    function test_SetSupportedToken() public {
        address testToken = address(0x123);
        
        // Set token as supported
        vm.prank(owner);
        nearBridge.setSupportedToken(testToken, true);
        
        // Check token is supported
        assertTrue(nearBridge.supportedTokens(testToken), "Token not supported");
        
        // Remove support
        vm.prank(owner);
        nearBridge.setSupportedToken(testToken, false);
        
        // Check token is no longer supported
        assertFalse(nearBridge.supportedTokens(testToken), "Token still supported");
    }
    
    // Test updating bridge status
    function test_UpdateBridgeStatus() public {
        // Pause bridge
        vm.prank(owner);
        nearBridge.updateBridgeStatus(NearBridge.BridgeStatus.PAUSED);
        
        // Check status was updated
        (, , , , , NearBridge.BridgeStatus status) = nearBridge.config();
        assertTrue(status == NearBridge.BridgeStatus.PAUSED, "Bridge not paused");
        
        // Reactivate bridge
        vm.prank(owner);
        nearBridge.updateBridgeStatus(NearBridge.BridgeStatus.ACTIVE);
        
        // Check status was updated
        (, , , , , status) = nearBridge.config();
        assertTrue(status == NearBridge.BridgeStatus.ACTIVE, "Bridge not active");
    }
}
