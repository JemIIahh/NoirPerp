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
    /// @dev Uses the select-guard pattern: both `FHE.sub` arms are evaluated
    ///      (FHE has no short-circuit), and exactly one wraps on underflow.
    ///      `FHE.select` discards the wrapped branch, so the returned value
    ///      is always the correct non-negative difference. The raw `FHE.sub`
    ///      calls are ONLY safe here because of this select-guard — do not
    ///      copy this pattern outside the lib without understanding it.
    function absDiff(euint64 a, euint64 b) internal returns (euint64) {
        ebool aGe = FHE.ge(a, b);
        return FHE.select(aGe, FHE.sub(a, b), FHE.sub(b, a));
    }

    /// @notice Returns a * b, saturated at MAX_UINT64 on overflow.
    /// @dev Overflow check uses a conservative 2^32 bound on both operands:
    ///      if both `a < 2^32` and `b < 2^32`, then `a * b < 2^64` (no wrap).
    ///      Otherwise we saturate at MAX_U64. This is intentionally
    ///      conservative — e.g., `2^40 * 2^20 = 2^60` fits but would still
    ///      saturate. For the perps/AMM workloads in NoirPerp (USDC with
    ///      6 decimals, realistic size/price ranges), both operands stay
    ///      well under 2^32, so saturation almost never triggers.
    ///      The raw `FHE.mul` in the "unsafe" branch is discarded by
    ///      `FHE.select` — same select-guard pattern as `absDiff`.
    function safeMul(euint64 a, euint64 b) internal returns (euint64) {
        euint64 threshold = FHE.asEuint64(uint64(1) << 32);
        ebool aFits = FHE.lt(a, threshold);
        ebool bFits = FHE.lt(b, threshold);
        ebool safe = FHE.and(aFits, bFits);
        euint64 maxCt = FHE.asEuint64(MAX_U64);
        return FHE.select(safe, FHE.mul(a, b), maxCt);
    }
}
