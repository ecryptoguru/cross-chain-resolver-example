// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "forge-std/Script.sol";
import "../contracts/src/NearBridge.sol";
import "../contracts/src/TestEscrowFactory.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract DeployScript is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        
        console.log("Deploying contracts to Sepolia testnet...");
        console.log("Deployer address:", deployer);
        console.log("Deployer balance:", deployer.balance);
        
        vm.startBroadcast(deployerPrivateKey);
        
        // Deploy a simple fee token for testing
        MockToken feeToken = new MockToken("Bridge Fee Token", "BFT");
        console.log("Fee Token deployed at:", address(feeToken));
        
        // Deploy NearBridge contract
        NearBridge nearBridge = new NearBridge(
            deployer,                    // owner
            address(feeToken),          // feeToken
            address(0),                 // accessToken (optional)
            deployer,                   // feeCollector
            0.01 ether,                 // minDeposit
            100 ether,                  // maxDeposit
            7 days,                     // disputePeriod
            100,                        // bridgeFeeBps (1%)
            NearBridge.BridgeStatus.ACTIVE  // initialStatus
        );
        console.log("NearBridge deployed at:", address(nearBridge));
        
        // Deploy TestEscrowFactory
        TestEscrowFactory escrowFactory = new TestEscrowFactory(
            address(0x1111111111111111111111111111111111111111), // limitOrderProtocol (placeholder)
            IERC20(address(feeToken)),   // feeToken
            IERC20(address(0)),          // accessToken (optional)
            deployer,                    // owner
            86400,                       // rescueDelaySrc (1 day)
            86400                        // rescueDelayDst (1 day)
        );
        console.log("TestEscrowFactory deployed at:", address(escrowFactory));
        
        vm.stopBroadcast();
        
        // Log deployment summary
        console.log("\n=== DEPLOYMENT SUMMARY ===");
        console.log("Network: Sepolia Testnet (Chain ID: 11155111)");
        console.log("Fee Token:", address(feeToken));
        console.log("NearBridge:", address(nearBridge));
        console.log("TestEscrowFactory:", address(escrowFactory));
        console.log("Deployer:", deployer);
        console.log("=========================");
    }
}

// Simple mock token for testing
contract MockToken {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
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
