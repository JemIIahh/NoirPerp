// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { FHE, euint64, ebool, externalEuint64 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";
import { FHESafeMath } from "../lib/FHESafeMath.sol";
import { MarginMath } from "../lib/MarginMath.sol";
import { DecryptQueue } from "../lib/DecryptQueue.sol";
import { NoirVault } from "../NoirVault.sol";
import { Oracle } from "../services/Oracle.sol";
import { Compliance } from "../services/Compliance.sol";

/// @title PerpEngine
/// @notice Perpetual futures engine. Open/close synchronous; liquidation async.
///         All ciphertext state lives in NoirVault; this contract is stateless
///         except for config and the decrypt-request queue (inherited).
/// @dev Inherits DecryptQueue for async-liquidation replay guard + timeout.
///      `openPosition` and `closePosition` are sync because the entire flow
///      produces a verifiable outcome in one tx (via FHE.select-guarded math).
///      `requestLiquidation` → `_onLiquidationDecided` is 2-phase: FHE margin
///      check produces `ebool`, Gateway KMS decrypts the bit, callback acts.
contract PerpEngine is DecryptQueue, ZamaEthereumConfig {
    NoirVault public immutable vault;
    Oracle public immutable oracle;
    Compliance public immutable compliance;

    address public admin;
    address public liquidationPool;

    uint64 public constant MAX_LEVERAGE = 20;
    uint64 public constant MAINTENANCE_MARGIN_BPS = 500;   // 5%
    uint64 public constant LIQUIDATOR_FEE_BPS = 50;        // 0.5%
    uint64 private constant BPS_DIVISOR = 10_000;

    event PositionOpened(uint256 indexed positionId, address indexed owner, uint8 marketId);
    event LiquidationRequested(uint256 indexed requestId, uint256 indexed positionId, address indexed keeper);
    event Liquidated(uint256 indexed positionId, address indexed keeper);
    event LiquidationChecked(uint256 indexed positionId);
    event PositionClosed(uint256 indexed positionId, address indexed owner);
    event AdminTransferred(address indexed oldAdmin, address indexed newAdmin);
    event LiquidationPoolChanged(address indexed oldPool, address indexed newPool);

    error NotAdmin();
    error NotCompliant();
    error OraclePriceStale();
    error InvalidMarket();
    error ZeroAddress();
    error VaultPaused();
    error NotPositionOwner();
    error PositionNotActive();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    modifier whenNotPaused() {
        // Cascade from vault's pause state.
        if (vault.paused()) revert VaultPaused();
        _;
    }

    constructor(
        address vault_,
        address oracle_,
        address compliance_,
        address liquidationPool_,
        address admin_
    ) {
        if (vault_ == address(0) || oracle_ == address(0) || compliance_ == address(0)
            || liquidationPool_ == address(0) || admin_ == address(0)) {
            revert ZeroAddress();
        }
        vault = NoirVault(vault_);
        oracle = Oracle(oracle_);
        compliance = Compliance(compliance_);
        liquidationPool = liquidationPool_;
        admin = admin_;
        emit AdminTransferred(address(0), admin_);
        emit LiquidationPoolChanged(address(0), liquidationPool_);
    }

    // ─── Admin ─────────────────────────────────────────────────────────

    function transferAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        address old = admin;
        admin = newAdmin;
        emit AdminTransferred(old, newAdmin);
    }

    function setLiquidationPool(address newPool) external onlyAdmin {
        if (newPool == address(0)) revert ZeroAddress();
        address old = liquidationPool;
        liquidationPool = newPool;
        emit LiquidationPoolChanged(old, newPool);
    }

    // ─── Open position (synchronous) ───────────────────────────────────

    /// @notice Opens a perpetual position. If margin or balance insufficient,
    ///         final size/collateral silently zero (position still written).
    ///         User decrypts their own position client-side to see outcome.
    function openPosition(
        externalEuint64 eSize,
        bytes calldata sizeProof,
        externalEuint64 eCollateral,
        bytes calldata collateralProof,
        bool isLong,
        uint8 marketId,
        bytes32[] calldata complianceProof
    ) external whenNotPaused returns (uint256 positionId) {
        // Compliance gate
        if (!compliance.verify(msg.sender, complianceProof)) revert NotCompliant();
        // Market gate
        if (marketId < 1 || marketId > 3) revert InvalidMarket();
        // Oracle freshness
        (uint64 price, bool fresh) = oracle.getPrice(marketId);
        if (!fresh) revert OraclePriceStale();

        // Import encrypted inputs (with proofs)
        euint64 size = FHE.fromExternal(eSize, sizeProof);
        euint64 collateral = FHE.fromExternal(eCollateral, collateralProof);
        require(FHE.isSenderAllowed(size), "PerpEngine: size not allowed");
        require(FHE.isSenderAllowed(collateral), "PerpEngine: collateral not allowed");

        // Compute select-guarded final ciphertexts
        (euint64 finalSize, euint64 finalCollateral) = _computeFinals(size, collateral, price);

        // Settle: debit vault + write position
        positionId = _settle(msg.sender, finalSize, finalCollateral, price, isLong, marketId);
    }

    /// @dev Runs balance + margin FHE checks, returns select-guarded (size, collateral).
    ///      Extracted to keep each function's stack frame within the EVM 16-slot limit.
    function _computeFinals(
        euint64 size,
        euint64 collateral,
        uint64 price
    ) internal returns (euint64 finalSize, euint64 finalCollateral) {
        euint64 ePrice = FHE.asEuint64(price);
        euint64 balance = vault.allowBalanceAccess(msg.sender);
        ebool balanceOK = FHE.ge(balance, collateral);
        euint64 notionalValue = MarginMath.notional(size, ePrice);
        ebool marginOK = MarginMath.marginOK(collateral, notionalValue, MAX_LEVERAGE);
        ebool allOK = FHE.and(balanceOK, marginOK);
        euint64 zero = FHE.asEuint64(0);
        finalSize = FHE.select(allOK, size, zero);
        finalCollateral = FHE.select(allOK, collateral, zero);
    }

    /// @dev Debits vault balance by finalCollateral, writes position to vault.
    ///      Returns the new positionId.
    function _settle(
        address user,
        euint64 finalSize,
        euint64 finalCollateral,
        uint64 price,
        bool isLong,
        uint8 marketId
    ) internal returns (uint256 positionId) {
        euint64 ePrice = FHE.asEuint64(price);

        // Debit vault balance by finalCollateral
        FHE.allowTransient(finalCollateral, address(vault));
        vault.adjustBalance(user, finalCollateral, false);

        // Write the position to vault; grant vault transient ACL on all ciphertext args
        FHE.allowTransient(finalSize, address(vault));
        FHE.allowTransient(ePrice, address(vault));
        FHE.allowTransient(finalCollateral, address(vault));
        positionId = vault.writePosition(user, finalSize, ePrice, finalCollateral, isLong, marketId);
    }

    // ─── Close position (synchronous) ──────────────────────────────────

    /// @notice Closes a caller-owned position. Computes encrypted PnL
    ///         synchronously using multiplication-only math, credits payout
    ///         to the caller's vault balance, and marks the position inactive.
    /// @dev Caller decrypts their updated balance client-side to observe
    ///      realized value. Saturating safe-math throughout — losses that
    ///      exceed collateral produce 0 payout, never negative.
    function closePosition(uint256 positionId) external whenNotPaused {
        // Fetch position with transient ACL on each ciphertext field
        NoirVault.Position memory p = vault.allowPositionAccess(positionId);

        // Ownership + lifecycle guards (plaintext fields, no FHE needed)
        if (p.owner != msg.sender) revert NotPositionOwner();
        if (!p.active) revert PositionNotActive();

        // Oracle freshness
        (uint64 price, bool fresh) = oracle.getPrice(p.marketId);
        if (!fresh) revert OraclePriceStale();
        euint64 ePrice = FHE.asEuint64(price);

        // Compute profit + loss branches (both non-negative)
        euint64 profit;
        euint64 loss;
        if (p.isLong) {
            (profit, loss) = MarginMath.pnlLong(p.size, p.entryPrice, ePrice);
        } else {
            (profit, loss) = MarginMath.pnlShort(p.size, p.entryPrice, ePrice);
        }

        // Payout = safeAdd(safeSub(collateral, loss), profit). Saturating.
        euint64 collMinusLoss = FHESafeMath.safeSub(p.collateral, loss);
        euint64 payout = FHESafeMath.safeAdd(collMinusLoss, profit);

        // Credit user's vault balance
        FHE.allowTransient(payout, address(vault));
        vault.adjustBalance(p.owner, payout, true);

        // Mark position closed
        vault.closePosition(positionId);

        emit PositionClosed(positionId, p.owner);
    }
}
