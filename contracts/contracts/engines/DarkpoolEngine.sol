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

    error NotAdmin();
    error ZeroAddress();

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
}
