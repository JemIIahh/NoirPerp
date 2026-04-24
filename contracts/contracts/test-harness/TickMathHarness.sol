// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { TickMath } from "../lib/TickMath.sol";

/// @title TickMathHarness
/// @notice Test-only wrapper exposing TickMath pure functions as external
///         for TypeScript test assertions.
contract TickMathHarness {
    function getSqrtRatioAtTick(int24 tick) external pure returns (uint160) {
        return TickMath.getSqrtRatioAtTick(tick);
    }

    function getTickAtSqrtRatio(uint160 sqrtPriceX96) external pure returns (int24) {
        return TickMath.getTickAtSqrtRatio(sqrtPriceX96);
    }
}
