// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "forge-std/Test.sol";
import "forge-std/console.sol";
import "@openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin-contracts/contracts/access/AccessControl.sol";
import "@openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin-contracts/contracts/utils/introspection/IERC165.sol";
import "../src/adapters/TokenAdapter.sol";

contract TestERC20 is ERC20 {
    uint8 private _decimals;

    constructor(string memory name, string memory symbol, uint8 decimals_) ERC20(name, symbol) {
        _decimals = decimals_;
        _mint(msg.sender, 1000000 * 10 ** decimals_);
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) public {
        _mint(to, amount);
    }
}

contract MaliciousToken is ERC20 {
    bool public alwaysReturnFalse = false;
    bool public revertOnTransfer = false;
    
    constructor() ERC20("Malicious Token", "MAL") {}
    
    function mint(address to, uint256 amount) public {
        _mint(to, amount);
    }
    
    function setAlwaysReturnFalse(bool value) public {
        alwaysReturnFalse = value;
    }
    
    function setRevertOnTransfer(bool value) public {
        revertOnTransfer = value;
    }
    
    function transfer(address to, uint256 amount) public override returns (bool) {
        if (revertOnTransfer) {
            revert("MaliciousToken: transfer reverted");
        }
        
        if (alwaysReturnFalse) {
            return false;
        }
        
        _transfer(msg.sender, to, amount);
        
        // Don't return anything to test SafeERC20 behavior
        assembly {
            return(0, 0)
        }
    }
    
    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        if (revertOnTransfer) {
            revert("MaliciousToken: transferFrom reverted");
        }
        
        if (alwaysReturnFalse) {
            return false;
        }
        
        _spendAllowance(from, msg.sender, amount);
        _transfer(from, to, amount);
        
        // Don't return anything to test SafeERC20 behavior
        assembly {
            return(0, 0)
        }
    }
}

contract TokenAdapterTest is Test {
    TokenAdapter public tokenAdapter;
    TestERC20 public testToken;
    MaliciousToken public maliciousToken;
    
    address public constant NATIVE_TOKEN = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
    address public constant ZERO_ADDRESS = address(0);
    
    address public owner = address(0x1);
    address public user = address(0x2);
    address public recipient = address(0x3);
    address public registrar = address(0x4);
    
    function setUp() public {
        // Set up accounts
        vm.startPrank(owner);
        
        // Deploy TokenAdapter
        tokenAdapter = new TokenAdapter();
        
        // Deploy TestERC20
        testToken = new TestERC20("Test Token", "TST", 18);
        
        // Deploy MaliciousToken
        maliciousToken = new MaliciousToken();
        
        // Grant REGISTRAR_ROLE to registrar
        bytes32 REGISTRAR_ROLE = tokenAdapter.REGISTRAR_ROLE();
        tokenAdapter.grantRole(REGISTRAR_ROLE, registrar);
        
        vm.stopPrank();
    }
    
    // Test cases will be added here
    function test_Deployment() public {
        // Check owner has DEFAULT_ADMIN_ROLE
        bytes32 DEFAULT_ADMIN_ROLE = tokenAdapter.DEFAULT_ADMIN_ROLE();
        assertTrue(tokenAdapter.hasRole(DEFAULT_ADMIN_ROLE, owner));
        
        // Check registrar has REGISTRAR_ROLE
        bytes32 REGISTRAR_ROLE = tokenAdapter.REGISTRAR_ROLE();
        assertTrue(tokenAdapter.hasRole(REGISTRAR_ROLE, registrar));
    }
    
    function test_RegisterToken() public {
        vm.startPrank(registrar);
        
        // Register token
        vm.expectEmit(true, true, true, true);
        emit TokenAdapter.TokenRegistered(address(testToken), TokenAdapter.TokenStandard.ERC20);
        tokenAdapter.registerToken(address(testToken), TokenAdapter.TokenStandard.ERC20);
        
        // Verify token info
        (TokenAdapter.TokenStandard standard, bool isRegistered) = tokenAdapter.getTokenInfo(address(testToken));
        assertEq(uint(standard), uint(TokenAdapter.TokenStandard.ERC20));
        assertTrue(isRegistered);
        
        vm.stopPrank();
    }
    
    function test_TransferERC20() public {
        // Register token
        vm.prank(registrar);
        tokenAdapter.registerToken(address(testToken), TokenAdapter.TokenStandard.ERC20);
        
        // Mint tokens to user
        uint256 amount = 1000 * 10 ** 18;
        testToken.mint(user, amount);
        
        // Approve token adapter
        vm.prank(user);
        testToken.approve(address(tokenAdapter), amount);
        
        // Transfer tokens
        uint256 transferAmount = 500 * 10 ** 18;
        vm.prank(registrar);
        
        vm.expectEmit(true, true, true, true);
        emit TokenAdapter.TokensTransferred(address(testToken), user, recipient, transferAmount);
        
        tokenAdapter.transfer(
            address(testToken),
            user,
            recipient,
            transferAmount
        );
        
        // Check balances
        assertEq(testToken.balanceOf(user), amount - transferAmount);
        assertEq(testToken.balanceOf(recipient), transferAmount);
    }
    
    function test_Revert_NonRegistrarTransfer() public {
        // Register token
        vm.prank(registrar);
        tokenAdapter.registerToken(address(testToken), TokenAdapter.TokenStandard.ERC20);
        
        // Non-registrar should not be able to transfer
        vm.expectRevert(
            abi.encodeWithSelector(
                AccessControl.AccessControlUnauthorizedAccount.selector,
                user,
                tokenAdapter.REGISTRAR_ROLE()
            )
        );
        
        vm.prank(user);
        tokenAdapter.transfer(
            address(testToken),
            user,
            recipient,
            100
        );
    }
    
    function test_Revert_TransferUnregisteredToken() public {
        // Try to transfer unregistered token
        vm.expectRevert("TokenNotRegistered");
        
        vm.prank(registrar);
        tokenAdapter.transfer(
            address(testToken),
            user,
            recipient,
            100
        );
    }
    
    function test_Revert_TransferInsufficientAllowance() public {
        // Register token
        vm.prank(registrar);
        tokenAdapter.registerToken(address(testToken), TokenAdapter.TokenStandard.ERC20);
        
        // Mint tokens to user but don't approve
        testToken.mint(user, 1000);
        
        // Should revert due to insufficient allowance
        vm.expectRevert("ERC20: insufficient allowance");
        
        vm.prank(registrar);
        tokenAdapter.transfer(
            address(testToken),
            user,
            recipient,
            1000
        );
    }
    
    function test_TransferNativeToken() public {
        // Register native token
        vm.prank(registrar);
        tokenAdapter.registerToken(NATIVE_TOKEN, TokenAdapter.TokenStandard.NATIVE);
        
        // Send ETH to the token adapter
        uint256 amount = 1 ether;
        vm.deal(address(tokenAdapter), amount);
        
        // Transfer native tokens
        uint256 initialBalance = recipient.balance;
        
        vm.prank(registrar);
        tokenAdapter.transfer{value: amount}(
            NATIVE_TOKEN,
            address(tokenAdapter),
            recipient,
            amount
        );
        
        // Check recipient balance increased
        assertEq(recipient.balance, initialBalance + amount);
    }
    
    function test_Revert_MaliciousToken_NoReturn() public {
        // Register malicious token
        vm.prank(registrar);
        tokenAdapter.registerToken(address(maliciousToken), TokenAdapter.TokenStandard.ERC20);
        
        // Fund the malicious token
        maliciousToken.mint(user, 1000);
        
        // Approve the token adapter
        vm.prank(user);
        maliciousToken.approve(address(tokenAdapter), 500);
        
        // Transfer should fail because the token doesn't return a boolean
        vm.expectRevert("SafeERC20: ERC20 operation did not succeed");
        
        vm.prank(registrar);
        tokenAdapter.transfer(
            address(maliciousToken),
            user,
            recipient,
            500
        );
    }
    
    function test_SupportsInterface() public {
        // Check that the contract supports the IERC165 interface
        assertTrue(tokenAdapter.supportsInterface(type(IERC165).interfaceId));
        
        // Check that the contract supports the IAccessControl interface
        assertTrue(tokenAdapter.supportsInterface(type(IAccessControl).interfaceId));
    }
}

// Events for testing
interface ITokenAdapterEvents {
    event TokenRegistered(address indexed token, TokenAdapter.TokenStandard standard);
    event TokensTransferred(
        address indexed token,
        address indexed from,
        address indexed to,
        uint256 amount
    );
}
