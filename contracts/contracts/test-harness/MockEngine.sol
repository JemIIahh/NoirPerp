// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { FHE, euint64 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";
import { NoirVault } from "../NoirVault.sol";

/// @title MockEngine
/// @notice Test-only authorized-engine stand-in. Exercises vault mutator
///         paths with plaintext inputs (trivially encrypted internally).
contract MockEngine is ZamaEthereumConfig {
    NoirVault public immutable vault;

    constructor(address vaultAddr) {
        vault = NoirVault(vaultAddr);
    }

    /// @notice Trivially encrypts inputs and calls vault.writePosition.
    function openMockPosition(
        address owner,
        uint64 size,
        uint64 entryPrice,
        uint64 collateral,
        bool isLong,
        uint8 marketId
    ) external returns (uint256 positionId) {
        euint64 eSize = FHE.asEuint64(size);
        euint64 eEntry = FHE.asEuint64(entryPrice);
        euint64 eColl = FHE.asEuint64(collateral);
        FHE.allowTransient(eSize, address(vault));
        FHE.allowTransient(eEntry, address(vault));
        FHE.allowTransient(eColl, address(vault));
        positionId = vault.writePosition(owner, eSize, eEntry, eColl, isLong, marketId);
    }

    /// @notice Calls vault.closePosition.
    function closeMockPosition(uint256 positionId) external {
        vault.closePosition(positionId);
    }

    /// @notice Trivially encrypts `amount` and calls vault.adjustBalance.
    ///         Test helper so existing balance tests can exercise the
    ///         new euint64-delta signature with plaintext-style setup.
    function adjustMockBalance(address user, uint64 amount, bool isCredit) external {
        euint64 delta = FHE.asEuint64(amount);
        FHE.allowTransient(delta, address(vault));
        vault.adjustBalance(user, delta, isCredit);
    }

    // ─── Access-grant helpers (for Phase 3 Task 1 tests) ──────────────

    euint64 public lastReadBalance;

    euint64 public lastReadSize;
    euint64 public lastReadEntry;
    euint64 public lastReadCollateral;
    address public lastReadOwner;
    uint8 public lastReadMarketId;
    bool public lastReadIsLong;
    bool public lastReadActive;

    /// @notice Calls vault.allowBalanceAccess, stores the handle with
    ///         persistent allow to the tx sender so tests can decrypt.
    function readAndCopyBalance(address user) external {
        euint64 bal = vault.allowBalanceAccess(user);
        lastReadBalance = bal;
        FHE.allowThis(bal);
        FHE.allow(bal, msg.sender);
    }

    /// @notice Calls vault.allowPositionAccess, copies all fields to
    ///         storage with persistent allow for test decryption.
    function readAndCopyPosition(uint256 positionId) external {
        NoirVault.Position memory p = vault.allowPositionAccess(positionId);
        lastReadSize = p.size;
        lastReadEntry = p.entryPrice;
        lastReadCollateral = p.collateral;
        lastReadOwner = p.owner;
        lastReadMarketId = p.marketId;
        lastReadIsLong = p.isLong;
        lastReadActive = p.active;
        FHE.allowThis(p.size);
        FHE.allowThis(p.entryPrice);
        FHE.allowThis(p.collateral);
        FHE.allow(p.size, msg.sender);
        FHE.allow(p.entryPrice, msg.sender);
        FHE.allow(p.collateral, msg.sender);
    }
}
