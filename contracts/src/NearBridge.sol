// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/security/ReentrancyGuard.sol";

/**
 * @title NearBridge - Bridge contract for Ethereum to NEAR cross-chain transfers
 * @dev Handles asset custody, message verification, and dispute resolution for cross-chain swaps
 */
contract NearBridge is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // NEAR chain ID (following EIP-155)
    uint256 public constant NEAR_CHAIN_ID = 397;
    
    // Bridge status enum
    enum BridgeStatus { ACTIVE, PAUSED, DISPUTE }
    
    // Bridge configuration
    struct BridgeConfig {
        address feeCollector;          // Address to collect bridge fees
        uint256 minDeposit;            // Minimum deposit amount
        uint256 maxDeposit;            // Maximum deposit amount
        uint256 disputePeriod;         // Time period for dispute resolution (in seconds)
        uint256 bridgeFeeBps;          // Bridge fee in basis points (1/10000)
        BridgeStatus status;           // Current bridge status
    }
    
    // Deposit data structure
    struct Deposit {
        address token;                 // Token address (address(0) for native ETH)
        address depositor;             // Address that made the deposit
        string nearRecipient;          // NEAR account ID of the recipient
        uint256 amount;                // Deposit amount
        uint256 timestamp;             // Deposit timestamp
        bool claimed;                  // Whether the deposit has been claimed
        bool disputed;                 // Whether the deposit is in dispute
        uint256 disputeEndTime;        // Timestamp when dispute period ends
    }
    
    // State variables
    BridgeConfig public config;
    mapping(bytes32 => Deposit) public deposits;  // depositId => Deposit
    mapping(address => bool) public relayers;     // Trusted relayers
    mapping(address => bool) public supportedTokens;  // Supported ERC20 tokens
    
    // Events
    event Deposited(
        bytes32 indexed depositId,
        address indexed token,
        address indexed depositor,
        string nearRecipient,
        uint256 amount,
        uint256 fee
    );
    
    event Claimed(
        bytes32 indexed depositId,
        address indexed claimer,
        uint256 amount
    );
    
    event DisputeInitiated(
        bytes32 indexed depositId,
        address indexed disputer,
        string reason
    );
    
    event DisputeResolved(
        bytes32 indexed depositId,
        bool approved,
        address resolver,
        string reason
    );
    
    event BridgeConfigUpdated(BridgeConfig newConfig);
    event RelayerUpdated(address indexed relayer, bool isActive);
    event TokenSupportUpdated(address indexed token, bool isSupported);
    
    // Modifiers
    modifier onlyRelayer() {
        require(relayers[msg.sender], "Not a relayer");
        _;
    }
    
    modifier whenActive() {
        require(config.status == BridgeStatus.ACTIVE, "Bridge is not active");
        _;
    }
    
    /**
     * @dev Constructor
     * @param _feeCollector Address to collect bridge fees
     * @param _minDeposit Minimum deposit amount
     * @param _maxDeposit Maximum deposit amount
     * @param _disputePeriod Dispute period in seconds
     * @param _bridgeFeeBps Bridge fee in basis points (1/10000)
     */
    constructor(
        address _feeCollector,
        uint256 _minDeposit,
        uint256 _maxDeposit,
        uint256 _disputePeriod,
        uint256 _bridgeFeeBps
    ) {
        require(_feeCollector != address(0), "Invalid fee collector");
        require(_minDeposit < _maxDeposit, "Invalid deposit limits");
        require(_bridgeFeeBps < 10000, "Invalid fee");
        
        config = BridgeConfig({
            feeCollector: _feeCollector,
            minDeposit: _minDeposit,
            maxDeposit: _maxDeposit,
            disputePeriod: _disputePeriod,
            bridgeFeeBps: _bridgeFeeBps,
            status: BridgeStatus.ACTIVE
        });
        
        // Owner is a relayer by default
        relayers[msg.sender] = true;
        
        emit BridgeConfigUpdated(config);
        emit RelayerUpdated(msg.sender, true);
    }
    
    // ============ User Functions ============
    
    /**
     * @dev Deposit native ETH to bridge to NEAR
     * @param nearRecipient NEAR account ID of the recipient
     */
    function depositEth(string calldata nearRecipient) external payable nonReentrant whenActive {
        require(msg.value >= config.minDeposit, "Amount below minimum");
        require(msg.value <= config.maxDeposit, "Amount exceeds maximum");
        
        _processDeposit(address(0), msg.value, nearRecipient, msg.sender);
    }
    
    /**
     * @dev Deposit ERC20 tokens to bridge to NEAR
     * @param token ERC20 token address
     * @param amount Amount to deposit
     * @param nearRecipient NEAR account ID of the recipient
     */
    function depositToken(
        address token,
        uint256 amount,
        string calldata nearRecipient
    ) external nonReentrant whenActive {
        require(supportedTokens[token], "Token not supported");
        require(amount >= config.minDeposit, "Amount below minimum");
        require(amount <= config.maxDeposit, "Amount exceeds maximum");
        
        // Transfer tokens from user to this contract
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        
        _processDeposit(token, amount, nearRecipient, msg.sender);
    }
    
    /**
     * @dev Claim tokens after they've been bridged back from NEAR
     * @param depositId Unique deposit ID
     * @param amount Amount to claim
     * @param proof Merkle proof for verification
     */
    function claim(
        bytes32 depositId,
        uint256 amount,
        bytes32[] calldata proof
    ) external nonReentrant {
        Deposit storage deposit = deposits[depositId];
        require(!deposit.claimed, "Already claimed");
        require(!deposit.disputed, "Deposit in dispute");
        require(deposit.depositor == msg.sender, "Not the depositor");
        
        // In a real implementation, verify the proof against a merkle root
        // stored in the contract and signed by relayers
        _verifyClaim(depositId, amount, proof);
        
        // Mark as claimed
        deposit.claimed = true;
        
        // Transfer tokens to the depositor
        if (deposit.token == address(0)) {
            (bool success, ) = msg.sender.call{value: amount}("");
            require(success, "ETH transfer failed");
        } else {
            IERC20(deposit.token).safeTransfer(msg.sender, amount);
        }
        
        emit Claimed(depositId, msg.sender, amount);
    }
    
    /**
     * @dev Initiate a dispute for a deposit
     * @param depositId Unique deposit ID
     * @param reason Reason for the dispute
     */
    function initiateDispute(bytes32 depositId, string calldata reason) external {
        Deposit storage deposit = deposits[depositId];
        require(deposit.depositor == msg.sender, "Not the depositor");
        require(!deposit.claimed, "Already claimed");
        require(!deposit.disputed, "Already in dispute");
        
        deposit.disputed = true;
        deposit.disputeEndTime = block.timestamp + config.disputePeriod;
        
        emit DisputeInitiated(depositId, msg.sender, reason);
    }
    
    // ============ Relayer Functions ============
    
    /**
     * @dev Process a deposit and generate a deposit ID (relayer only)
     * @param token Token address (address(0) for native ETH)
     * @param amount Deposit amount
     * @param nearRecipient NEAR account ID of the recipient
     * @param depositor Address that made the deposit
     * @return depositId Unique deposit ID
     */
    function processDeposit(
        address token,
        uint256 amount,
        string calldata nearRecipient,
        address depositor
    ) external onlyRelayer whenActive returns (bytes32) {
        return _processDeposit(token, amount, nearRecipient, depositor);
    }
    
    /**
     * @dev Resolve a dispute (relayer only)
     * @param depositId Unique deposit ID
     * @param approved Whether to approve the claim
     * @param reason Reason for the resolution
     */
    function resolveDispute(
        bytes32 depositId,
        bool approved,
        string calldata reason
    ) external onlyRelayer {
        Deposit storage deposit = deposits[depositId];
        require(deposit.disputed, "Not in dispute");
        require(block.timestamp <= deposit.disputeEndTime, "Dispute period ended");
        
        if (approved) {
            // Transfer tokens to the depositor
            if (deposit.token == address(0)) {
                (bool success, ) = deposit.depositor.call{value: deposit.amount}("");
                require(success, "ETH transfer failed");
            } else {
                IERC20(deposit.token).safeTransfer(deposit.depositor, deposit.amount);
            }
            
            emit Claimed(depositId, deposit.depositor, deposit.amount);
        }
        
        // Mark as claimed to prevent further actions
        deposit.claimed = true;
        
        emit DisputeResolved(depositId, approved, msg.sender, reason);
    }
    
    // ============ Admin Functions ============
    
    /**
     * @dev Update bridge configuration (owner only)
     * @param newConfig New bridge configuration
     */
    function updateConfig(BridgeConfig calldata newConfig) external onlyOwner {
        require(newConfig.feeCollector != address(0), "Invalid fee collector");
        require(newConfig.minDeposit < newConfig.maxDeposit, "Invalid deposit limits");
        require(newConfig.bridgeFeeBps < 10000, "Invalid fee");
        
        config = newConfig;
        emit BridgeConfigUpdated(newConfig);
    }
    
    /**
     * @dev Add or remove a relayer (owner only)
     * @param relayer Address of the relayer
     * @param isActive Whether the relayer is active
     */
    function setRelayer(address relayer, bool isActive) external onlyOwner {
        require(relayer != address(0), "Invalid relayer");
        relayers[relayer] = isActive;
        emit RelayerUpdated(relayer, isActive);
    }
    
    /**
     * @dev Add or remove a supported token (owner only)
     * @param token Token address
     * @param isSupported Whether the token is supported
     */
    function setSupportedToken(address token, bool isSupported) external onlyOwner {
        require(token != address(0), "Invalid token");
        supportedTokens[token] = isSupported;
        emit TokenSupportUpdated(token, isSupported);
    }
    
    /**
     * @dev Emergency withdraw tokens (owner only)
     * @param token Token address (address(0) for native ETH)
     * @param to Recipient address
     * @param amount Amount to withdraw
     */
    function emergencyWithdraw(
        address token,
        address to,
        uint256 amount
    ) external onlyOwner {
        require(to != address(0), "Invalid recipient");
        
        if (token == address(0)) {
            (bool success, ) = to.call{value: amount}("");
            require(success, "ETH transfer failed");
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }
    
    // ============ Internal Functions ============
    
    /**
     * @dev Process a deposit and generate a deposit ID
     * @param token Token address (address(0) for native ETH)
     * @param amount Deposit amount
     * @param nearRecipient NEAR account ID of the recipient
     * @param depositor Address that made the deposit
     * @return depositId Unique deposit ID
     */
    function _processDeposit(
        address token,
        uint256 amount,
        string calldata nearRecipient,
        address depositor
    ) internal returns (bytes32) {
        require(bytes(nearRecipient).length > 0, "Invalid recipient");
        
        // Calculate bridge fee
        uint256 fee = (amount * config.bridgeFeeBps) / 10000;
        uint256 amountAfterFee = amount - fee;
        
        // Transfer fee to fee collector if non-zero
        if (fee > 0 && config.feeCollector != address(0)) {
            if (token == address(0)) {
                (bool success, ) = config.feeCollector.call{value: fee}("");
                require(success, "Fee transfer failed");
            } else {
                IERC20(token).safeTransfer(config.feeCollector, fee);
            }
        }
        
        // Generate a unique deposit ID
        bytes32 depositId = keccak256(
            abi.encodePacked(
                block.chainid,
                block.timestamp,
                depositor,
                token,
                amount,
                nearRecipient,
                block.prevrandao
            )
        );
        
        // Store deposit data
        deposits[depositId] = Deposit({
            token: token,
            depositor: depositor,
            nearRecipient: nearRecipient,
            amount: amountAfterFee,
            timestamp: block.timestamp,
            claimed: false,
            disputed: false,
            disputeEndTime: 0
        });
        
        emit Deposited(
            depositId,
            token,
            depositor,
            nearRecipient,
            amountAfterFee,
            fee
        );
        
        return depositId;
    }
    
    /**
     * @dev Verify a claim using a merkle proof (stub implementation)
     * @param depositId Unique deposit ID
     * @param amount Amount to claim
     * @param proof Merkle proof for verification
     */
    function _verifyClaim(
        bytes32 depositId,
        uint256 amount,
        bytes32[] calldata proof
    ) internal pure {
        // In a real implementation, this would verify the proof against a merkle root
        // stored in the contract and signed by relayers
        // This is a simplified version that always passes
        require(amount > 0, "Invalid amount");
        require(proof.length > 0, "Proof required");
        
        // Verify the proof (simplified)
        bool isValid = false;
        for (uint256 i = 0; i < proof.length; i++) {
            if (proof[i] != bytes32(0)) {
                isValid = true;
                break;
            }
        }
        require(isValid, "Invalid proof");
    }
    
    // ============ View Functions ============
    
    /**
     * @dev Get deposit details by ID
     * @param depositId Unique deposit ID
     * @return Deposit details
     */
    function getDeposit(bytes32 depositId) external view returns (Deposit memory) {
        return deposits[depositId];
    }
    
    /**
     * @dev Check if a deposit is claimable
     * @param depositId Unique deposit ID
     * @return Whether the deposit is claimable
     */
    function isClaimable(bytes32 depositId) external view returns (bool) {
        Deposit storage deposit = deposits[depositId];
        return !deposit.claimed && !deposit.disputed;
    }
    
    // Allow receiving ETH
    receive() external payable {}
}
