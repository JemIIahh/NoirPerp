// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { FHE, euint64, ebool, externalEuint64 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";
import { FHESafeMath } from "../lib/FHESafeMath.sol";
import { DecryptQueue } from "../lib/DecryptQueue.sol";
import { NoirVault } from "../NoirVault.sol";
import { Compliance } from "../services/Compliance.sol";
import { Oracle } from "../services/Oracle.sol";
import { PerpEngine } from "./PerpEngine.sol";

/// @title DarkpoolEngine
/// @notice Encrypted darkpool with two settlement paths:
///         1. **Batch-vs-pool** (Phase 6, legacy): orders submitted via
///            `submitOrder` settle against the Perp pool at oracle price.
///            All-or-nothing per order; bot batches up to 10 in one
///            Gateway decrypt.
///         2. **Peer-to-peer pair match** (Phase 11): orders submitted via
///            `submitOrderForPairMatch` are matched against an opposite-
///            side order via `submitMatchPair` (bot-callable). Partial
///            fills supported with residual regeneration on the larger
///            order. Settlement at oracle price (NOT midpoint of limits)
///            to preserve the privacy property: only the boolean
///            "do prices intersect?" is decrypted; limit prices stay
///            encrypted forever.
///
///         Order shapes:
///         - Legacy:        (size, collateral,        limitPrice)
///         - Pair-eligible: (size, collateralPerUnit, limitPrice)
///
///         Why the shape change for pair-eligible: partial fills require
///         scaling collateral by fill ratio, which would need ciphertext
///         division (banned per CLAUDE.md rule 2). Storing collateral as
///         per-unit at submission moves the division off-chain (user
///         already has plaintext access to both numbers) and lets the
///         engine compute filled collateral as `collateralPerUnit ×
///         fillSize` via one FHE.mul.
///
/// @dev Spec deviations (Phase 11 additions, in addition to Phase 6's):
///      1. Pair settlement at oracle price (not midpoint of limits) —
///         midpoint would leak the price range.
///      2. All-or-nothing on the smaller order; residual on the larger.
///      3. Self-match prevented by plaintext check (owner addresses).
///
/// @dev Inherits DecryptQueue for replay-guarded async callbacks. Both
///      `_onBatchDecided` (Phase 6) and `_onMatchDecided` (Phase 11)
///      follow the canonical `checkSignatures → _dequeue → external` order.
///      Both reuse the `_decodeBatch` flat-tuple cleartext decoder.
contract DarkpoolEngine is DecryptQueue, ZamaEthereumConfig {
    NoirVault public immutable vault;
    address public oracle;
    address public perp;
    address public compliance;
    address public admin;

    struct DarkOrder {
        address owner;
        uint8 marketId;
        bool isLong;
        bool active;
        bool pairMatchEligible;     // Phase 11: true → submitOrderForPairMatch path
        euint64 size;
        euint64 collateral;         // Used by legacy submitOrder; encrypted-zero on pair-eligible
        euint64 collateralPerUnit;  // Phase 11: pair-eligible only; encrypted-zero on legacy
        euint64 limitPrice;
    }

    /// @notice Phase 11 — async-decrypt context for `submitMatchPair`.
    ///         Stores the FHE handles needed by `_onMatchDecided` to apply
    ///         a pair-match outcome. The 3 ebool handles
    ///         (intersects + buyResidualZero + sellResidualZero) are
    ///         decrypted in one Gateway round-trip; the cleartext flat
    ///         tuple is decoded via `_decodeBatch` (reused from the
    ///         existing batch-match path).
    struct PendingMatch {
        uint256 buyId;
        uint256 sellId;
        ebool   intersects;
        euint64 fillSize;
        euint64 buyResidualSize;
        euint64 sellResidualSize;
        ebool   buyResidualZero;
        ebool   sellResidualZero;
        address requester;
    }

    mapping(uint256 orderId => DarkOrder) private _orders;
    mapping(uint256 requestId => PendingMatch) private _pendingMatches;
    uint256 public nextOrderId;

    event AdminTransferred(address indexed oldAdmin, address indexed newAdmin);
    event OracleSet(address indexed newOracle);
    event PerpSet(address indexed newPerp);
    event ComplianceSet(address indexed newCompliance);
    event OrderSubmitted(uint256 indexed orderId, address indexed owner, uint8 marketId);
    /// @notice Phase 11 — fires only for pair-match-eligible orders. Includes
    ///         `isLong` so the off-chain matcher bot can filter pair
    ///         candidates by side without calling `getOrder` per candidate.
    event OrderSubmittedForPair(uint256 indexed orderId, address indexed owner, uint8 marketId, bool isLong);
    event OrderCancelled(uint256 indexed orderId, address indexed owner);
    event OrderClosed(uint256 indexed orderId, string reason);
    event BatchMatchRequested(uint256 indexed requestId, address indexed keeper, uint256[] orderIds, bytes32[] handles);
    event BatchSettled(uint256 indexed requestId, uint256[] orderIds, uint256[] shouldFires);
    event MatchProposed(uint256 indexed requestId, uint256 indexed buyId, uint256 indexed sellId, address requester, bytes32[] handles);
    event MatchSettled(uint256 indexed requestId, uint256 indexed buyId, uint256 indexed sellId, address settler);
    event MatchRejected(uint256 indexed requestId, uint256 indexed buyId, uint256 indexed sellId);
    /// @notice Phase 11 — fired when a pair match's callback runs but one
    ///         or both orders were cancelled during the in-flight decrypt
    ///         window. No fills, no positions opened, no penalty — both
    ///         users keep their state. The bot should remove these orders
    ///         from its candidate pool on this event.
    event MatchAborted(uint256 indexed requestId, uint256 indexed buyId, uint256 indexed sellId, string reason);

    error NotAdmin();
    error ZeroAddress();
    error ComplianceNotSet();
    error NotCompliant();
    error InvalidMarket();
    error NotAllowed();
    error NotOrderOwner();
    error OrderNotActive();
    error OracleNotSet();
    error PerpNotSet();
    error OraclePriceStale();
    error EmptyBatch();
    error CrossMarketBatch();
    error CleartextLengthMismatch();
    // Phase 11
    error PairOrderInactive();
    error PairOrderNotEligible();
    error PairOrdersSameOwner();
    error PairOrdersDifferentMarket();
    error PairOrdersSameSide();
    error PairOrdersWrongCanonicalization(); // buyId arg must be the long side

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

    function setOracle(address oracle_) external onlyAdmin {
        if (oracle_ == address(0)) revert ZeroAddress();
        oracle = oracle_;
        emit OracleSet(oracle_);
    }

    function setPerp(address perp_) external onlyAdmin {
        if (perp_ == address(0)) revert ZeroAddress();
        perp = perp_;
        emit PerpSet(perp_);
    }

    function setCompliance(address compliance_) external onlyAdmin {
        if (compliance_ == address(0)) revert ZeroAddress();
        compliance = compliance_;
        emit ComplianceSet(compliance_);
    }

    // ─── Views ─────────────────────────────────────────────────────

    function getOrder(uint256 orderId) external view returns (DarkOrder memory) {
        return _orders[orderId];
    }

    // ─── Order submission ──────────────────────────────────────────

    /// @notice Inputs bundle for `submitOrder`. Struct param works around
    ///         the EVM 16-slot stack limit on individual calldata args.
    struct SubmitOrderInputs {
        externalEuint64 eSize;
        bytes sizeProof;
        externalEuint64 eCollateral;
        bytes collateralProof;
        externalEuint64 eLimitPrice;
        bytes limitProof;
    }

    /// @notice Submits an encrypted darkpool order. Locks collateral as
    ///         escrow (debit user vault → credit DarkpoolEngine vault).
    function submitOrder(
        SubmitOrderInputs calldata inputs,
        uint8 marketId,
        bool isLong,
        bytes32[] calldata complianceProof
    ) external returns (uint256 orderId) {
        if (compliance == address(0)) revert ComplianceNotSet();
        if (!Compliance(compliance).verify(msg.sender, complianceProof)) revert NotCompliant();
        if (marketId < 1 || marketId > 3) revert InvalidMarket();

        (euint64 size, euint64 collateral, euint64 limitPrice) = _importInputs(inputs);

        _lockCollateral(msg.sender, collateral);

        orderId = _storeOrder(size, collateral, limitPrice, marketId, isLong);

        emit OrderSubmitted(orderId, msg.sender, marketId);
    }

    /// @notice Phase 11 — inputs bundle for pair-match-eligible orders.
    ///         Identical shape to `SubmitOrderInputs` but with the
    ///         `eCollateralPerUnit` field name reflecting its semantic.
    ///         The user computes `collateralPerUnit = totalCollateral / size`
    ///         off-chain at order construction (already plaintext to them);
    ///         this avoids the banned `FHE.div(euint64, euint64)` pattern
    ///         when computing per-fill collateral on partial fills.
    struct SubmitPairOrderInputs {
        externalEuint64 eSize;
        bytes sizeProof;
        externalEuint64 eCollateralPerUnit;
        bytes collateralPerUnitProof;
        externalEuint64 eLimitPrice;
        bytes limitProof;
    }

    /// @notice Phase 11 — submit a pair-match-eligible darkpool order.
    ///         The order will be matched peer-to-peer with an opposite-side
    ///         order via `submitMatchPair`, with partial-fill semantics
    ///         (smaller order fully consumed, larger has residual).
    ///         Settlement is at oracle price, NOT at midpoint of limits —
    ///         this preserves the "nobody, including the matcher bot,
    ///         learns prices" property. See
    ///         `docs/specs/2026-04-28-darkpool-pair-match-design.md` §4.
    /// @dev Locks total collateral as escrow: `collateralPerUnit × size`
    ///      (one FHE.mul, supported). On partial fills, only the filled
    ///      portion's collateral is released to fund positions; the
    ///      residual stays in escrow against the residual order size.
    /// @dev SPEC DEVIATION (§5.2 "$ZAMA fee"): non-payable. Same rationale
    ///      as the other async entry points — see CHANGELOG 2026-04-26
    ///      "$ZAMA fee question".
    function submitOrderForPairMatch(
        SubmitPairOrderInputs calldata inputs,
        uint8 marketId,
        bool isLong,
        bytes32[] calldata complianceProof
    ) external returns (uint256 orderId) {
        if (compliance == address(0)) revert ComplianceNotSet();
        if (!Compliance(compliance).verify(msg.sender, complianceProof)) revert NotCompliant();
        if (marketId < 1 || marketId > 3) revert InvalidMarket();

        (euint64 size, euint64 collateralPerUnit, euint64 limitPrice) = _importPairInputs(inputs);

        // Total escrow = collateralPerUnit × size (one FHE.mul). On partial
        // fills the engine retains `collateralPerUnit × residualSize`
        // automatically because `size` is updated to the residual on fill,
        // and `_refundCollateral` re-computes the product when needed.
        euint64 totalCollateral = FHE.mul(collateralPerUnit, size);
        _lockCollateral(msg.sender, totalCollateral);

        orderId = _storeOrderForPair(size, collateralPerUnit, limitPrice, marketId, isLong);

        emit OrderSubmittedForPair(orderId, msg.sender, marketId, isLong);
    }

    function _importPairInputs(SubmitPairOrderInputs calldata inputs)
        internal
        returns (euint64 size, euint64 collateralPerUnit, euint64 limitPrice)
    {
        size = FHE.fromExternal(inputs.eSize, inputs.sizeProof);
        if (!FHE.isSenderAllowed(size)) revert NotAllowed();

        collateralPerUnit = FHE.fromExternal(inputs.eCollateralPerUnit, inputs.collateralPerUnitProof);
        if (!FHE.isSenderAllowed(collateralPerUnit)) revert NotAllowed();

        limitPrice = FHE.fromExternal(inputs.eLimitPrice, inputs.limitProof);
        if (!FHE.isSenderAllowed(limitPrice)) revert NotAllowed();
    }

    /// @notice Owner can cancel an active order; escrow refunded.
    function cancelOrder(uint256 orderId) external {
        DarkOrder storage order = _orders[orderId];
        if (order.owner != msg.sender) revert NotOrderOwner();
        if (!order.active) revert OrderNotActive();

        order.active = false;
        _refundCollateral(order);

        emit OrderCancelled(orderId, msg.sender);
    }

    // ─── Internal helpers ─────────────────────────────────────────

    function _importInputs(SubmitOrderInputs calldata inputs)
        internal
        returns (euint64 size, euint64 collateral, euint64 limitPrice)
    {
        size = FHE.fromExternal(inputs.eSize, inputs.sizeProof);
        if (!FHE.isSenderAllowed(size)) revert NotAllowed();

        collateral = FHE.fromExternal(inputs.eCollateral, inputs.collateralProof);
        if (!FHE.isSenderAllowed(collateral)) revert NotAllowed();

        limitPrice = FHE.fromExternal(inputs.eLimitPrice, inputs.limitProof);
        if (!FHE.isSenderAllowed(limitPrice)) revert NotAllowed();
    }

    function _lockCollateral(address user, euint64 collateral) internal {
        FHE.allowTransient(collateral, address(vault));
        vault.adjustBalance(user, collateral, false);

        euint64 collCredit = FHESafeMath.safeAdd(collateral, FHE.asEuint64(0));
        FHE.allowTransient(collCredit, address(vault));
        vault.adjustBalance(address(this), collCredit, true);
    }

    /// @dev Refunds the order's CURRENT outstanding escrow (collateral that
    ///      hasn't been consumed by a partial fill). For legacy orders
    ///      (pairMatchEligible=false) this is just `order.collateral`. For
    ///      pair-eligible orders it's `collateralPerUnit × current size`,
    ///      which equals the original lock minus whatever was already
    ///      spent on filled portions.
    function _refundCollateral(DarkOrder storage order) internal {
        euint64 amt = order.pairMatchEligible
            ? FHE.mul(order.collateralPerUnit, order.size)
            : order.collateral;

        FHE.allowTransient(amt, address(vault));
        vault.adjustBalance(address(this), amt, false);

        euint64 refund = FHESafeMath.safeAdd(amt, FHE.asEuint64(0));
        FHE.allowTransient(refund, address(vault));
        vault.adjustBalance(order.owner, refund, true);
    }

    function _storeOrder(
        euint64 size,
        euint64 collateral,
        euint64 limitPrice,
        uint8 marketId,
        bool isLong
    ) internal returns (uint256 orderId) {
        FHE.allowThis(size);
        FHE.allowThis(collateral);
        FHE.allowThis(limitPrice);
        FHE.allow(size, msg.sender);
        FHE.allow(collateral, msg.sender);
        FHE.allow(limitPrice, msg.sender);

        orderId = nextOrderId++;
        _orders[orderId] = DarkOrder({
            owner: msg.sender,
            marketId: marketId,
            isLong: isLong,
            active: true,
            pairMatchEligible: false,
            size: size,
            collateral: collateral,
            collateralPerUnit: euint64.wrap(0),  // unused on legacy path
            limitPrice: limitPrice
        });
    }

    /// @dev Phase 11 — store a pair-match-eligible order. Mirrors
    ///      `_storeOrder` but populates `collateralPerUnit` instead of
    ///      `collateral`, sets `pairMatchEligible = true`, emits the new
    ///      `OrderSubmittedForPair` event.
    function _storeOrderForPair(
        euint64 size,
        euint64 collateralPerUnit,
        euint64 limitPrice,
        uint8 marketId,
        bool isLong
    ) internal returns (uint256 orderId) {
        FHE.allowThis(size);
        FHE.allowThis(collateralPerUnit);
        FHE.allowThis(limitPrice);
        FHE.allow(size, msg.sender);
        FHE.allow(collateralPerUnit, msg.sender);
        FHE.allow(limitPrice, msg.sender);

        orderId = nextOrderId++;
        _orders[orderId] = DarkOrder({
            owner: msg.sender,
            marketId: marketId,
            isLong: isLong,
            active: true,
            pairMatchEligible: true,
            size: size,
            collateral: euint64.wrap(0),  // unused on pair path
            collateralPerUnit: collateralPerUnit,
            limitPrice: limitPrice
        });
    }

    // ─── Async batch match ────────────────────────────────────────

    /// @notice Bot-callable. For each orderId, computes whether the order
    ///         should fill at current oracle price, marks each ebool
    ///         publicly decryptable, and emits the handle list for relayer
    ///         pickup.
    /// @dev SPEC DEVIATION (§5.2 "$ZAMA fee"): this function is non-payable.
    ///      The spec calls for a $ZAMA decrypt fee. FHEVM v0.11.1 exposes
    ///      no on-chain fee API and Sepolia Gateway decrypts are free-tier;
    ///      a speculative `payable` here would not match the future API
    ///      shape if Zama enables paid decrypts. Resolution path: contract
    ///      upgrade integrating the actual fee mechanism. See CHANGELOG
    ///      2026-04-26 "$ZAMA fee question" for the full reasoning.
    /// @dev HCU budget: each order in a batch costs ~152k HCU for the
    ///      le/ge fill check plus ~337k HCU for the safeAdd-based escrow
    ///      refund in the callback (~489k per order total). The 5M
    ///      sequential limit caps the safe batch size at ~10 orders.
    ///      Keepers MUST cap orderIds.length at 10 to avoid HCU exhaustion.
    function requestBatchMatch(uint256[] calldata orderIds) external returns (uint256 requestId) {
        if (oracle == address(0)) revert OracleNotSet();
        if (perp == address(0)) revert PerpNotSet();
        uint256 n = orderIds.length;
        if (n == 0) revert EmptyBatch();

        uint8 batchMarket = _marketIdOf(orderIds[0]);
        (uint64 price, bool fresh) = Oracle(oracle).getPrice(batchMarket);
        if (!fresh) revert OraclePriceStale();

        euint64 ePrice = FHE.asEuint64(price);

        bytes32[] memory handles = new bytes32[](n);
        for (uint256 i = 0; i < n; i++) {
            DarkOrder storage order = _orders[orderIds[i]];
            if (!order.active) revert OrderNotActive();
            // Phase 11: pair-eligible orders MUST go through submitMatchPair,
            // not the legacy batch-vs-pool flow. Reject explicitly so a
            // misconfigured keeper can't route them here and silently get
            // wrong fills (they'd settle against Perp pool at oracle price
            // instead of pairing with a counterparty).
            if (order.pairMatchEligible) revert PairOrderNotEligible();
            // Reject heterogeneous batches — the oracle price was fetched
            // for batchMarket only; orders from other markets would settle
            // against the wrong price.
            if (order.marketId != batchMarket) revert CrossMarketBatch();

            // Per-order fill check: long → oracle <= limit; short → oracle >= limit
            ebool wouldFill = order.isLong
                ? FHE.le(ePrice, order.limitPrice)
                : FHE.ge(ePrice, order.limitPrice);

            FHE.makePubliclyDecryptable(wouldFill);
            handles[i] = FHE.toBytes32(wouldFill);
        }

        requestId = uint256(keccak256(abi.encode(orderIds, block.number, block.timestamp, msg.sender)));
        bytes memory ctx = abi.encode(orderIds);
        _enqueue(requestId, msg.sender, 0, ctx);

        emit BatchMatchRequested(requestId, msg.sender, orderIds, handles);
    }

    // ─── Async pair match (Phase 11) ─────────────────────────────

    /// @notice Phase 11 — match two opposite-side orders peer-to-peer.
    ///         Caller passes the canonical pair: `buyId` is the LONG side,
    ///         `sellId` is the SHORT side, both pair-match-eligible. Engine
    ///         computes 3 FHE booleans (`intersects`, `buyResidualZero`,
    ///         `sellResidualZero`), marks all 3 publicly decryptable in one
    ///         Gateway request, enqueues the pending state. Resolution
    ///         happens in `_onMatchDecided`.
    /// @dev Privacy preserved: only the 3 decision booleans ever leave FHE.
    ///      Limit prices, sizes, collaterals, per-unit collaterals stay
    ///      encrypted forever. The matcher bot sees only plaintext metadata
    ///      (market, side, ownership, activity) — no decrypt rights.
    /// @dev Settlement at oracle price (not midpoint of limits) — see
    ///      `docs/specs/2026-04-28-darkpool-pair-match-design.md` §4.
    /// @dev SPEC DEVIATION (§5.2 "$ZAMA fee"): non-payable. Same rationale
    ///      as the other async entry points.
    /// @dev HCU sequential: ~1.30M (1× FHE.le for intersects + 1× FHE.le
    ///      + 1× FHE.select for fillSize + 2× safeSub for residuals +
    ///      2× FHE.eq for residual-zero checks + ACL/decrypt overhead).
    ///      Far under 5M.
    function submitMatchPair(uint256 buyId, uint256 sellId) external returns (uint256 requestId) {
        if (oracle == address(0)) revert OracleNotSet();
        if (perp == address(0)) revert PerpNotSet();

        DarkOrder storage buyOrder  = _orders[buyId];
        DarkOrder storage sellOrder = _orders[sellId];

        // Plaintext invariants — fail fast.
        if (!buyOrder.active   || !sellOrder.active)                     revert PairOrderInactive();
        if (!buyOrder.pairMatchEligible || !sellOrder.pairMatchEligible) revert PairOrderNotEligible();
        if (buyOrder.owner == sellOrder.owner)                           revert PairOrdersSameOwner();
        if (buyOrder.marketId != sellOrder.marketId)                     revert PairOrdersDifferentMarket();
        if (buyOrder.isLong == sellOrder.isLong)                         revert PairOrdersSameSide();
        if (!buyOrder.isLong)                                            revert PairOrdersWrongCanonicalization();

        (, bool fresh) = Oracle(oracle).getPrice(buyOrder.marketId);
        if (!fresh) revert OraclePriceStale();

        // Compute the 3 ebools + fillSize + residuals in a helper to avoid
        // stack-too-deep (this function holds storage refs + computed
        // ciphertexts simultaneously).
        PendingMatch memory m = _computePairMatch(buyId, sellId, msg.sender);
        bytes32[] memory handles = _publishPairHandles(m);

        requestId = uint256(keccak256(abi.encode(buyId, sellId, block.number, block.timestamp, msg.sender)));
        bytes memory ctx = abi.encode(buyId, sellId);
        _enqueue(requestId, msg.sender, 0, ctx);
        _pendingMatches[requestId] = m;

        emit MatchProposed(requestId, buyId, sellId, msg.sender, handles);
    }

    /// @dev FHE compute extracted into a helper to keep `submitMatchPair`
    ///      under the EVM stack limit. Returns a fully-populated
    ///      `PendingMatch` that the caller stores and Gateway-decrypts.
    function _computePairMatch(
        uint256 buyId,
        uint256 sellId,
        address requester
    ) internal returns (PendingMatch memory m) {
        DarkOrder storage buyOrder  = _orders[buyId];
        DarkOrder storage sellOrder = _orders[sellId];

        // Prices intersect when seller is willing to sell at or below what buyer is willing to pay.
        ebool   intersects = FHE.le(sellOrder.limitPrice, buyOrder.limitPrice);

        // fillSize = min(buy.size, sell.size). FHE has no min primitive — use le + select.
        ebool   buySmaller = FHE.le(buyOrder.size, sellOrder.size);
        euint64 fillSize   = FHE.select(buySmaller, buyOrder.size, sellOrder.size);

        // Residuals = origSize - fillSize. SafeSub saturates at 0 (it never
        // underflows here by construction since fillSize = min(...), but
        // the saturating wrapper is the project-wide rule for raw FHE.sub).
        euint64 buyResidual  = FHESafeMath.safeSub(buyOrder.size,  fillSize);
        euint64 sellResidual = FHESafeMath.safeSub(sellOrder.size, fillSize);

        // Residual-zero booleans — bundled into the same Gateway decrypt
        // so the callback can close exhausted orders atomically without
        // a second decrypt round-trip.
        ebool buyResidualZero  = FHE.eq(buyResidual,  FHE.asEuint64(0));
        ebool sellResidualZero = FHE.eq(sellResidual, FHE.asEuint64(0));

        m = PendingMatch({
            buyId:            buyId,
            sellId:           sellId,
            intersects:       intersects,
            fillSize:         fillSize,
            buyResidualSize:  buyResidual,
            sellResidualSize: sellResidual,
            buyResidualZero:  buyResidualZero,
            sellResidualZero: sellResidualZero,
            requester:        requester
        });
    }

    /// @dev Grants engine ACL on the computed ciphertexts (so the callback
    ///      can read them), marks the 3 ebools publicly decryptable, and
    ///      builds the handle list for the `MatchProposed` event.
    function _publishPairHandles(PendingMatch memory m)
        internal
        returns (bytes32[] memory handles)
    {
        FHE.allowThis(m.intersects);
        FHE.allowThis(m.fillSize);
        FHE.allowThis(m.buyResidualSize);
        FHE.allowThis(m.sellResidualSize);
        FHE.allowThis(m.buyResidualZero);
        FHE.allowThis(m.sellResidualZero);

        FHE.makePubliclyDecryptable(m.intersects);
        FHE.makePubliclyDecryptable(m.buyResidualZero);
        FHE.makePubliclyDecryptable(m.sellResidualZero);

        // Cleartext-tuple order MUST match: [intersects, buyResidualZero, sellResidualZero].
        // The `_decodeBatch` helper reads bits[0..2] in this order.
        handles = new bytes32[](3);
        handles[0] = FHE.toBytes32(m.intersects);
        handles[1] = FHE.toBytes32(m.buyResidualZero);
        handles[2] = FHE.toBytes32(m.sellResidualZero);
    }

    /// @notice Phase 11 — Gateway-relayed callback for a pair-match
    ///         decision. The Gateway delivers 3 booleans atomically:
    ///         [intersects, buyResidualZero, sellResidualZero]. Reuses
    ///         `_decodeBatch` (line 308 below) for the flat-tuple
    ///         cleartext encoding.
    /// @dev Canonical pattern: checkSignatures → _dequeue → external work.
    function _onMatchDecided(
        uint256 requestId,
        bytes32[] memory handlesList,
        bytes memory cleartexts,
        bytes memory decryptionProof
    ) external {
        FHE.checkSignatures(handlesList, cleartexts, decryptionProof);
        _dequeue(requestId);                       // replay guard
        PendingMatch memory m = _pendingMatches[requestId];
        delete _pendingMatches[requestId];

        // Decode 3 booleans: [intersects, buyResidualZero, sellResidualZero].
        // Order matches the handle list emitted in MatchProposed.
        uint256[] memory bits = _decodeBatch(cleartexts, 3);
        bool intersects       = bits[0] != 0;
        bool buyResidualZero  = bits[1] != 0;
        bool sellResidualZero = bits[2] != 0;

        if (!intersects) {
            emit MatchRejected(requestId, m.buyId, m.sellId);
            return;                                // both orders remain active
        }

        // Concurrent-cancel safety: if either order was cancelled during
        // the in-flight decrypt window, escrow has already been refunded
        // to the user via cancelOrder. Opening a position now would either
        // double-charge them or silent-zero on insufficient balance —
        // either way wrong. Skip the fill cleanly; both users keep state.
        if (!_orders[m.buyId].active || !_orders[m.sellId].active) {
            emit MatchAborted(requestId, m.buyId, m.sellId, "cancelled during decrypt");
            return;
        }

        _applyPairFill(m, buyResidualZero, sellResidualZero, requestId);
    }

    /// @dev Settles a successful pair match: per-side filled collateral is
    ///      released from engine escrow back to the user, then PerpEngine
    ///      opens both positions at oracle price. Residuals are written
    ///      back to the orders; fully-consumed orders close.
    function _applyPairFill(
        PendingMatch memory m,
        bool buyResidualZero,
        bool sellResidualZero,
        uint256 requestId
    ) internal {
        DarkOrder storage buyOrder  = _orders[m.buyId];
        DarkOrder storage sellOrder = _orders[m.sellId];

        // Snapshot plaintext fields before any state writes — used by the
        // external-call section below. Snapshotting first lets us hoist the
        // storage writes ahead of external calls (CEI pattern, defense-in-
        // depth: even though Vault + Perp aren't user-controlled callable
        // surfaces today, an inactive flag must be authoritative the moment
        // an external call lands).
        address buyOwner    = buyOrder.owner;
        address sellOwner   = sellOrder.owner;
        uint8   buyMarket   = buyOrder.marketId;
        uint8   sellMarket  = sellOrder.marketId;

        // Per-side filled collateral = collateralPerUnit × fillSize. Single
        // FHE.mul each — supported in FHEVM v0.11.1 for ct × ct.
        euint64 buyFilledColl  = FHE.mul(buyOrder.collateralPerUnit,  m.fillSize);
        euint64 sellFilledColl = FHE.mul(sellOrder.collateralPerUnit, m.fillSize);

        // ── State changes BEFORE external calls (CEI) ──
        buyOrder.size  = m.buyResidualSize;
        sellOrder.size = m.sellResidualSize;
        // Re-grant owner ACL only on residuals that survive — closed orders
        // don't need a decryptable size handle (saves ~5k HCU per closed
        // side). Original size cipher had its grant via `_storeOrderForPair`;
        // residuals were freshly minted in `_computePairMatch` with engine-
        // only ACL, so a survivor needs explicit owner re-grant for the
        // frontend partial-fill progress display per design memo §11.
        if (buyResidualZero) {
            buyOrder.active = false;
            emit OrderClosed(m.buyId, "filled");
        } else {
            FHE.allow(buyOrder.size, buyOwner);
        }
        if (sellResidualZero) {
            sellOrder.active = false;
            emit OrderClosed(m.sellId, "filled");
        } else {
            FHE.allow(sellOrder.size, sellOwner);
        }

        // ── External calls (refunds + Perp opens) ──
        // Refund the filled portion to each user's vault balance. Engine's
        // escrow holds collateralPerUnit × originalSize at this point; we
        // release collateralPerUnit × fillSize, leaving the residual amount
        // backing the residual order size (auto-correct since
        // `_refundCollateral` re-derives the product from the updated `size`
        // field on cancel).
        _refundFilledColl(buyOwner,  buyFilledColl);
        _refundFilledColl(sellOwner, sellFilledColl);

        // ACL transient grants for PerpEngine to read the ciphertexts.
        // m.fillSize is reused for both calls — granting once suffices for
        // the whole tx (transient ACL is per-handle, not per-call).
        FHE.allowTransient(m.fillSize,     perp);
        FHE.allowTransient(buyFilledColl,  perp);
        FHE.allowTransient(sellFilledColl, perp);

        // Open both positions at the same oracle price. PerpEngine.openPositionAsExecutor
        // re-debits the user's vault for the collateral we just refunded — net
        // user balance unchanged; engine escrow drops by filledColl per side.
        PerpEngine(perp).openPositionAsExecutor(
            buyOwner,  m.fillSize, buyFilledColl,  true,  buyMarket
        );
        PerpEngine(perp).openPositionAsExecutor(
            sellOwner, m.fillSize, sellFilledColl, false, sellMarket
        );

        emit MatchSettled(requestId, m.buyId, m.sellId, m.requester);
    }

    /// @dev Releases `amt` of collateral from engine escrow back to `user`'s
    ///      vault balance. Used during pair-match settlement before
    ///      PerpEngine re-debits the user for the new position.
    function _refundFilledColl(address user, euint64 amt) internal {
        FHE.allowTransient(amt, address(vault));
        vault.adjustBalance(address(this), amt, false);

        euint64 refund = FHESafeMath.safeAdd(amt, FHE.asEuint64(0));
        FHE.allowTransient(refund, address(vault));
        vault.adjustBalance(user, refund, true);
    }

    /// @notice Gateway-relayed callback. Verifies KMS sigs, dequeues
    ///         (replay guard) BEFORE external calls, then settles all
    ///         orders in the batch.
    function _onBatchDecided(
        uint256 requestId,
        bytes32[] memory handlesList,
        bytes memory cleartexts,
        bytes memory decryptionProof
    ) external {
        FHE.checkSignatures(handlesList, cleartexts, decryptionProof);
        PendingDecrypt memory ctx = _dequeue(requestId);

        uint256[] memory orderIds = abi.decode(ctx.context, (uint256[]));
        uint256[] memory shouldFires = _decodeBatch(cleartexts, orderIds.length);

        _dispatchBatch(orderIds, shouldFires, requestId);
    }

    /// @dev Extracted to avoid stack-too-deep in _onBatchDecided.
    function _dispatchBatch(
        uint256[] memory orderIds,
        uint256[] memory shouldFires,
        uint256 requestId
    ) internal {
        for (uint256 i = 0; i < orderIds.length; i++) {
            _settleOne(orderIds[i], shouldFires[i] != 0);
        }
        emit BatchSettled(requestId, orderIds, shouldFires);
    }

    /// @dev Decodes N booleans from the KMS cleartext blob.
    ///      The mock Gateway (and production KMSVerifier) returns batched
    ///      ebool decrypts as `abi.encode(uint256, uint256, ...)` — a flat
    ///      tuple of N uint256 values (NOT a uint256[] with length header).
    ///      Each element occupies exactly 32 bytes at offset i*32 within the
    ///      data region. We extract via assembly to avoid the ABI-decode
    ///      tuple-vs-array ambiguity.
    function _decodeBatch(bytes memory cleartexts, uint256 expectedLen)
        internal pure returns (uint256[] memory shouldFires)
    {
        if (cleartexts.length != expectedLen * 32) revert CleartextLengthMismatch();
        shouldFires = new uint256[](expectedLen);
        for (uint256 i = 0; i < expectedLen; i++) {
            uint256 val;
            uint256 byteOffset = 32 + i * 32; // skip the `bytes` length word
            assembly {
                val := mload(add(cleartexts, byteOffset))
            }
            shouldFires[i] = val;
        }
    }

    /// @dev Settles a single order from the batch.
    function _settleOne(uint256 orderId, bool fire) internal {
        DarkOrder storage order = _orders[orderId];
        order.active = false;

        // Always refund escrow first — Perp will re-debit user normally if order fires
        _refundCollateral(order);

        if (!fire) {
            return;
        }

        FHE.allowTransient(order.size, perp);
        FHE.allowTransient(order.collateral, perp);
        PerpEngine(perp).openPositionAsExecutor(
            order.owner, order.size, order.collateral, order.isLong, order.marketId
        );
    }

    /// @dev Returns marketId of an order — small read helper to keep the
    ///      ergonomics of `requestBatchMatch` clean (avoids inlining storage
    ///      reads in arg lists).
    function _marketIdOf(uint256 orderId) internal view returns (uint8) {
        return _orders[orderId].marketId;
    }
}
