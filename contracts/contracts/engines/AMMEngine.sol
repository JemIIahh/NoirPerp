// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { FHE, euint64, ebool, externalEuint64 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";
import { FHESafeMath } from "../lib/FHESafeMath.sol";
import { DecryptQueue } from "../lib/DecryptQueue.sol";
import { NoirVault } from "../NoirVault.sol";
import { Oracle } from "../services/Oracle.sol";

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

    // ─── Oracle reference (admin-settable) ────────────────────────
    Oracle public oracleContract;

    // ─── Encrypted per-user state (private) ────────────────────────
    mapping(address user => euint64) private _userShares;
    mapping(address user => mapping(uint8 marketId => euint64)) private _syntheticBalance;

    // ─── Config ───────────────────────────────────────────────────
    uint64 public swapFeeBps = 30;                // 0.30%
    uint64 private constant BPS_DIVISOR = 10_000;
    uint64 private constant MAX_FEE_BPS = 1_000;  // 10% cap

    event AdminTransferred(address indexed oldAdmin, address indexed newAdmin);
    event SwapFeeChanged(uint64 oldBps, uint64 newBps);
    event LiquidityAdded(address indexed user, uint64 amount, uint64 sharesMinted);
    event WithdrawRequested(uint256 indexed requestId, address indexed user, uint64 claimedShares, bytes32 matchHandle);
    event LiquidityRemoved(uint256 indexed requestId, address indexed user, uint64 shares, uint64 payout);
    event WithdrawRejected(uint256 indexed requestId, address indexed user);
    event OracleSet(address indexed newOracle);
    /// @notice Emitted on every swap. `amountInHandle` is the bytes32 ciphertext
    ///         handle for off-chain indexing — privacy preserved (no decrypt without ACL).
    event Swapped(address indexed user, uint8 indexed marketId, bytes32 amountInHandle);

    error NotAdmin();
    error ZeroAddress();
    error FeeTooHigh();
    error ZeroAmount();
    error ClaimExceedsPoolTotal();
    error OracleNotSet();
    error OraclePriceStale();
    error InvalidMarket();
    error NotAllowed();

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

    // ─── Liquidity — withdraw (async 2-phase) ──────────────────────

    /// @notice Phase 1: Request withdrawal of `claimedShares` from the
    ///         caller. Engine computes ebool `matchesExactly` comparing
    ///         the user's encrypted share balance to the plaintext claim,
    ///         marks it publicly decryptable, emits event, and enqueues
    ///         pending state for the callback.
    /// @dev SPEC DEVIATION (§5.2 "$ZAMA fee"): this function is non-payable.
    ///      The spec calls for a $ZAMA decrypt fee. FHEVM v0.11.1 exposes
    ///      no on-chain fee API and Sepolia Gateway decrypts are free-tier;
    ///      a speculative `payable` here would not match the future API
    ///      shape if Zama enables paid decrypts. Resolution path: contract
    ///      upgrade integrating the actual fee mechanism. See CHANGELOG
    ///      2026-04-26 "$ZAMA fee question" for the full reasoning.
    /// @dev User must decrypt their share balance client-side first
    ///      (via FHE.userDecrypt) to know the exact claimedShares value.
    ///      If wrong, the callback rejects.
    function requestWithdraw(uint64 claimedShares) external returns (uint256 requestId) {
        if (claimedShares == 0) revert ZeroAmount();
        if (claimedShares > totalShares) revert ClaimExceedsPoolTotal();

        euint64 userBal = _userShares[msg.sender];
        euint64 eClaim = FHE.asEuint64(claimedShares);
        // isValid: claimedShares ≤ user's encrypted balance (allows partial withdrawals)
        ebool isValid = FHE.le(eClaim, userBal);
        FHE.makePubliclyDecryptable(isValid);

        requestId = uint256(keccak256(abi.encode(
            msg.sender, claimedShares, block.number, block.timestamp
        )));

        // Encode context: claimedShares — decoded in callback
        bytes memory ctx = abi.encode(claimedShares);
        _enqueue(requestId, msg.sender, uint256(uint64(claimedShares)), ctx);

        emit WithdrawRequested(requestId, msg.sender, claimedShares, FHE.toBytes32(isValid));
    }

    /// @notice Phase 2: Gateway-relayed callback. Verifies KMS signatures,
    ///         dequeues BEFORE external calls (replay guard), and either
    ///         processes the payout or rejects on mismatch.
    function _onWithdrawDecided(
        uint256 requestId,
        bytes32[] memory handlesList,
        bytes memory cleartexts,
        bytes memory decryptionProof
    ) external {
        // 1. Verify KMS signatures first (reverts if invalid)
        FHE.checkSignatures(handlesList, cleartexts, decryptionProof);

        // 2. Dequeue BEFORE any external call — replay guard
        PendingDecrypt memory ctx = _dequeue(requestId);
        address user = ctx.caller;
        uint64 claimedShares = abi.decode(ctx.context, (uint64));

        // 3. Decode match boolean (encoded as uint256; non-zero = true)
        uint256 clearUint = abi.decode(cleartexts, (uint256));
        bool matched = clearUint != 0;

        if (!matched) {
            emit WithdrawRejected(requestId, user);
            return;
        }

        // 4. Compute payout in plaintext: payout = claimedShares × totalReserveUsdcx / totalShares
        uint256 product = uint256(claimedShares) * uint256(totalReserveUsdcx);
        uint64 payout = uint64(product / uint256(totalShares));

        // 5. Update plaintext counters
        totalShares -= claimedShares;
        totalReserveUsdcx -= payout;

        // 6. Update user's encrypted share balance: subtract claimedShares
        euint64 eClaim = FHE.asEuint64(claimedShares);
        euint64 newShares = FHESafeMath.safeSub(_userShares[user], eClaim);
        _userShares[user] = newShares;
        FHE.allowThis(newShares);
        FHE.allow(newShares, user);

        // 7. Debit AMM's vault balance, credit user's vault balance
        euint64 ePayout = FHE.asEuint64(payout);
        FHE.allowTransient(ePayout, address(vault));
        vault.adjustBalance(address(this), ePayout, false); // debit AMM

        euint64 ePayout2 = FHE.asEuint64(payout);
        FHE.allowTransient(ePayout2, address(vault));
        vault.adjustBalance(user, ePayout2, true); // credit user

        emit LiquidityRemoved(requestId, user, claimedShares, payout);
    }

    // ─── Oracle wiring ─────────────────────────────────────────────

    function setOracle(address oracle_) external onlyAdmin {
        if (oracle_ == address(0)) revert ZeroAddress();
        oracleContract = Oracle(oracle_);
        emit OracleSet(oracle_);
    }

    // ─── Swap (synchronous, oracle-pegged, USDCx → synthetic) ──────

    /// @notice Swaps encrypted USDCx for encrypted synthetic-asset credit
    ///         at the current oracle price, minus `swapFeeBps` fee.
    /// @dev Fee stays in the pool (increases AMM's vault balance) but
    ///      does NOT update plaintext totalReserveUsdcx (stranded fee —
    ///      same MVP limitation as liquidation forfeits).
    function swap(
        externalEuint64 eAmountIn,
        bytes calldata amountProof,
        uint8 marketId
    ) external {
        if (address(oracleContract) == address(0)) revert OracleNotSet();
        if (marketId < 1 || marketId > 3) revert InvalidMarket();

        (uint64 price, bool fresh) = oracleContract.getPrice(marketId);
        if (!fresh) revert OraclePriceStale();

        euint64 amountIn = FHE.fromExternal(eAmountIn, amountProof);
        if (!FHE.isSenderAllowed(amountIn)) revert NotAllowed();

        _executeSwap(amountIn, price, marketId);
    }

    /// @dev Internal helper split out to avoid stack-too-deep in `swap`.
    ///      Defensive ordering: all ciphertext derivations + ACL grants
    ///      happen BEFORE any external vault call. This isolates us from
    ///      hypothetical future FHEVM ACL-semantics changes (the current
    ///      v0.11.1 additive-allowTransient model would tolerate either
    ///      ordering, but we prefer the more robust pattern).
    function _executeSwap(euint64 amountIn, uint64 price, uint8 marketId) internal {
        // 1. Compute fee = amountIn × swapFeeBps / BPS_DIVISOR
        //    (scalar div OK per fhe-primitives.md §3)
        euint64 feeNumerator = FHESafeMath.safeMul(amountIn, FHE.asEuint64(swapFeeBps));
        euint64 fee = FHE.div(feeNumerator, BPS_DIVISOR);
        euint64 amountAfterFee = FHESafeMath.safeSub(amountIn, fee);

        // 2. amountOut = amountAfterFee / price (scalar div)
        euint64 amountOut = FHE.div(amountAfterFee, price);

        // 3. Derive a separate handle for the AMM-credit path BEFORE any vault calls.
        //    Even though FHEVM v0.11.1 `allowTransient` is additive (AMM keeps
        //    access to `amountIn` after the first vault call), deriving the copy
        //    up-front isolates us from future ACL-semantics changes.
        euint64 amountInCopy = FHESafeMath.safeAdd(amountIn, FHE.asEuint64(0));

        // 4. Grant vault transient ACL on BOTH ciphertexts up-front.
        FHE.allowTransient(amountIn, address(vault));
        FHE.allowTransient(amountInCopy, address(vault));

        // 5. Now perform the two vault calls.
        vault.adjustBalance(msg.sender, amountIn, false);      // debit user
        vault.adjustBalance(address(this), amountInCopy, true); // credit AMM

        // 6. Credit user's synthetic-asset balance
        euint64 currentSynth = _syntheticBalance[msg.sender][marketId];
        euint64 newSynth = FHESafeMath.safeAdd(currentSynth, amountOut);
        _syntheticBalance[msg.sender][marketId] = newSynth;
        FHE.allowThis(newSynth);
        FHE.allow(newSynth, msg.sender);

        // 7. Emit swap event with the encrypted amountIn handle for off-chain
        //    indexing. The handle stays private (requires FHE.allow to decrypt),
        //    but monitoring can correlate swaps per user/market.
        emit Swapped(msg.sender, marketId, FHE.toBytes32(amountIn));
    }

    /// @notice Returns encrypted synthetic-asset balance handle for a user.
    function getSyntheticBalance(address user, uint8 marketId) external view returns (euint64) {
        return _syntheticBalance[user][marketId];
    }
}
