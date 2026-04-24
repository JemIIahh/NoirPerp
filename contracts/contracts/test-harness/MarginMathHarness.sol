// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { FHE, euint64, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";
import { MarginMath } from "../lib/MarginMath.sol";

/// @title MarginMathHarness
/// @notice Test-only wrapper over MarginMath — plaintext inputs are
///         trivially encrypted before each call. Results stored for decrypt.
contract MarginMathHarness is ZamaEthereumConfig {
    euint64 public lastEuint;
    ebool public lastEbool;
    euint64 public lastProfit;
    euint64 public lastLoss;

    function runNotional(uint64 size, uint64 price) external {
        euint64 result = MarginMath.notional(FHE.asEuint64(size), FHE.asEuint64(price));
        lastEuint = result;
        FHE.allowThis(result);
        FHE.allow(result, msg.sender);
    }

    function runMarginOK(uint64 collateral, uint64 notionalValue, uint64 maxLev) external {
        ebool result = MarginMath.marginOK(
            FHE.asEuint64(collateral),
            FHE.asEuint64(notionalValue),
            maxLev
        );
        lastEbool = result;
        FHE.allowThis(result);
        FHE.allow(result, msg.sender);
    }

    function runPnlLong(uint64 size, uint64 entry, uint64 curr) external {
        (euint64 p, euint64 l) = MarginMath.pnlLong(
            FHE.asEuint64(size),
            FHE.asEuint64(entry),
            FHE.asEuint64(curr)
        );
        lastProfit = p;
        lastLoss = l;
        FHE.allowThis(p);
        FHE.allowThis(l);
        FHE.allow(p, msg.sender);
        FHE.allow(l, msg.sender);
    }

    function runPnlShort(uint64 size, uint64 entry, uint64 curr) external {
        (euint64 p, euint64 l) = MarginMath.pnlShort(
            FHE.asEuint64(size),
            FHE.asEuint64(entry),
            FHE.asEuint64(curr)
        );
        lastProfit = p;
        lastLoss = l;
        FHE.allowThis(p);
        FHE.allowThis(l);
        FHE.allow(p, msg.sender);
        FHE.allow(l, msg.sender);
    }

    function runShouldLiquidate(uint64 collateral, uint64 loss, uint64 maintBps) external {
        ebool result = MarginMath.shouldLiquidate(
            FHE.asEuint64(collateral),
            FHE.asEuint64(loss),
            maintBps
        );
        lastEbool = result;
        FHE.allowThis(result);
        FHE.allow(result, msg.sender);
    }
}
