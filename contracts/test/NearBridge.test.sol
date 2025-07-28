// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "forge-std/Test.sol";
import "forge-std/console.sol";
import "@openzeppelin-contracts/contracts/access/Ownable.sol";
import "@openzeppelin-contracts/contracts/utils/Pausable.sol";
import "../src/NearBridge.sol";

contract NearBridgeTest is Test {
    NearBridge public nearBridge;
    
    // Test accounts
    address public owner = address(0x1);
    address public user = address(0x2);
    address public relayer = address(0x3);
    
    // Sample block header data
    struct BlockHeader {
        uint64 height;
        bytes32 prevBlockHash;
        bytes32 epochId;
        bytes32 nextEpochId;
        uint32 chunksIncluded;
        bytes32 hash;
        uint64 timestamp;
        bytes32 nextBpHash;
        bytes32 blockMerkleRoot;
    }
    
    BlockHeader public sampleBlockHeader;
    
    function setUp() public {
        // Set up accounts
        vm.startPrank(owner);
        
        // Deploy NearBridge
        nearBridge = new NearBridge(owner);
        
        // Initialize sample block header
        sampleBlockHeader = BlockHeader({
            height: 1,
            prevBlockHash: keccak256("prevBlock"),
            epochId: keccak256("epoch1"),
            nextEpochId: keccak256("epoch2"),
            chunksIncluded: 1,
            hash: keccak256("block1"),
            timestamp: uint64(block.timestamp),
            nextBpHash: keccak256("nextBp"),
            blockMerkleRoot: keccak256("merkleRoot")
        });
        
        vm.stopPrank();
    }
    
    // Test cases
    function test_Deployment() public {
        // Check owner
        assertEq(nearBridge.owner(), owner);
        
        // Check initial state
        assertFalse(nearBridge.paused());
        assertEq(nearBridge.relayer(), address(0));
    }
    
    function test_SetRelayer() public {
        // Set relayer
        vm.prank(owner);
        nearBridge.setRelayer(relayer);
        
        // Check relayer was set
        assertEq(nearBridge.relayer(), relayer);
    }
    
    function test_Revert_NonOwnerSetRelayer() public {
        // Non-owner should not be able to set relayer
        vm.expectRevert("Ownable: caller is not the owner");
        vm.prank(user);
        nearBridge.setRelayer(relayer);
    }
    
    function test_Revert_SetZeroAddressAsRelayer() public {
        // Should not allow setting zero address as relayer
        vm.expectRevert("ZeroAddress");
        vm.prank(owner);
        nearBridge.setRelayer(address(0));
    }
    
    function test_PauseUnpause() public {
        // Pause the contract
        vm.prank(owner);
        nearBridge.pause();
        assertTrue(nearBridge.paused());
        
        // Unpause the contract
        vm.prank(owner);
        nearBridge.unpause();
        assertFalse(nearBridge.paused());
    }
    
    function test_Revert_NonOwnerPauseUnpause() public {
        // Non-owner should not be able to pause
        vm.expectRevert("Ownable: caller is not the owner");
        vm.prank(user);
        nearBridge.pause();
        
        // Pause first
        vm.prank(owner);
        nearBridge.pause();
        
        // Non-owner should not be able to unpause
        vm.expectRevert("Ownable: caller is not the owner");
        vm.prank(user);
        nearBridge.unpause();
    }
    
    function test_SubmitBlockHeader() public {
        // Set relayer
        vm.prank(owner);
        nearBridge.setRelayer(relayer);
        
        // Submit block header
        vm.prank(relayer);
        nearBridge.submitBlockHeader(
            sampleBlockHeader.height,
            sampleBlockHeader.prevBlockHash,
            sampleBlockHeader.epochId,
            sampleBlockHeader.nextEpochId,
            sampleBlockHeader.chunksIncluded,
            sampleBlockHeader.hash,
            sampleBlockHeader.timestamp,
            sampleBlockHeader.nextBpHash,
            sampleBlockHeader.blockMerkleRoot
        );
        
        // Verify block header was stored
        (uint64 height, uint64 timestamp, bool exists) = nearBridge.blockHeaders(sampleBlockHeader.hash);
        assertTrue(exists);
        assertEq(height, sampleBlockHeader.height);
        assertEq(timestamp, sampleBlockHeader.timestamp);
    }
    
    function test_Revert_NonRelayerSubmitBlockHeader() public {
        // Set relayer to someone else
        vm.prank(owner);
        nearBridge.setRelayer(relayer);
        
        // Non-relayer should not be able to submit block header
        vm.expectRevert("NotRelayer");
        vm.prank(user);
        nearBridge.submitBlockHeader(
            sampleBlockHeader.height,
            sampleBlockHeader.prevBlockHash,
            sampleBlockHeader.epochId,
            sampleBlockHeader.nextEpochId,
            sampleBlockHeader.chunksIncluded,
            sampleBlockHeader.hash,
            sampleBlockHeader.timestamp,
            sampleBlockHeader.nextBpHash,
            sampleBlockHeader.blockMerkleRoot
        );
    }
    
    function test_Revert_DuplicateBlockHeader() public {
        // Set relayer
        vm.prank(owner);
        nearBridge.setRelayer(relayer);
        
        // Submit block header first time
        vm.prank(relayer);
        nearBridge.submitBlockHeader(
            sampleBlockHeader.height,
            sampleBlockHeader.prevBlockHash,
            sampleBlockHeader.epochId,
            sampleBlockHeader.nextEpochId,
            sampleBlockHeader.chunksIncluded,
            sampleBlockHeader.hash,
            sampleBlockHeader.timestamp,
            sampleBlockHeader.nextBpHash,
            sampleBlockHeader.blockMerkleRoot
        );
        
        // Try to submit the same block header again
        vm.expectRevert("BlockHeaderAlreadyExists");
        vm.prank(relayer);
        nearBridge.submitBlockHeader(
            sampleBlockHeader.height,
            sampleBlockHeader.prevBlockHash,
            sampleBlockHeader.epochId,
            sampleBlockHeader.nextEpochId,
            sampleBlockHeader.chunksIncluded,
            sampleBlockHeader.hash,
            sampleBlockHeader.timestamp,
            sampleBlockHeader.nextBpHash,
            sampleBlockHeader.blockMerkleRoot
        );
    }
    
    function test_IsBlockHeaderValid() public {
        // Set relayer
        vm.prank(owner);
        nearBridge.setRelayer(relayer);
        
        // Submit block header
        vm.prank(relayer);
        nearBridge.submitBlockHeader(
            sampleBlockHeader.height,
            sampleBlockHeader.prevBlockHash,
            sampleBlockHeader.epochId,
            sampleBlockHeader.nextEpochId,
            sampleBlockHeader.chunksIncluded,
            sampleBlockHeader.hash,
            sampleBlockHeader.timestamp,
            sampleBlockHeader.nextBpHash,
            sampleBlockHeader.blockMerkleRoot
        );
        
        // Check if block header is valid
        assertTrue(nearBridge.isBlockHeaderValid(sampleBlockHeader.hash));
        assertFalse(nearBridge.isBlockHeaderValid(keccak256("nonexistent")));
    }
    
    function test_EmergencyWithdraw() public {
        // Send some ETH to the contract
        uint256 amount = 1 ether;
        vm.deal(address(nearBridge), amount);
        
        // Withdraw ETH
        uint256 initialBalance = owner.balance;
        
        vm.prank(owner);
        nearBridge.emergencyWithdraw(owner, amount);
        
        // Check balances
        assertEq(address(nearBridge).balance, 0);
        assertEq(owner.balance, initialBalance + amount);
    }
    
    function test_Revert_NonOwnerEmergencyWithdraw() public {
        // Non-owner should not be able to withdraw
        vm.expectRevert("Ownable: caller is not the owner");
        vm.prank(user);
        nearBridge.emergencyWithdraw(user, 1 ether);
    }
    
    function test_Revert_WithdrawToZeroAddress() public {
        // Should not allow withdrawing to zero address
        vm.expectRevert("ZeroAddress");
        vm.prank(owner);
        nearBridge.emergencyWithdraw(address(0), 1 ether);
    }
    
    function test_Revert_WithdrawInsufficientBalance() public {
        // Contract has no balance
        uint256 contractBalance = address(nearBridge).balance;
        
        // Try to withdraw more than the balance
        vm.expectRevert("InsufficientBalance");
        vm.prank(owner);
        nearBridge.emergencyWithdraw(owner, contractBalance + 1);
    }
}
