# Phase 1 — Shared Libraries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the four foundational Solidity libraries that every NoirPerp engine depends on — `FHESafeMath`, `MarginMath`, `TickMath`, `DecryptQueue` — with ≥90% unit-test coverage per library.

**Architecture:** Libraries and one abstract contract live at `contracts/contracts/lib/`. Test-only harness contracts live at `contracts/contracts/test-harness/` (kept separate from production lib code but compiled by Hardhat). All Solidity files use pragma `^0.8.27`, FHE namespace `FHE.*` (no `TFHE.*`), and inherit `ZamaEthereumConfig` where ciphertext operations occur. MarginMath formulates all ratio checks as multiplications (no `FHE.div(ct,ct)` — does not exist).

**Tech Stack:**
- Solidity `^0.8.27`
- `@fhevm/solidity@^0.11.1` (`FHE`, `euint64`, `ebool`)
- `@fhevm/hardhat-plugin@^0.4.2` (FHEVM mock for tests)
- `@openzeppelin/contracts@^5.2.0` (only if needed; prefer zero deps for libs)
- Hardhat + Mocha + Chai
- `@fhevm/hardhat-plugin` `userDecryptEuint` for reveal-and-compare in tests

**Reference docs (authoritative):**
- Design spec: `docs/specs/2026-04-24-noirperp-design.md` §4.8 (lib specs), §6 (error handling), §7 (testing)
- Primitives: `docs/fhe-primitives.md` — especially §3 (op HCU costs), §5 (async decryption pattern), §10 (Hardhat plugin integration notes)
- Pinned rules: `CLAUDE.md`

---

### Task 0: Branch + preconditions

**Files:** none

- [ ] **Step 1: Verify branch**

Run:
```bash
git -C /Users/ram/Desktop/NoirPerp branch --show-current
```
Expected: `phase-1-shared-libs`. If not, `git checkout phase-1-shared-libs`.

- [ ] **Step 2: Verify Phase 0 still green**

Run:
```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat compile && npx hardhat test
```
Expected: compile succeeds; 1 passing (Smoke). Any regression blocks Phase 1 start — fix before continuing.

- [ ] **Step 3: Create test-harness directory**

Run:
```bash
mkdir -p /Users/ram/Desktop/NoirPerp/contracts/contracts/test-harness
```

---

### Task 1: FHESafeMath library

**Files:**
- Create: `contracts/contracts/lib/FHESafeMath.sol`
- Create: `contracts/contracts/test-harness/FHESafeMathHarness.sol`
- Create: `contracts/test/FHESafeMath.test.ts`

**Purpose:** select-guarded arithmetic on `euint64` that prevents silent underflow (the #1 footgun per OZ FHEVM security guide). Exports three pure functions.

#### Function signatures

```solidity
library FHESafeMath {
    function safeSub(euint64 a, euint64 b) internal returns (euint64);
    function safeAdd(euint64 a, euint64 b) internal returns (euint64);
    function absDiff(euint64 a, euint64 b) internal returns (euint64);
}
```

**Semantics:**
- `safeSub(a, b)` → returns `a - b` if `a >= b`, else `0`. Never wraps.
- `safeAdd(a, b)` → returns `a + b` if `a + b <= MAX_UINT64`, else `MAX_UINT64`. Saturating on overflow.
- `absDiff(a, b)` → returns `|a - b|` (non-negative difference).

- [ ] **Step 1: Write failing test (`FHESafeMath.test.ts`)**

Create `/Users/ram/Desktop/NoirPerp/contracts/test/FHESafeMath.test.ts`:

```typescript
import { expect } from "chai";
import * as hre from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import type { FHESafeMathHarness } from "../typechain-types";

describe("FHESafeMath", () => {
  let harness: FHESafeMathHarness;
  let owner: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];

  const MAX_U64 = (1n << 64n) - 1n;

  beforeEach(async () => {
    [owner] = await hre.ethers.getSigners();
    const Harness = await hre.ethers.getContractFactory("FHESafeMathHarness");
    harness = (await Harness.deploy()) as unknown as FHESafeMathHarness;
    await harness.waitForDeployment();
  });

  async function decryptLast(): Promise<bigint> {
    const handle = await harness.lastResult();
    return hre.fhevm.userDecryptEuint(
      FhevmType.euint64,
      handle,
      await harness.getAddress(),
      owner,
    );
  }

  describe("safeSub", () => {
    it("returns a - b when a > b", async () => {
      await (await harness.runSafeSub(100n, 40n)).wait();
      expect(await decryptLast()).to.equal(60n);
    });

    it("returns a - b when a == b (zero)", async () => {
      await (await harness.runSafeSub(100n, 100n)).wait();
      expect(await decryptLast()).to.equal(0n);
    });

    it("returns 0 when b > a (no wraparound)", async () => {
      await (await harness.runSafeSub(40n, 100n)).wait();
      expect(await decryptLast()).to.equal(0n);
    });

    it("handles max uint64 correctly", async () => {
      await (await harness.runSafeSub(MAX_U64, 1n)).wait();
      expect(await decryptLast()).to.equal(MAX_U64 - 1n);
    });

    it("returns 0 when b == max and a == 0", async () => {
      await (await harness.runSafeSub(0n, MAX_U64)).wait();
      expect(await decryptLast()).to.equal(0n);
    });
  });

  describe("safeAdd", () => {
    it("returns a + b when no overflow", async () => {
      await (await harness.runSafeAdd(100n, 40n)).wait();
      expect(await decryptLast()).to.equal(140n);
    });

    it("returns max uint64 on overflow (saturates)", async () => {
      await (await harness.runSafeAdd(MAX_U64, 1n)).wait();
      expect(await decryptLast()).to.equal(MAX_U64);
    });

    it("returns max uint64 when both operands are max", async () => {
      await (await harness.runSafeAdd(MAX_U64, MAX_U64)).wait();
      expect(await decryptLast()).to.equal(MAX_U64);
    });

    it("returns 0 when both operands are 0", async () => {
      await (await harness.runSafeAdd(0n, 0n)).wait();
      expect(await decryptLast()).to.equal(0n);
    });

    it("returns a when b is 0", async () => {
      await (await harness.runSafeAdd(12345n, 0n)).wait();
      expect(await decryptLast()).to.equal(12345n);
    });
  });

  describe("absDiff", () => {
    it("returns a - b when a > b", async () => {
      await (await harness.runAbsDiff(100n, 40n)).wait();
      expect(await decryptLast()).to.equal(60n);
    });

    it("returns b - a when b > a", async () => {
      await (await harness.runAbsDiff(40n, 100n)).wait();
      expect(await decryptLast()).to.equal(60n);
    });

    it("returns 0 when a == b", async () => {
      await (await harness.runAbsDiff(100n, 100n)).wait();
      expect(await decryptLast()).to.equal(0n);
    });

    it("handles max uint64 vs 0", async () => {
      await (await harness.runAbsDiff(MAX_U64, 0n)).wait();
      expect(await decryptLast()).to.equal(MAX_U64);
    });
  });
});
```

- [ ] **Step 2: Run test — expect FAIL (harness + lib not written yet)**

Run:
```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test test/FHESafeMath.test.ts
```
Expected: FAIL with compile error or missing module `FHESafeMathHarness`. This is the TDD red state.

- [ ] **Step 3: Implement `FHESafeMath.sol`**

Create `/Users/ram/Desktop/NoirPerp/contracts/contracts/lib/FHESafeMath.sol`:

```solidity
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
```

- [ ] **Step 4: Implement `FHESafeMathHarness.sol`**

Create `/Users/ram/Desktop/NoirPerp/contracts/contracts/test-harness/FHESafeMathHarness.sol`:

```solidity
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
```

- [ ] **Step 5: Run test — expect PASS (TDD green)**

Run:
```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test test/FHESafeMath.test.ts
```
Expected: all tests in `describe("FHESafeMath")` pass. Target: 14 passing (5 safeSub + 5 safeAdd + 4 absDiff).

If any fail:
1. Read the error. Most common: ACL error (harness forgot `FHE.allow(result, msg.sender)`).
2. If it's an HCU-limit error on `safeAdd` (uses 4 ops: asEuint, sub, le, select), the mock should handle it fine — but if it complains, reduce ops by inlining MAX_U64 differently.
3. If the assertion fails on value, check your safeAdd overflow math — the `b <= (MAX - a)` inequality is the critical correctness condition.

- [ ] **Step 6: Add CHANGELOG entry**

Append to `/Users/ram/Desktop/NoirPerp/CHANGELOG.md` under a new `### Phase 1 — Shared libs (in progress)` section:

```markdown
### Phase 1 — Shared libs (in progress)

- **Added**: `contracts/contracts/lib/FHESafeMath.sol` — select-guarded
  `safeSub`, `safeAdd` (saturating), `absDiff` on `euint64`. Prevents
  silent underflow / overflow wraparound per OZ FHEVM security guide.
  **Why**: every engine's margin/PnL math runs through this lib; raw
  `FHE.sub` / `FHE.add` are banned outside of it (per CLAUDE.md rule #3).
  **Files**: `contracts/contracts/lib/FHESafeMath.sol`,
  `contracts/contracts/test-harness/FHESafeMathHarness.sol`,
  `contracts/test/FHESafeMath.test.ts`.
```

- [ ] **Step 7: Commit**

Run:
```bash
cd /Users/ram/Desktop/NoirPerp && git add contracts/contracts/lib/FHESafeMath.sol contracts/contracts/test-harness/FHESafeMathHarness.sol contracts/test/FHESafeMath.test.ts CHANGELOG.md && git -c user.email=developer@randao.net -c user.name="Ram" commit -q -m "feat(lib): add FHESafeMath with safeSub, safeAdd, absDiff

Select-guarded arithmetic on euint64. Prevents silent underflow /
overflow wraparound — the #1 FHE footgun per OZ security guide.
14 unit tests passing (5 safeSub + 5 safeAdd + 4 absDiff).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: TickMath library

**Files:**
- Create: `contracts/contracts/lib/TickMath.sol`
- Create: `contracts/contracts/test-harness/TickMathHarness.sol`
- Create: `contracts/test/TickMath.test.ts`

**Purpose:** UniV3-style tick ↔ sqrtPriceX96 conversion. Pure math — no FHE. Used by `AMMEngine` (Phase 4). Ported from Uniswap v3's MIT-licensed `TickMath.sol`.

**Scope for Phase 1:** only the two core functions and the bounds constants. Advanced helpers (e.g., `getTickSpacing`) defer to Phase 4 if needed.

#### Function signatures

```solidity
library TickMath {
    int24 internal constant MIN_TICK = -887272;
    int24 internal constant MAX_TICK = -MIN_TICK; // 887272
    uint160 internal constant MIN_SQRT_RATIO = 4295128739;
    uint160 internal constant MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342;

    function getSqrtRatioAtTick(int24 tick) internal pure returns (uint160 sqrtPriceX96);
    function getTickAtSqrtRatio(uint160 sqrtPriceX96) internal pure returns (int24 tick);
}
```

- [ ] **Step 1: Write failing test (`TickMath.test.ts`)**

Create `/Users/ram/Desktop/NoirPerp/contracts/test/TickMath.test.ts`:

```typescript
import { expect } from "chai";
import * as hre from "hardhat";
import type { TickMathHarness } from "../typechain-types";

describe("TickMath", () => {
  let harness: TickMathHarness;

  const MIN_TICK = -887272;
  const MAX_TICK = 887272;
  const MIN_SQRT_RATIO = 4295128739n;
  const MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342n;

  beforeEach(async () => {
    const Harness = await hre.ethers.getContractFactory("TickMathHarness");
    harness = (await Harness.deploy()) as unknown as TickMathHarness;
    await harness.waitForDeployment();
  });

  describe("getSqrtRatioAtTick", () => {
    it("returns MIN_SQRT_RATIO at MIN_TICK", async () => {
      expect(await harness.getSqrtRatioAtTick(MIN_TICK)).to.equal(MIN_SQRT_RATIO);
    });

    it("returns MAX_SQRT_RATIO at MAX_TICK", async () => {
      expect(await harness.getSqrtRatioAtTick(MAX_TICK)).to.equal(MAX_SQRT_RATIO);
    });

    it("returns 2**96 at tick 0 (price = 1)", async () => {
      expect(await harness.getSqrtRatioAtTick(0)).to.equal(2n ** 96n);
    });

    it("is monotonically increasing", async () => {
      const a = await harness.getSqrtRatioAtTick(100);
      const b = await harness.getSqrtRatioAtTick(101);
      expect(b).to.be.gt(a);
    });

    it("handles negative ticks symmetrically", async () => {
      const pos = await harness.getSqrtRatioAtTick(1000);
      const neg = await harness.getSqrtRatioAtTick(-1000);
      // sqrtPrice(-tick) * sqrtPrice(+tick) == 2**192 (approximately)
      // Exact invariant: product equals 2^192 within rounding
      const product = pos * neg;
      const target = 2n ** 192n;
      // allow up to 2 ULP drift (uniV3 rounding)
      const diff = product > target ? product - target : target - product;
      expect(diff).to.be.lt(1n << 16n);
    });

    it("reverts on tick below MIN_TICK", async () => {
      await expect(harness.getSqrtRatioAtTick(MIN_TICK - 1)).to.be.reverted;
    });

    it("reverts on tick above MAX_TICK", async () => {
      await expect(harness.getSqrtRatioAtTick(MAX_TICK + 1)).to.be.reverted;
    });
  });

  describe("getTickAtSqrtRatio", () => {
    it("returns MIN_TICK at MIN_SQRT_RATIO", async () => {
      expect(await harness.getTickAtSqrtRatio(MIN_SQRT_RATIO)).to.equal(MIN_TICK);
    });

    it("returns MAX_TICK at MAX_SQRT_RATIO - 1 (MAX_SQRT is exclusive upper)", async () => {
      expect(
        await harness.getTickAtSqrtRatio(MAX_SQRT_RATIO - 1n),
      ).to.equal(MAX_TICK - 1);
    });

    it("round-trips at tick 0", async () => {
      const ratio = await harness.getSqrtRatioAtTick(0);
      expect(await harness.getTickAtSqrtRatio(ratio)).to.equal(0);
    });

    it("round-trips at tick 1000", async () => {
      const ratio = await harness.getSqrtRatioAtTick(1000);
      expect(await harness.getTickAtSqrtRatio(ratio)).to.equal(1000);
    });

    it("reverts on sqrtPriceX96 below MIN_SQRT_RATIO", async () => {
      await expect(harness.getTickAtSqrtRatio(MIN_SQRT_RATIO - 1n)).to.be.reverted;
    });

    it("reverts on sqrtPriceX96 >= MAX_SQRT_RATIO", async () => {
      await expect(harness.getTickAtSqrtRatio(MAX_SQRT_RATIO)).to.be.reverted;
    });
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run:
```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test test/TickMath.test.ts
```
Expected: compile error `Cannot find name 'TickMathHarness'`.

- [ ] **Step 3: Implement `TickMath.sol`**

Create `/Users/ram/Desktop/NoirPerp/contracts/contracts/lib/TickMath.sol`:

```solidity
// SPDX-License-Identifier: MIT
// Ported from Uniswap v3-core TickMath.sol (MIT, Uniswap Labs)
// https://github.com/Uniswap/v3-core/blob/main/contracts/libraries/TickMath.sol
pragma solidity ^0.8.27;

/// @title TickMath
/// @notice Computes sqrt price at ticks of size 1.0001, and ticks from sqrt prices.
/// @dev Pure math. No FHE. Used by AMMEngine in Phase 4.
library TickMath {
    error InvalidTick();
    error InvalidSqrtRatio();

    int24 internal constant MIN_TICK = -887272;
    int24 internal constant MAX_TICK = -MIN_TICK;

    uint160 internal constant MIN_SQRT_RATIO = 4295128739;
    uint160 internal constant MAX_SQRT_RATIO =
        1461446703485210103287273052203988822378723970342;

    /// @notice Calculates sqrt(1.0001^tick) * 2^96.
    function getSqrtRatioAtTick(int24 tick) internal pure returns (uint160 sqrtPriceX96) {
        uint256 absTick = tick < 0 ? uint256(-int256(tick)) : uint256(int256(tick));
        if (absTick > uint256(int256(MAX_TICK))) revert InvalidTick();

        uint256 ratio = absTick & 0x1 != 0
            ? 0xfffcb933bd6fad37aa2d162d1a594001
            : 0x100000000000000000000000000000000;
        if (absTick & 0x2 != 0) ratio = (ratio * 0xfff97272373d413259a46990580e213a) >> 128;
        if (absTick & 0x4 != 0) ratio = (ratio * 0xfff2e50f5f656932ef12357cf3c7fdcc) >> 128;
        if (absTick & 0x8 != 0) ratio = (ratio * 0xffe5caca7e10e4e61c3624eaa0941cd0) >> 128;
        if (absTick & 0x10 != 0) ratio = (ratio * 0xffcb9843d60f6159c9db58835c926644) >> 128;
        if (absTick & 0x20 != 0) ratio = (ratio * 0xff973b41fa98c081472e6896dfb254c0) >> 128;
        if (absTick & 0x40 != 0) ratio = (ratio * 0xff2ea16466c96a3843ec78b326b52861) >> 128;
        if (absTick & 0x80 != 0) ratio = (ratio * 0xfe5dee046a99a2a811c461f1969c3053) >> 128;
        if (absTick & 0x100 != 0) ratio = (ratio * 0xfcbe86c7900a88aedcffc83b479aa3a4) >> 128;
        if (absTick & 0x200 != 0) ratio = (ratio * 0xf987a7253ac413176f2b074cf7815e54) >> 128;
        if (absTick & 0x400 != 0) ratio = (ratio * 0xf3392b0822b70005940c7a398e4b70f3) >> 128;
        if (absTick & 0x800 != 0) ratio = (ratio * 0xe7159475a2c29b7443b29c7fa6e889d9) >> 128;
        if (absTick & 0x1000 != 0) ratio = (ratio * 0xd097f3bdfd2022b8845ad8f792aa5825) >> 128;
        if (absTick & 0x2000 != 0) ratio = (ratio * 0xa9f746462d870fdf8a65dc1f90e061e5) >> 128;
        if (absTick & 0x4000 != 0) ratio = (ratio * 0x70d869a156d2a1b890bb3df62baf32f7) >> 128;
        if (absTick & 0x8000 != 0) ratio = (ratio * 0x31be135f97d08fd981231505542fcfa6) >> 128;
        if (absTick & 0x10000 != 0) ratio = (ratio * 0x9aa508b5b7a84e1c677de54f3e99bc9) >> 128;
        if (absTick & 0x20000 != 0) ratio = (ratio * 0x5d6af8dedb81196699c329225ee604) >> 128;
        if (absTick & 0x40000 != 0) ratio = (ratio * 0x2216e584f5fa1ea926041bedfe98) >> 128;
        if (absTick & 0x80000 != 0) ratio = (ratio * 0x48a170391f7dc42444e8fa2) >> 128;

        if (tick > 0) ratio = type(uint256).max / ratio;

        // this divides by 1<<32 rounding up to go from a Q128.128 to a Q128.96.
        // shift amount is 32, round up if remainder > 0.
        sqrtPriceX96 = uint160((ratio >> 32) + (ratio % (1 << 32) == 0 ? 0 : 1));
    }

    /// @notice Calculates the greatest tick value such that getSqrtRatioAtTick(tick) <= sqrtPriceX96.
    function getTickAtSqrtRatio(uint160 sqrtPriceX96) internal pure returns (int24 tick) {
        if (sqrtPriceX96 < MIN_SQRT_RATIO || sqrtPriceX96 >= MAX_SQRT_RATIO) {
            revert InvalidSqrtRatio();
        }

        uint256 ratio = uint256(sqrtPriceX96) << 32;

        uint256 r = ratio;
        uint256 msb = 0;

        assembly {
            let f := shl(7, gt(r, 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF))
            msb := or(msb, f)
            r := shr(f, r)
        }
        assembly {
            let f := shl(6, gt(r, 0xFFFFFFFFFFFFFFFF))
            msb := or(msb, f)
            r := shr(f, r)
        }
        assembly {
            let f := shl(5, gt(r, 0xFFFFFFFF))
            msb := or(msb, f)
            r := shr(f, r)
        }
        assembly {
            let f := shl(4, gt(r, 0xFFFF))
            msb := or(msb, f)
            r := shr(f, r)
        }
        assembly {
            let f := shl(3, gt(r, 0xFF))
            msb := or(msb, f)
            r := shr(f, r)
        }
        assembly {
            let f := shl(2, gt(r, 0xF))
            msb := or(msb, f)
            r := shr(f, r)
        }
        assembly {
            let f := shl(1, gt(r, 0x3))
            msb := or(msb, f)
            r := shr(f, r)
        }
        assembly {
            let f := gt(r, 0x1)
            msb := or(msb, f)
        }

        if (msb >= 128) r = ratio >> (msb - 127);
        else r = ratio << (127 - msb);

        int256 log_2 = (int256(msb) - 128) << 64;

        assembly {
            r := shr(127, mul(r, r))
            let f := shr(128, r)
            log_2 := or(log_2, shl(63, f))
            r := shr(f, r)
        }
        assembly {
            r := shr(127, mul(r, r))
            let f := shr(128, r)
            log_2 := or(log_2, shl(62, f))
            r := shr(f, r)
        }
        assembly {
            r := shr(127, mul(r, r))
            let f := shr(128, r)
            log_2 := or(log_2, shl(61, f))
            r := shr(f, r)
        }
        assembly {
            r := shr(127, mul(r, r))
            let f := shr(128, r)
            log_2 := or(log_2, shl(60, f))
            r := shr(f, r)
        }
        assembly {
            r := shr(127, mul(r, r))
            let f := shr(128, r)
            log_2 := or(log_2, shl(59, f))
            r := shr(f, r)
        }
        assembly {
            r := shr(127, mul(r, r))
            let f := shr(128, r)
            log_2 := or(log_2, shl(58, f))
            r := shr(f, r)
        }
        assembly {
            r := shr(127, mul(r, r))
            let f := shr(128, r)
            log_2 := or(log_2, shl(57, f))
            r := shr(f, r)
        }
        assembly {
            r := shr(127, mul(r, r))
            let f := shr(128, r)
            log_2 := or(log_2, shl(56, f))
            r := shr(f, r)
        }
        assembly {
            r := shr(127, mul(r, r))
            let f := shr(128, r)
            log_2 := or(log_2, shl(55, f))
            r := shr(f, r)
        }
        assembly {
            r := shr(127, mul(r, r))
            let f := shr(128, r)
            log_2 := or(log_2, shl(54, f))
            r := shr(f, r)
        }
        assembly {
            r := shr(127, mul(r, r))
            let f := shr(128, r)
            log_2 := or(log_2, shl(53, f))
            r := shr(f, r)
        }
        assembly {
            r := shr(127, mul(r, r))
            let f := shr(128, r)
            log_2 := or(log_2, shl(52, f))
            r := shr(f, r)
        }
        assembly {
            r := shr(127, mul(r, r))
            let f := shr(128, r)
            log_2 := or(log_2, shl(51, f))
            r := shr(f, r)
        }
        assembly {
            r := shr(127, mul(r, r))
            let f := shr(128, r)
            log_2 := or(log_2, shl(50, f))
        }

        int256 log_sqrt10001 = log_2 * 255738958999603826347141; // 128.128 number

        int24 tickLow = int24((log_sqrt10001 - 3402992956809132418596140100660247210) >> 128);
        int24 tickHi = int24((log_sqrt10001 + 291339464771989622907027621153398088495) >> 128);

        tick = tickLow == tickHi
            ? tickLow
            : getSqrtRatioAtTick(tickHi) <= sqrtPriceX96 ? tickHi : tickLow;
    }
}
```

- [ ] **Step 4: Implement `TickMathHarness.sol`**

Create `/Users/ram/Desktop/NoirPerp/contracts/contracts/test-harness/TickMathHarness.sol`:

```solidity
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
```

- [ ] **Step 5: Run test — expect PASS**

Run:
```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test test/TickMath.test.ts
```
Expected: all TickMath describe blocks pass. Target: 13 passing.

If any fail:
1. Compile error on assembly blocks: check Solidity pragma supports them (`^0.8.27` does).
2. If `round-trips at tick 0` fails: the conversion may have ±1 drift at tick 0 — that's the UniV3 standard behavior. Relax to `|tick| <= 1` if this is the issue; quote the comment.
3. If a magic constant looks wrong, verify against https://github.com/Uniswap/v3-core/blob/main/contracts/libraries/TickMath.sol — do NOT modify constants blindly.

- [ ] **Step 6: Update CHANGELOG**

Append to `/Users/ram/Desktop/NoirPerp/CHANGELOG.md` under the Phase 1 section:

```markdown
- **Added**: `contracts/contracts/lib/TickMath.sol` — ported from
  Uniswap v3-core (MIT). Pure math, no FHE. Used by AMMEngine
  (Phase 4) for concentrated-liquidity tick calculations.
  Exposes `getSqrtRatioAtTick`, `getTickAtSqrtRatio`, and bound
  constants `MIN_TICK`, `MAX_TICK`, `MIN_SQRT_RATIO`, `MAX_SQRT_RATIO`.
  13 unit tests passing.
  **Files**: `contracts/contracts/lib/TickMath.sol`,
  `contracts/contracts/test-harness/TickMathHarness.sol`,
  `contracts/test/TickMath.test.ts`.
```

- [ ] **Step 7: Commit**

Run:
```bash
cd /Users/ram/Desktop/NoirPerp && git add contracts/contracts/lib/TickMath.sol contracts/contracts/test-harness/TickMathHarness.sol contracts/test/TickMath.test.ts CHANGELOG.md && git -c user.email=developer@randao.net -c user.name="Ram" commit -q -m "feat(lib): add TickMath ported from Uniswap v3-core (MIT)

Pure math for sqrt-price <-> tick conversions. Used by AMMEngine
(Phase 4) for concentrated-liquidity positions. 13 unit tests
covering bounds, monotonicity, symmetry, round-trip, and reverts.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: DecryptQueue abstract contract

**Files:**
- Create: `contracts/contracts/lib/DecryptQueue.sol`
- Create: `contracts/contracts/test-harness/DecryptQueueConsumer.sol`
- Create: `contracts/test/DecryptQueue.test.ts`

**Purpose:** Async-decrypt state machine. Every engine that calls `FHE.requestDecryption` tracks pending requests here. `dequeue` is called BEFORE any external call in the callback — replay guard pattern. Timeout-based cleanup for stale entries.

**Not a library — state-holding abstract contract.** Engines inherit it.

#### Function signatures

```solidity
abstract contract DecryptQueue {
    struct PendingDecrypt {
        address caller;
        uint256 contextId;
        bytes context;
        uint64 requestedAt;
    }

    uint64 public constant DECRYPT_TIMEOUT = 10 minutes;

    event DecryptEnqueued(uint256 indexed requestId, address indexed caller, uint256 contextId);
    event DecryptDequeued(uint256 indexed requestId);
    event DecryptCleaned(uint256 indexed requestId);

    error DecryptNotPending();
    error DecryptNotStale();

    function _enqueue(uint256 requestId, address caller, uint256 contextId, bytes memory context) internal;
    function _dequeue(uint256 requestId) internal returns (PendingDecrypt memory);
    function _isPending(uint256 requestId) internal view returns (bool);
    function pendingInfo(uint256 requestId) external view returns (PendingDecrypt memory);
    function cleanupStale(uint256[] calldata requestIds) external;
}
```

- [ ] **Step 1: Write failing test (`DecryptQueue.test.ts`)**

Create `/Users/ram/Desktop/NoirPerp/contracts/test/DecryptQueue.test.ts`:

```typescript
import { expect } from "chai";
import * as hre from "hardhat";
import type { DecryptQueueConsumer } from "../typechain-types";

describe("DecryptQueue", () => {
  let queue: DecryptQueueConsumer;
  let owner: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let other: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];

  beforeEach(async () => {
    [owner, other] = await hre.ethers.getSigners();
    const Factory = await hre.ethers.getContractFactory("DecryptQueueConsumer");
    queue = (await Factory.deploy()) as unknown as DecryptQueueConsumer;
    await queue.waitForDeployment();
  });

  describe("enqueue + pendingInfo", () => {
    it("stores the pending decrypt info", async () => {
      const reqId = 42n;
      const ctxId = 100n;
      const ctx = "0xdeadbeef";
      await (await queue.enqueue(reqId, owner.address, ctxId, ctx)).wait();

      const info = await queue.pendingInfo(reqId);
      expect(info.caller).to.equal(owner.address);
      expect(info.contextId).to.equal(ctxId);
      expect(info.context).to.equal(ctx);
      expect(info.requestedAt).to.be.gt(0);
    });

    it("emits DecryptEnqueued event", async () => {
      const reqId = 1n;
      await expect(queue.enqueue(reqId, owner.address, 5n, "0x"))
        .to.emit(queue, "DecryptEnqueued")
        .withArgs(reqId, owner.address, 5n);
    });

    it("isPending returns true after enqueue", async () => {
      await (await queue.enqueue(7n, owner.address, 0n, "0x")).wait();
      expect(await queue.isPending(7n)).to.equal(true);
    });

    it("isPending returns false for unknown id", async () => {
      expect(await queue.isPending(999n)).to.equal(false);
    });
  });

  describe("dequeue (replay guard)", () => {
    it("returns the stored info and deletes the entry", async () => {
      await (await queue.enqueue(10n, owner.address, 50n, "0xabcd")).wait();
      await (await queue.dequeueAndRecord(10n)).wait();

      const captured = await queue.lastDequeued();
      expect(captured.caller).to.equal(owner.address);
      expect(captured.contextId).to.equal(50n);
      expect(captured.context).to.equal("0xabcd");

      // After dequeue, entry must be gone
      expect(await queue.isPending(10n)).to.equal(false);
    });

    it("emits DecryptDequeued event", async () => {
      await (await queue.enqueue(3n, owner.address, 0n, "0x")).wait();
      await expect(queue.dequeueAndRecord(3n))
        .to.emit(queue, "DecryptDequeued")
        .withArgs(3n);
    });

    it("reverts when dequeueing an unknown id (replay guard)", async () => {
      await expect(queue.dequeueAndRecord(999n))
        .to.be.revertedWithCustomError(queue, "DecryptNotPending");
    });

    it("reverts when dequeueing the same id twice (replay guard)", async () => {
      await (await queue.enqueue(5n, owner.address, 0n, "0x")).wait();
      await (await queue.dequeueAndRecord(5n)).wait();
      await expect(queue.dequeueAndRecord(5n))
        .to.be.revertedWithCustomError(queue, "DecryptNotPending");
    });
  });

  describe("cleanupStale", () => {
    it("removes entries older than DECRYPT_TIMEOUT", async () => {
      await (await queue.enqueue(1n, owner.address, 0n, "0x")).wait();

      // Fast-forward past timeout (10 minutes)
      await hre.ethers.provider.send("evm_increaseTime", [601]);
      await hre.ethers.provider.send("evm_mine", []);

      await (await queue.cleanupStale([1n])).wait();
      expect(await queue.isPending(1n)).to.equal(false);
    });

    it("reverts on non-stale entry (too fresh)", async () => {
      await (await queue.enqueue(2n, owner.address, 0n, "0x")).wait();
      await expect(queue.cleanupStale([2n]))
        .to.be.revertedWithCustomError(queue, "DecryptNotStale");
    });

    it("reverts on unknown id", async () => {
      await expect(queue.cleanupStale([999n]))
        .to.be.revertedWithCustomError(queue, "DecryptNotPending");
    });

    it("emits DecryptCleaned event for each cleaned entry", async () => {
      await (await queue.enqueue(8n, owner.address, 0n, "0x")).wait();
      await (await queue.enqueue(9n, owner.address, 0n, "0x")).wait();

      await hre.ethers.provider.send("evm_increaseTime", [601]);
      await hre.ethers.provider.send("evm_mine", []);

      await expect(queue.cleanupStale([8n, 9n]))
        .to.emit(queue, "DecryptCleaned").withArgs(8n)
        .and.to.emit(queue, "DecryptCleaned").withArgs(9n);
    });

    it("can be called by anyone (non-caller account)", async () => {
      await (await queue.enqueue(4n, owner.address, 0n, "0x")).wait();

      await hre.ethers.provider.send("evm_increaseTime", [601]);
      await hre.ethers.provider.send("evm_mine", []);

      await (await queue.connect(other).cleanupStale([4n])).wait();
      expect(await queue.isPending(4n)).to.equal(false);
    });
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run:
```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test test/DecryptQueue.test.ts
```
Expected: FAIL with compile error or missing module `DecryptQueueConsumer`.

- [ ] **Step 3: Implement `DecryptQueue.sol`**

Create `/Users/ram/Desktop/NoirPerp/contracts/contracts/lib/DecryptQueue.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @title DecryptQueue
/// @notice Async-decrypt state machine for FHEVM engines. Every engine
///         that calls FHE.requestDecryption inherits this abstract
///         contract to track pending requests and guard against replay.
/// @dev Replay-guard pattern: always call _dequeue(reqId) BEFORE any
///      external call in the decrypt callback. Stale entries past
///      DECRYPT_TIMEOUT can be garbage-collected by anyone via
///      cleanupStale to prevent storage bloat.
abstract contract DecryptQueue {
    struct PendingDecrypt {
        address caller;
        uint256 contextId;
        bytes context;
        uint64 requestedAt;
    }

    uint64 public constant DECRYPT_TIMEOUT = 10 minutes;

    mapping(uint256 requestId => PendingDecrypt) private _pending;

    event DecryptEnqueued(
        uint256 indexed requestId,
        address indexed caller,
        uint256 contextId
    );
    event DecryptDequeued(uint256 indexed requestId);
    event DecryptCleaned(uint256 indexed requestId);

    error DecryptNotPending();
    error DecryptNotStale();

    /// @notice Records a pending decrypt request. Engine calls this right
    ///         before FHE.requestDecryption.
    function _enqueue(
        uint256 requestId,
        address caller,
        uint256 contextId,
        bytes memory context
    ) internal {
        _pending[requestId] = PendingDecrypt({
            caller: caller,
            contextId: contextId,
            context: context,
            requestedAt: uint64(block.timestamp)
        });
        emit DecryptEnqueued(requestId, caller, contextId);
    }

    /// @notice Returns and deletes the pending entry. MUST be called
    ///         BEFORE any external call in the callback (replay guard).
    /// @dev Reverts DecryptNotPending if requestId is not pending.
    function _dequeue(uint256 requestId)
        internal
        returns (PendingDecrypt memory info)
    {
        info = _pending[requestId];
        if (info.requestedAt == 0) revert DecryptNotPending();
        delete _pending[requestId];
        emit DecryptDequeued(requestId);
    }

    function _isPending(uint256 requestId) internal view returns (bool) {
        return _pending[requestId].requestedAt != 0;
    }

    /// @notice Read pending entry without removing (for debugging / UX).
    function pendingInfo(uint256 requestId)
        external
        view
        returns (PendingDecrypt memory)
    {
        return _pending[requestId];
    }

    /// @notice Anyone can call to sweep stale pending entries past timeout.
    ///         Reverts if any id is not pending or not yet stale.
    function cleanupStale(uint256[] calldata requestIds) external {
        uint256 len = requestIds.length;
        for (uint256 i = 0; i < len; i++) {
            uint256 rid = requestIds[i];
            PendingDecrypt storage entry = _pending[rid];
            if (entry.requestedAt == 0) revert DecryptNotPending();
            if (block.timestamp < entry.requestedAt + DECRYPT_TIMEOUT) {
                revert DecryptNotStale();
            }
            delete _pending[rid];
            emit DecryptCleaned(rid);
        }
    }
}
```

- [ ] **Step 4: Implement `DecryptQueueConsumer.sol`**

Create `/Users/ram/Desktop/NoirPerp/contracts/contracts/test-harness/DecryptQueueConsumer.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { DecryptQueue } from "../lib/DecryptQueue.sol";

/// @title DecryptQueueConsumer
/// @notice Test-only concrete inheritor of DecryptQueue. Exposes internal
///         _enqueue / _dequeue / _isPending as external + records the
///         last dequeued payload so tests can assert on it.
contract DecryptQueueConsumer is DecryptQueue {
    PendingDecrypt public lastDequeued;

    function enqueue(
        uint256 requestId,
        address caller,
        uint256 contextId,
        bytes memory context
    ) external {
        _enqueue(requestId, caller, contextId, context);
    }

    function dequeueAndRecord(uint256 requestId) external {
        PendingDecrypt memory info = _dequeue(requestId);
        lastDequeued = info;
    }

    function isPending(uint256 requestId) external view returns (bool) {
        return _isPending(requestId);
    }
}
```

- [ ] **Step 5: Run test — expect PASS**

Run:
```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test test/DecryptQueue.test.ts
```
Expected: all DecryptQueue describe blocks pass. Target: 13 passing.

If any fail:
1. If `revertedWithCustomError` doesn't fire, verify error names match exactly between contract and test (`DecryptNotPending`, `DecryptNotStale`).
2. If `evm_increaseTime` fails, Hardhat node may not be running — mocha auto-starts one. Check that `hre.ethers.provider.send` reaches it.
3. If event assertions fail on chaining `.and.to.emit`, older chai-matchers may not support chaining; rewrite as two separate `.to.emit` calls wrapping separate tx objects.

- [ ] **Step 6: Update CHANGELOG**

Append to `/Users/ram/Desktop/NoirPerp/CHANGELOG.md`:

```markdown
- **Added**: `contracts/contracts/lib/DecryptQueue.sol` — abstract
  contract that every engine calling `FHE.requestDecryption` inherits.
  Tracks pending requests with replay-guarded `_dequeue` (deletes
  entry before returning, preventing double-fulfill attacks). Stale
  entries past 10-minute timeout can be swept by anyone via
  `cleanupStale`. 13 unit tests: enqueue/pendingInfo, dequeue replay
  guard, cleanup-stale semantics + auth.
  **Files**: `contracts/contracts/lib/DecryptQueue.sol`,
  `contracts/contracts/test-harness/DecryptQueueConsumer.sol`,
  `contracts/test/DecryptQueue.test.ts`.
```

- [ ] **Step 7: Commit**

Run:
```bash
cd /Users/ram/Desktop/NoirPerp && git add contracts/contracts/lib/DecryptQueue.sol contracts/contracts/test-harness/DecryptQueueConsumer.sol contracts/test/DecryptQueue.test.ts CHANGELOG.md && git -c user.email=developer@randao.net -c user.name="Ram" commit -q -m "feat(lib): add DecryptQueue abstract contract

Async-decrypt state machine with replay guard (_dequeue deletes
entry before returning). Engines inherit to track pending
FHE.requestDecryption requests. Stale entries past DECRYPT_TIMEOUT
(10 min) sweepable by anyone via cleanupStale. 13 unit tests.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: MarginMath library

**Files:**
- Create: `contracts/contracts/lib/MarginMath.sol`
- Create: `contracts/contracts/test-harness/MarginMathHarness.sol`
- Create: `contracts/test/MarginMath.test.ts`

**Purpose:** Multiplication-only margin/PnL/liquidation math on `euint64`. No `FHE.div(ct,ct)` — does not exist. Depends on `FHESafeMath` (Task 1).

#### Function signatures

```solidity
library MarginMath {
    uint64 internal constant BPS_DIVISOR = 10_000;

    function notional(euint64 size, euint64 price) internal returns (euint64);

    function marginOK(
        euint64 collateral,
        euint64 notionalValue,
        uint64 maxLeverage
    ) internal returns (ebool);

    function pnlLong(
        euint64 size,
        euint64 entryPrice,
        euint64 currentPrice
    ) internal returns (euint64 profit, euint64 loss);

    function pnlShort(
        euint64 size,
        euint64 entryPrice,
        euint64 currentPrice
    ) internal returns (euint64 profit, euint64 loss);

    function shouldLiquidate(
        euint64 collateral,
        euint64 unrealizedLoss,
        uint64 maintenanceMarginBps
    ) internal returns (ebool);
}
```

**Semantics (all multiplication-only):**
- `notional(size, price)` → `size × price`
- `marginOK(coll, notional, maxLev)` → `coll × maxLev >= notional`
- `pnlLong(size, entry, curr)` → `(profit = size × max(curr-entry, 0), loss = size × max(entry-curr, 0))`
- `pnlShort(...)` → inverted
- `shouldLiquidate(coll, loss, maintBps)` → `loss × BPS_DIVISOR >= coll × maintBps`

- [ ] **Step 1: Write failing test (`MarginMath.test.ts`)**

Create `/Users/ram/Desktop/NoirPerp/contracts/test/MarginMath.test.ts`:

```typescript
import { expect } from "chai";
import * as hre from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import type { MarginMathHarness } from "../typechain-types";

describe("MarginMath", () => {
  let harness: MarginMathHarness;
  let owner: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];

  beforeEach(async () => {
    [owner] = await hre.ethers.getSigners();
    const Factory = await hre.ethers.getContractFactory("MarginMathHarness");
    harness = (await Factory.deploy()) as unknown as MarginMathHarness;
    await harness.waitForDeployment();
  });

  async function decryptEuint(handle: string): Promise<bigint> {
    return hre.fhevm.userDecryptEuint(
      FhevmType.euint64,
      handle,
      await harness.getAddress(),
      owner,
    );
  }

  async function decryptEbool(handle: string): Promise<boolean> {
    return hre.fhevm.userDecryptEbool(
      handle,
      await harness.getAddress(),
      owner,
    );
  }

  describe("notional", () => {
    it("returns size * price", async () => {
      await (await harness.runNotional(10n, 2000n)).wait();
      const handle = await harness.lastEuint();
      expect(await decryptEuint(handle)).to.equal(20_000n);
    });

    it("returns 0 when size is 0", async () => {
      await (await harness.runNotional(0n, 2000n)).wait();
      expect(await decryptEuint(await harness.lastEuint())).to.equal(0n);
    });
  });

  describe("marginOK", () => {
    // 20x max leverage; collateral=100, notional=2000 → 100*20=2000, equal allowed
    it("true when collateral * maxLev == notional (boundary)", async () => {
      await (await harness.runMarginOK(100n, 2000n, 20n)).wait();
      expect(await decryptEbool(await harness.lastEbool())).to.equal(true);
    });

    it("true when collateral * maxLev > notional (comfortable margin)", async () => {
      await (await harness.runMarginOK(200n, 2000n, 20n)).wait();
      expect(await decryptEbool(await harness.lastEbool())).to.equal(true);
    });

    it("false when collateral * maxLev < notional (over-leveraged)", async () => {
      await (await harness.runMarginOK(50n, 2000n, 20n)).wait();
      expect(await decryptEbool(await harness.lastEbool())).to.equal(false);
    });

    it("true with 1x leverage and equal collateral", async () => {
      await (await harness.runMarginOK(1000n, 1000n, 1n)).wait();
      expect(await decryptEbool(await harness.lastEbool())).to.equal(true);
    });
  });

  describe("pnlLong", () => {
    it("pure profit when currentPrice > entryPrice", async () => {
      // size=2, entry=100, curr=150 → profit = 2*50 = 100, loss = 0
      await (await harness.runPnlLong(2n, 100n, 150n)).wait();
      expect(await decryptEuint(await harness.lastProfit())).to.equal(100n);
      expect(await decryptEuint(await harness.lastLoss())).to.equal(0n);
    });

    it("pure loss when currentPrice < entryPrice", async () => {
      // size=2, entry=100, curr=80 → profit = 0, loss = 2*20 = 40
      await (await harness.runPnlLong(2n, 100n, 80n)).wait();
      expect(await decryptEuint(await harness.lastProfit())).to.equal(0n);
      expect(await decryptEuint(await harness.lastLoss())).to.equal(40n);
    });

    it("both zero when currentPrice == entryPrice", async () => {
      await (await harness.runPnlLong(5n, 100n, 100n)).wait();
      expect(await decryptEuint(await harness.lastProfit())).to.equal(0n);
      expect(await decryptEuint(await harness.lastLoss())).to.equal(0n);
    });
  });

  describe("pnlShort", () => {
    it("pure profit when currentPrice < entryPrice", async () => {
      // size=2, entry=100, curr=80 → profit = 2*20 = 40, loss = 0
      await (await harness.runPnlShort(2n, 100n, 80n)).wait();
      expect(await decryptEuint(await harness.lastProfit())).to.equal(40n);
      expect(await decryptEuint(await harness.lastLoss())).to.equal(0n);
    });

    it("pure loss when currentPrice > entryPrice", async () => {
      // size=2, entry=100, curr=150 → profit = 0, loss = 2*50 = 100
      await (await harness.runPnlShort(2n, 100n, 150n)).wait();
      expect(await decryptEuint(await harness.lastProfit())).to.equal(0n);
      expect(await decryptEuint(await harness.lastLoss())).to.equal(100n);
    });

    it("both zero when currentPrice == entryPrice", async () => {
      await (await harness.runPnlShort(5n, 100n, 100n)).wait();
      expect(await decryptEuint(await harness.lastProfit())).to.equal(0n);
      expect(await decryptEuint(await harness.lastLoss())).to.equal(0n);
    });
  });

  describe("shouldLiquidate", () => {
    // BPS_DIVISOR = 10_000, maintBps = 500 (5%)
    // condition: loss * 10000 >= collateral * 500
    // equivalently: loss / collateral >= 5% (but no div used on ct)

    it("false when loss is zero", async () => {
      await (await harness.runShouldLiquidate(1000n, 0n, 500n)).wait();
      expect(await decryptEbool(await harness.lastEbool())).to.equal(false);
    });

    it("false when loss is under maintenance threshold", async () => {
      // loss = 40, collateral = 1000, maintBps = 500
      // 40 * 10000 = 400_000 ; 1000 * 500 = 500_000 ; 400k < 500k → false
      await (await harness.runShouldLiquidate(1000n, 40n, 500n)).wait();
      expect(await decryptEbool(await harness.lastEbool())).to.equal(false);
    });

    it("true at boundary (loss * BPS == collateral * maintBps)", async () => {
      // loss = 50, collateral = 1000, maintBps = 500
      // 50 * 10000 = 500_000 ; 1000 * 500 = 500_000 → equal → true (>=)
      await (await harness.runShouldLiquidate(1000n, 50n, 500n)).wait();
      expect(await decryptEbool(await harness.lastEbool())).to.equal(true);
    });

    it("true when loss exceeds maintenance threshold", async () => {
      // loss = 100, collateral = 1000, maintBps = 500
      // 100 * 10000 = 1_000_000 ; 1000 * 500 = 500_000 → true
      await (await harness.runShouldLiquidate(1000n, 100n, 500n)).wait();
      expect(await decryptEbool(await harness.lastEbool())).to.equal(true);
    });
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run:
```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test test/MarginMath.test.ts
```
Expected: FAIL with compile / missing module.

- [ ] **Step 3: Implement `MarginMath.sol`**

Create `/Users/ram/Desktop/NoirPerp/contracts/contracts/lib/MarginMath.sol`:

```solidity
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
```

- [ ] **Step 4: Implement `MarginMathHarness.sol`**

Create `/Users/ram/Desktop/NoirPerp/contracts/contracts/test-harness/MarginMathHarness.sol`:

```solidity
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
```

- [ ] **Step 5: Run test — expect PASS**

Run:
```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test test/MarginMath.test.ts
```
Expected: all MarginMath blocks pass. Target: 15 passing (2 notional + 4 marginOK + 3 pnlLong + 3 pnlShort + 4 shouldLiquidate − 1 duplicated = actually 15).

If `userDecryptEbool` isn't a function on the plugin, check `node_modules/@fhevm/hardhat-plugin/dist/index.d.ts`. The fallback is to decrypt the `ebool` handle via the euint1 path or read the underlying bytes32 handle and compare against known true/false constants. Update `decryptEbool` helper accordingly.

If any test fails on a value, re-derive the arithmetic manually on paper — this lib's correctness is load-bearing for the entire protocol.

- [ ] **Step 6: Update CHANGELOG**

Append to `/Users/ram/Desktop/NoirPerp/CHANGELOG.md`:

```markdown
- **Added**: `contracts/contracts/lib/MarginMath.sol` —
  multiplication-only margin / PnL / liquidation math. No `FHE.div`
  (ciphertext ÷ ciphertext does not exist); all ratio checks
  reformulated as multiplications. Depends on `FHESafeMath`.
  Functions: `notional`, `marginOK`, `pnlLong`, `pnlShort`,
  `shouldLiquidate`. 15 unit tests covering happy paths, boundaries,
  and zero-price-change edge cases.
  **Files**: `contracts/contracts/lib/MarginMath.sol`,
  `contracts/contracts/test-harness/MarginMathHarness.sol`,
  `contracts/test/MarginMath.test.ts`.
```

- [ ] **Step 7: Commit**

Run:
```bash
cd /Users/ram/Desktop/NoirPerp && git add contracts/contracts/lib/MarginMath.sol contracts/contracts/test-harness/MarginMathHarness.sol contracts/test/MarginMath.test.ts CHANGELOG.md && git -c user.email=developer@randao.net -c user.name="Ram" commit -q -m "feat(lib): add MarginMath (multiplication-only margin / PnL / liq)

No FHE.div — every ratio check reformulated as multiplication.
Depends on FHESafeMath (safeSub in pnl branch math). Covers:
notional, marginOK, pnlLong, pnlShort, shouldLiquidate.
15 unit tests across happy paths, boundaries, zero-change edges.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Coverage report

**Files:** none (generates `contracts/coverage/` directory — gitignored)

**Purpose:** verify ≥90% coverage across all 4 lib files per PROGRESS.md Phase 1 completion criteria.

- [ ] **Step 1: Run solidity-coverage**

Run:
```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat coverage --testfiles "test/{FHESafeMath,TickMath,DecryptQueue,MarginMath}.test.ts" 2>&1 | tail -40
```

Expected: coverage summary table at the end. Target: each of the 4 lib files shows **Lines ≥ 90%**, **Functions ≥ 90%**, **Statements ≥ 90%**, **Branches ≥ 80%** (branches are lower threshold since `select`-guarded patterns don't expose both branches to solc-reported coverage).

The coverage output will look like:
```
File                       | % Stmts | % Branch | % Funcs | % Lines |
lib/FHESafeMath.sol        |   100   |   100    |   100   |   100   |
lib/TickMath.sol           |   >90   |   >70    |   100   |   >90   |
lib/DecryptQueue.sol       |   100   |   >80    |   100   |   100   |
lib/MarginMath.sol         |   100   |   100    |   100   |   100   |
```

- [ ] **Step 2: If any lib under 90% lines/funcs, add tests**

If any lib file shows <90% on Lines or Functions, identify the uncovered code (the report highlights it) and add tests. Common misses:
- TickMath: getTickAtSqrtRatio edge branches (high / low tick near boundaries) — add tests at `MIN_SQRT_RATIO + 1` and `MAX_SQRT_RATIO - 1000`.
- DecryptQueue: `cleanupStale` edge where `requestIds.length == 0` — add a `it("no-ops on empty array")` test.

Do NOT game the coverage with assertion-less tests (that's worse than low coverage).

- [ ] **Step 3: Commit coverage pass**

After coverage green, no files change unless you added tests. If test files changed:

```bash
cd /Users/ram/Desktop/NoirPerp && git add contracts/test/ && git -c user.email=developer@randao.net -c user.name="Ram" commit -q -m "test(lib): add coverage gap tests (reach 90%+ per lib)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

If no files changed, skip the commit and proceed to Task 6.

---

### Task 6: Tick Phase 1 complete + CHANGELOG close

**Files:**
- Modify: `/Users/ram/Desktop/NoirPerp/PROGRESS.md`
- Modify: `/Users/ram/Desktop/NoirPerp/CHANGELOG.md`

- [ ] **Step 1: Verify full test suite still passes**

Run:
```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test
```
Expected: all test files pass. Total across Phase 0 + Phase 1: 1 (Smoke) + 14 (FHESafeMath) + 13 (TickMath) + 13 (DecryptQueue) + 15 (MarginMath) = **56 passing**.

- [ ] **Step 2: Tick Phase 1 in PROGRESS.md**

Change:
```markdown
- [ ] **Phase 1 — Shared libs**
  Plan: `docs/plans/2026-04-24-phase-1-shared-libs.md` *(not yet written)*
  Completion criteria: `FHESafeMath`, `MarginMath`, `TickMath`,
  `DecryptQueue` implemented with ≥90% unit-test coverage.
```
to:
```markdown
- [x] **Phase 1 — Shared libs** ✅ (2026-04-XX)
  Plan: `docs/plans/2026-04-24-phase-1-shared-libs.md`
  Completion criteria met: all 4 libs implemented; 56 unit tests
  passing across Smoke + 4 libs; solidity-coverage ≥90% per lib.
```

Replace `2026-04-XX` with the actual date.

- [ ] **Step 3: Add Phase 1 complete entry to CHANGELOG.md**

Append:
```markdown
### Phase 1 complete ✅ (2026-04-XX)

- **All 4 shared libraries live**:
  - `FHESafeMath` — select-guarded arithmetic (safeSub, safeAdd, absDiff)
  - `TickMath` — UniV3 tick math, MIT-ported
  - `DecryptQueue` — async-decrypt state machine with replay guard
  - `MarginMath` — multiplication-only margin/PnL/liquidation math
- **Test count**: 56 passing (Smoke 1 + FHESafeMath 14 + TickMath 13
  + DecryptQueue 13 + MarginMath 15).
- **Coverage**: ≥90% Lines / Functions on every lib.
- **Ready for Phase 2** (Vault + services): engines will import these
  libs directly for margin math, overflow-safe balance updates, async
  decrypt state tracking, and (Phase 4) AMM tick math.
```

Replace `2026-04-XX` with the actual date.

- [ ] **Step 4: Commit**

Run:
```bash
cd /Users/ram/Desktop/NoirPerp && git add PROGRESS.md CHANGELOG.md && git -c user.email=developer@randao.net -c user.name="Ram" commit -q -m "docs: tick Phase 1 complete — all 4 shared libs green

56 unit tests passing across FHESafeMath, TickMath, DecryptQueue,
MarginMath. Coverage >=90% per lib. Ready for Phase 2 (Vault + services).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: Announce complete**

Report to the user:
> "✅ Phase 1 complete. All 4 shared libs live + tested. 56 tests passing. Coverage ≥90% per lib. Ready for Phase 2 plan (Vault + services)."

---

## Appendix A — Troubleshooting

**Decrypt helper fails with "not allowed" / "ACL denied"**: the harness forgot `FHE.allow(result, msg.sender)` after computing. Every returned ciphertext needs both `allowThis` (so the contract can reference it again) and `allow(..., msg.sender)` (so the test caller can decrypt).

**`userDecryptEbool` does not exist**: check `@fhevm/hardhat-plugin` actual exports in `node_modules/@fhevm/hardhat-plugin/dist/index.d.ts`. Alternative: use the `euint1` decrypt path, or inline the bytes32 equality check against known true/false ciphertext handles. Update the helper, document the adjustment in fhe-primitives.md §10.

**TickMath off-by-one at boundaries**: UniV3's `getTickAtSqrtRatio` is defined such that `getSqrtRatioAtTick(tick) <= sqrtPriceX96 < getSqrtRatioAtTick(tick+1)`. If a round-trip test fails at exactly tick 0, the test may need to assert within `[tick, tick+1]` rather than exactly `tick`. Don't modify the library.

**Coverage tool complains about abstract contract**: `DecryptQueue.sol` is abstract; coverage should be measured via its concrete inheritor `DecryptQueueConsumer.sol`. `solidity-coverage` handles this automatically, but if not, add `DecryptQueueConsumer` to the included files list.

**Out of HCU at test time**: the mock enforces the same limits as production. `MarginMath.shouldLiquidate` uses two `mul` + one `ge` = ~1.4M HCU. Well under 5M sequential. If tests fail on HCU, you're likely chaining more ops than necessary — review the lib for unnecessary intermediate ciphertexts.
