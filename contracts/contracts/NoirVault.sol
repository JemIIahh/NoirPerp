// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { FHE, euint64, externalEuint64 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";
import { IERC7984 } from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";
import { FHESafeMath } from "./lib/FHESafeMath.sol";

/// @title NoirVault
/// @notice Sole owner of all NoirPerp ciphertext state.
/// @dev Task 5 (this commit): adds user balance state + deposit/withdraw
///      + engine-gated adjustBalance. Task 6 adds position storage.
contract NoirVault is ZamaEthereumConfig {
    IERC7984 public immutable usdcxToken;

    address public admin;
    bool public paused;
    mapping(address => bool) public authorizedEngines;

    /// @dev Encrypted user balances in USDCx. Incremented on deposit /
    ///      engine-credit; decremented on withdraw / engine-debit.
    ///      Uses FHESafeMath semantics (underflow clamps to 0).
    mapping(address => euint64) private _balances;

    event AdminTransferred(address indexed oldAdmin, address indexed newAdmin);
    event EngineRegistered(address indexed engine);
    event EngineDeregistered(address indexed engine);
    event Paused();
    event Unpaused();
    event Deposited(address indexed user, uint64 amount);
    event Withdrawn(address indexed user, uint64 amount);
    event BalanceAdjusted(address indexed user, uint64 amount, bool isCredit, address indexed engine);

    error NotAdmin();
    error NotAuthorizedEngine();
    error ZeroAddress();
    error AlreadyPaused();
    error NotPaused();
    error VaultPaused();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    modifier onlyAuthorizedEngine() {
        if (!authorizedEngines[msg.sender]) revert NotAuthorizedEngine();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert VaultPaused();
        _;
    }

    constructor(address initialAdmin, address usdcxToken_) {
        if (initialAdmin == address(0)) revert ZeroAddress();
        admin = initialAdmin;
        usdcxToken = IERC7984(usdcxToken_);
        emit AdminTransferred(address(0), initialAdmin);
    }

    // ─── Admin: engine registration ────────────────────────────────────

    function registerEngine(address engine) external onlyAdmin {
        if (engine == address(0)) revert ZeroAddress();
        authorizedEngines[engine] = true;
        emit EngineRegistered(engine);
    }

    function deregisterEngine(address engine) external onlyAdmin {
        authorizedEngines[engine] = false;
        emit EngineDeregistered(engine);
    }

    // ─── Admin: pause ──────────────────────────────────────────────────

    function pause() external onlyAdmin {
        if (paused) revert AlreadyPaused();
        paused = true;
        emit Paused();
    }

    function unpause() external onlyAdmin {
        if (!paused) revert NotPaused();
        paused = false;
        emit Unpaused();
    }

    // ─── Admin: transfer ───────────────────────────────────────────────

    function transferAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        address old = admin;
        admin = newAdmin;
        emit AdminTransferred(old, newAdmin);
    }

    // ─── Balance: user-facing ──────────────────────────────────────────

    /// @notice Deposits `amount` of USDCx from the caller into the vault,
    ///         crediting the caller's encrypted balance.
    /// @dev Requires the caller to have granted the vault operator status
    ///      on the USDCx token prior to calling.
    function deposit(uint64 amount) external whenNotPaused {
        euint64 amt = FHE.asEuint64(amount);
        // Grant the token contract transient ACL access to our ciphertext
        FHE.allowTransient(amt, address(usdcxToken));
        // Transfer from caller to vault via ERC-7984
        usdcxToken.confidentialTransferFrom(msg.sender, address(this), amt);
        // Credit internal balance
        euint64 current = _balances[msg.sender];
        euint64 newBal = FHESafeMath.safeAdd(current, amt);
        _balances[msg.sender] = newBal;
        FHE.allowThis(newBal);
        FHE.allow(newBal, msg.sender);
        emit Deposited(msg.sender, amount);
    }

    /// @notice Withdraws `amount` of USDCx to the caller, debiting
    ///         their internal balance (saturating at 0).
    function withdraw(uint64 amount) external whenNotPaused {
        euint64 amt = FHE.asEuint64(amount);
        euint64 current = _balances[msg.sender];
        // Effective withdraw = min(amount, current)
        // newBal = current - effective (saturating)
        euint64 newBal = FHESafeMath.safeSub(current, amt);
        // Effective amount transferred = current - newBal
        euint64 effective = FHESafeMath.safeSub(current, newBal);
        _balances[msg.sender] = newBal;
        FHE.allowThis(newBal);
        FHE.allow(newBal, msg.sender);
        // Grant token contract transient ACL access to effective ciphertext
        FHE.allowTransient(effective, address(usdcxToken));
        usdcxToken.confidentialTransfer(msg.sender, effective);
        emit Withdrawn(msg.sender, amount);
    }

    // ─── Balance: engine-facing ────────────────────────────────────────

    /// @notice Adjusts a user's encrypted balance. Only authorized engines.
    ///         Used by PerpEngine to debit collateral at position open and
    ///         credit payout at position close.
    /// @param user Target user.
    /// @param amount Plaintext amount (trivial-encrypted internally; amounts
    ///        here are engine-known since they're oracle-derived).
    /// @param isCredit true to credit (add), false to debit (subtract,
    ///        saturating at 0).
    function adjustBalance(address user, uint64 amount, bool isCredit)
        external
        onlyAuthorizedEngine
        whenNotPaused
    {
        euint64 delta = FHE.asEuint64(amount);
        euint64 current = _balances[user];
        euint64 newBal = isCredit
            ? FHESafeMath.safeAdd(current, delta)
            : FHESafeMath.safeSub(current, delta);
        _balances[user] = newBal;
        FHE.allowThis(newBal);
        FHE.allow(newBal, user);
        emit BalanceAdjusted(user, amount, isCredit, msg.sender);
    }

    /// @notice Returns the ciphertext handle for a user's balance. Caller
    ///         must have FHE.allow permission on the returned handle to
    ///         decrypt it (the user themselves is granted at each mutation).
    function getBalance(address user) external view returns (euint64) {
        return _balances[user];
    }
}
