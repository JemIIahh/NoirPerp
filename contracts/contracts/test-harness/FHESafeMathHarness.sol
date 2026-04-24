// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { FHE, euint64 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";
import { FHESafeMath } from "../lib/FHESafeMath.sol";

/// @title FHESafeMathHarness
/// @notice Test-only wrapper that exposes FHESafeMath functions over
///         plaintext inputs for easy test assertions. Trivially encrypts
///         uint64 inputs, runs the op, stores result for decrypt.
/// @dev NOT for production use. Lives under test-harness/ by convention.
contract FHESafeMathHarness is ZamaEthereumConfig {
    euint64 public lastResult;

    function runSafeSub(uint64 a, uint64 b) external {
        euint64 ea = FHE.asEuint64(a);
        euint64 eb = FHE.asEuint64(b);
        euint64 result = FHESafeMath.safeSub(ea, eb);
        lastResult = result;
        FHE.allowThis(result);
        FHE.allow(result, msg.sender);
    }

    function runSafeAdd(uint64 a, uint64 b) external {
        euint64 ea = FHE.asEuint64(a);
        euint64 eb = FHE.asEuint64(b);
        euint64 result = FHESafeMath.safeAdd(ea, eb);
        lastResult = result;
        FHE.allowThis(result);
        FHE.allow(result, msg.sender);
    }

    function runAbsDiff(uint64 a, uint64 b) external {
        euint64 ea = FHE.asEuint64(a);
        euint64 eb = FHE.asEuint64(b);
        euint64 result = FHESafeMath.absDiff(ea, eb);
        lastResult = result;
        FHE.allowThis(result);
        FHE.allow(result, msg.sender);
    }
}
