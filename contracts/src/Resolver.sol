// SPDX-License-Identifier: MIT

pragma solidity 0.8.23;

import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";

import {IOrderMixin} from "limit-order-protocol/contracts/interfaces/IOrderMixin.sol";
import {TakerTraits} from "limit-order-protocol/contracts/libraries/TakerTraitsLib.sol";

import {IResolverExample} from "../lib/cross-chain-swap/contracts/interfaces/IResolverExample.sol";
import {RevertReasonForwarder} from "../lib/cross-chain-swap/lib/solidity-utils/contracts/libraries/RevertReasonForwarder.sol";
import {IEscrowFactory} from "../lib/cross-chain-swap/contracts/interfaces/IEscrowFactory.sol";
import {IBaseEscrow} from "../lib/cross-chain-swap/contracts/interfaces/IBaseEscrow.sol";
import {TimelocksLib, Timelocks} from "../lib/cross-chain-swap/contracts/libraries/TimelocksLib.sol";
import {Address} from "solidity-utils/contracts/libraries/AddressLib.sol";
import {IEscrow} from "../lib/cross-chain-swap/contracts/interfaces/IEscrow.sol";
import {ImmutablesLib} from "../lib/cross-chain-swap/contracts/libraries/ImmutablesLib.sol";

// NEAR-specific interfaces
interface INearBridge {
    function deposit() external payable;
    function withdraw(bytes calldata proofData, bytes calldata blockHeaderLite, bytes calldata blockProof) external;
}

interface INearToken {
    function ft_transfer_call(
        string memory receiver_id,
        uint128 amount,
        string memory memo,
        bytes memory msg
    ) external returns (bool);
}

/**
 * @title Cross-chain Resolver for 1inch Fusion+ and NEAR Protocol
 * @dev This contract handles cross-chain swaps between Ethereum and NEAR Protocol.
 * It extends the base Resolver functionality to support NEAR-specific operations.
 *
 * @custom:security-contact security@1inch.io
 */
contract Resolver is Ownable {
    // Events for NEAR integration
    event NearDepositInitiated(
        address indexed sender,
        string nearRecipient,
        uint256 amount,
        bytes32 secretHash,
        uint256 timelock
    );
    
    event NearWithdrawalCompleted(
        bytes32 indexed secretHash,
        string nearRecipient,
        uint256 amount
    );
    
    event NearRefunded(
        bytes32 indexed secretHash,
        string nearRecipient,
        uint256 amount
    );
    
    // Constants for NEAR integration
    address public constant NEAR_BRIDGE = 0x3FEFc5A022Bf1f57d3D1fDd5cc20c42e467E4bEe; // Example address, update with actual
    string public constant NEAR_TOKEN_CONTRACT = "wrap.near"; // NEAR token contract on NEAR
    
    // Mapping to track NEAR deposits
    mapping(bytes32 => bool) public nearDeposits;
    using ImmutablesLib for IBaseEscrow.Immutables;
    using TimelocksLib for Timelocks;

    error InvalidLength();
    error LengthMismatch();

    IEscrowFactory private immutable _FACTORY;
    IOrderMixin private immutable _LOP;

    constructor(IEscrowFactory factory, IOrderMixin lop, address initialOwner) Ownable(initialOwner) {
        _FACTORY = factory;
        _LOP = lop;
    }

    receive() external payable {} // solhint-disable-line no-empty-blocks

    /**
     * @notice See {IResolverExample-deploySrc}.
     */
    function deploySrc(
        IBaseEscrow.Immutables calldata immutables,
        IOrderMixin.Order calldata order,
        bytes32 r,
        bytes32 vs,
        uint256 amount,
        TakerTraits takerTraits,
        bytes calldata args
    ) external payable onlyOwner {

        IBaseEscrow.Immutables memory immutablesMem = immutables;
        immutablesMem.timelocks = TimelocksLib.setDeployedAt(immutables.timelocks, block.timestamp);
        address computed = _FACTORY.addressOfEscrowSrc(immutablesMem);

        (bool success,) = address(computed).call{value: immutablesMem.safetyDeposit}("");
        if (!success) revert IBaseEscrow.NativeTokenSendingFailure();

        // _ARGS_HAS_TARGET = 1 << 251
        takerTraits = TakerTraits.wrap(TakerTraits.unwrap(takerTraits) | uint256(1 << 251));
        bytes memory argsMem = abi.encodePacked(computed, args);
        _LOP.fillOrderArgs(order, r, vs, amount, takerTraits, argsMem);
    }

    /**
     * @notice See {IResolverExample-deployDst}.
     */
    function deployDst(IBaseEscrow.Immutables calldata dstImmutables, uint256 srcCancellationTimestamp) external onlyOwner payable {
        _FACTORY.createDstEscrow{value: msg.value}(dstImmutables, srcCancellationTimestamp);
    }

    /**
     * @notice Withdraw funds from escrow using the secret
     * @param escrow The escrow contract address
     * @param secret The secret to unlock the funds
     * @param immutables Immutable parameters for the escrow
     */
    function withdraw(IEscrow escrow, bytes32 secret, IBaseEscrow.Immutables calldata immutables) external {
        escrow.withdraw(secret, immutables);
        
        // If this is a NEAR-related withdrawal, emit an event
        if (nearDeposits[keccak256(abi.encodePacked(immutables.dstChainId, immutables.recipient))]) {
            emit NearWithdrawalCompleted(
                keccak256(abi.encodePacked(secret)),
                string(abi.encodePacked(immutables.recipient)),
                immutables.amount
            );
            
            // Clean up
            delete nearDeposits[keccak256(abi.encodePacked(immutables.dstChainId, immutables.recipient))];
        }
    }


    /**
     * @notice Cancel an escrow and handle NEAR-specific cleanup if needed
     * @param escrow The escrow contract address
     * @param immutables Immutable parameters for the escrow
     */
    function cancel(IEscrow escrow, IBaseEscrow.Immutables calldata immutables) external {
        escrow.cancel(immutables);
        
        // If this is a NEAR-related escrow, emit refund event
        bytes32 depositKey = keccak256(abi.encodePacked(immutables.dstChainId, immutables.recipient));
        if (nearDeposits[depositKey]) {
            emit NearRefunded(
                depositKey,
                string(abi.encodePacked(immutables.recipient)),
                immutables.amount
            );
            
            // Clean up
            delete nearDeposits[depositKey];
        }
    }

    /**
     * @notice See {IResolverExample-arbitraryCalls}.
     */
    function arbitraryCalls(address[] calldata targets, bytes[] calldata arguments) external onlyOwner {
        uint256 length = targets.length;
        if (targets.length != arguments.length) revert LengthMismatch();
        for (uint256 i = 0; i < length; ++i) {
            // solhint-disable-next-line avoid-low-level-calls
            (bool success,) = targets[i].call(arguments[i]);
            if (!success) RevertReasonForwarder.reRevert();
        }
    }
}
