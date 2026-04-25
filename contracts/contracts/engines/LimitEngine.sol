// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { FHE, euint64, ebool, externalEuint64 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";
import { FHESafeMath } from "../lib/FHESafeMath.sol";
import { DecryptQueue } from "../lib/DecryptQueue.sol";
import { NoirVault } from "../NoirVault.sol";

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
    address public oracle;  // set post-deploy
    address public perp;    // set post-deploy
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
    event OrderPlaced(uint256 indexed orderId, address indexed owner, uint8 orderType, uint8 marketId);
    event OrderCancelled(uint256 indexed orderId, address indexed owner);

    error NotAdmin();
    error ZeroAddress();
    error NotPositionOwner();
    error PositionNotActive();
    error InvalidOrderType();
    error NotOrderOwner();
    error OrderNotActive();
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

    /// @dev Stub for Task 4 — empty for TP/SL, will be filled in for LIMIT.
    function _refundLimitCollateral(LimitOrder storage /* order */) internal pure {
        // Filled in Task 4 (placeLimit + escrow handling)
    }
}
