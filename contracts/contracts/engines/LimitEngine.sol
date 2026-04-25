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

    // ─── Views ─────────────────────────────────────────────────────

    function getOrder(uint256 orderId) external view returns (LimitOrder memory) {
        return _orders[orderId];
    }
}
