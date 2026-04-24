// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { FHE, euint64, externalEuint64 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";
import { IERC7984 } from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";

/// @title NoirVault
/// @notice Sole owner of all NoirPerp ciphertext state. No engine ever
///         holds user funds; engines call into the vault via authorized-
///         engine gating to mutate state.
/// @dev Task 4 (this commit): admin + engine authorization + pause.
///      Tasks 5-6 add balance ops and position storage.
contract NoirVault is ZamaEthereumConfig {
    /// @dev USDCx (ERC-7984) used for collateral. Set once at construction.
    ///      Can be address(0) for admin-only tests.
    IERC7984 public immutable usdcxToken;

    address public admin;
    bool public paused;
    mapping(address => bool) public authorizedEngines;

    event AdminTransferred(address indexed oldAdmin, address indexed newAdmin);
    event EngineRegistered(address indexed engine);
    event EngineDeregistered(address indexed engine);
    event Paused();
    event Unpaused();

    error NotAdmin();
    error NotAuthorizedEngine();
    error ZeroAddress();
    error AlreadyPaused();
    error NotPaused();
    error VaultPaused();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    modifier onlyAuthorizedEngine() {
        if (!authorizedEngines[msg.sender]) revert NotAuthorizedEngine();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert VaultPaused();
        _;
    }

    constructor(address initialAdmin, address usdcxToken_) {
        if (initialAdmin == address(0)) revert ZeroAddress();
        admin = initialAdmin;
        usdcxToken = IERC7984(usdcxToken_);
        emit AdminTransferred(address(0), initialAdmin);
    }

    // ─── Admin: engine registration ────────────────────────────────────

    function registerEngine(address engine) external onlyAdmin {
        if (engine == address(0)) revert ZeroAddress();
        authorizedEngines[engine] = true;
        emit EngineRegistered(engine);
    }

    function deregisterEngine(address engine) external onlyAdmin {
        authorizedEngines[engine] = false;
        emit EngineDeregistered(engine);
    }

    // ─── Admin: pause ──────────────────────────────────────────────────

    function pause() external onlyAdmin {
        if (paused) revert AlreadyPaused();
        paused = true;
        emit Paused();
    }

    function unpause() external onlyAdmin {
        if (!paused) revert NotPaused();
        paused = false;
        emit Unpaused();
    }

    // ─── Admin: transfer ───────────────────────────────────────────────

    function transferAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        address old = admin;
        admin = newAdmin;
        emit AdminTransferred(old, newAdmin);
    }
}
