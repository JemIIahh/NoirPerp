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

    error NotAdmin();
    error ZeroAddress();
    error FeeTooHigh();

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
}
