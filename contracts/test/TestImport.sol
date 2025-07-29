// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import { AddressLib } from "@1inch/solidity-utils/contracts/libraries/AddressLib.sol";

contract TestImport {
    using AddressLib for address;
    
    function test() public pure returns (bool) {
        return true;
    }
}
