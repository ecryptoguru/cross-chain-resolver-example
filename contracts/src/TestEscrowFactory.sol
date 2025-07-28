// SPDX-License-Identifier: MIT

pragma solidity 0.8.30;

import "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import "cross-chain-swap/EscrowFactory.sol";
import "cross-chain-swap/interfaces/IBaseEscrow.sol";

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
     * @dev Override createDstEscrow to add NEAR-specific logic
     */
    function createDstEscrow(
        IBaseEscrow.Immutables calldata immutables,
        uint256 srcCancellationTimestamp
    ) public payable override returns (address escrow) {
        escrow = super.createDstEscrow(immutables, srcCancellationTimestamp);
        
        // Check if this is a NEAR-related escrow (using chain ID)
        if (immutables.chainId.get() == NEAR_CHAIN_ID) {
            nearEscrows[escrow] = true;
            
            // Emit event for NEAR escrow creation
            emit NearEscrowCreated(
                escrow,
                string(abi.encodePacked(immutables.recipient)),
                immutables.amount.get(),
                immutables.secretHash.get(),
                immutables.timelock.get()
            );
        }
        
        return escrow;
    }
    
    /**
     * @dev Function to check if an escrow is a NEAR escrow
     * @param escrow The address of the escrow to check
     * @return bool True if the escrow is a NEAR escrow
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
    
    /**
     * @notice Override createDstEscrow to add NEAR-specific logic
     */
    function createDstEscrow(
        IBaseEscrow.Immutables calldata immutables,
        uint256 srcCancellationTimestamp
    ) external payable override returns (address escrow) {
        escrow = super.createDstEscrow(immutables, srcCancellationTimestamp);
        
        // Check if this is a NEAR-related escrow (using the token address as a proxy for now)
        // Note: In a real implementation, we would need to properly identify NEAR-related escrows
        // based on the actual chain ID or other criteria from the immutables
        nearEscrows[escrow] = true;
        emit NearEscrowCreated(
            escrow,
                string(abi.encodePacked(immutables.recipient)),
                immutables.amount,
                immutables.secretHash,
                immutables.timelocks.timelock()
            );
        
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
