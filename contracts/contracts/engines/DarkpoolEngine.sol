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
/// @notice Encrypted batch-limit-order pool. Orders carry encrypted size,
///         collateral, and limit price; a keeper batches a list of orderIds
///         for matching; the engine evaluates per-order fill conditions on
///         ciphertexts; one Gateway decrypt resolves all of them; the
///         callback opens perp positions for all fillable orders via the
///         PerpEngine executor pattern.
/// @dev Inherits DecryptQueue for replay-guarded async callbacks.
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
        euint64 size;
        euint64 collateral;
        euint64 limitPrice;
    }

    mapping(uint256 orderId => DarkOrder) private _orders;
    uint256 public nextOrderId;

    event AdminTransferred(address indexed oldAdmin, address indexed newAdmin);
    event OracleSet(address indexed newOracle);
    event PerpSet(address indexed newPerp);
    event ComplianceSet(address indexed newCompliance);
    event OrderSubmitted(uint256 indexed orderId, address indexed owner, uint8 marketId);
    event OrderCancelled(uint256 indexed orderId, address indexed owner);

    error NotAdmin();
    error ZeroAddress();
    error ComplianceNotSet();
    error NotCompliant();
    error InvalidMarket();
    error NotAllowed();
    error NotOrderOwner();
    error OrderNotActive();

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

    function _refundCollateral(DarkOrder storage order) internal {
        FHE.allowTransient(order.collateral, address(vault));
        vault.adjustBalance(address(this), order.collateral, false);

        euint64 refund = FHESafeMath.safeAdd(order.collateral, FHE.asEuint64(0));
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
            size: size,
            collateral: collateral,
            limitPrice: limitPrice
        });
    }
}
