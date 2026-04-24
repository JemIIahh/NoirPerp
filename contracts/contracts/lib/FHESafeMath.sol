// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { FHE, euint64, ebool } from "@fhevm/solidity/lib/FHE.sol";

/// @title FHESafeMath
/// @notice Select-guarded arithmetic on euint64 that never wraps silently.
///         Addresses FHE's unchecked-arithmetic footgun (OZ FHEVM security guide).
/// @dev All functions return encrypted results; the engine / caller is
///      responsible for ACL permits on the result.
library FHESafeMath {
    uint64 private constant MAX_U64 = type(uint64).max;

    /// @notice Returns a - b, or 0 if b > a (no wraparound).
    function safeSub(euint64 a, euint64 b) internal returns (euint64) {
        ebool safe = FHE.le(b, a);
        return FHE.select(safe, FHE.sub(a, b), FHE.asEuint64(0));
    }

    /// @notice Returns a + b, saturated at MAX_UINT64 on overflow.
    /// @dev Overflow check: b <= (MAX - a). Works because MAX_U64 as euint64
    ///      fits uint64 exactly; FHE.sub(MAX_CT, a) computes (MAX - a) cleanly.
    function safeAdd(euint64 a, euint64 b) internal returns (euint64) {
        euint64 maxCt = FHE.asEuint64(MAX_U64);
        euint64 headroom = FHE.sub(maxCt, a);
        ebool noOverflow = FHE.le(b, headroom);
        return FHE.select(noOverflow, FHE.add(a, b), maxCt);
    }

    /// @notice Returns |a - b| (non-negative difference).
    function absDiff(euint64 a, euint64 b) internal returns (euint64) {
        ebool aGe = FHE.ge(a, b);
        return FHE.select(aGe, FHE.sub(a, b), FHE.sub(b, a));
    }
}
