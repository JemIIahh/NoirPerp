// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { FHE, euint64 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

/// @notice Phase 0 smoke test. Proves toolchain works: FHE.asEuint64
///         trivially encrypts a plaintext into a ciphertext handle,
///         stores it, and grants the caller persistent read permission.
contract Smoke is ZamaEthereumConfig {
    euint64 private _value;

    /// @notice Stores a trivially-encrypted uint64 and allows msg.sender to decrypt it.
    /// @param plainValue The plaintext value to trivially encrypt.
    function setValue(uint64 plainValue) external {
        euint64 encrypted = FHE.asEuint64(plainValue);
        _value = encrypted;
        FHE.allowThis(encrypted);
        FHE.allow(encrypted, msg.sender);
    }

    /// @notice Returns the ciphertext handle. Caller must be allowed.
    function getValue() external view returns (euint64) {
        return _value;
    }
}
