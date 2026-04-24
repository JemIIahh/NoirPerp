// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { FHE, euint64, ebool, externalEuint64 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";
import { FHESafeMath } from "../lib/FHESafeMath.sol";
import { DecryptQueue } from "../lib/DecryptQueue.sol";
import { NoirVault } from "../NoirVault.sol";

/// @title AMMEngine
/// @notice Encrypted reserve pool with LP shares + oracle-pegged swaps.
///         Hybrid privacy model: plaintext pool totals (for fair ratio
///         math — FHE has no ct/ct division), encrypted per-user shares,
///         encrypted swap amounts.
/// @dev Inherits DecryptQueue for async withdrawal replay guard.
///      Liquidation forfeits from PerpEngine accumulate in vault's
///      _balances[AMM] as encrypted increments, NOT reflected in the
///      plaintext totalReserveUsdcx counter. Documented limitation.
contract AMMEngine is DecryptQueue, ZamaEthereumConfig {
    NoirVault public immutable vault;
    address public admin;

    // ─── Plaintext pool totals (intentionally public) ───────────────
    uint64 public totalShares;
    uint64 public totalReserveUsdcx;

    // ─── Encrypted per-user state (private) ────────────────────────
    mapping(address user => euint64) private _userShares;

    // ─── Config ───────────────────────────────────────────────────
    uint64 public swapFeeBps = 30;                // 0.30%
    uint64 private constant BPS_DIVISOR = 10_000;
    uint64 private constant MAX_FEE_BPS = 1_000;  // 10% cap

    event AdminTransferred(address indexed oldAdmin, address indexed newAdmin);
    event SwapFeeChanged(uint64 oldBps, uint64 newBps);
    event LiquidityAdded(address indexed user, uint64 amount, uint64 sharesMinted);

    error NotAdmin();
    error ZeroAddress();
    error FeeTooHigh();
    error ZeroAmount();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    constructor(address vault_, address admin_) {
        if (vault_ == address(0) || admin_ == address(0)) revert ZeroAddress();
        vault = NoirVault(vault_);
        admin = admin_;
        emit AdminTransferred(address(0), admin_);
    }

    // ─── Admin ─────────────────────────────────────────────────────

    function transferAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        address old = admin;
        admin = newAdmin;
        emit AdminTransferred(old, newAdmin);
    }

    function setSwapFeeBps(uint64 newBps) external onlyAdmin {
        if (newBps > MAX_FEE_BPS) revert FeeTooHigh();
        uint64 old = swapFeeBps;
        swapFeeBps = newBps;
        emit SwapFeeChanged(old, newBps);
    }

    // ─── Views ─────────────────────────────────────────────────────

    /// @notice Returns encrypted LP share handle for a user. Caller
    ///         must have ACL (the user themselves gets it at each mutation).
    function getUserShares(address user) external view returns (euint64) {
        return _userShares[user];
    }

    // ─── Liquidity — add (synchronous) ─────────────────────────────

    /// @notice Deposits `amount` USDCx from caller's vault balance and
    ///         credits encrypted LP shares. First deposit bootstraps at
    ///         1:1; subsequent deposits use the fair ratio
    ///         `shares = amount × totalShares / totalReserveUsdcx`.
    /// @dev Amount is plaintext (privacy concession documented in plan).
    ///      User's SHARE of pool stays encrypted.
    function addLiquidity(uint64 amount) external {
        if (amount == 0) revert ZeroAmount();

        // Fair-ratio share math (all plaintext)
        uint64 sharesToMint;
        if (totalShares == 0) {
            sharesToMint = amount;
        } else {
            // shares = amount × totalShares / totalReserveUsdcx
            // Use uint256 for intermediate to avoid overflow; safe since
            // all inputs fit in uint64.
            uint256 product = uint256(amount) * uint256(totalShares);
            sharesToMint = uint64(product / uint256(totalReserveUsdcx));
        }

        // Update plaintext counters
        totalShares += sharesToMint;
        totalReserveUsdcx += amount;

        // Debit user's vault balance, credit AMM's vault balance
        euint64 eAmount = FHE.asEuint64(amount);
        FHE.allowTransient(eAmount, address(vault));
        vault.adjustBalance(msg.sender, eAmount, false); // debit user

        euint64 eAmount2 = FHE.asEuint64(amount); // fresh handle for re-use
        FHE.allowTransient(eAmount2, address(vault));
        vault.adjustBalance(address(this), eAmount2, true); // credit AMM

        // Credit user's encrypted share balance
        euint64 eShares = FHE.asEuint64(sharesToMint);
        euint64 currentShares = _userShares[msg.sender];
        euint64 newShares = FHESafeMath.safeAdd(currentShares, eShares);
        _userShares[msg.sender] = newShares;
        FHE.allowThis(newShares);
        FHE.allow(newShares, msg.sender);

        emit LiquidityAdded(msg.sender, amount, sharesToMint);
    }
}
