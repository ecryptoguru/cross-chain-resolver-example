// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import {Script, console} from "forge-std/Script.sol";
import {NearBridge} from "../src/NearBridge.sol";

contract DeployNearBridge is Script {
    // Configuration for Sepolia testnet
    uint256 public constant MIN_DEPOSIT = 0.01 ether; // 0.01 ETH
    uint256 public constant MAX_DEPOSIT = 100 ether;   // 100 ETH
    uint256 public constant DISPUTE_PERIOD = 7 days;   // 7 days
    uint256 public constant BRIDGE_FEE_BPS = 10;       // 0.1%

    function run() external {
        // Get private key from environment variable
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address feeCollector = vm.envAddress("FEE_COLLECTOR");
        
        // Validate configuration
        require(feeCollector != address(0), "FEE_COLLECTOR not set");
        require(deployerPrivateKey != 0, "PRIVATE_KEY not set");
        
        // Start broadcasting transactions
        vm.startBroadcast(deployerPrivateKey);
        
        // Deploy the bridge
        NearBridge bridge = new NearBridge(
            feeCollector,
            MIN_DEPOSIT,
            MAX_DEPOSIT,
            DISPUTE_PERIOD,
            BRIDGE_FEE_BPS
        );
        
        // Add relayer (deployer is added as relayer in constructor)
        // Additional relayers can be added using bridge.setRelayer()
        
        vm.stopBroadcast();
        
        // Log deployment information
        console.log("NearBridge deployed to:", address(bridge));
        console.log("Owner:", bridge.owner());
        console.log("Fee Collector:", feeCollector);
        console.log("Min Deposit:", MIN_DEPOSIT);
        console.log("Max Deposit:", MAX_DEPOSIT);
        console.log("Dispute Period:", DISPUTE_PERIOD);
        console.log("Bridge Fee (bps):", BRIDGE_FEE_BPS);
    }
}
