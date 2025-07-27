// SPDX-License-Identifier: MIT

pragma solidity 0.8.23;

import "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import "cross-chain-swap/EscrowFactory.sol";

/**
 * @title TestEscrowFactory with NEAR Protocol Support
 * @dev Extends the base EscrowFactory to support NEAR Protocol integration
 */
contract TestEscrowFactory is EscrowFactory {
    // NEAR-specific events
    event NearEscrowCreated(
        address indexed escrowAddress,
        string nearRecipient,
        uint256 amount,
        bytes32 secretHash,
        uint256 timelock
    );
    
    // NEAR chain ID (following EIP-155)
    uint256 public constant NEAR_CHAIN_ID = 397;
    
    // Mapping to track NEAR escrows
    mapping(address => bool) public nearEscrows;

    constructor(
        address limitOrderProtocol,
        IERC20 feeToken,
        IERC20 accessToken,
        address owner,
        uint32 rescueDelaySrc,
        uint32 rescueDelayDst
    ) EscrowFactory(limitOrderProtocol, feeToken, accessToken, owner, rescueDelayDst, rescueDelayDst) {}
    
    /**
     * @notice Override createDstEscrow to add NEAR-specific logic
     */
    function createDstEscrow(
        IBaseEscrow.Immutables calldata immutables,
        uint256 srcCancellationTimestamp
    ) external payable override returns (address escrow) {
        escrow = super.createDstEscrow(immutables, srcCancellationTimestamp);
        
        // Check if this is a NEAR-related escrow
        if (immutables.dstChainId == NEAR_CHAIN_ID) {
            nearEscrows[escrow] = true;
            emit NearEscrowCreated(
                escrow,
                string(abi.encodePacked(immutables.recipient)),
                immutables.amount,
                immutables.secretHash,
                immutables.timelocks.timelock()
            );
        }
        
        return escrow;
    }
    
    /**
     * @notice Check if an escrow is for NEAR Protocol
     * @param escrow The escrow contract address to check
     * @return bool True if the escrow is for NEAR Protocol
     */
    function isNearEscrow(address escrow) external view returns (bool) {
        return nearEscrows[escrow];
    }
}
