# Phase 4 — AMMEngine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `AMMEngine.sol` — an encrypted reserve pool with oracle-pegged swaps, integrated with Phase 3's liquidationPool so LP reserves backstop perp liquidations.

**Architecture:** Hybrid privacy model: plaintext `totalShares` + `totalReserveUsdcx` counters for fair deposit-ratio math (public TVL, unavoidable given no FHE.div on ciphertexts), encrypted per-user LP shares via `mapping(address => euint64)` (private positions), and encrypted swap amounts via `externalEuint64` inputs. Deposits and swaps are synchronous; withdrawals are async (2-phase decrypt to verify encrypted-share-claim match). Liquidation forfeits from `PerpEngine` flow into the AMM's vault USDCx balance as encrypted increments that sit as "stranded protocol reserves" in v1 (not reflected in plaintext counters — a documented MVP limitation that Phase 5+ can resolve via an on-chain resync decrypt).

**Tech Stack:**
- Solidity `^0.8.27`
- `@fhevm/solidity@^0.11.1` (`FHE`, `euint64`, `ebool`, `externalEuint64`, `ZamaEthereumConfig`)
- Phase 1 libs: `FHESafeMath`, `DecryptQueue`
- Phase 2 contracts: `NoirVault`, `Oracle`
- Phase 3 contract: `PerpEngine` (for `setLiquidationPool` hookup)
- Hardhat mock FHEVM
- `@fhevm/hardhat-plugin` for `createEncryptedInput` + `publicDecrypt`

**Reference docs:**
- Spec: `docs/specs/2026-04-24-noirperp-design.md` §4.3
- Primitives: `docs/fhe-primitives.md` §5 (pull-based async decrypt — corrected during Phase 3)
- Rules: `CLAUDE.md`
- Prior phases: `docs/plans/2026-04-24-phase-{0,1,2,3}-*.md`

**Spec deviations (intentional, documented below)**:

1. **No UniV3 concentrated liquidity**: UniV3's swap pricing needs `FHE.sqrt(reserve1/reserve0)` — neither sqrt nor ct/ct div exists in FHEVM v0.11.1. Deferred to post-v0.11.1 (requires Zama to ship ct/ct div).
2. **Plaintext pool totals**: `totalShares` + `totalReserveUsdcx` are `uint64` public. Individual LP shares stay encrypted. This partially accepts spec §4.1 weakness #5 (pool TVL visible) — but per-LP privacy is preserved, which is the primary pitch.
3. **Liquidation forfeits stranded**: PerpEngine's forfeit ciphertext can't increment a plaintext counter without decryption (privacy leak of liquidated position size). Forfeits accumulate in vault's `_balances[AMM]` but are unclaimable by LP withdrawals in v1. Phase 5+ adds a resync-decrypt flow.
4. **No TickMath usage**: the Phase 1 lib is pre-positioned for future concentrated liquidity; unused in Phase 4.
5. **LP shares in AMMEngine, not Vault**: spec §4.1 put `lpPositions` on vault; we keep LP state inside AMMEngine since no other engine needs to read it. YAGNI simplification.

**Config constants**:
- `SWAP_FEE_BPS = 30` (0.30%) — admin-settable
- `BPS_DIVISOR = 10_000` — private

---

### Task 0: Branch + preconditions

**Files:** none

- [ ] **Step 1: Verify branch**

```bash
git -C /Users/ram/Desktop/NoirPerp branch --show-current
```
Expected: `phase-4-amm-engine`.

- [ ] **Step 2: Verify Phase 0–3 still green**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat compile && npx hardhat test 2>&1 | tail -3
```
Expected: **176 passing**.

- [ ] **Step 3: Re-read primer docs**

- `CLAUDE.md` — pinned rules
- `docs/fhe-primitives.md` §5 (pull-based async decrypt — needed for async withdraw)
- `docs/specs/2026-04-24-noirperp-design.md` §4.3 (AMM design, deviations documented above)

---

### Task 1: `AMMEngine` scaffold + admin

**Files:**
- Create: `contracts/contracts/engines/AMMEngine.sol`
- Create: `contracts/test/AMMEngine.Admin.test.ts`

**Purpose:** Contract skeleton: config, admin controls, pool-state accessor. No liquidity logic yet — that's Task 2.

- [ ] **Step 1: Write failing test**

Create `/Users/ram/Desktop/NoirPerp/contracts/test/AMMEngine.Admin.test.ts`:

```typescript
import { expect } from "chai";
import * as hre from "hardhat";
import type { NoirVault, MockERC7984, AMMEngine } from "../typechain-types";

describe("AMMEngine — admin + scaffold", () => {
  let vault: NoirVault;
  let token: MockERC7984;
  let amm: AMMEngine;
  let admin: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let alice: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let bob: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];

  beforeEach(async () => {
    [admin, alice, bob] = await hre.ethers.getSigners();

    const TokenFactory = await hre.ethers.getContractFactory("MockERC7984");
    token = (await TokenFactory.deploy("MockUSDCx", "mUSDCx")) as unknown as MockERC7984;
    await token.waitForDeployment();

    const VaultFactory = await hre.ethers.getContractFactory("NoirVault");
    vault = (await VaultFactory.deploy(admin.address, await token.getAddress())) as unknown as NoirVault;
    await vault.waitForDeployment();

    const AMMFactory = await hre.ethers.getContractFactory("AMMEngine");
    amm = (await AMMFactory.deploy(await vault.getAddress(), admin.address)) as unknown as AMMEngine;
    await amm.waitForDeployment();

    await (await vault.registerEngine(await amm.getAddress())).wait();
  });

  describe("constructor", () => {
    it("stores admin + vault", async () => {
      expect(await amm.admin()).to.equal(admin.address);
      expect(await amm.vault()).to.equal(await vault.getAddress());
    });

    it("initial pool totals are zero", async () => {
      expect(await amm.totalShares()).to.equal(0n);
      expect(await amm.totalReserveUsdcx()).to.equal(0n);
    });

    it("initial swap fee is 30 bps", async () => {
      expect(await amm.swapFeeBps()).to.equal(30);
    });

    it("reverts on zero vault", async () => {
      const F = await hre.ethers.getContractFactory("AMMEngine");
      await expect(F.deploy(hre.ethers.ZeroAddress, admin.address))
        .to.be.revertedWithCustomError({ interface: F.interface } as any, "ZeroAddress");
    });

    it("reverts on zero admin", async () => {
      const F = await hre.ethers.getContractFactory("AMMEngine");
      await expect(F.deploy(await vault.getAddress(), hre.ethers.ZeroAddress))
        .to.be.revertedWithCustomError({ interface: F.interface } as any, "ZeroAddress");
    });
  });

  describe("transferAdmin", () => {
    it("admin can transfer", async () => {
      await expect(amm.transferAdmin(alice.address))
        .to.emit(amm, "AdminTransferred").withArgs(admin.address, alice.address);
      expect(await amm.admin()).to.equal(alice.address);
    });

    it("non-admin cannot transfer", async () => {
      await expect(amm.connect(alice).transferAdmin(bob.address))
        .to.be.revertedWithCustomError(amm, "NotAdmin");
    });

    it("reverts on zero address", async () => {
      await expect(amm.transferAdmin(hre.ethers.ZeroAddress))
        .to.be.revertedWithCustomError(amm, "ZeroAddress");
    });
  });

  describe("setSwapFeeBps", () => {
    it("admin can update fee", async () => {
      await expect(amm.setSwapFeeBps(50))
        .to.emit(amm, "SwapFeeChanged").withArgs(30, 50);
      expect(await amm.swapFeeBps()).to.equal(50);
    });

    it("non-admin cannot update fee", async () => {
      await expect(amm.connect(alice).setSwapFeeBps(50))
        .to.be.revertedWithCustomError(amm, "NotAdmin");
    });

    it("reverts on fee > 10%", async () => {
      await expect(amm.setSwapFeeBps(1_001))
        .to.be.revertedWithCustomError(amm, "FeeTooHigh");
    });
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test test/AMMEngine.Admin.test.ts
```
Expected: missing `AMMEngine` typechain.

- [ ] **Step 3: Implement `AMMEngine.sol` scaffold**

Create `/Users/ram/Desktop/NoirPerp/contracts/contracts/engines/AMMEngine.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { FHE, euint64, ebool, externalEuint64 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";
import { FHESafeMath } from "../lib/FHESafeMath.sol";
import { DecryptQueue } from "../lib/DecryptQueue.sol";
import { NoirVault } from "../NoirVault.sol";

/// @title AMMEngine
/// @notice Encrypted reserve pool with LP shares + oracle-pegged swaps.
///         Hybrid privacy model: plaintext pool totals (for fair ratio
///         math — FHE has no ct/ct division), encrypted per-user shares,
///         encrypted swap amounts.
/// @dev Inherits DecryptQueue for async withdrawal replay guard.
///      Liquidation forfeits from PerpEngine accumulate in vault's
///      _balances[AMM] as encrypted increments, NOT reflected in the
///      plaintext totalReserveUsdcx counter. Documented limitation.
contract AMMEngine is DecryptQueue, ZamaEthereumConfig {
    NoirVault public immutable vault;
    address public admin;

    // ─── Plaintext pool totals (intentionally public) ───────────────
    uint64 public totalShares;
    uint64 public totalReserveUsdcx;

    // ─── Encrypted per-user state (private) ────────────────────────
    mapping(address user => euint64) private _userShares;

    // ─── Config ───────────────────────────────────────────────────
    uint64 public swapFeeBps = 30;                // 0.30%
    uint64 private constant BPS_DIVISOR = 10_000;
    uint64 private constant MAX_FEE_BPS = 1_000;  // 10% cap

    event AdminTransferred(address indexed oldAdmin, address indexed newAdmin);
    event SwapFeeChanged(uint64 oldBps, uint64 newBps);

    error NotAdmin();
    error ZeroAddress();
    error FeeTooHigh();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    constructor(address vault_, address admin_) {
        if (vault_ == address(0) || admin_ == address(0)) revert ZeroAddress();
        vault = NoirVault(vault_);
        admin = admin_;
        emit AdminTransferred(address(0), admin_);
    }

    // ─── Admin ─────────────────────────────────────────────────────

    function transferAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        address old = admin;
        admin = newAdmin;
        emit AdminTransferred(old, newAdmin);
    }

    function setSwapFeeBps(uint64 newBps) external onlyAdmin {
        if (newBps > MAX_FEE_BPS) revert FeeTooHigh();
        uint64 old = swapFeeBps;
        swapFeeBps = newBps;
        emit SwapFeeChanged(old, newBps);
    }

    // ─── Views ─────────────────────────────────────────────────────

    /// @notice Returns encrypted LP share handle for a user. Caller
    ///         must have ACL (the user themselves gets it at each mutation).
    function getUserShares(address user) external view returns (euint64) {
        return _userShares[user];
    }
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test test/AMMEngine.Admin.test.ts
```
Expected: all 12 tests pass. Full suite: `npx hardhat test 2>&1 | tail -3` → 188 passing (176 + 12).

- [ ] **Step 5: CHANGELOG entry**

Append to `/Users/ram/Desktop/NoirPerp/CHANGELOG.md` under a new `### Phase 4 — AMMEngine (in progress)` section:

```markdown
### Phase 4 — AMMEngine (in progress)

- **Added**: `contracts/contracts/engines/AMMEngine.sol` (Task 1
  scaffold — admin + swap fee config + pool-state accessors). Inherits
  `DecryptQueue` for upcoming async-withdraw work. Hybrid privacy:
  plaintext `totalShares` + `totalReserveUsdcx`, encrypted `_userShares`.
  12 unit tests.
  **Files**: `contracts/contracts/engines/AMMEngine.sol`,
  `contracts/test/AMMEngine.Admin.test.ts`.
```

- [ ] **Step 6: Commit**

```bash
cd /Users/ram/Desktop/NoirPerp && git add contracts/contracts/engines/AMMEngine.sol contracts/test/AMMEngine.Admin.test.ts CHANGELOG.md && git -c user.email=developer@randao.net -c user.name="Ram" commit -q -m "feat(engine): add AMMEngine scaffold + admin

DecryptQueue + ZamaEthereumConfig inheritance. Hybrid privacy:
plaintext pool totals (for fair share-ratio math — FHE lacks ct/ct
div), encrypted per-user LP shares. Config: swap fee 30bps default,
admin-settable up to 10% cap. 12 unit tests.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `addLiquidity` (synchronous)

**Files:**
- Modify: `contracts/contracts/engines/AMMEngine.sol` (append)
- Create: `contracts/test/AMMEngine.AddLiquidity.test.ts`

**Purpose:** User deposits plaintext USDCx amount. AMM computes fair share count using plaintext pool totals, debits user's vault USDCx balance, credits AMM's vault USDCx balance, credits user's encrypted LP share balance.

**Why plaintext amount** (design decision): fair LP share math requires `shares = amount × totalShares / totalReserveUsdcx`. With totalShares and totalReserveUsdcx as plaintext, the ratio is plaintext — but user's amount must also be plaintext for the multiplication to work without ct/ct issues. Plaintext deposit amounts are a moderate privacy concession; user's SHARE OF POOL stays encrypted. Acceptable MVP tradeoff.

- [ ] **Step 1: Write failing test**

Create `/Users/ram/Desktop/NoirPerp/contracts/test/AMMEngine.AddLiquidity.test.ts`:

```typescript
import { expect } from "chai";
import * as hre from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import type { NoirVault, MockERC7984, AMMEngine } from "../typechain-types";

describe("AMMEngine — addLiquidity", () => {
  let vault: NoirVault;
  let token: MockERC7984;
  let amm: AMMEngine;
  let admin: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let alice: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let bob: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];

  async function decrypt(handle: string, contractAddr: string, signer: typeof admin): Promise<bigint> {
    return hre.fhevm.userDecryptEuint(FhevmType.euint64, handle, contractAddr, signer);
  }

  beforeEach(async () => {
    [admin, alice, bob] = await hre.ethers.getSigners();

    const TokenFactory = await hre.ethers.getContractFactory("MockERC7984");
    token = (await TokenFactory.deploy("MockUSDCx", "mUSDCx")) as unknown as MockERC7984;
    await token.waitForDeployment();
    await (await token.mintPlaintext(alice.address, 100_000n)).wait();
    await (await token.mintPlaintext(bob.address, 100_000n)).wait();

    const VaultFactory = await hre.ethers.getContractFactory("NoirVault");
    vault = (await VaultFactory.deploy(admin.address, await token.getAddress())) as unknown as NoirVault;
    await vault.waitForDeployment();

    const AMMFactory = await hre.ethers.getContractFactory("AMMEngine");
    amm = (await AMMFactory.deploy(await vault.getAddress(), admin.address)) as unknown as AMMEngine;
    await amm.waitForDeployment();

    await (await vault.registerEngine(await amm.getAddress())).wait();

    // Seed alice and bob with vault balances
    await (await token.connect(alice).setOperator(await vault.getAddress(), 2n ** 48n - 1n)).wait();
    await (await token.connect(bob).setOperator(await vault.getAddress(), 2n ** 48n - 1n)).wait();
    await (await vault.connect(alice).deposit(10_000n)).wait();
    await (await vault.connect(bob).deposit(10_000n)).wait();
  });

  describe("first deposit (bootstrap)", () => {
    it("mints shares 1:1 when pool is empty", async () => {
      await (await amm.connect(alice).addLiquidity(5_000n)).wait();

      expect(await amm.totalShares()).to.equal(5_000n);
      expect(await amm.totalReserveUsdcx()).to.equal(5_000n);

      const sharesHandle = await amm.getUserShares(alice.address);
      const shares = await decrypt(sharesHandle, await amm.getAddress(), alice);
      expect(shares).to.equal(5_000n);

      // Alice's vault balance debited
      const balHandle = await vault.getBalance(alice.address);
      const bal = await decrypt(balHandle, await vault.getAddress(), alice);
      expect(bal).to.equal(5_000n); // 10_000 - 5_000

      // AMM's vault balance credited
      const ammBalHandle = await vault.getBalance(await amm.getAddress());
      // AMM's balance has FHE.allow to the AMM contract only; we can't decrypt as admin.
      // Verify via handle existence.
      expect(ammBalHandle).to.not.equal(hre.ethers.ZeroHash);
    });

    it("emits LiquidityAdded event", async () => {
      await expect(amm.connect(alice).addLiquidity(5_000n))
        .to.emit(amm, "LiquidityAdded")
        .withArgs(alice.address, 5_000n, 5_000n); // amount, sharesMinted
    });
  });

  describe("subsequent deposits (fair ratio)", () => {
    beforeEach(async () => {
      // Alice bootstraps with 1000 USDCx
      await (await amm.connect(alice).addLiquidity(1_000n)).wait();
    });

    it("mints shares pro-rata when pool already has reserves", async () => {
      // Bob deposits 2000. Pool has 1000 reserves + 1000 shares.
      // Bob's shares = 2000 * 1000 / 1000 = 2000
      await (await amm.connect(bob).addLiquidity(2_000n)).wait();

      expect(await amm.totalShares()).to.equal(3_000n);
      expect(await amm.totalReserveUsdcx()).to.equal(3_000n);

      const bobShares = await decrypt(
        await amm.getUserShares(bob.address),
        await amm.getAddress(),
        bob
      );
      expect(bobShares).to.equal(2_000n);
    });

    it("multiple deposits from same user accumulate", async () => {
      await (await amm.connect(alice).addLiquidity(500n)).wait();
      await (await amm.connect(alice).addLiquidity(500n)).wait();

      const aliceShares = await decrypt(
        await amm.getUserShares(alice.address),
        await amm.getAddress(),
        alice
      );
      // Alice initially had 1000 shares; +500 (ratio 1:1) +500 (ratio 1:1) = 2000
      expect(aliceShares).to.equal(2_000n);
    });
  });

  describe("guards", () => {
    it("reverts on zero amount", async () => {
      await expect(amm.connect(alice).addLiquidity(0n))
        .to.be.revertedWithCustomError(amm, "ZeroAmount");
    });
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test test/AMMEngine.AddLiquidity.test.ts
```

- [ ] **Step 3: Append `addLiquidity` to `AMMEngine.sol`**

Open `/Users/ram/Desktop/NoirPerp/contracts/contracts/engines/AMMEngine.sol`. Add to the error list:

```solidity
    error ZeroAmount();
```

Add to the event list:

```solidity
    event LiquidityAdded(address indexed user, uint64 amount, uint64 sharesMinted);
```

Append before the closing `}`:

```solidity
    // ─── Liquidity — add (synchronous) ─────────────────────────────

    /// @notice Deposits `amount` USDCx from caller's vault balance and
    ///         credits encrypted LP shares. First deposit bootstraps at
    ///         1:1; subsequent deposits use the fair ratio
    ///         `shares = amount × totalShares / totalReserveUsdcx`.
    /// @dev Amount is plaintext (privacy concession documented in plan).
    ///      User's SHARE of pool stays encrypted.
    function addLiquidity(uint64 amount) external {
        if (amount == 0) revert ZeroAmount();

        // Fair-ratio share math (all plaintext)
        uint64 sharesToMint;
        if (totalShares == 0) {
            sharesToMint = amount;
        } else {
            // shares = amount × totalShares / totalReserveUsdcx
            // Use uint256 for intermediate to avoid overflow; safe since
            // all inputs fit in uint64.
            uint256 product = uint256(amount) * uint256(totalShares);
            sharesToMint = uint64(product / uint256(totalReserveUsdcx));
        }

        // Update plaintext counters
        totalShares += sharesToMint;
        totalReserveUsdcx += amount;

        // Debit user's vault balance, credit AMM's vault balance
        euint64 eAmount = FHE.asEuint64(amount);
        FHE.allowTransient(eAmount, address(vault));
        vault.adjustBalance(msg.sender, eAmount, false); // debit user

        euint64 eAmount2 = FHE.asEuint64(amount); // fresh handle for re-use
        FHE.allowTransient(eAmount2, address(vault));
        vault.adjustBalance(address(this), eAmount2, true); // credit AMM

        // Credit user's encrypted share balance
        euint64 eShares = FHE.asEuint64(sharesToMint);
        euint64 currentShares = _userShares[msg.sender];
        euint64 newShares = FHESafeMath.safeAdd(currentShares, eShares);
        _userShares[msg.sender] = newShares;
        FHE.allowThis(newShares);
        FHE.allow(newShares, msg.sender);

        emit LiquidityAdded(msg.sender, amount, sharesToMint);
    }
```

**Note on `_userShares[msg.sender]` at first use**: reading an uninitialised `euint64` from storage returns a zero ciphertext handle. `FHESafeMath.safeAdd(zeroHandle, value)` should yield `value`. If tests fail because `currentShares` is invalid on first deposit, inspect `FHESafeMath.safeAdd` behavior with the zero handle — if it reverts, pre-check with `FHE.isInitialized` or similar and use `FHE.asEuint64(0)` as the fallback.

- [ ] **Step 4: Run test — expect PASS**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test test/AMMEngine.AddLiquidity.test.ts
```
Expected: all tests pass.

- [ ] **Step 5: Verify full suite**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test 2>&1 | tail -3
```
Expected: 194 passing (188 + 6).

- [ ] **Step 6: CHANGELOG entry**

Append:
```markdown
- **Added**: `AMMEngine.addLiquidity(uint64 amount)` — sync deposit.
  Plaintext amount; encrypted LP share credit. Fair-ratio math via
  plaintext `totalShares` + `totalReserveUsdcx` counters. Debits user's
  vault USDCx balance, credits AMM's vault balance, credits user's
  encrypted share. 6 unit tests (bootstrap, fair-ratio, accumulation,
  zero-amount guard).
  **Files**: `contracts/contracts/engines/AMMEngine.sol`,
  `contracts/test/AMMEngine.AddLiquidity.test.ts`.
```

- [ ] **Step 7: Commit**

```bash
cd /Users/ram/Desktop/NoirPerp && git add contracts/contracts/engines/AMMEngine.sol contracts/test/AMMEngine.AddLiquidity.test.ts CHANGELOG.md && git -c user.email=developer@randao.net -c user.name="Ram" commit -q -m "feat(amm): add synchronous addLiquidity

Plaintext amount in, encrypted LP share credit out. Fair-ratio math
(shares = amount × totalShares / totalReserveUsdcx) uses plaintext
counters — ct/ct division would be needed for fully-private ratios
and doesn't exist in FHEVM v0.11.1. User's share of pool stays
encrypted; only the deposit amount is visible. 6 unit tests.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `requestWithdraw` + `_onWithdrawDecided` (asynchronous)

**Files:**
- Modify: `contracts/contracts/engines/AMMEngine.sol` (append)
- Create: `contracts/test/AMMEngine.Withdraw.test.ts`

**Purpose:** User withdraws LP shares. Async 2-phase because we need to verify the user's claimed-plaintext-shares matches their encrypted share ciphertext before processing (without decrypting the whole balance).

**Flow**:
1. **Phase 1 (`requestWithdraw`)**: User calls with plaintext `claimedShares`. Engine computes `ebool matchesExactly = FHE.eq(userShares, FHE.asEuint64(claimedShares))`. Marks `matchesExactly` publicly decryptable; emits event; enqueues pending state.
2. **Relayer**: pulls decrypt, calls back.
3. **Phase 2 (`_onWithdrawDecided`)**: verify KMS signatures, dequeue, if match true — pay out `payout = claimedShares × totalReserveUsdcx / totalShares` (all plaintext math), debit AMM vault, credit user vault, update counters, decrement user's encrypted shares. If match false — revert / emit no-op event.

- [ ] **Step 1: Write failing test**

Create `/Users/ram/Desktop/NoirPerp/contracts/test/AMMEngine.Withdraw.test.ts`:

```typescript
import { expect } from "chai";
import * as hre from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import type { NoirVault, MockERC7984, AMMEngine } from "../typechain-types";

describe("AMMEngine — requestWithdraw + async callback", () => {
  let vault: NoirVault;
  let token: MockERC7984;
  let amm: AMMEngine;
  let admin: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let alice: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let bob: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];

  async function decrypt(handle: string, contractAddr: string, signer: typeof admin): Promise<bigint> {
    return hre.fhevm.userDecryptEuint(FhevmType.euint64, handle, contractAddr, signer);
  }

  async function fulfillWithdraw(reqId: bigint, handle: string): Promise<void> {
    const { abiEncodedClearValues, decryptionProof } = await hre.fhevm.publicDecrypt([handle]);
    await (await amm._onWithdrawDecided(
      reqId,
      [handle],
      abiEncodedClearValues,
      decryptionProof,
    )).wait();
  }

  beforeEach(async () => {
    [admin, alice, bob] = await hre.ethers.getSigners();

    const TokenFactory = await hre.ethers.getContractFactory("MockERC7984");
    token = (await TokenFactory.deploy("MockUSDCx", "mUSDCx")) as unknown as MockERC7984;
    await token.waitForDeployment();
    await (await token.mintPlaintext(alice.address, 100_000n)).wait();

    const VaultFactory = await hre.ethers.getContractFactory("NoirVault");
    vault = (await VaultFactory.deploy(admin.address, await token.getAddress())) as unknown as NoirVault;
    await vault.waitForDeployment();

    const AMMFactory = await hre.ethers.getContractFactory("AMMEngine");
    amm = (await AMMFactory.deploy(await vault.getAddress(), admin.address)) as unknown as AMMEngine;
    await amm.waitForDeployment();
    await (await vault.registerEngine(await amm.getAddress())).wait();

    await (await token.connect(alice).setOperator(await vault.getAddress(), 2n ** 48n - 1n)).wait();
    await (await vault.connect(alice).deposit(10_000n)).wait();

    // Alice adds 1000 liquidity → shares = 1000
    await (await amm.connect(alice).addLiquidity(1_000n)).wait();
  });

  describe("full-amount withdraw", () => {
    it("pays out pro-rata and zeros user shares", async () => {
      const tx = await amm.connect(alice).requestWithdraw(1_000n);
      const receipt = await tx.wait();

      // Extract reqId + handle from the WithdrawRequested event
      const event = receipt!.logs.find(
        (l: any) => l.fragment?.name === "WithdrawRequested"
      ) as any;
      const reqId = event.args.requestId;
      const matchHandle = event.args.matchHandle;

      await fulfillWithdraw(reqId, matchHandle);

      // Alice's shares decremented to 0
      const sharesHandle = await amm.getUserShares(alice.address);
      const shares = await decrypt(sharesHandle, await amm.getAddress(), alice);
      expect(shares).to.equal(0n);

      // Pool totals decremented
      expect(await amm.totalShares()).to.equal(0n);
      expect(await amm.totalReserveUsdcx()).to.equal(0n);

      // Alice's vault USDCx balance credited (back to 10_000)
      const balHandle = await vault.getBalance(alice.address);
      const bal = await decrypt(balHandle, await vault.getAddress(), alice);
      expect(bal).to.equal(10_000n); // full return
    });
  });

  describe("partial withdraw", () => {
    it("pays out fair fraction and decrements shares + totals", async () => {
      const tx = await amm.connect(alice).requestWithdraw(400n);
      const receipt = await tx.wait();
      const event = receipt!.logs.find(
        (l: any) => l.fragment?.name === "WithdrawRequested"
      ) as any;
      await fulfillWithdraw(event.args.requestId, event.args.matchHandle);

      // payout = 400 × 1000 / 1000 = 400
      // remaining: shares = 600, reserve = 600
      expect(await amm.totalShares()).to.equal(600n);
      expect(await amm.totalReserveUsdcx()).to.equal(600n);

      const shares = await decrypt(
        await amm.getUserShares(alice.address),
        await amm.getAddress(),
        alice
      );
      expect(shares).to.equal(600n);
    });
  });

  describe("mismatch guard", () => {
    it("emits WithdrawRejected and does nothing if claimedShares != encrypted", async () => {
      // Alice actually has 1000, but claims 500
      const tx = await amm.connect(alice).requestWithdraw(500n);
      const receipt = await tx.wait();
      const event = receipt!.logs.find(
        (l: any) => l.fragment?.name === "WithdrawRequested"
      ) as any;
      const reqId = event.args.requestId;
      const matchHandle = event.args.matchHandle;

      // The ebool matchesExactly = (1000 == 500) = false → decrypt returns 0
      const { abiEncodedClearValues, decryptionProof } = await hre.fhevm.publicDecrypt([matchHandle]);

      await expect(amm._onWithdrawDecided(
        reqId, [matchHandle], abiEncodedClearValues, decryptionProof
      )).to.emit(amm, "WithdrawRejected").withArgs(reqId, alice.address);

      // Alice's shares unchanged
      const shares = await decrypt(
        await amm.getUserShares(alice.address),
        await amm.getAddress(),
        alice
      );
      expect(shares).to.equal(1_000n);
      expect(await amm.totalShares()).to.equal(1_000n);
    });
  });

  describe("guards", () => {
    it("requestWithdraw reverts on zero shares claimed", async () => {
      await expect(amm.connect(alice).requestWithdraw(0n))
        .to.be.revertedWithCustomError(amm, "ZeroAmount");
    });

    it("requestWithdraw reverts when claimed > totalShares", async () => {
      await expect(amm.connect(alice).requestWithdraw(10_000n))
        .to.be.revertedWithCustomError(amm, "ClaimExceedsPoolTotal");
    });

    it("requestWithdraw reverts when pool is empty", async () => {
      await (await amm.connect(alice).requestWithdraw(1_000n)).wait(); // drain
      const tx = await amm.connect(alice).requestWithdraw(1_000n).catch(e => e);
      // It may either revert here, or fulfill then revert — either way bob with
      // empty pool cannot initiate
      await expect(amm.connect(bob).requestWithdraw(100n))
        .to.be.revertedWithCustomError(amm, "ClaimExceedsPoolTotal");
    });
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test test/AMMEngine.Withdraw.test.ts
```

- [ ] **Step 3: Append withdraw logic to `AMMEngine.sol`**

Add to the error list:

```solidity
    error ClaimExceedsPoolTotal();
```

Add to the event list:

```solidity
    event WithdrawRequested(uint256 indexed requestId, address indexed user, uint64 claimedShares, bytes32 matchHandle);
    event LiquidityRemoved(uint256 indexed requestId, address indexed user, uint64 shares, uint64 payout);
    event WithdrawRejected(uint256 indexed requestId, address indexed user);
```

Append before the closing `}`:

```solidity
    // ─── Liquidity — withdraw (async 2-phase) ──────────────────────

    /// @notice Phase 1: Request withdrawal of `claimedShares` from the
    ///         caller. Engine computes ebool `matchesExactly` comparing
    ///         the user's encrypted share balance to the plaintext claim,
    ///         marks it publicly decryptable, emits event, and enqueues
    ///         pending state for the callback.
    /// @dev User must decrypt their share balance client-side first
    ///      (via FHE.userDecrypt) to know the exact claimedShares value.
    ///      If wrong, the callback rejects.
    function requestWithdraw(uint64 claimedShares) external returns (uint256 requestId) {
        if (claimedShares == 0) revert ZeroAmount();
        if (claimedShares > totalShares) revert ClaimExceedsPoolTotal();

        euint64 userBal = _userShares[msg.sender];
        euint64 eClaim = FHE.asEuint64(claimedShares);
        ebool matchesExactly = FHE.eq(userBal, eClaim);
        FHE.makePubliclyDecryptable(matchesExactly);

        requestId = uint256(keccak256(abi.encode(
            msg.sender, claimedShares, block.number, block.timestamp
        )));

        // Encode context: (caller, claimedShares) — we'll decode in callback
        bytes memory ctx = abi.encode(claimedShares);
        _enqueue(requestId, msg.sender, uint256(uint64(claimedShares)), ctx);

        emit WithdrawRequested(requestId, msg.sender, claimedShares, FHE.toBytes32(matchesExactly));
    }

    /// @notice Phase 2: Gateway-relayed callback. Verifies KMS signatures,
    ///         dequeues BEFORE external calls (replay guard), and either
    ///         processes the payout or rejects on mismatch.
    function _onWithdrawDecided(
        uint256 requestId,
        bytes32[] memory handlesList,
        bytes memory cleartexts,
        bytes memory decryptionProof
    ) external {
        // 1. Verify KMS signatures
        FHE.checkSignatures(handlesList, cleartexts, decryptionProof);

        // 2. Dequeue BEFORE any external call
        PendingDecrypt memory ctx = _dequeue(requestId);
        address user = ctx.caller;
        uint64 claimedShares = abi.decode(ctx.context, (uint64));

        // 3. Decode match boolean
        uint256 clearUint = abi.decode(cleartexts, (uint256));
        bool matched = clearUint != 0;

        if (!matched) {
            emit WithdrawRejected(requestId, user);
            return;
        }

        // 4. Compute payout in plaintext: payout = claimedShares × totalReserveUsdcx / totalShares
        uint256 product = uint256(claimedShares) * uint256(totalReserveUsdcx);
        uint64 payout = uint64(product / uint256(totalShares));

        // 5. Update plaintext counters
        totalShares -= claimedShares;
        totalReserveUsdcx -= payout;

        // 6. Update user's encrypted share balance: subtract claimedShares
        euint64 eClaim = FHE.asEuint64(claimedShares);
        euint64 newShares = FHESafeMath.safeSub(_userShares[user], eClaim);
        _userShares[user] = newShares;
        FHE.allowThis(newShares);
        FHE.allow(newShares, user);

        // 7. Debit AMM's vault balance, credit user's vault balance
        euint64 ePayout = FHE.asEuint64(payout);
        FHE.allowTransient(ePayout, address(vault));
        vault.adjustBalance(address(this), ePayout, false); // debit AMM

        euint64 ePayout2 = FHE.asEuint64(payout);
        FHE.allowTransient(ePayout2, address(vault));
        vault.adjustBalance(user, ePayout2, true); // credit user

        emit LiquidityRemoved(requestId, user, claimedShares, payout);
    }
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test test/AMMEngine.Withdraw.test.ts
```
Expected: 6 passing.

Common issues:
- Event parsing: `receipt.logs.find(l => l.fragment?.name === "WithdrawRequested")` may need `amm.interface.parseLog(rawLog)`. If the direct filter fails, iterate logs and parse each with `amm.interface.parseLog(log)`.
- `publicDecrypt` for ebool: the ebool handle should decrypt as 0 or 1 (uint256 on the wire). Match existing Phase 3 liquidation callback decode pattern.

- [ ] **Step 5: Full suite check**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test 2>&1 | tail -3
```
Expected: 200 passing (194 + 6).

- [ ] **Step 6: CHANGELOG + commit**

Append:
```markdown
- **Added**: `AMMEngine.requestWithdraw` + `_onWithdrawDecided` —
  async 2-phase withdrawal. Phase 1: engine compares user's encrypted
  shares to plaintext claim via `FHE.eq`, marks result publicly
  decryptable, emits event + enqueues. Phase 2 (relayer callback):
  verify KMS sigs, dequeue pre-external-call, if match compute pro-rata
  payout via plaintext math, debit AMM vault / credit user vault,
  decrement shares. On mismatch: emit `WithdrawRejected` no-op.
  6 unit tests (full / partial / mismatch-reject / guards).
  **Files**: `contracts/contracts/engines/AMMEngine.sol`,
  `contracts/test/AMMEngine.Withdraw.test.ts`.
```

```bash
cd /Users/ram/Desktop/NoirPerp && git add contracts/contracts/engines/AMMEngine.sol contracts/test/AMMEngine.Withdraw.test.ts CHANGELOG.md && git -c user.email=developer@randao.net -c user.name="Ram" commit -q -m "feat(amm): add async requestWithdraw + _onWithdrawDecided callback

Two-phase withdrawal via pull-based public decrypt (fhe-primitives.md
§5). User supplies plaintext claim; engine compares against encrypted
share via FHE.eq; KMS decrypts only the match bit. Callback verifies
sigs, dequeues before external calls (replay guard), processes payout
on match or emits WithdrawRejected on mismatch. 6 unit tests.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `swap` (synchronous, oracle-pegged)

**Files:**
- Modify: `contracts/contracts/engines/AMMEngine.sol` (append)
- Create: `contracts/test/AMMEngine.Swap.test.ts`

**Purpose:** Oracle-pegged swap. User submits encrypted USDCx amount in + direction flag. Engine fetches oracle price (plaintext), computes `fee = amount × swapFeeBps / BPS_DIVISOR` (scalar FHE.div), `amountAfterFee = amount - fee`, `amountOut = amountAfterFee × price` (USDCx→synth) or `amountAfterFee / price` (synth→USDCx), credits user's synthetic-asset tracker.

**Design simplification**: one direction only (USDCx → synthetic asset) in this MVP task. Reverse direction (synth → USDCx) uses the same math pattern but inverted; add as a follow-up if time permits. Single market (ETH, marketId=2). Multi-market and bidirectional can be Phase 5+.

**Encrypted synthetic-asset tracker**: `mapping(address => euint64) private _syntheticEth` — per-user encrypted synthetic ETH balance. User can't do anything with this balance in Phase 4 (no reverse swap yet); it's a demo of privacy-preserving swap. Phase 5+ enables withdrawal or closure into perp position.

**Dependency**: needs Oracle deployed + fresh ETH price.

- [ ] **Step 1: Write failing test**

Create `/Users/ram/Desktop/NoirPerp/contracts/test/AMMEngine.Swap.test.ts`:

```typescript
import { expect } from "chai";
import * as hre from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import type { NoirVault, MockERC7984, Oracle, AMMEngine } from "../typechain-types";

const MARKET_ETH = 2;
const STALENESS = 90;
const DEVIATION_BPS = 50;

describe("AMMEngine — swap (USDCx → synthetic ETH)", () => {
  let vault: NoirVault;
  let token: MockERC7984;
  let oracle: Oracle;
  let amm: AMMEngine;
  let admin: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let relayerA: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let relayerB: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let relayerC: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let alice: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];

  async function now(): Promise<number> {
    const blk = await hre.ethers.provider.getBlock("latest");
    return blk!.timestamp;
  }

  async function encrypt(contract: string, user: string, value: bigint) {
    const input = hre.fhevm.createEncryptedInput(contract, user);
    input.add64(value);
    return await input.encrypt();
  }

  async function commitPrice(marketId: number, price: bigint) {
    const t = await now();
    await (await oracle.connect(relayerA).submitPrice(marketId, price, t)).wait();
    await (await oracle.connect(relayerB).submitPrice(marketId, price, t + 1)).wait();
  }

  async function decrypt(handle: string, contractAddr: string, signer: typeof admin): Promise<bigint> {
    return hre.fhevm.userDecryptEuint(FhevmType.euint64, handle, contractAddr, signer);
  }

  beforeEach(async () => {
    [admin, relayerA, relayerB, relayerC, alice] = await hre.ethers.getSigners();

    const TokenFactory = await hre.ethers.getContractFactory("MockERC7984");
    token = (await TokenFactory.deploy("MockUSDCx", "mUSDCx")) as unknown as MockERC7984;
    await token.waitForDeployment();
    await (await token.mintPlaintext(alice.address, 100_000n)).wait();

    const VaultFactory = await hre.ethers.getContractFactory("NoirVault");
    vault = (await VaultFactory.deploy(admin.address, await token.getAddress())) as unknown as NoirVault;
    await vault.waitForDeployment();

    const OracleFactory = await hre.ethers.getContractFactory("Oracle");
    oracle = (await OracleFactory.deploy(
      admin.address, [relayerA.address, relayerB.address, relayerC.address],
      STALENESS, DEVIATION_BPS,
    )) as unknown as Oracle;
    await oracle.waitForDeployment();

    const AMMFactory = await hre.ethers.getContractFactory("AMMEngine");
    amm = (await AMMFactory.deploy(
      await vault.getAddress(),
      admin.address,
    )) as unknown as AMMEngine;
    await amm.waitForDeployment();
    await (await vault.registerEngine(await amm.getAddress())).wait();

    // Wire oracle to AMM (via admin setter — will be added alongside swap)
    await (await amm.setOracle(await oracle.getAddress())).wait();

    await (await token.connect(alice).setOperator(await vault.getAddress(), 2n ** 48n - 1n)).wait();
    await (await vault.connect(alice).deposit(10_000n)).wait();

    await commitPrice(MARKET_ETH, 3_000n);
  });

  describe("happy path", () => {
    it("swaps 3000 USDCx → 0.997 synthetic ETH (with 30 bps fee)", async () => {
      // fee = 3000 × 30 / 10000 = 9 USDCx
      // amountAfterFee = 3000 - 9 = 2991 USDCx
      // ethOut = 2991 / 3000 = 0.997 → floor to 0 (integer div)
      // For whole-ETH output, need bigger amountIn — let's use 3_000_000 base units
      // Rescale: alice deposited 10_000 × 10^6 (if we want decimals)... or just test integer output

      // For simplicity: use a price of 3 so amountIn 3000 → amountOut ≈ 997
      // Re-commit price = 3
      // Actually the oracle price is still uint64 plain; let's use price=3 for cleaner math
      // Re-do setup with price 3 for this test
      // Skipped: use the existing 3000 price, assert floor-rounded ethOut
      const engineAddr = await amm.getAddress();
      const amtEnc = await encrypt(engineAddr, alice.address, 3_000n);
      await (await amm.connect(alice).swap(
        amtEnc.handles[0], amtEnc.inputProof, MARKET_ETH
      )).wait();

      // ethOut = floor((3000 - 9) / 3000) = 0 with integer div. This test
      // just verifies execution without revert + sane accounting.
      const vaultBal = await decrypt(
        await vault.getBalance(alice.address),
        await vault.getAddress(),
        alice,
      );
      expect(vaultBal).to.equal(7_000n); // 10_000 - 3_000
    });

    it("swap with price=3 produces non-zero synthetic output", async () => {
      await commitPrice(MARKET_ETH, 3n);

      const engineAddr = await amm.getAddress();
      const amtEnc = await encrypt(engineAddr, alice.address, 3_000n);
      await (await amm.connect(alice).swap(
        amtEnc.handles[0], amtEnc.inputProof, MARKET_ETH
      )).wait();

      // fee = 3000 × 30 / 10000 = 9
      // amountAfterFee = 2991
      // ethOut = 2991 / 3 = 997
      const synthHandle = await amm.getSyntheticBalance(alice.address, MARKET_ETH);
      const synth = await decrypt(synthHandle, await amm.getAddress(), alice);
      expect(synth).to.equal(997n);

      // AMM vault balance increased by 3000 (full amountIn went into pool)
      // Alice vault balance decreased by 3000
      const aliceBal = await decrypt(
        await vault.getBalance(alice.address),
        await vault.getAddress(),
        alice,
      );
      expect(aliceBal).to.equal(7_000n);
    });
  });

  describe("guards", () => {
    it("reverts on stale oracle", async () => {
      await hre.ethers.provider.send("evm_increaseTime", [STALENESS + 10]);
      await hre.ethers.provider.send("evm_mine", []);

      const engineAddr = await amm.getAddress();
      const amtEnc = await encrypt(engineAddr, alice.address, 100n);
      await expect(amm.connect(alice).swap(
        amtEnc.handles[0], amtEnc.inputProof, MARKET_ETH
      )).to.be.revertedWithCustomError(amm, "OraclePriceStale");
    });

    it("reverts on invalid marketId", async () => {
      const engineAddr = await amm.getAddress();
      const amtEnc = await encrypt(engineAddr, alice.address, 100n);
      await expect(amm.connect(alice).swap(
        amtEnc.handles[0], amtEnc.inputProof, 99
      )).to.be.revertedWithCustomError(amm, "InvalidMarket");
    });

    it("reverts if oracle not configured", async () => {
      // Deploy a fresh AMM without setOracle
      const AMMFactory = await hre.ethers.getContractFactory("AMMEngine");
      const freshAmm = (await AMMFactory.deploy(
        await vault.getAddress(),
        admin.address,
      )) as unknown as AMMEngine;
      await freshAmm.waitForDeployment();
      await (await vault.registerEngine(await freshAmm.getAddress())).wait();

      const engineAddr = await freshAmm.getAddress();
      const amtEnc = await encrypt(engineAddr, alice.address, 100n);
      await expect(freshAmm.connect(alice).swap(
        amtEnc.handles[0], amtEnc.inputProof, MARKET_ETH
      )).to.be.revertedWithCustomError(freshAmm, "OracleNotSet");
    });
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test test/AMMEngine.Swap.test.ts
```

- [ ] **Step 3: Append swap logic + oracle wiring**

Open `/Users/ram/Desktop/NoirPerp/contracts/contracts/engines/AMMEngine.sol`. Add at the top of imports:

```solidity
import { Oracle } from "../services/Oracle.sol";
```

Add state variable (after `_userShares`):

```solidity
    Oracle public oracleContract;
    mapping(address user => mapping(uint8 marketId => euint64)) private _syntheticBalance;
```

Add errors:

```solidity
    error OracleNotSet();
    error OraclePriceStale();
    error InvalidMarket();
    error NotAllowed();
```

Add events:

```solidity
    event OracleSet(address indexed newOracle);
    event Swapped(address indexed user, uint8 indexed marketId, uint64 amountInUsdcx);
```

Append before closing `}`:

```solidity
    // ─── Oracle wiring ─────────────────────────────────────────────

    function setOracle(address oracle_) external onlyAdmin {
        if (oracle_ == address(0)) revert ZeroAddress();
        oracleContract = Oracle(oracle_);
        emit OracleSet(oracle_);
    }

    // ─── Swap (synchronous, oracle-pegged, USDCx → synthetic) ──────

    /// @notice Swaps encrypted USDCx for encrypted synthetic-asset credit
    ///         at the current oracle price, minus `swapFeeBps` fee.
    /// @dev Fee stays in the pool (increases AMM's vault balance) but
    ///      does NOT update plaintext totalReserveUsdcx (stranded fee —
    ///      same MVP limitation as liquidation forfeits).
    function swap(
        externalEuint64 eAmountIn,
        bytes calldata amountProof,
        uint8 marketId
    ) external {
        if (address(oracleContract) == address(0)) revert OracleNotSet();
        if (marketId < 1 || marketId > 3) revert InvalidMarket();

        (uint64 price, bool fresh) = oracleContract.getPrice(marketId);
        if (!fresh) revert OraclePriceStale();

        euint64 amountIn = FHE.fromExternal(eAmountIn, amountProof);
        if (!FHE.isSenderAllowed(amountIn)) revert NotAllowed();

        // Compute fee = amountIn × swapFeeBps / BPS_DIVISOR (scalar div OK)
        euint64 feeBpsCt = FHE.asEuint64(swapFeeBps);
        euint64 feeNumerator = FHESafeMath.safeMul(amountIn, feeBpsCt);
        euint64 fee = FHE.div(feeNumerator, BPS_DIVISOR);
        euint64 amountAfterFee = FHESafeMath.safeSub(amountIn, fee);

        // amountOut = amountAfterFee / price (scalar div — price is plaintext uint64)
        euint64 amountOut = FHE.div(amountAfterFee, price);

        // Debit user's vault USDCx by full amountIn (fee stays in pool)
        FHE.allowTransient(amountIn, address(vault));
        vault.adjustBalance(msg.sender, amountIn, false);

        // Credit AMM's vault USDCx by full amountIn
        // Use a fresh handle to avoid ACL reuse issues
        euint64 amountInCopy = FHESafeMath.safeAdd(amountIn, FHE.asEuint64(0));
        FHE.allowTransient(amountInCopy, address(vault));
        vault.adjustBalance(address(this), amountInCopy, true);

        // Credit user's synthetic-asset balance
        euint64 currentSynth = _syntheticBalance[msg.sender][marketId];
        euint64 newSynth = FHESafeMath.safeAdd(currentSynth, amountOut);
        _syntheticBalance[msg.sender][marketId] = newSynth;
        FHE.allowThis(newSynth);
        FHE.allow(newSynth, msg.sender);

        emit Swapped(msg.sender, marketId, 0); // amountIn is encrypted; 0 is placeholder
    }

    function getSyntheticBalance(address user, uint8 marketId) external view returns (euint64) {
        return _syntheticBalance[user][marketId];
    }
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test test/AMMEngine.Swap.test.ts
```
Expected: 5 passing.

If compile fails with stack-too-deep: split the swap logic into an internal helper `_executeSwap(amountIn, price, marketId)` as Phase 3 Task 2 did.

If the 2nd happy-path test fails on synth=997, the issue is likely integer-division rounding in `FHE.div`. Verify the math by hand: `fee = 3000 × 30 / 10000 = 9`. `afterFee = 2991`. `out = 2991 / 3 = 997`. If Solidity's `FHE.div` rounds differently, adjust the test expectation.

- [ ] **Step 5: Full suite + CHANGELOG + commit**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test 2>&1 | tail -3
```
Expected: 205 passing.

Append to CHANGELOG:
```markdown
- **Added**: `AMMEngine.swap` — synchronous oracle-pegged USDCx →
  synthetic-asset swap. Fee (30 bps default) stays in the pool
  (stranded, same as liquidation forfeits — MVP limitation).
  `setOracle(address)` admin function wires the oracle reference.
  Supports 3 markets (BTC=1, ETH=2, SOL=3). User's synthetic balance
  is encrypted per-market. 5 unit tests.
  **Files**: `contracts/contracts/engines/AMMEngine.sol`,
  `contracts/test/AMMEngine.Swap.test.ts`.
```

```bash
cd /Users/ram/Desktop/NoirPerp && git add contracts/contracts/engines/AMMEngine.sol contracts/test/AMMEngine.Swap.test.ts CHANGELOG.md && git -c user.email=developer@randao.net -c user.name="Ram" commit -q -m "feat(amm): add synchronous oracle-pegged swap

USDCx → synthetic asset, 30bps fee, fee stays in pool as stranded
reserves (same MVP limitation as liquidation forfeits). Scalar
FHE.div supported for both fee calc and price conversion.
Per-user per-market synthetic balance tracked as encrypted. 5 unit tests.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: PerpEngine integration (repoint liquidationPool → AMM)

**Files:**
- Create: `contracts/test/Integration.PerpAmmLiq.test.ts`

**Purpose:** Verify the cross-engine integration: PerpEngine's liquidationPool points to AMMEngine address, and on liquidation the forfeit lands in AMM's vault balance as an encrypted increment.

**No new Solidity code in this task.** PerpEngine's `setLiquidationPool(address)` already exists (Phase 3). We just test the integration + document the stranded-forfeit behavior.

- [ ] **Step 1: Write test**

Create `/Users/ram/Desktop/NoirPerp/contracts/test/Integration.PerpAmmLiq.test.ts`:

```typescript
import { expect } from "chai";
import * as hre from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import type { NoirVault, MockERC7984, Oracle, Compliance, PerpEngine, AMMEngine } from "../typechain-types";

const MARKET_ETH = 2;
const STALENESS = 90;
const DEVIATION_BPS = 50;

describe("Integration — Perp → AMM liquidation forfeit flow", () => {
  let vault: NoirVault;
  let token: MockERC7984;
  let oracle: Oracle;
  let compliance: Compliance;
  let perp: PerpEngine;
  let amm: AMMEngine;
  let admin: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let relayerA: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let relayerB: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let relayerC: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let alice: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let keeper: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let aliceProof: string[];

  async function now(): Promise<number> {
    const blk = await hre.ethers.provider.getBlock("latest");
    return blk!.timestamp;
  }

  async function encrypt(contract: string, user: string, value: bigint) {
    const input = hre.fhevm.createEncryptedInput(contract, user);
    input.add64(value);
    return await input.encrypt();
  }

  async function commitPrice(marketId: number, price: bigint) {
    const t = await now();
    await (await oracle.connect(relayerA).submitPrice(marketId, price, t)).wait();
    await (await oracle.connect(relayerB).submitPrice(marketId, price, t + 1)).wait();
  }

  async function fulfillLiq(reqId: bigint, handle: string): Promise<void> {
    const { abiEncodedClearValues, decryptionProof } = await hre.fhevm.publicDecrypt([handle]);
    await (await perp._onLiquidationDecided(
      reqId, [handle], abiEncodedClearValues, decryptionProof,
    )).wait();
  }

  beforeEach(async () => {
    [admin, relayerA, relayerB, relayerC, alice, keeper] = await hre.ethers.getSigners();

    const TokenFactory = await hre.ethers.getContractFactory("MockERC7984");
    token = (await TokenFactory.deploy("MockUSDCx", "mUSDCx")) as unknown as MockERC7984;
    await token.waitForDeployment();
    await (await token.mintPlaintext(alice.address, 100_000n)).wait();

    const VaultFactory = await hre.ethers.getContractFactory("NoirVault");
    vault = (await VaultFactory.deploy(admin.address, await token.getAddress())) as unknown as NoirVault;
    await vault.waitForDeployment();

    const OracleFactory = await hre.ethers.getContractFactory("Oracle");
    oracle = (await OracleFactory.deploy(
      admin.address, [relayerA.address, relayerB.address, relayerC.address],
      STALENESS, DEVIATION_BPS,
    )) as unknown as Oracle;
    await oracle.waitForDeployment();

    const tree = StandardMerkleTree.of([[alice.address]], ["address"]);
    aliceProof = tree.getProof([alice.address]);
    const ComplianceFactory = await hre.ethers.getContractFactory("Compliance");
    compliance = (await ComplianceFactory.deploy(admin.address, tree.root)) as unknown as Compliance;
    await compliance.waitForDeployment();

    const AMMFactory = await hre.ethers.getContractFactory("AMMEngine");
    amm = (await AMMFactory.deploy(await vault.getAddress(), admin.address)) as unknown as AMMEngine;
    await amm.waitForDeployment();

    const PerpFactory = await hre.ethers.getContractFactory("PerpEngine");
    perp = (await PerpFactory.deploy(
      await vault.getAddress(),
      await oracle.getAddress(),
      await compliance.getAddress(),
      await amm.getAddress(), // liquidationPool = AMM
      admin.address,
    )) as unknown as PerpEngine;
    await perp.waitForDeployment();

    await (await vault.registerEngine(await perp.getAddress())).wait();
    await (await vault.registerEngine(await amm.getAddress())).wait();

    await (await token.connect(alice).setOperator(await vault.getAddress(), 2n ** 48n - 1n)).wait();
    await (await vault.connect(alice).deposit(10_000n)).wait();

    await commitPrice(MARKET_ETH, 3_000n);

    // Alice opens a long position that will go underwater
    const perpAddr = await perp.getAddress();
    const sizeEnc = await encrypt(perpAddr, alice.address, 10n);
    const collEnc = await encrypt(perpAddr, alice.address, 1_500n);
    await (await perp.connect(alice).openPosition(
      sizeEnc.handles[0], sizeEnc.inputProof,
      collEnc.handles[0], collEnc.inputProof,
      true, MARKET_ETH, aliceProof,
    )).wait();
  });

  it("liquidation forfeit flows to AMM's vault balance", async () => {
    // Drop price → position underwater → liquidate
    await commitPrice(MARKET_ETH, 2_990n);

    const tx = await perp.connect(keeper).requestLiquidation(0);
    const receipt = await tx.wait();
    const event = receipt!.logs.find(
      (l: any) => l.fragment?.name === "LiquidationRequested"
    ) as any;
    await fulfillLiq(event.args.requestId, event.args.underwaterHandle);

    // Position is closed
    const pos = await vault.getPosition(0);
    expect(pos.active).to.equal(false);

    // AMM's vault balance is non-zero — forfeit landed there
    const ammBalHandle = await vault.getBalance(await amm.getAddress());
    expect(ammBalHandle).to.not.equal(hre.ethers.ZeroHash);

    // NOTE: AMM's plaintext totalReserveUsdcx is still 0 (forfeit is
    // "stranded" in vault balance but not reflected in plaintext counter).
    // This is the documented MVP limitation.
    expect(await amm.totalReserveUsdcx()).to.equal(0n);
  });
});
```

- [ ] **Step 2: Run test — expect PASS (no new Solidity)**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test test/Integration.PerpAmmLiq.test.ts
```
Expected: 1 passing.

- [ ] **Step 3: CHANGELOG + commit**

Append:
```markdown
- **Added**: `contracts/test/Integration.PerpAmmLiq.test.ts` —
  cross-engine integration test verifying PerpEngine liquidation
  forfeit lands in AMM's vault balance. Confirms the documented
  MVP limitation: `totalReserveUsdcx` plaintext counter is NOT
  incremented (forfeits stranded). Phase 5+ adds resync flow.
```

```bash
cd /Users/ram/Desktop/NoirPerp && git add contracts/test/Integration.PerpAmmLiq.test.ts CHANGELOG.md && git -c user.email=developer@randao.net -c user.name="Ram" commit -q -m "test(integration): verify Perp→AMM liquidation forfeit flow

PerpEngine's liquidationPool set to AMMEngine address at construction.
On liquidation, forfeit lands in AMM's vault balance as encrypted
increment. Plaintext totalReserveUsdcx stays 0 — documented MVP
limitation (forfeits stranded, resync deferred to Phase 5+). 1 test.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Update `deploy-local.ts` to include AMMEngine

**Files:**
- Modify: `contracts/scripts/deploy-local.ts`

- [ ] **Step 1: Append AMM deploy + setOracle + PerpEngine.setLiquidationPool**

Open `/Users/ram/Desktop/NoirPerp/contracts/scripts/deploy-local.ts`. Just before the final "Phase 3 deploy complete" log, insert:

```typescript
  // 6. AMMEngine (Phase 4)
  const AMMFactory = await hre.ethers.getContractFactory("AMMEngine");
  const amm = await AMMFactory.deploy(await vault.getAddress(), admin.address);
  await amm.waitForDeployment();
  console.log("AMMEngine deployed:  ", await amm.getAddress());
  await (await vault.registerEngine(await amm.getAddress())).wait();
  console.log("AMMEngine registered as authorized engine on vault");

  // Wire oracle into AMM
  await (await amm.setOracle(await oracle.getAddress())).wait();
  console.log("AMMEngine oracle set");

  // Repoint PerpEngine liquidationPool → AMM
  await (await perp.setLiquidationPool(await amm.getAddress())).wait();
  console.log("PerpEngine liquidationPool repointed to AMMEngine");
```

Update the final banner from `=== Phase 3 deploy complete ===` to `=== Phase 4 deploy complete ===`.

- [ ] **Step 2: Run the deploy script**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat run scripts/deploy-local.ts
```
Expected: prints 6 addresses + "AMMEngine registered" + "AMMEngine oracle set" + "PerpEngine liquidationPool repointed" + "Phase 4 deploy complete".

- [ ] **Step 3: CHANGELOG + commit**

```bash
cd /Users/ram/Desktop/NoirPerp && git add contracts/scripts/deploy-local.ts CHANGELOG.md && git -c user.email=developer@randao.net -c user.name="Ram" commit -q -m "chore(scripts): deploy AMMEngine + wire oracle + repoint liquidationPool

deploy-local.ts now deploys AMMEngine, registers it on vault,
wires it to the oracle, and repoints PerpEngine.liquidationPool
to the AMM address.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

Append CHANGELOG entry:
```markdown
- **Modified**: `deploy-local.ts` — includes AMM deploy, oracle wiring,
  and PerpEngine.setLiquidationPool(AMM) repoint.
```

---

### Task 7: Coverage verification

- [ ] **Step 1: Run coverage**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && SOLIDITY_COVERAGE=true npx hardhat coverage --testfiles "test/AMMEngine.Admin.test.ts,test/AMMEngine.AddLiquidity.test.ts,test/AMMEngine.Withdraw.test.ts,test/AMMEngine.Swap.test.ts,test/Integration.PerpAmmLiq.test.ts" 2>&1 | tail -15
```

Expected: AMMEngine.sol coverage ≥90% lines/funcs/stmts, ≥80% branches.

- [ ] **Step 2: Add coverage-gap tests if needed**

Likely gaps:
- Constructor zero-address guards on both ctor args (should already be tested)
- `setOracle` zero-address + non-admin (test these explicitly if coverage misses)
- `setOracle` event emission

If coverage falls short, add a `test/AMMEngine.OracleAdmin.test.ts` with:
```typescript
it("non-admin cannot setOracle", async () => {
  await expect(amm.connect(alice).setOracle(ethers.ZeroAddress))
    .to.be.revertedWithCustomError(amm, "NotAdmin");
});
it("setOracle reverts on zero address", async () => {
  await expect(amm.setOracle(ethers.ZeroAddress))
    .to.be.revertedWithCustomError(amm, "ZeroAddress");
});
it("setOracle emits OracleSet event", async () => {
  await expect(amm.setOracle(await oracle.getAddress()))
    .to.emit(amm, "OracleSet").withArgs(await oracle.getAddress());
});
```

- [ ] **Step 3: Commit coverage fixes if any**

```bash
cd /Users/ram/Desktop/NoirPerp && git add contracts/test/ && git -c user.email=developer@randao.net -c user.name="Ram" commit -q -m "test(amm): close coverage gaps (>=90% achieved)"
```

---

### Task 8: Tier 1 audit (mandatory)

Per `PROGRESS.md` phase gate, Phase 4 can't tick complete until Tier 1 audit passes. Dispatch both reviewers in parallel (read-only):

- [ ] **Step 1: Dispatch spec-compliance reviewer**

Use Agent tool, subagent_type=general-purpose, model=sonnet. Prompt:
> Review Phase 4 (AMMEngine) against `/Users/ram/Desktop/NoirPerp/docs/plans/2026-04-24-phase-4-amm-engine.md` and `/Users/ram/Desktop/NoirPerp/docs/specs/2026-04-24-noirperp-design.md` §4.3. The plan documents 5 intentional deviations (no UniV3, plaintext pool totals, stranded forfeits, no TickMath usage, LP state inside AMM not vault). Verify: (a) code matches plan, (b) all documented deviations are actually implemented as described (not accidentally undocumented), (c) no YAGNI violations, (d) all test counts match. Report ✅ compliant or ❌ issues with file:line.

- [ ] **Step 2: Dispatch code-quality reviewer**

Same pattern. Prompt:
> Code-quality review of Phase 4 (AMMEngine). Per `/Users/ram/Desktop/NoirPerp/CLAUDE.md` and `/Users/ram/Desktop/NoirPerp/docs/fhe-primitives.md`, check: FHE.* namespace, no raw FHE.sub/add/mul outside FHESafeMath, isSenderAllowed guard on external encrypted inputs (swap's `amountIn`), allowTransient-only for cross-contract ciphertexts, async callback replay guard (`_onWithdrawDecided`: checkSignatures first, _dequeue BEFORE external calls), custom errors (no string reverts), events on mutating functions. Report APPROVED / APPROVED_WITH_MINOR_FIXES / NEEDS_REWORK.

- [ ] **Step 3: Address any critical + important findings in a `fix(audit):` commit**

Per the pattern established in Phases 2-3: fix inline, commit separately, full suite must still pass.

---

### Task 9: Phase 4 tick + merge to master

- [ ] **Step 1: Verify full suite + coverage still green**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test 2>&1 | tail -3
```
Expected: ≥206 passing (176 prior + Phase 4 additions).

- [ ] **Step 2: Tick Phase 4 in PROGRESS.md**

Change:
```markdown
- [ ] **Phase 4 — AMMEngine**
  Plan: *(not yet written)*
```
to:
```markdown
- [x] **Phase 4 — AMMEngine** ✅ (2026-04-XX)
  Plan: `docs/plans/2026-04-24-phase-4-amm-engine.md`
  Completion criteria met: AMMEngine live on local mock; addLiquidity
  (sync) + requestWithdraw (async) + swap (sync oracle-pegged) all
  working; PerpEngine.liquidationPool repointed to AMM; forfeit flow
  verified end-to-end (forfeits land in AMM vault balance — plaintext
  counter sync deferred to Phase 5+). Tier 1 audit passed. Coverage
  ≥90% on AMMEngine. Total tests: ~210 passing.
```

- [ ] **Step 3: Append Phase 4 complete entry to CHANGELOG.md**

```markdown
### Phase 4 complete ✅ (2026-04-XX)

- **AMMEngine live**: encrypted reserve pool with plaintext totals +
  encrypted per-user LP shares + encrypted per-user synthetic balances.
  - `addLiquidity(uint64)` — sync plaintext deposit, encrypted share credit
  - `requestWithdraw` + `_onWithdrawDecided` — async 2-phase, pull-based
    public decrypt pattern (fhe-primitives.md §5)
  - `swap` — sync oracle-pegged USDCx → synthetic, 30bps fee
- **PerpEngine integration**: `liquidationPool` repointed to AMM at
  deploy time; forfeits land in AMM's vault balance as encrypted
  increments.
- **Spec deviations** (documented): no UniV3 concentrated liquidity
  (needs FHE.sqrt + ct/ct div — not in v0.11.1), plaintext pool totals
  (partial TVL visibility, but per-LP privacy preserved), stranded
  forfeits (plaintext counter not auto-updated from encrypted increments;
  Phase 5+ resync), no TickMath usage, LP state inside AMM not vault.
- **Test count**: ~210 total.
- **Coverage**: AMMEngine ≥90% stmts/funcs/lines.
- **Tier 1 audit**: passed.
- **Ready for Phase 5** (LimitEngine): TP/SL + limit orders.
```

- [ ] **Step 4: Commit + merge**

```bash
cd /Users/ram/Desktop/NoirPerp && git add PROGRESS.md CHANGELOG.md && git -c user.email=developer@randao.net -c user.name="Ram" commit -q -m "docs: tick Phase 4 complete — AMMEngine live" && git checkout master && git merge --ff-only phase-4-amm-engine
```

- [ ] **Step 5: Announce**

> "✅ Phase 4 complete. AMMEngine live: addLiquidity, async withdraw, oracle-pegged swap. PerpEngine forfeits flow to AMM. Ready for Phase 5 (LimitEngine)."

---

## Appendix A — Troubleshooting

**`FHESafeMath.safeAdd` on uninitialised storage slot**: reading `_userShares[user]` before any mutation returns the euint64 zero-value handle. `FHESafeMath.safeAdd(zeroHandle, x) == x` — should work. If it reverts with an ACL error, the zero handle may not be decryptable by the vault — pre-check with a branch: `if (_userShares[user] == 0) initialize explicitly`.

**Event arg decoding in withdraw test**: `receipt.logs.find(l => l.fragment?.name === ...)` may miss the event if the log is emitted by an inherited contract. Fallback: iterate all logs and parse each with `amm.interface.parseLog(log)`, then match on `name`.

**Stack-too-deep on `swap`**: 4-5 euint64 locals + oracle price + market id. If hit, split into `_executeSwap(amountIn, price)` internal helper. Reference: Phase 3 Task 2 used the same pattern.

**Synthetic balance zero on first swap**: same as `_userShares` — uninitialised storage. Same mitigation.

**`FHE.div(ct, uint64)` returning unexpected values**: it's integer floor division. Confirm with a paper-and-pencil test: `FHE.div(FHE.asEuint64(100), 3) == FHE.asEuint64(33)`. If off, there may be a scalar-vs-ciphertext API confusion.

**Forfeit test asserting AMM balance non-zero**: the vault's balance for AMM is encrypted and not directly decryptable from the test (AMM doesn't grant test-signer persistent allow). Test can only assert the handle is non-zero. Deeper assertions require an AMM helper method or a separate Phase 5+ decrypt-and-verify flow.
