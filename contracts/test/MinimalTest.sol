// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "forge-std/Test.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";

// Minimal test contract to verify imports
contract MinimalTest is Test {
    function test_imports() public {
        // Just a simple test to verify imports work
        assertTrue(true);
    }
}
