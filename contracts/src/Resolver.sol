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
    
    // Constants for NEAR integration
    uint256 public constant NEAR_CHAIN_ID = 397;
    uint256 public constant MIN_NEAR_DEPOSIT = 0.1 ether; // Minimum deposit amount
    
    // Struct to track NEAR deposits
    struct NearDeposit {
        address sender;
        string nearRecipient;
        uint256 amount;
        bytes32 secretHash;
        uint256 timelock;
        bool withdrawn;
    }
    
    // Mapping to track NEAR deposits by secret hash
    mapping(bytes32 => NearDeposit) public nearDeposits;
    
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
    
    /**
     * @dev Internal function to handle NEAR deposits
     * @param immutables The immutables from the escrow
     * @param secret The secret used for the hashlock
     */
    function _handleNearDeposit(
        IBaseEscrow.Immutables memory immutables,
        bytes32 secret
    ) internal {
        // Verify the deposit amount meets minimum requirements
        require(immutables.amount.get() >= MIN_NEAR_DEPOSIT, "Deposit amount too low");
        
        // Generate secret hash from the provided secret
        bytes32 secretHash = keccak256(abi.encodePacked(secret));
        
        // Store the NEAR deposit details
        nearDeposits[secretHash] = NearDeposit({
            sender: immutables.taker.get(),
            nearRecipient: string(abi.encodePacked(immutables.recipient)),
            amount: immutables.amount.get(),
            secretHash: secretHash,
            timelock: block.timestamp + 24 hours, // 24-hour timelock
            withdrawn: false
        });
        
        // Emit event for off-chain services to pick up
        emit NearDepositInitiated(
            immutables.taker.get(),
            string(abi.encodePacked(immutables.recipient)),
            immutables.amount.get(),
            secretHash,
            block.timestamp + 24 hours
        );
    }
    
    /**
     * @dev Function to complete a NEAR withdrawal
     * @param secret The secret that was used to create the hashlock
     * @param nearRecipient The NEAR account that will receive the funds
     */
    function completeNearWithdrawal(
        bytes32 secret,
        string calldata nearRecipient
    ) external {
        bytes32 secretHash = keccak256(abi.encodePacked(secret));
        NearDeposit storage deposit = nearDeposits[secretHash];
        
        // Verify the deposit exists and hasn't been withdrawn
        require(deposit.amount > 0, "Deposit not found");
        require(!deposit.withdrawn, "Already withdrawn");
        require(block.timestamp <= deposit.timelock, "Timelock expired");
        
        // Mark as withdrawn to prevent reentrancy
        deposit.withdrawn = true;
        
        // Transfer the funds to the NEAR bridge contract
        // In a real implementation, this would interact with the NEAR bridge
        // For now, we'll just emit an event
        emit NearWithdrawalCompleted(
            secretHash,
            nearRecipient,
            deposit.amount
        );
    }
    
    /**
     * @dev Function to refund a NEAR deposit after the timelock expires
     * @param secretHash The hash of the secret used for the deposit
     */
    function refundNearDeposit(bytes32 secretHash) external {
        NearDeposit storage deposit = nearDeposits[secretHash];
        
        // Verify the deposit exists and hasn't been withdrawn
        require(deposit.amount > 0, "Deposit not found");
        require(!deposit.withdrawn, "Already withdrawn");
        require(block.timestamp > deposit.timelock, "Timelock not expired");
        
        // Mark as withdrawn to prevent reentrancy
        deposit.withdrawn = true;
        
        // In a real implementation, transfer the funds back to the original sender
        // For now, we'll just emit an event
        emit NearRefunded(
            secretHash,
            deposit.nearRecipient,
            deposit.amount
        );
    }
    
    // Constants for NEAR integration
    address public constant NEAR_BRIDGE = 0x3fEFc5a022BF1f57d3d1FDd5Cc20C42e467e4bEe; // Fixed checksum address
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
     * @notice Initiate a deposit to NEAR bridge
     * @param nearRecipient NEAR account ID of the recipient
     * @param secretHash Hash of the secret for atomic swap
     * @param timelock Timestamp until which the deposit is locked
     */
    function depositToNear(
        string calldata nearRecipient,
        bytes32 secretHash,
        uint256 timelock
    ) external payable {
        require(msg.value > 0, "Resolver: amount must be greater than 0");
        require(timelock > block.timestamp, "Resolver: invalid timelock");
        
        // Store the deposit information
        bytes32 depositKey = keccak256(abi.encodePacked(block.chainid, nearRecipient));
        nearDeposits[depositKey] = true;
        
        // Convert NEAR amount (1e24 yoctoNEAR = 1 NEAR)
        uint128 nearAmount = uint128(msg.value / 1e10); // Convert wei to yoctoNEAR (1e24)
        
        // Emit event for the relayer to pick up
        emit NearDepositInitiated(
            msg.sender,
            nearRecipient,
            msg.value,
            secretHash,
            timelock
        );
        
        // In a real implementation, this would interact with the NEAR bridge contract
        // For now, we'll just emit an event and the relayer will handle the actual bridge interaction
    }
    
    /**
     * @notice Complete a withdrawal from NEAR bridge
     * @param proofData Proof data from NEAR bridge
     * @param blockHeaderLite NEAR block header lite
     * @param blockProof Proof of block header
     * @param recipient Ethereum address to receive the funds
     * @param amount Amount to withdraw
     */
    function completeNearWithdrawal(
        bytes calldata proofData,
        bytes calldata blockHeaderLite,
        bytes calldata blockProof,
        address payable recipient,
        uint256 amount
    ) external onlyOwner {
        // In a real implementation, this would verify the proof and withdraw from the bridge
        // For now, we'll just transfer the funds to the recipient
        (bool success, ) = recipient.call{value: amount}("");
        require(success, "Resolver: transfer failed");
    }
    
    /**
     * @notice Refund a NEAR deposit
     * @param nearRecipient Original NEAR recipient
     * @param secretHash Hash of the secret used for the deposit
     */
    function refundNearDeposit(
        string calldata nearRecipient,
        bytes32 secretHash
    ) external onlyOwner {
        bytes32 depositKey = keccak256(abi.encodePacked(block.chainid, nearRecipient));
        require(nearDeposits[depositKey], "Resolver: no active deposit");
        
        // Emit refund event
        emit NearRefunded(
            secretHash,
            nearRecipient,
            address(this).balance // In a real implementation, this would be the actual deposit amount
        );
        
        // Clean up
        delete nearDeposits[depositKey];
    }

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
        // For NEAR integration, we need to handle deposits differently
        if (immutables.chainId.get() == NEAR_CHAIN_ID) {
            _handleNearDeposit(immutables, secret);
            return;
        }

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
if (nearDeposits[keccak256(abi.encodePacked(immutables.taker.get(), immutables.token.get()))]) {
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
