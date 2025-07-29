// SPDX-License-Identifier: MIT

pragma solidity 0.8.23;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/utils/Create2.sol";
import "../lib/cross-chain-swap/contracts/EscrowFactory.sol";
import "../lib/cross-chain-swap/contracts/libraries/ImmutablesLib.sol";
import "../lib/cross-chain-swap/contracts/interfaces/IBaseEscrow.sol";

/**
 * @title TestEscrowFactory with NEAR Protocol Support
 * @dev Extends the base EscrowFactory to support NEAR Protocol integration
 */
contract TestEscrowFactory is EscrowFactory, Ownable {
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
    ) Ownable(owner) EscrowFactory(limitOrderProtocol, feeToken, accessToken, owner, rescueDelaySrc, rescueDelayDst) {
        // Ownership is already set by Ownable(owner)
    }
    
    /**
     * @notice Creates a destination escrow and adds NEAR-specific logic
     * @param dstImmutables The immutable parameters for the destination escrow
     * @param srcCancellationTimestamp The timestamp when the source escrow can be cancelled
     */
    function createDstEscrow(
        IBaseEscrow.Immutables calldata dstImmutables,
        uint256 srcCancellationTimestamp
    ) external payable override {
        // Call the parent contract's createDstEscrow function
        // We need to use a low-level call to avoid the external visibility issue with super
        (bool success, ) = address(this).delegatecall(
            abi.encodeWithSelector(
                BaseEscrowFactory.createDstEscrow.selector,
                dstImmutables,
                srcCancellationTimestamp
            )
        );
        require(success, "Failed to create destination escrow");
        
        // Get the escrow address using the same logic as the parent
        bytes32 salt = ImmutablesLib.hash(dstImmutables);
        bytes32 creationCode = _PROXY_DST_BYTECODE_HASH;
        address escrow = Create2.computeAddress(salt, creationCode);
        
        // TODO: Implement NEAR escrow identification logic here
        // For now, we're not marking any escrows as NEAR escrows
        // In the future, we can use a different mechanism to identify NEAR escrows
    }
    
    /**
     * @notice Check if an escrow is for NEAR Protocol
     * @param escrow The escrow contract address to check
     * @return bool True if the escrow is for NEAR Protocol
     */
    function isNearEscrow(address escrow) external view returns (bool) {
        return nearEscrows[escrow];
    }
    
    /**
     * @dev Function to handle NEAR-specific deposit logic
     * @param escrow The address of the NEAR escrow
     * @param nearRecipient The NEAR account that will receive the funds
     * @param amount The amount of tokens to deposit
     * @param secretHash The hash of the secret used for the hashlock
     * @param timelock The timestamp when the deposit can be refunded
     */
    function handleNearDeposit(
        address escrow,
        string calldata nearRecipient,
        uint256 amount,
        bytes32 secretHash,
        uint256 timelock
    ) external onlyOwner {
        require(nearEscrows[escrow], "Not a NEAR escrow");
        
        // Additional validation can be added here
        require(amount > 0, "Invalid amount");
        require(timelock > block.timestamp, "Invalid timelock");
        
        // Emit event for off-chain services to pick up
        emit NearEscrowCreated(
            escrow,
            nearRecipient,
            amount,
            secretHash,
            timelock
        );
    }
}
