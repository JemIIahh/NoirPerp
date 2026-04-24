// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { FHE, euint64, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { FHESafeMath } from "./FHESafeMath.sol";

/// @title MarginMath
/// @notice Multiplication-only margin / PnL / liquidation math on euint64.
///         Avoids FHE.div(ct, ct) which does not exist; all ratio checks
///         reformulated as multiplications.
/// @dev Basis points: 10_000 = 100%. Maintenance margin typically 500 bps (5%).
library MarginMath {
    uint64 internal constant BPS_DIVISOR = 10_000;

    /// @notice notional = size × price.
    function notional(euint64 size, euint64 price) internal returns (euint64) {
        return FHE.mul(size, price);
    }

    /// @notice true iff collateral × maxLeverage >= notionalValue.
    ///         Equivalent to (notional / collateral) <= maxLeverage
    ///         without using FHE.div.
    function marginOK(
        euint64 collateral,
        euint64 notionalValue,
        uint64 maxLeverage
    ) internal returns (ebool) {
        euint64 capacity = FHE.mul(collateral, maxLeverage);
        return FHE.ge(capacity, notionalValue);
    }

    /// @notice Returns (profit, loss) for a long position. Both are >= 0;
    ///         exactly one is non-zero (or both zero if no price change).
    ///         profit = size × max(curr - entry, 0)
    ///         loss   = size × max(entry - curr, 0)
    function pnlLong(
        euint64 size,
        euint64 entryPrice,
        euint64 currentPrice
    ) internal returns (euint64 profit, euint64 loss) {
        ebool isProfit = FHE.ge(currentPrice, entryPrice);
        euint64 up = FHESafeMath.safeSub(currentPrice, entryPrice);
        euint64 down = FHESafeMath.safeSub(entryPrice, currentPrice);
        euint64 zero = FHE.asEuint64(0);
        profit = FHE.select(isProfit, FHE.mul(size, up), zero);
        loss = FHE.select(isProfit, zero, FHE.mul(size, down));
    }

    /// @notice Returns (profit, loss) for a short position. Mirror of pnlLong.
    function pnlShort(
        euint64 size,
        euint64 entryPrice,
        euint64 currentPrice
    ) internal returns (euint64 profit, euint64 loss) {
        ebool isProfit = FHE.le(currentPrice, entryPrice);
        euint64 down = FHESafeMath.safeSub(entryPrice, currentPrice);
        euint64 up = FHESafeMath.safeSub(currentPrice, entryPrice);
        euint64 zero = FHE.asEuint64(0);
        profit = FHE.select(isProfit, FHE.mul(size, down), zero);
        loss = FHE.select(isProfit, zero, FHE.mul(size, up));
    }

    /// @notice true iff unrealizedLoss / collateral >= maintenanceMarginBps / 10000,
    ///         reformulated as (loss × BPS) >= (collateral × maintBps) to avoid division.
    function shouldLiquidate(
        euint64 collateral,
        euint64 unrealizedLoss,
        uint64 maintenanceMarginBps
    ) internal returns (ebool) {
        euint64 lossScaled = FHE.mul(unrealizedLoss, BPS_DIVISOR);
        euint64 threshold = FHE.mul(collateral, maintenanceMarginBps);
        return FHE.ge(lossScaled, threshold);
    }
}
