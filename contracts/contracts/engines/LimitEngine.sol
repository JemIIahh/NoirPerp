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

/// @title LimitEngine
/// @notice Encrypted TP / SL / Limit-Open order management with bot-triggered
///         async execution. Orders carry encrypted trigger prices; the
///         comparison against current oracle price runs in FHE; only the
///         single-bit `shouldTrigger` ebool is decrypted via Gateway. On
///         match, the callback dispatches to PerpEngine via the executor
///         pattern (close for TP/SL; open for Limit).
/// @dev Inherits DecryptQueue for replay-guarded async callbacks.
contract LimitEngine is DecryptQueue, ZamaEthereumConfig {
    NoirVault public immutable vault;
    address public oracle;      // set post-deploy
    address public perp;        // set post-deploy
    address public compliance;  // set post-deploy
    address public admin;

    uint8 public constant ORDER_TYPE_TP = 1;
    uint8 public constant ORDER_TYPE_SL = 2;
    uint8 public constant ORDER_TYPE_LIMIT = 3;

    struct LimitOrder {
        address owner;
        uint8 orderType;
        uint8 marketId;
        bool isLong;
        bool active;
        uint256 positionId;     // for TP/SL only
        euint64 triggerPrice;
        euint64 size;           // for LIMIT only
        euint64 collateral;     // for LIMIT only
    }

    mapping(uint256 orderId => LimitOrder) private _orders;
    uint256 public nextOrderId;

    event AdminTransferred(address indexed oldAdmin, address indexed newAdmin);
    event OracleSet(address indexed newOracle);
    event PerpSet(address indexed newPerp);
    event ComplianceSet(address indexed newCompliance);
    event OrderPlaced(uint256 indexed orderId, address indexed owner, uint8 orderType, uint8 marketId);
    event OrderCancelled(uint256 indexed orderId, address indexed owner);
    event TriggerRequested(uint256 indexed requestId, uint256 indexed orderId, address indexed keeper, bytes32 shouldTriggerHandle);
    event Triggered(uint256 indexed orderId, address indexed user);
    event TriggerNotMet(uint256 indexed orderId);

    error NotAdmin();
    error ZeroAddress();
    error NotPositionOwner();
    error PositionNotActive();
    error InvalidOrderType();
    error NotOrderOwner();
    error OrderNotActive();
    error NotAllowed();
    error ComplianceNotSet();
    error NotCompliant();
    error InvalidMarket();
    error OracleNotSet();
    error PerpNotSet();
    error OraclePriceStale();

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

    function getOrder(uint256 orderId) external view returns (LimitOrder memory) {
        return _orders[orderId];
    }

    // ─── Place order — TP / SL (close-on-trigger) ──────────────────

    /// @notice Places a TP (orderType=1) or SL (orderType=2) order
    ///         tied to an existing perp position owned by msg.sender.
    /// @param positionId The position to close on trigger.
    /// @param eTrigger Encrypted trigger price.
    /// @param triggerProof FHE input proof for eTrigger.
    /// @param orderType Must be 1 (TP) or 2 (SL).
    function placeStopOrTake(
        uint256 positionId,
        externalEuint64 eTrigger,
        bytes calldata triggerProof,
        uint8 orderType
    ) external returns (uint256 orderId) {
        if (orderType != ORDER_TYPE_TP && orderType != ORDER_TYPE_SL) {
            revert InvalidOrderType();
        }

        // Verify caller owns the position + it's active
        NoirVault.Position memory p = vault.allowPositionAccess(positionId);
        if (p.owner != msg.sender) revert NotPositionOwner();
        if (!p.active) revert PositionNotActive();

        // Import encrypted trigger
        euint64 triggerPrice = FHE.fromExternal(eTrigger, triggerProof);
        if (!FHE.isSenderAllowed(triggerPrice)) revert NotAllowed();
        FHE.allowThis(triggerPrice);

        orderId = nextOrderId++;
        // Trivial-encrypt zero ciphertexts for unused fields (TP/SL don't
        // use size/collateral). FHE.asEuint64(0) is safer than euint64.wrap(0)
        // — explicit type, well-supported, 32 HCU is negligible.
        euint64 zeroCt = FHE.asEuint64(0);
        _orders[orderId] = LimitOrder({
            owner: msg.sender,
            orderType: orderType,
            marketId: p.marketId,
            isLong: p.isLong,
            active: true,
            positionId: positionId,
            triggerPrice: triggerPrice,
            size: zeroCt,         // unused for TP/SL
            collateral: zeroCt    // unused for TP/SL
        });

        emit OrderPlaced(orderId, msg.sender, orderType, p.marketId);
    }

    // ─── Cancel order ─────────────────────────────────────────────

    /// @notice Owner can cancel an active order. For LIMIT orders,
    ///         this also refunds the escrowed collateral. (TP/SL orders
    ///         have no escrow.)
    function cancelOrder(uint256 orderId) external {
        LimitOrder storage order = _orders[orderId];
        if (order.owner != msg.sender) revert NotOrderOwner();
        if (!order.active) revert OrderNotActive();

        order.active = false;

        // For LIMIT: refund escrowed collateral. (Task 4 will add the
        // collateral refund logic; for TP/SL there's nothing to refund.)
        if (order.orderType == ORDER_TYPE_LIMIT) {
            _refundLimitCollateral(order);
        }

        emit OrderCancelled(orderId, msg.sender);
    }

    // ─── Place order — LIMIT (open-on-trigger) ─────────────────────

    /// @notice Inputs bundle for `placeLimit`. Packing into a struct works
    ///         around the EVM 16-slot stack limit on individual calldata args.
    ///         Tests construct as `{eTrigger, triggerProof, eSize, sizeProof, eCollateral, collateralProof}`.
    struct PlaceLimitInputs {
        externalEuint64 eTrigger;
        bytes triggerProof;
        externalEuint64 eSize;
        bytes sizeProof;
        externalEuint64 eCollateral;
        bytes collateralProof;
    }

    /// @notice Places a Limit-Open order. Locks `eCollateral` from caller's
    ///         vault USDCx balance into LimitEngine's vault balance (escrow).
    ///         On trigger, the escrow is refunded and PerpEngine opens the
    ///         position via the executor pattern (debiting user normally).
    ///         On cancel, the escrow is refunded.
    function placeLimit(
        PlaceLimitInputs calldata inputs,
        uint8 marketId,
        bool isLong,
        bytes32[] calldata complianceProof
    ) external returns (uint256 orderId) {
        // Pre-conditions
        if (compliance == address(0)) revert ComplianceNotSet();
        if (!Compliance(compliance).verify(msg.sender, complianceProof)) revert NotCompliant();
        if (marketId < 1 || marketId > 3) revert InvalidMarket();

        // Import all 3 encrypted inputs in a helper to free stack slots
        (euint64 triggerPrice, euint64 size, euint64 collateral) = _importLimitInputs(inputs);

        // Lock collateral escrow
        _lockCollateral(msg.sender, collateral);

        // Store the order (helper to free stack)
        orderId = _storeLimitOrder(triggerPrice, size, collateral, marketId, isLong);

        emit OrderPlaced(orderId, msg.sender, ORDER_TYPE_LIMIT, marketId);
    }

    /// @dev Imports the 3 encrypted inputs with isSenderAllowed guards.
    ///      Extracted to free stack slots in placeLimit.
    function _importLimitInputs(
        PlaceLimitInputs calldata inputs
    ) internal returns (euint64 triggerPrice, euint64 size, euint64 collateral) {
        triggerPrice = FHE.fromExternal(inputs.eTrigger, inputs.triggerProof);
        if (!FHE.isSenderAllowed(triggerPrice)) revert NotAllowed();

        size = FHE.fromExternal(inputs.eSize, inputs.sizeProof);
        if (!FHE.isSenderAllowed(size)) revert NotAllowed();

        collateral = FHE.fromExternal(inputs.eCollateral, inputs.collateralProof);
        if (!FHE.isSenderAllowed(collateral)) revert NotAllowed();
    }

    /// @dev Stores the order in `_orders` with persistent ACL grants.
    ///      Extracted to free stack slots in placeLimit.
    function _storeLimitOrder(
        euint64 triggerPrice,
        euint64 size,
        euint64 collateral,
        uint8 marketId,
        bool isLong
    ) internal returns (uint256 orderId) {
        FHE.allowThis(triggerPrice);
        FHE.allowThis(size);
        FHE.allowThis(collateral);
        FHE.allow(triggerPrice, msg.sender);
        FHE.allow(size, msg.sender);
        FHE.allow(collateral, msg.sender);

        orderId = nextOrderId++;
        _orders[orderId] = LimitOrder({
            owner: msg.sender,
            orderType: ORDER_TYPE_LIMIT,
            marketId: marketId,
            isLong: isLong,
            active: true,
            positionId: 0,
            triggerPrice: triggerPrice,
            size: size,
            collateral: collateral
        });
    }

    /// @dev Lock collateral escrow: debit user vault, credit LimitEngine vault.
    function _lockCollateral(address user, euint64 collateral) internal {
        FHE.allowTransient(collateral, address(vault));
        vault.adjustBalance(user, collateral, false);

        euint64 collCredit = FHESafeMath.safeAdd(collateral, FHE.asEuint64(0));
        FHE.allowTransient(collCredit, address(vault));
        vault.adjustBalance(address(this), collCredit, true);
    }

    // ─── Async trigger ─────────────────────────────────────────────

    /// @notice Bot-callable. Computes whether the order should fire by
    ///         comparing the current oracle price to the encrypted
    ///         trigger, then requests Gateway decryption of the bool.
    /// @dev SPEC DEVIATION (§5.2 "$ZAMA fee"): this function is non-payable.
    ///      The spec calls for a $ZAMA decrypt fee. FHEVM v0.11.1 exposes
    ///      no on-chain fee API and Sepolia Gateway decrypts are free-tier;
    ///      a speculative `payable` here would not match the future API
    ///      shape if Zama enables paid decrypts. Resolution path: contract
    ///      upgrade integrating the actual fee mechanism. See CHANGELOG
    ///      2026-04-26 "$ZAMA fee question" for the full reasoning.
    function requestTrigger(uint256 orderId) external returns (uint256 requestId) {
        if (oracle == address(0)) revert OracleNotSet();
        if (perp == address(0)) revert PerpNotSet();

        LimitOrder storage order = _orders[orderId];
        if (!order.active) revert OrderNotActive();

        (uint64 price, bool fresh) = Oracle(oracle).getPrice(order.marketId);
        if (!fresh) revert OraclePriceStale();
        euint64 ePrice = FHE.asEuint64(price);

        ebool shouldTrigger = _shouldTrigger(
            order.orderType, order.isLong, ePrice, order.triggerPrice
        );
        FHE.makePubliclyDecryptable(shouldTrigger);

        requestId = uint256(keccak256(abi.encode(
            orderId, block.number, block.timestamp, msg.sender
        )));

        // Context = orderId only (we re-read order in callback)
        bytes memory ctx = abi.encode(orderId);
        _enqueue(requestId, msg.sender, orderId, ctx);

        emit TriggerRequested(requestId, orderId, msg.sender, FHE.toBytes32(shouldTrigger));
    }

    /// @notice Gateway-relayed callback. Verifies KMS sigs, dequeues
    ///         (replay guard) BEFORE external calls, marks order inactive,
    ///         and dispatches to the right execution path on match.
    function _onTriggerDecided(
        uint256 requestId,
        bytes32[] memory handlesList,
        bytes memory cleartexts,
        bytes memory decryptionProof
    ) external {
        // 1. Verify KMS signatures first (reverts if invalid)
        FHE.checkSignatures(handlesList, cleartexts, decryptionProof);

        // 2. Dequeue BEFORE any external call — replay guard
        PendingDecrypt memory ctx = _dequeue(requestId);
        uint256 orderId = abi.decode(ctx.context, (uint256));

        LimitOrder storage order = _orders[orderId];
        // Mark inactive regardless of outcome — trigger is single-use
        order.active = false;

        uint256 clearUint = abi.decode(cleartexts, (uint256));
        bool shouldFire = clearUint != 0;

        _dispatchTrigger(orderId, order, shouldFire);
    }

    /// @dev Dispatched from `_onTriggerDecided` to avoid stack-too-deep.
    ///      Handles all 3 order types on both fire and miss paths.
    function _dispatchTrigger(
        uint256 orderId,
        LimitOrder storage order,
        bool shouldFire
    ) internal {
        if (!shouldFire) {
            // For LIMIT: refund escrow even on miss
            if (order.orderType == ORDER_TYPE_LIMIT) {
                _refundLimitCollateral(order);
            }
            emit TriggerNotMet(orderId);
            return;
        }

        if (order.orderType == ORDER_TYPE_TP || order.orderType == ORDER_TYPE_SL) {
            // Defensive: re-verify the position's owner matches the order's
            // owner before closing. positionIds aren't recycled in current
            // NoirVault, but this guards against future storage refactors
            // and against any path where a stale positionId could leak.
            NoirVault.Position memory p = vault.getPosition(order.positionId);
            if (p.owner != order.owner) revert NotPositionOwner();

            PerpEngine(perp).closePositionAsExecutor(order.positionId);
        } else {
            // LIMIT: refund escrow first, then have Perp open the position
            // (which will debit user normally and apply margin/silent-zero)
            _refundLimitCollateral(order);

            FHE.allowTransient(order.size, perp);
            FHE.allowTransient(order.collateral, perp);
            PerpEngine(perp).openPositionAsExecutor(
                order.owner, order.size, order.collateral, order.isLong, order.marketId
            );
        }

        emit Triggered(orderId, order.owner);
    }

    // ─── Trigger condition helper ─────────────────────────────────

    /// @dev Computes `ebool shouldTrigger` based on order type and direction.
    ///      useGe = (TP && long) || (SL && short) || (LIMIT && short)
    function _shouldTrigger(
        uint8 orderType,
        bool isLong,
        euint64 currentPrice,
        euint64 triggerPrice
    ) internal returns (ebool) {
        bool useGe;
        if (orderType == ORDER_TYPE_TP) useGe = isLong;
        else if (orderType == ORDER_TYPE_SL) useGe = !isLong;
        else /* LIMIT */ useGe = !isLong;
        return useGe
            ? FHE.ge(currentPrice, triggerPrice)
            : FHE.le(currentPrice, triggerPrice);
    }

    /// @dev Refunds escrowed collateral for a LIMIT order. Debits LimitEngine's
    ///      vault balance + credits the order's owner. Called from cancelOrder
    ///      and from the trigger callback (before executing the position open).
    function _refundLimitCollateral(LimitOrder storage order) internal {
        // Debit LimitEngine's vault balance
        FHE.allowTransient(order.collateral, address(vault));
        vault.adjustBalance(address(this), order.collateral, false);

        // Credit user's vault balance (fresh handle copy)
        euint64 refund = FHESafeMath.safeAdd(order.collateral, FHE.asEuint64(0));
        FHE.allowTransient(refund, address(vault));
        vault.adjustBalance(order.owner, refund, true);
    }
}
