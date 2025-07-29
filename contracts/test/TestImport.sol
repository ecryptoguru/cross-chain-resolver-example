// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import { Address } from "@1inch/solidity-utils/contracts/libraries/AddressLib.sol";

contract TestImport {
    using Address for address;
    
    function test() public pure returns (bool) {
        return true;
    }
}
