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
}
