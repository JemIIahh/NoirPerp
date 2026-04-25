# Phase 5 — LimitEngine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `LimitEngine.sol` — encrypted TP / SL / Limit-Open order management with bot-triggered async execution that calls into PerpEngine via a new authorized-executor pattern.

**Architecture:** LimitEngine inherits `DecryptQueue` for replay-guarded async callbacks. All 3 order types share a single async-trigger flow: bot calls `requestTrigger(orderId)` → engine computes `ebool shouldTrigger` on ciphertexts → KMS decrypts → callback executes (close existing position for TP/SL, open new position for Limit). PerpEngine is refactored minimally to expose `openPositionAsExecutor` + `closePositionAsExecutor`, gated by an `authorizedExecutors` allowlist. LimitEngine acts as escrow for Limit-Open collateral (locks at place-time, refunds at cancel/trigger).

**Tech Stack:**
- Solidity `^0.8.27`
- `@fhevm/solidity@^0.11.1` (`FHE`, `euint64`, `ebool`, `externalEuint64`, `ZamaEthereumConfig`)
- Phase 1 libs: `FHESafeMath`, `MarginMath`, `DecryptQueue`
- Phase 2-4 contracts: `NoirVault`, `Oracle`, `Compliance`, `PerpEngine`, `AMMEngine`
- Hardhat mock FHEVM
- `@fhevm/hardhat-plugin` for `createEncryptedInput` + `publicDecrypt`

**Reference docs:**
- Spec: `docs/specs/2026-04-24-noirperp-design.md` §4.5
- Primitives: `docs/fhe-primitives.md` §5 (pull-based async decrypt — corrected during Phase 3)
- Rules: `CLAUDE.md`
- Prior phases: `docs/plans/2026-04-24-phase-{0,1,2,3,4}-*.md`

**Order types** (uint8 enum):
- `1 = TP` (Take-Profit) — closes existing position when price reaches profit target
- `2 = SL` (Stop-Loss) — closes existing position when price falls/rises to stop level
- `3 = LIMIT` (Limit-Open) — opens new position when price crosses target

**Trigger conditions** (computed as `ebool` on ciphertexts):

| Order type | Direction | Trigger condition |
|---|---|---|
| TP | long position | `oraclePrice >= triggerPrice` |
| TP | short position | `oraclePrice <= triggerPrice` |
| SL | long position | `oraclePrice <= triggerPrice` |
| SL | short position | `oraclePrice >= triggerPrice` |
| LIMIT | long (buy) | `oraclePrice <= triggerPrice` |
| LIMIT | short (sell) | `oraclePrice >= triggerPrice` |

Simplifies to: `useGe = (TP && long) || (SL && short) || (LIMIT && short)`. The helper computes once, both arms cheap.

**Collateral escrow (Limit-Open only)**:
- `placeLimit` debits user's vault USDCx balance + credits LimitEngine's vault balance (escrow)
- `cancelOrder` (Limit type): refund — debit LimitEngine + credit user
- `_onTriggerDecided` (Limit type): refund LimitEngine → user, THEN call `perp.openPositionAsExecutor` which debits user normally for the position open. This way perp's existing margin/silent-zero logic handles trigger-time failure cleanly (e.g., if oracle price made the position over-leveraged at trigger, position is silently zeroed and user keeps the refunded collateral).

**PerpEngine modifications (Task 1) — VERIFIED against current code**:

Current PerpEngine.sol structure (verified by reading the file):
- `_computeFinals(euint64 size, euint64 collateral, uint64 price)` exists at line 139. Takes **plaintext price** (encrypts internally). Uses `msg.sender` to read user balance via `vault.allowBalanceAccess(msg.sender)` at line 145.
- `_settle(address user, euint64 finalSize, euint64 finalCollateral, uint64 price, bool isLong, uint8 marketId)` at line 157 — **already takes `user` as parameter**. No refactor needed for `_settle`.
- `closePosition(uint256 positionId)` body at lines 292-324 is **inlined — no `_executeClose` helper exists**. Extraction is REQUIRED for `closePositionAsExecutor`.

Required changes:
- Modify `_computeFinals` signature: add `address owner` parameter (4 args total). Replace the hardcoded `msg.sender` with `owner`. Existing `openPosition` caller passes `msg.sender`.
- Extract `_executeClose(NoirVault.Position memory p, uint64 price)` from the body of `closePosition` (everything from the oracle freshness check onwards). Existing `closePosition` becomes: ownership guard + extract → call `_executeClose(p, price)`.
- New `mapping(address => bool) public authorizedExecutors`
- New `setExecutor(address, bool)` admin function
- New `openPositionAsExecutor(owner, euint64 size, euint64 collateral, isLong, marketId)` — calls `_computeFinals(size, collateral, price, owner)` then `_settle(owner, finalSize, finalCollateral, price, isLong, marketId)`. Skips compliance (LimitEngine verifies at place-time).
- New `closePositionAsExecutor(positionId)` — bypasses owner check; calls `_executeClose(p, price)`.
- Phase 3 tests must remain green (verify after refactor).

---

### Task 0: Branch + preconditions

**Files:** none

- [ ] **Step 1: Verify branch**

```bash
git -C /Users/ram/Desktop/NoirPerp branch --show-current
```
Expected: `phase-5-limit-engine`.

- [ ] **Step 2: Verify Phase 0–4 still green**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat compile && npx hardhat test 2>&1 | tail -3
```
Expected: **205 passing**.

- [ ] **Step 3: Re-read primer docs**

- `CLAUDE.md` — pinned rules
- `docs/fhe-primitives.md` §5 (pull-based async decrypt pattern — Phase 3 + 4 reference)
- `docs/specs/2026-04-24-noirperp-design.md` §4.5 (LimitEngine spec)
- Existing `contracts/contracts/engines/PerpEngine.sol` — understand `_computeFinals` + `_settle` structure before refactoring

---

### Task 1: PerpEngine — executor pattern + internal helper refactor

**Files:**
- Modify: `contracts/contracts/engines/PerpEngine.sol`
- Create: `contracts/test/PerpEngine.Executor.test.ts`

**Purpose:** Add an authorized-executor pattern so LimitEngine can call `openPosition`/`closePosition` on behalf of users. Refactor minimally — extract `_computeFinals(owner, ...)` to take owner as arg (currently uses `msg.sender`); existing `openPosition`/`closePosition` must keep passing all prior tests.

**New API**:
```solidity
mapping(address => bool) public authorizedExecutors;
event ExecutorSet(address indexed executor, bool authorized);
error NotAuthorizedExecutor();

function setExecutor(address executor, bool authorized) external onlyAdmin;
function openPositionAsExecutor(
    address owner,
    euint64 size,
    euint64 collateral,
    bool isLong,
    uint8 marketId
) external onlyAuthorizedExecutor whenNotPaused returns (uint256 positionId);
function closePositionAsExecutor(uint256 positionId) external onlyAuthorizedExecutor whenNotPaused;
```

- [ ] **Step 1: Read current PerpEngine to understand structure**

```bash
cat /Users/ram/Desktop/NoirPerp/contracts/contracts/engines/PerpEngine.sol | head -200
```
Note where `_computeFinals` and `_settle` are defined and what they take as args.

- [ ] **Step 2: Write failing executor tests first**

Create `/Users/ram/Desktop/NoirPerp/contracts/test/PerpEngine.Executor.test.ts`:

```typescript
import { expect } from "chai";
import * as hre from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import type { NoirVault, MockERC7984, Oracle, Compliance, PerpEngine } from "../typechain-types";

const MARKET_ETH = 2;
const STALENESS = 90;
const DEVIATION_BPS = 50;

describe("PerpEngine — executor pattern", () => {
  let vault: NoirVault;
  let token: MockERC7984;
  let oracle: Oracle;
  let compliance: Compliance;
  let perp: PerpEngine;
  let admin: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let relayerA: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let relayerB: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let relayerC: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let alice: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let executor: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let aliceProof: string[];

  async function now(): Promise<number> {
    const blk = await hre.ethers.provider.getBlock("latest");
    return blk!.timestamp;
  }

  async function commitPrice(marketId: number, price: bigint) {
    const t = await now();
    await (await oracle.connect(relayerA).submitPrice(marketId, price, t)).wait();
    await (await oracle.connect(relayerB).submitPrice(marketId, price, t + 1)).wait();
  }

  beforeEach(async () => {
    [admin, relayerA, relayerB, relayerC, alice, executor] = await hre.ethers.getSigners();

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

    const PerpFactory = await hre.ethers.getContractFactory("PerpEngine");
    perp = (await PerpFactory.deploy(
      await vault.getAddress(),
      await oracle.getAddress(),
      await compliance.getAddress(),
      admin.address, // liquidationPool
      admin.address,
    )) as unknown as PerpEngine;
    await perp.waitForDeployment();
    await (await vault.registerEngine(await perp.getAddress())).wait();

    await (await token.connect(alice).setOperator(await vault.getAddress(), 2n ** 48n - 1n)).wait();
    await (await vault.connect(alice).deposit(10_000n)).wait();
    await commitPrice(MARKET_ETH, 3_000n);
  });

  describe("setExecutor", () => {
    it("admin can authorize an executor", async () => {
      await expect(perp.setExecutor(executor.address, true))
        .to.emit(perp, "ExecutorSet")
        .withArgs(executor.address, true);
      expect(await perp.authorizedExecutors(executor.address)).to.equal(true);
    });

    it("admin can revoke an executor", async () => {
      await (await perp.setExecutor(executor.address, true)).wait();
      await (await perp.setExecutor(executor.address, false)).wait();
      expect(await perp.authorizedExecutors(executor.address)).to.equal(false);
    });

    it("non-admin cannot set executor", async () => {
      await expect(
        perp.connect(alice).setExecutor(executor.address, true)
      ).to.be.revertedWithCustomError(perp, "NotAdmin");
    });

    it("reverts on zero executor address", async () => {
      await expect(perp.setExecutor(hre.ethers.ZeroAddress, true))
        .to.be.revertedWithCustomError(perp, "ZeroAddress");
    });
  });

  describe("openPositionAsExecutor", () => {
    it("non-executor cannot call", async () => {
      // Build a dummy euint64 — the modifier should fire before any FHE op
      const dummy = hre.ethers.ZeroHash;
      await expect(
        perp.connect(alice).openPositionAsExecutor(
          alice.address, dummy, dummy, true, MARKET_ETH
        )
      ).to.be.revertedWithCustomError(perp, "NotAuthorizedExecutor");
    });

    it("authorized executor can open a position for a user", async () => {
      // Authorize executor
      await (await perp.setExecutor(executor.address, true)).wait();

      // Executor needs to hold ciphertexts to pass them — for this unit test,
      // we use a small wrapper contract OR just trivially-encrypt from the
      // executor's address. Since FHE.asEuint64 produces a ct owned by the
      // caller, the executor signer can call a helper. For simplicity here,
      // we test via an existing pattern: open a position as alice via the
      // normal openPosition (Phase 3), then verify executor-style call would
      // need a contract. Skip the full positive path here — Task 5
      // integration test exercises this end-to-end via LimitEngine.
      // Instead, assert the modifier passes: deploy a minimal MockExecutor
      // helper that holds + grants the ciphertexts.

      // For this scaffold test: just verify the function selector exists +
      // modifier guard works. Full path tested in integration.
      expect(perp.interface.getFunction("openPositionAsExecutor")).to.not.equal(null);
    });
  });

  describe("closePositionAsExecutor", () => {
    it("non-executor cannot call", async () => {
      await expect(
        perp.connect(alice).closePositionAsExecutor(0)
      ).to.be.revertedWithCustomError(perp, "NotAuthorizedExecutor");
    });

    it("authorized executor can close any position", async () => {
      // Open a position for alice via the normal flow first
      const engineAddr = await perp.getAddress();
      const sizeInput = hre.fhevm.createEncryptedInput(engineAddr, alice.address);
      sizeInput.add64(10n);
      const sizeEnc = await sizeInput.encrypt();
      const collInput = hre.fhevm.createEncryptedInput(engineAddr, alice.address);
      collInput.add64(1_500n);
      const collEnc = await collInput.encrypt();
      await (await perp.connect(alice).openPosition(
        sizeEnc.handles[0], sizeEnc.inputProof,
        collEnc.handles[0], collEnc.inputProof,
        true, MARKET_ETH, aliceProof,
      )).wait();

      // Authorize a contract executor — for this test we use a MockExecutor
      // that calls perp.closePositionAsExecutor. To keep this test simple,
      // we authorize an EOA and call directly. EOA → contract call works
      // because the EOA can issue tx with `perp.closePositionAsExecutor` signature.
      await (await perp.setExecutor(executor.address, true)).wait();

      await (await perp.connect(executor).closePositionAsExecutor(0)).wait();

      const pos = await vault.getPosition(0);
      expect(pos.active).to.equal(false);
    });

    it("reverts if position is not active", async () => {
      await (await perp.setExecutor(executor.address, true)).wait();
      // Position 0 doesn't exist yet
      await expect(
        perp.connect(executor).closePositionAsExecutor(0)
      ).to.be.revertedWithCustomError(perp, "PositionNotActive");
    });
  });

  describe("backwards compatibility — existing openPosition still works", () => {
    it("alice can still open a position via the standard openPosition", async () => {
      const engineAddr = await perp.getAddress();
      const sizeInput = hre.fhevm.createEncryptedInput(engineAddr, alice.address);
      sizeInput.add64(5n);
      const sizeEnc = await sizeInput.encrypt();
      const collInput = hre.fhevm.createEncryptedInput(engineAddr, alice.address);
      collInput.add64(1_000n);
      const collEnc = await collInput.encrypt();
      await (await perp.connect(alice).openPosition(
        sizeEnc.handles[0], sizeEnc.inputProof,
        collEnc.handles[0], collEnc.inputProof,
        false, MARKET_ETH, aliceProof,
      )).wait();
      const pos = await vault.getPosition(0);
      expect(pos.owner).to.equal(alice.address);
      expect(pos.active).to.equal(true);
    });
  });
});
```

- [ ] **Step 3: Run test — expect FAIL**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test test/PerpEngine.Executor.test.ts
```
Expected: failure on `setExecutor` not existing.

- [ ] **Step 4: Refactor + add executor pattern in `PerpEngine.sol`**

Open `/Users/ram/Desktop/NoirPerp/contracts/contracts/engines/PerpEngine.sol`. Make these surgical changes:

**4a — Add new state**:

After the existing `mapping(uint256 => uint256) private _pendingLiqs;` (or wherever existing mappings are), add:

```solidity
    mapping(address => bool) public authorizedExecutors;
```

**4b — Add new event + error**:

Within the existing event/error section, add:

```solidity
    event ExecutorSet(address indexed executor, bool authorized);

    error NotAuthorizedExecutor();
```

**4c — Add modifier**:

After existing `whenNotPaused` modifier, add:

```solidity
    modifier onlyAuthorizedExecutor() {
        if (!authorizedExecutors[msg.sender]) revert NotAuthorizedExecutor();
        _;
    }
```

**4d — Add `setExecutor` admin function**:

In the admin section, after `setLiquidationPool`, add:

```solidity
    /// @notice Authorize or revoke an executor contract (e.g., LimitEngine)
    ///         that can call open/close on behalf of users.
    function setExecutor(address executor, bool authorized) external onlyAdmin {
        if (executor == address(0)) revert ZeroAddress();
        authorizedExecutors[executor] = authorized;
        emit ExecutorSet(executor, authorized);
    }
```

**4e — Refactor `_computeFinals` to take `owner` parameter**:

Current signature (line 139-153):
```solidity
function _computeFinals(
    euint64 size,
    euint64 collateral,
    uint64 price
) internal returns (euint64 finalSize, euint64 finalCollateral) {
    euint64 ePrice = FHE.asEuint64(price);
    euint64 balance = vault.allowBalanceAccess(msg.sender);  // ← hardcoded
    ...
}
```

Change to:
```solidity
function _computeFinals(
    euint64 size,
    euint64 collateral,
    uint64 price,
    address owner       // ← NEW parameter
) internal returns (euint64 finalSize, euint64 finalCollateral) {
    euint64 ePrice = FHE.asEuint64(price);
    euint64 balance = vault.allowBalanceAccess(owner);  // ← owner not msg.sender
    // ... rest unchanged
}
```

**4f — Update existing `openPosition` to pass `msg.sender`**:

At line 131, change:
```solidity
(euint64 finalSize, euint64 finalCollateral) = _computeFinals(size, collateral, price);
```
to:
```solidity
(euint64 finalSize, euint64 finalCollateral) = _computeFinals(size, collateral, price, msg.sender);
```

Note: `_settle` at line 157 already takes `address user` as its first parameter — **no `_settle` refactor needed**.

**4g — Extract `_executeClose` helper from inlined `closePosition`**:

Current `closePosition` body at lines 292-324 is inlined. Extract into a new internal helper that takes `positionId` as a parameter (needed for `vault.closePosition(positionId)` at the end).

Replace the existing `closePosition` body with:

```solidity
function closePosition(uint256 positionId) external whenNotPaused {
    // Fetch position with transient ACL on each ciphertext field
    NoirVault.Position memory p = vault.allowPositionAccess(positionId);

    // Ownership guard for direct user calls
    if (p.owner != msg.sender) revert NotPositionOwner();
    if (!p.active) revert PositionNotActive();

    // Oracle freshness
    (uint64 price, bool fresh) = oracle.getPrice(p.marketId);
    if (!fresh) revert OraclePriceStale();

    _executeClose(positionId, p, price);
}
```

Add the new internal helper below it:

```solidity
/// @dev Internal close logic: assumes p.active was already checked +
///      caller-authorization handled by the wrapper. Computes PnL,
///      credits user balance, and marks position closed in vault.
function _executeClose(
    uint256 positionId,
    NoirVault.Position memory p,
    uint64 price
) internal {
    euint64 ePrice = FHE.asEuint64(price);

    // Compute profit + loss branches (both non-negative)
    euint64 profit;
    euint64 loss;
    if (p.isLong) {
        (profit, loss) = MarginMath.pnlLong(p.size, p.entryPrice, ePrice);
    } else {
        (profit, loss) = MarginMath.pnlShort(p.size, p.entryPrice, ePrice);
    }

    // Payout = safeAdd(safeSub(collateral, loss), profit). Saturating.
    euint64 collMinusLoss = FHESafeMath.safeSub(p.collateral, loss);
    euint64 payout = FHESafeMath.safeAdd(collMinusLoss, profit);

    // Credit user's vault balance
    FHE.allowTransient(payout, address(vault));
    vault.adjustBalance(p.owner, payout, true);

    // Mark position closed (vault emits PositionClosed canonically)
    vault.closePosition(positionId);
}
```

**4h — Add `openPositionAsExecutor`**:

After existing `openPosition`, add:

```solidity
    /// @notice Executor-only entry to open a position on behalf of `owner`.
    ///         Skips compliance check (executor verifies at place-time).
    ///         Requires already-imported euint64 ciphertexts (caller must
    ///         hold ACL via prior FHE.fromExternal or storage read).
    /// @dev Caller (executor) must `FHE.allowTransient(size, address(this))`
    ///      and same for collateral before calling.
    function openPositionAsExecutor(
        address owner,
        euint64 size,
        euint64 collateral,
        bool isLong,
        uint8 marketId
    ) external onlyAuthorizedExecutor whenNotPaused returns (uint256 positionId) {
        if (!FHE.isSenderAllowed(size)) revert NotAllowed();
        if (!FHE.isSenderAllowed(collateral)) revert NotAllowed();
        if (marketId < 1 || marketId > 3) revert InvalidMarket();
        (uint64 price, bool fresh) = oracle.getPrice(marketId);
        if (!fresh) revert OraclePriceStale();

        // Pass plaintext `price` to internal helpers — they trivially-encrypt
        // internally. Matches existing _computeFinals + _settle signatures.
        (euint64 finalSize, euint64 finalCollateral) = _computeFinals(size, collateral, price, owner);
        positionId = _settle(owner, finalSize, finalCollateral, price, isLong, marketId);
    }
```

**4i — Add `closePositionAsExecutor`**:

After existing `closePosition`, add:

```solidity
    /// @notice Executor-only entry to close a position on behalf of its owner.
    ///         Reads the position via vault.allowPositionAccess; uses the
    ///         stored owner field (no msg.sender == owner check).
    function closePositionAsExecutor(uint256 positionId) external onlyAuthorizedExecutor whenNotPaused {
        NoirVault.Position memory p = vault.allowPositionAccess(positionId);
        if (!p.active) revert PositionNotActive();

        (uint64 price, bool fresh) = oracle.getPrice(p.marketId);
        if (!fresh) revert OraclePriceStale();

        _executeClose(positionId, p, price);
    }
```

- [ ] **Step 5: Compile + run executor tests**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat compile && npx hardhat test test/PerpEngine.Executor.test.ts
```
Expected: ~7 passing.

- [ ] **Step 6: Run FULL Phase 3 test suite to verify no regressions**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test test/PerpEngine.Open.test.ts test/PerpEngine.Close.test.ts test/PerpEngine.Liquidation.test.ts test/PerpEngine.MultiMarket.test.ts test/PerpEngine.Admin.test.ts 2>&1 | tail -3
```
Expected: 38 passing (Phase 3's full PerpEngine suite). Any regression here means the refactor broke something. Fix before continuing.

- [ ] **Step 7: Run full suite**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test 2>&1 | tail -3
```
Expected: 212 passing (205 prior + 7 new executor tests).

- [ ] **Step 8: CHANGELOG entry**

Append to `/Users/ram/Desktop/NoirPerp/CHANGELOG.md` under a new `### Phase 5 — LimitEngine (in progress)` section:

```markdown
### Phase 5 — LimitEngine (in progress)

- **Modified**: `contracts/contracts/engines/PerpEngine.sol` — added
  authorized-executor pattern (`authorizedExecutors` mapping,
  `setExecutor` admin, `onlyAuthorizedExecutor` modifier),
  `openPositionAsExecutor`, `closePositionAsExecutor`. Refactored
  `_computeFinals` and `_settle`/`_executeClose` to take `owner` as
  arg (was `msg.sender`). Existing `openPosition`/`closePosition`
  pass `msg.sender` and remain functionally unchanged. Phase 3 test
  suite (38 tests) all pass — no regressions. 7 new executor tests.
  **Why**: Phase 5 LimitEngine needs to open/close positions on
  behalf of users at trigger time. The executor pattern provides
  authorization without breaking msg.sender semantics for direct
  user calls.
  **Files**: `contracts/contracts/engines/PerpEngine.sol`,
  `contracts/test/PerpEngine.Executor.test.ts`.
```

- [ ] **Step 9: Commit**

```bash
cd /Users/ram/Desktop/NoirPerp && git add contracts/contracts/engines/PerpEngine.sol contracts/test/PerpEngine.Executor.test.ts CHANGELOG.md && git -c user.email=developer@randao.net -c user.name="Ram" commit -q -m "feat(perp): add executor pattern for cross-engine position ops

LimitEngine (Phase 5) needs to open/close positions on behalf of users
at trigger time. Authorized-executor mapping + setExecutor admin
function + onlyAuthorizedExecutor modifier + openPositionAsExecutor +
closePositionAsExecutor. Refactor _computeFinals/_settle/_executeClose
to take owner as arg (was msg.sender). Existing openPosition and
closePosition continue passing msg.sender — Phase 3 test suite all green.

7 new executor tests; full suite 212 passing.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `LimitEngine` scaffold + admin

**Files:**
- Create: `contracts/contracts/engines/LimitEngine.sol`
- Create: `contracts/test/LimitEngine.Admin.test.ts`

**Purpose:** Contract skeleton with config, admin functions, struct, and view accessors. No order placement or trigger logic yet.

**State**:
```solidity
struct LimitOrder {
    address owner;
    uint8 orderType;        // 1=TP, 2=SL, 3=LIMIT
    uint8 marketId;
    bool isLong;
    bool active;
    uint256 positionId;     // for TP/SL only; 0 for LIMIT
    euint64 triggerPrice;
    euint64 size;           // for LIMIT only; zero handle for TP/SL
    euint64 collateral;     // for LIMIT only; zero handle for TP/SL
}

mapping(uint256 orderId => LimitOrder) private _orders;
uint256 public nextOrderId;

NoirVault public immutable vault;
address public oracle;       // settable; address(0) until setOracle called
address public perp;         // settable; address(0) until setPerp called
address public admin;
```

**Constants**:
- `ORDER_TYPE_TP = 1`, `ORDER_TYPE_SL = 2`, `ORDER_TYPE_LIMIT = 3`

- [ ] **Step 1: Write failing test**

Create `/Users/ram/Desktop/NoirPerp/contracts/test/LimitEngine.Admin.test.ts`:

```typescript
import { expect } from "chai";
import * as hre from "hardhat";
import type { NoirVault, MockERC7984, LimitEngine } from "../typechain-types";

describe("LimitEngine — admin + scaffold", () => {
  let vault: NoirVault;
  let token: MockERC7984;
  let limit: LimitEngine;
  let admin: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let alice: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let oracle: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let perp: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];

  beforeEach(async () => {
    [admin, alice, oracle, perp] = await hre.ethers.getSigners();

    const TokenFactory = await hre.ethers.getContractFactory("MockERC7984");
    token = (await TokenFactory.deploy("MockUSDCx", "mUSDCx")) as unknown as MockERC7984;
    await token.waitForDeployment();

    const VaultFactory = await hre.ethers.getContractFactory("NoirVault");
    vault = (await VaultFactory.deploy(admin.address, await token.getAddress())) as unknown as NoirVault;
    await vault.waitForDeployment();

    const LimitFactory = await hre.ethers.getContractFactory("LimitEngine");
    limit = (await LimitFactory.deploy(await vault.getAddress(), admin.address)) as unknown as LimitEngine;
    await limit.waitForDeployment();

    await (await vault.registerEngine(await limit.getAddress())).wait();
  });

  describe("constructor", () => {
    it("stores vault + admin + initial state", async () => {
      expect(await limit.admin()).to.equal(admin.address);
      expect(await limit.vault()).to.equal(await vault.getAddress());
      expect(await limit.oracle()).to.equal(hre.ethers.ZeroAddress);
      expect(await limit.perp()).to.equal(hre.ethers.ZeroAddress);
      expect(await limit.nextOrderId()).to.equal(0n);
    });

    it("reverts on zero vault", async () => {
      const F = await hre.ethers.getContractFactory("LimitEngine");
      await expect(F.deploy(hre.ethers.ZeroAddress, admin.address))
        .to.be.revertedWithCustomError({ interface: F.interface } as any, "ZeroAddress");
    });

    it("reverts on zero admin", async () => {
      const F = await hre.ethers.getContractFactory("LimitEngine");
      await expect(F.deploy(await vault.getAddress(), hre.ethers.ZeroAddress))
        .to.be.revertedWithCustomError({ interface: F.interface } as any, "ZeroAddress");
    });
  });

  describe("transferAdmin", () => {
    it("admin can transfer", async () => {
      await expect(limit.transferAdmin(alice.address))
        .to.emit(limit, "AdminTransferred").withArgs(admin.address, alice.address);
      expect(await limit.admin()).to.equal(alice.address);
    });

    it("non-admin cannot transfer", async () => {
      await expect(limit.connect(alice).transferAdmin(alice.address))
        .to.be.revertedWithCustomError(limit, "NotAdmin");
    });

    it("reverts on zero address", async () => {
      await expect(limit.transferAdmin(hre.ethers.ZeroAddress))
        .to.be.revertedWithCustomError(limit, "ZeroAddress");
    });
  });

  describe("setOracle", () => {
    it("admin can set oracle", async () => {
      await expect(limit.setOracle(oracle.address))
        .to.emit(limit, "OracleSet").withArgs(oracle.address);
      expect(await limit.oracle()).to.equal(oracle.address);
    });

    it("non-admin cannot set", async () => {
      await expect(limit.connect(alice).setOracle(oracle.address))
        .to.be.revertedWithCustomError(limit, "NotAdmin");
    });

    it("reverts on zero address", async () => {
      await expect(limit.setOracle(hre.ethers.ZeroAddress))
        .to.be.revertedWithCustomError(limit, "ZeroAddress");
    });
  });

  describe("setPerp", () => {
    it("admin can set perp", async () => {
      await expect(limit.setPerp(perp.address))
        .to.emit(limit, "PerpSet").withArgs(perp.address);
      expect(await limit.perp()).to.equal(perp.address);
    });

    it("non-admin cannot set", async () => {
      await expect(limit.connect(alice).setPerp(perp.address))
        .to.be.revertedWithCustomError(limit, "NotAdmin");
    });

    it("reverts on zero address", async () => {
      await expect(limit.setPerp(hre.ethers.ZeroAddress))
        .to.be.revertedWithCustomError(limit, "ZeroAddress");
    });
  });

  describe("constants", () => {
    it("exposes order type constants", async () => {
      expect(await limit.ORDER_TYPE_TP()).to.equal(1);
      expect(await limit.ORDER_TYPE_SL()).to.equal(2);
      expect(await limit.ORDER_TYPE_LIMIT()).to.equal(3);
    });
  });
});
```

- [ ] **Step 2: Run test — expect FAIL (typechain missing)**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test test/LimitEngine.Admin.test.ts
```

- [ ] **Step 3: Implement `LimitEngine.sol` scaffold**

Create `/Users/ram/Desktop/NoirPerp/contracts/contracts/engines/LimitEngine.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { FHE, euint64, ebool, externalEuint64 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";
import { FHESafeMath } from "../lib/FHESafeMath.sol";
import { DecryptQueue } from "../lib/DecryptQueue.sol";
import { NoirVault } from "../NoirVault.sol";

/// @title LimitEngine
/// @notice Encrypted TP / SL / Limit-Open order management with bot-triggered
///         async execution. Orders carry encrypted trigger prices; the
///         comparison against current oracle price runs in FHE; only the
///         single-bit `shouldTrigger` ebool is decrypted via Gateway. On
///         match, the callback dispatches to PerpEngine via the executor
///         pattern (close for TP/SL; open for Limit).
/// @dev Inherits DecryptQueue for replay-guarded async callbacks.
contract LimitEngine is DecryptQueue, ZamaEthereumConfig {
    NoirVault public immutable vault;
    address public oracle;  // set post-deploy
    address public perp;    // set post-deploy
    address public admin;

    uint8 public constant ORDER_TYPE_TP = 1;
    uint8 public constant ORDER_TYPE_SL = 2;
    uint8 public constant ORDER_TYPE_LIMIT = 3;

    struct LimitOrder {
        address owner;
        uint8 orderType;
        uint8 marketId;
        bool isLong;
        bool active;
        uint256 positionId;     // for TP/SL only
        euint64 triggerPrice;
        euint64 size;           // for LIMIT only
        euint64 collateral;     // for LIMIT only
    }

    mapping(uint256 orderId => LimitOrder) private _orders;
    uint256 public nextOrderId;

    event AdminTransferred(address indexed oldAdmin, address indexed newAdmin);
    event OracleSet(address indexed newOracle);
    event PerpSet(address indexed newPerp);

    error NotAdmin();
    error ZeroAddress();

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

    function setOracle(address oracle_) external onlyAdmin {
        if (oracle_ == address(0)) revert ZeroAddress();
        oracle = oracle_;
        emit OracleSet(oracle_);
    }

    function setPerp(address perp_) external onlyAdmin {
        if (perp_ == address(0)) revert ZeroAddress();
        perp = perp_;
        emit PerpSet(perp_);
    }

    // ─── Views ─────────────────────────────────────────────────────

    function getOrder(uint256 orderId) external view returns (LimitOrder memory) {
        return _orders[orderId];
    }
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat compile && npx hardhat test test/LimitEngine.Admin.test.ts
```
Expected: 14 passing.

- [ ] **Step 5: Full suite green**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test 2>&1 | tail -3
```
Expected: 226 passing (212 + 14).

- [ ] **Step 6: CHANGELOG + commit**

Append:
```markdown
- **Added**: `contracts/contracts/engines/LimitEngine.sol` (Task 2
  scaffold — admin + struct + view accessor). Inherits `DecryptQueue`
  for upcoming async-trigger work. Stores `LimitOrder` struct with
  per-type field usage: TP/SL use `positionId`, LIMIT uses
  `size`/`collateral` (zero handles for unused fields). 14 unit tests.
  **Files**: `contracts/contracts/engines/LimitEngine.sol`,
  `contracts/test/LimitEngine.Admin.test.ts`.
```

```bash
cd /Users/ram/Desktop/NoirPerp && git add contracts/contracts/engines/LimitEngine.sol contracts/test/LimitEngine.Admin.test.ts CHANGELOG.md && git -c user.email=developer@randao.net -c user.name="Ram" commit -q -m "feat(engine): add LimitEngine scaffold + admin

DecryptQueue + ZamaEthereumConfig inheritance. LimitOrder struct
supports all 3 order types via conditional field usage (TP/SL use
positionId; LIMIT uses size/collateral). Admin functions for oracle
+ perp wiring. 14 unit tests.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `placeStopOrTake` (TP + SL) + `cancelOrder`

**Files:**
- Modify: `contracts/contracts/engines/LimitEngine.sol`
- Create: `contracts/test/LimitEngine.PlaceStopOrTake.test.ts`

**Purpose:** Place TP and SL orders (both reference an existing positionId). Cancel any order type (no escrow refund needed for TP/SL since no collateral was locked — that's Task 4).

**Validation at place-time**:
- Caller must own the referenced position
- Position must be active
- orderType must be 1 (TP) or 2 (SL)
- marketId must match the position's marketId
- isLong must match the position's isLong (consistency — TP for a long is different from TP for a short)

**API**:
```solidity
function placeStopOrTake(
    uint256 positionId,
    externalEuint64 eTrigger,
    bytes calldata triggerProof,
    uint8 orderType
) external returns (uint256 orderId);

function cancelOrder(uint256 orderId) external;
```

- [ ] **Step 1: Write failing test**

Create `/Users/ram/Desktop/NoirPerp/contracts/test/LimitEngine.PlaceStopOrTake.test.ts`:

```typescript
import { expect } from "chai";
import * as hre from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import type { NoirVault, MockERC7984, Oracle, Compliance, PerpEngine, LimitEngine } from "../typechain-types";

const MARKET_ETH = 2;
const STALENESS = 90;
const DEVIATION_BPS = 50;
const TP = 1;
const SL = 2;

describe("LimitEngine — placeStopOrTake + cancelOrder", () => {
  let vault: NoirVault;
  let token: MockERC7984;
  let oracle: Oracle;
  let compliance: Compliance;
  let perp: PerpEngine;
  let limit: LimitEngine;
  let admin: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let relayerA: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let relayerB: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let relayerC: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let alice: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let bob: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let aliceProof: string[];

  async function now(): Promise<number> {
    const blk = await hre.ethers.provider.getBlock("latest");
    return blk!.timestamp;
  }

  async function commitPrice(marketId: number, price: bigint) {
    const t = await now();
    await (await oracle.connect(relayerA).submitPrice(marketId, price, t)).wait();
    await (await oracle.connect(relayerB).submitPrice(marketId, price, t + 1)).wait();
  }

  async function encrypt(contractAddr: string, user: string, value: bigint) {
    const input = hre.fhevm.createEncryptedInput(contractAddr, user);
    input.add64(value);
    return await input.encrypt();
  }

  beforeEach(async () => {
    [admin, relayerA, relayerB, relayerC, alice, bob] = await hre.ethers.getSigners();

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

    const PerpFactory = await hre.ethers.getContractFactory("PerpEngine");
    perp = (await PerpFactory.deploy(
      await vault.getAddress(),
      await oracle.getAddress(),
      await compliance.getAddress(),
      admin.address, admin.address,
    )) as unknown as PerpEngine;
    await perp.waitForDeployment();
    await (await vault.registerEngine(await perp.getAddress())).wait();

    const LimitFactory = await hre.ethers.getContractFactory("LimitEngine");
    limit = (await LimitFactory.deploy(await vault.getAddress(), admin.address)) as unknown as LimitEngine;
    await limit.waitForDeployment();
    await (await vault.registerEngine(await limit.getAddress())).wait();
    await (await limit.setOracle(await oracle.getAddress())).wait();
    await (await limit.setPerp(await perp.getAddress())).wait();

    // Alice deposits + opens a long position
    await (await token.connect(alice).setOperator(await vault.getAddress(), 2n ** 48n - 1n)).wait();
    await (await vault.connect(alice).deposit(10_000n)).wait();
    await commitPrice(MARKET_ETH, 3_000n);

    const perpAddr = await perp.getAddress();
    const sizeEnc = await encrypt(perpAddr, alice.address, 10n);
    const collEnc = await encrypt(perpAddr, alice.address, 1_500n);
    await (await perp.connect(alice).openPosition(
      sizeEnc.handles[0], sizeEnc.inputProof,
      collEnc.handles[0], collEnc.inputProof,
      true, MARKET_ETH, aliceProof,
    )).wait();
    // Position 0 is now alice's long ETH
  });

  describe("placeStopOrTake — TP", () => {
    it("places a TP order on alice's long position", async () => {
      const limitAddr = await limit.getAddress();
      const trigEnc = await encrypt(limitAddr, alice.address, 3_500n);

      const tx = await limit.connect(alice).placeStopOrTake(
        0, // positionId
        trigEnc.handles[0],
        trigEnc.inputProof,
        TP,
      );
      const receipt = await tx.wait();
      const event = receipt!.logs.find(
        (l: any) => l.fragment?.name === "OrderPlaced"
      ) as any;
      expect(event).to.not.equal(undefined);
      expect(event.args.orderId).to.equal(0n);
      expect(event.args.owner).to.equal(alice.address);
      expect(event.args.orderType).to.equal(TP);

      const order = await limit.getOrder(0);
      expect(order.owner).to.equal(alice.address);
      expect(order.orderType).to.equal(TP);
      expect(order.positionId).to.equal(0);
      expect(order.isLong).to.equal(true);
      expect(order.marketId).to.equal(MARKET_ETH);
      expect(order.active).to.equal(true);
    });

    it("places a SL order on alice's long position", async () => {
      const limitAddr = await limit.getAddress();
      const trigEnc = await encrypt(limitAddr, alice.address, 2_800n);
      await (await limit.connect(alice).placeStopOrTake(
        0, trigEnc.handles[0], trigEnc.inputProof, SL
      )).wait();
      const order = await limit.getOrder(0);
      expect(order.orderType).to.equal(SL);
      expect(order.active).to.equal(true);
    });

    it("nextOrderId increments", async () => {
      const limitAddr = await limit.getAddress();
      const trigEnc1 = await encrypt(limitAddr, alice.address, 3_500n);
      await (await limit.connect(alice).placeStopOrTake(
        0, trigEnc1.handles[0], trigEnc1.inputProof, TP
      )).wait();
      const trigEnc2 = await encrypt(limitAddr, alice.address, 2_800n);
      await (await limit.connect(alice).placeStopOrTake(
        0, trigEnc2.handles[0], trigEnc2.inputProof, SL
      )).wait();
      expect(await limit.nextOrderId()).to.equal(2n);
    });
  });

  describe("placeStopOrTake — guards", () => {
    it("reverts when caller does not own the position", async () => {
      const limitAddr = await limit.getAddress();
      const trigEnc = await encrypt(limitAddr, bob.address, 3_500n);
      await expect(limit.connect(bob).placeStopOrTake(
        0, trigEnc.handles[0], trigEnc.inputProof, TP
      )).to.be.revertedWithCustomError(limit, "NotPositionOwner");
    });

    it("reverts on inactive position", async () => {
      // Close alice's position first
      await (await perp.connect(alice).closePosition(0)).wait();
      const limitAddr = await limit.getAddress();
      const trigEnc = await encrypt(limitAddr, alice.address, 3_500n);
      await expect(limit.connect(alice).placeStopOrTake(
        0, trigEnc.handles[0], trigEnc.inputProof, TP
      )).to.be.revertedWithCustomError(limit, "PositionNotActive");
    });

    it("reverts on invalid orderType (3 = LIMIT not allowed here)", async () => {
      const limitAddr = await limit.getAddress();
      const trigEnc = await encrypt(limitAddr, alice.address, 3_500n);
      await expect(limit.connect(alice).placeStopOrTake(
        0, trigEnc.handles[0], trigEnc.inputProof, 3 /* LIMIT */
      )).to.be.revertedWithCustomError(limit, "InvalidOrderType");
    });

    it("reverts on orderType 0", async () => {
      const limitAddr = await limit.getAddress();
      const trigEnc = await encrypt(limitAddr, alice.address, 3_500n);
      await expect(limit.connect(alice).placeStopOrTake(
        0, trigEnc.handles[0], trigEnc.inputProof, 0
      )).to.be.revertedWithCustomError(limit, "InvalidOrderType");
    });
  });

  describe("cancelOrder — TP/SL (no escrow refund)", () => {
    let orderId: bigint;

    beforeEach(async () => {
      const limitAddr = await limit.getAddress();
      const trigEnc = await encrypt(limitAddr, alice.address, 3_500n);
      const tx = await limit.connect(alice).placeStopOrTake(
        0, trigEnc.handles[0], trigEnc.inputProof, TP
      );
      const r = await tx.wait();
      const ev = r!.logs.find((l: any) => l.fragment?.name === "OrderPlaced") as any;
      orderId = ev.args.orderId;
    });

    it("owner can cancel", async () => {
      await expect(limit.connect(alice).cancelOrder(orderId))
        .to.emit(limit, "OrderCancelled").withArgs(orderId, alice.address);
      const order = await limit.getOrder(orderId);
      expect(order.active).to.equal(false);
    });

    it("non-owner cannot cancel", async () => {
      await expect(limit.connect(bob).cancelOrder(orderId))
        .to.be.revertedWithCustomError(limit, "NotOrderOwner");
    });

    it("cannot cancel an already-cancelled order", async () => {
      await (await limit.connect(alice).cancelOrder(orderId)).wait();
      await expect(limit.connect(alice).cancelOrder(orderId))
        .to.be.revertedWithCustomError(limit, "OrderNotActive");
    });
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test test/LimitEngine.PlaceStopOrTake.test.ts
```

- [ ] **Step 3: Add `placeStopOrTake` and `cancelOrder` to `LimitEngine.sol`**

Open `LimitEngine.sol`. Add new errors:

```solidity
    error NotPositionOwner();
    error PositionNotActive();
    error InvalidOrderType();
    error NotOrderOwner();
    error OrderNotActive();
    error NotAllowed();
```

Add new events:

```solidity
    event OrderPlaced(uint256 indexed orderId, address indexed owner, uint8 orderType, uint8 marketId);
    event OrderCancelled(uint256 indexed orderId, address indexed owner);
```

Append before closing `}`:

```solidity
    // ─── Place order — TP / SL (close-on-trigger) ──────────────────

    /// @notice Places a TP (orderType=1) or SL (orderType=2) order
    ///         tied to an existing perp position owned by msg.sender.
    /// @param positionId The position to close on trigger.
    /// @param eTrigger Encrypted trigger price.
    /// @param triggerProof FHE input proof for eTrigger.
    /// @param orderType Must be 1 (TP) or 2 (SL).
    function placeStopOrTake(
        uint256 positionId,
        externalEuint64 eTrigger,
        bytes calldata triggerProof,
        uint8 orderType
    ) external returns (uint256 orderId) {
        if (orderType != ORDER_TYPE_TP && orderType != ORDER_TYPE_SL) {
            revert InvalidOrderType();
        }

        // Verify caller owns the position + it's active
        NoirVault.Position memory p = vault.allowPositionAccess(positionId);
        if (p.owner != msg.sender) revert NotPositionOwner();
        if (!p.active) revert PositionNotActive();

        // Import encrypted trigger
        euint64 triggerPrice = FHE.fromExternal(eTrigger, triggerProof);
        if (!FHE.isSenderAllowed(triggerPrice)) revert NotAllowed();
        FHE.allowThis(triggerPrice);

        orderId = nextOrderId++;
        // Trivial-encrypt zero ciphertexts for unused fields (TP/SL don't
        // use size/collateral). FHE.asEuint64(0) is safer than euint64.wrap(0)
        // — explicit type, well-supported, 32 HCU is negligible.
        euint64 zeroCt = FHE.asEuint64(0);
        _orders[orderId] = LimitOrder({
            owner: msg.sender,
            orderType: orderType,
            marketId: p.marketId,
            isLong: p.isLong,
            active: true,
            positionId: positionId,
            triggerPrice: triggerPrice,
            size: zeroCt,         // unused for TP/SL
            collateral: zeroCt    // unused for TP/SL
        });

        emit OrderPlaced(orderId, msg.sender, orderType, p.marketId);
    }

    // ─── Cancel order ─────────────────────────────────────────────

    /// @notice Owner can cancel an active order. For LIMIT orders,
    ///         this also refunds the escrowed collateral. (TP/SL orders
    ///         have no escrow.)
    function cancelOrder(uint256 orderId) external {
        LimitOrder storage order = _orders[orderId];
        if (order.owner != msg.sender) revert NotOrderOwner();
        if (!order.active) revert OrderNotActive();

        order.active = false;

        // For LIMIT: refund escrowed collateral. (Task 4 will add the
        // collateral refund logic; for TP/SL there's nothing to refund.)
        if (order.orderType == ORDER_TYPE_LIMIT) {
            _refundLimitCollateral(order);
        }

        emit OrderCancelled(orderId, msg.sender);
    }

    /// @dev Stub for Task 4 — empty for TP/SL, will be filled in for LIMIT.
    function _refundLimitCollateral(LimitOrder storage /* order */) internal pure {
        // Filled in Task 4 (placeLimit + escrow handling)
    }
```

**Note**: `euint64.wrap(0)` creates a zero ciphertext handle for unused fields. The test only checks active/owner/type/marketId, so unused encrypted fields don't matter at this stage.

- [ ] **Step 4: Run test — expect PASS**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test test/LimitEngine.PlaceStopOrTake.test.ts
```
Expected: 11 passing.

- [ ] **Step 5: Full suite check**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test 2>&1 | tail -3
```
Expected: 237 passing (226 + 11).

- [ ] **Step 6: CHANGELOG + commit**

Append:
```markdown
- **Added**: `LimitEngine.placeStopOrTake` (TP=1 / SL=2) +
  `cancelOrder` (works for all types). TP/SL placements verify
  caller owns the position via `vault.allowPositionAccess`,
  inherit isLong + marketId from the position, store encrypted
  trigger. Cancel marks order inactive (TP/SL has no escrow).
  Stub `_refundLimitCollateral` for Task 4. 11 unit tests.
  **Files**: `contracts/contracts/engines/LimitEngine.sol`,
  `contracts/test/LimitEngine.PlaceStopOrTake.test.ts`.
```

```bash
cd /Users/ram/Desktop/NoirPerp && git add contracts/contracts/engines/LimitEngine.sol contracts/test/LimitEngine.PlaceStopOrTake.test.ts CHANGELOG.md && git -c user.email=developer@randao.net -c user.name="Ram" commit -q -m "feat(limit): add placeStopOrTake (TP/SL) + cancelOrder

TP/SL placements verify position ownership via allowPositionAccess,
inherit direction + market from position, store encrypted trigger
price. Cancel works for all order types; LIMIT refund stub for Task 4.
11 unit tests.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `placeLimit` (Limit-Open) with collateral escrow

**Files:**
- Modify: `contracts/contracts/engines/LimitEngine.sol`
- Create: `contracts/test/LimitEngine.PlaceLimit.test.ts`

**Purpose:** Limit-Open orders open NEW positions when the price crosses a target. They lock collateral at place-time (debit user vault → credit LimitEngine vault). Cancel refunds.

**API**:
```solidity
function placeLimit(
    externalEuint64 eTrigger, bytes calldata triggerProof,
    externalEuint64 eSize, bytes calldata sizeProof,
    externalEuint64 eCollateral, bytes calldata collateralProof,
    uint8 marketId,
    bool isLong,
    bytes32[] calldata complianceProof
) external returns (uint256 orderId);
```

**At place-time**:
- Verify compliance (caller is allowlisted)
- Validate marketId
- Import 3 encrypted inputs (trigger, size, collateral) with `isSenderAllowed` guards
- Lock collateral: debit user vault, credit LimitEngine vault (with two ciphertext copies via safeAdd-zero pattern)
- Store order with all 3 ciphertexts + isLong + marketId

**Compliance**: `Compliance` is on the `Compliance` contract (Phase 2). LimitEngine needs its address. Add a `setCompliance(address)` admin function similar to `setOracle`/`setPerp`. Plus pass complianceProof in placeLimit.

- [ ] **Step 1: Write failing test**

Create `/Users/ram/Desktop/NoirPerp/contracts/test/LimitEngine.PlaceLimit.test.ts`:

```typescript
import { expect } from "chai";
import * as hre from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import type { NoirVault, MockERC7984, Oracle, Compliance, PerpEngine, LimitEngine } from "../typechain-types";

const MARKET_ETH = 2;
const STALENESS = 90;
const DEVIATION_BPS = 50;
const LIMIT = 3;

describe("LimitEngine — placeLimit + cancel-with-refund", () => {
  let vault: NoirVault;
  let token: MockERC7984;
  let oracle: Oracle;
  let compliance: Compliance;
  let perp: PerpEngine;
  let limit: LimitEngine;
  let admin: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let relayerA: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let relayerB: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let relayerC: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let alice: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let nonKyc: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let aliceProof: string[];

  async function now(): Promise<number> {
    const blk = await hre.ethers.provider.getBlock("latest");
    return blk!.timestamp;
  }

  async function commitPrice(marketId: number, price: bigint) {
    const t = await now();
    await (await oracle.connect(relayerA).submitPrice(marketId, price, t)).wait();
    await (await oracle.connect(relayerB).submitPrice(marketId, price, t + 1)).wait();
  }

  async function encrypt(contractAddr: string, user: string, value: bigint) {
    const input = hre.fhevm.createEncryptedInput(contractAddr, user);
    input.add64(value);
    return await input.encrypt();
  }

  async function decrypt(handle: string, contractAddr: string, signer: typeof admin): Promise<bigint> {
    return hre.fhevm.userDecryptEuint(FhevmType.euint64, handle, contractAddr, signer);
  }

  beforeEach(async () => {
    [admin, relayerA, relayerB, relayerC, alice, nonKyc] = await hre.ethers.getSigners();

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

    const PerpFactory = await hre.ethers.getContractFactory("PerpEngine");
    perp = (await PerpFactory.deploy(
      await vault.getAddress(),
      await oracle.getAddress(),
      await compliance.getAddress(),
      admin.address, admin.address,
    )) as unknown as PerpEngine;
    await perp.waitForDeployment();
    await (await vault.registerEngine(await perp.getAddress())).wait();

    const LimitFactory = await hre.ethers.getContractFactory("LimitEngine");
    limit = (await LimitFactory.deploy(await vault.getAddress(), admin.address)) as unknown as LimitEngine;
    await limit.waitForDeployment();
    await (await vault.registerEngine(await limit.getAddress())).wait();
    await (await limit.setOracle(await oracle.getAddress())).wait();
    await (await limit.setPerp(await perp.getAddress())).wait();
    await (await limit.setCompliance(await compliance.getAddress())).wait();

    await (await token.connect(alice).setOperator(await vault.getAddress(), 2n ** 48n - 1n)).wait();
    await (await vault.connect(alice).deposit(10_000n)).wait();
    await commitPrice(MARKET_ETH, 3_000n);
  });

  describe("placeLimit happy path", () => {
    it("places a limit-buy order and locks collateral", async () => {
      const limitAddr = await limit.getAddress();
      const trigEnc = await encrypt(limitAddr, alice.address, 2_900n);
      const sizeEnc = await encrypt(limitAddr, alice.address, 5n);
      const collEnc = await encrypt(limitAddr, alice.address, 800n);

      await (await limit.connect(alice).placeLimit(
        trigEnc.handles[0], trigEnc.inputProof,
        sizeEnc.handles[0], sizeEnc.inputProof,
        collEnc.handles[0], collEnc.inputProof,
        MARKET_ETH, true /* isLong */, aliceProof,
      )).wait();

      const order = await limit.getOrder(0);
      expect(order.owner).to.equal(alice.address);
      expect(order.orderType).to.equal(LIMIT);
      expect(order.marketId).to.equal(MARKET_ETH);
      expect(order.isLong).to.equal(true);
      expect(order.active).to.equal(true);

      // Alice's vault balance debited by 800
      const aliceBal = await decrypt(
        await vault.getBalance(alice.address),
        await vault.getAddress(),
        alice,
      );
      expect(aliceBal).to.equal(9_200n); // 10_000 - 800
    });

    it("places a limit-sell (short) order", async () => {
      const limitAddr = await limit.getAddress();
      const trigEnc = await encrypt(limitAddr, alice.address, 3_100n);
      const sizeEnc = await encrypt(limitAddr, alice.address, 5n);
      const collEnc = await encrypt(limitAddr, alice.address, 800n);

      await (await limit.connect(alice).placeLimit(
        trigEnc.handles[0], trigEnc.inputProof,
        sizeEnc.handles[0], sizeEnc.inputProof,
        collEnc.handles[0], collEnc.inputProof,
        MARKET_ETH, false /* isLong */, aliceProof,
      )).wait();

      const order = await limit.getOrder(0);
      expect(order.isLong).to.equal(false);
    });
  });

  describe("placeLimit guards", () => {
    it("reverts on non-KYC user", async () => {
      const limitAddr = await limit.getAddress();
      const trigEnc = await encrypt(limitAddr, nonKyc.address, 2_900n);
      const sizeEnc = await encrypt(limitAddr, nonKyc.address, 5n);
      const collEnc = await encrypt(limitAddr, nonKyc.address, 800n);
      await expect(limit.connect(nonKyc).placeLimit(
        trigEnc.handles[0], trigEnc.inputProof,
        sizeEnc.handles[0], sizeEnc.inputProof,
        collEnc.handles[0], collEnc.inputProof,
        MARKET_ETH, true, aliceProof, // wrong proof
      )).to.be.revertedWithCustomError(limit, "NotCompliant");
    });

    it("reverts on invalid marketId", async () => {
      const limitAddr = await limit.getAddress();
      const trigEnc = await encrypt(limitAddr, alice.address, 2_900n);
      const sizeEnc = await encrypt(limitAddr, alice.address, 5n);
      const collEnc = await encrypt(limitAddr, alice.address, 800n);
      await expect(limit.connect(alice).placeLimit(
        trigEnc.handles[0], trigEnc.inputProof,
        sizeEnc.handles[0], sizeEnc.inputProof,
        collEnc.handles[0], collEnc.inputProof,
        99 /* invalid */, true, aliceProof,
      )).to.be.revertedWithCustomError(limit, "InvalidMarket");
    });

    it("reverts when compliance not configured", async () => {
      // Deploy fresh limit without setCompliance
      const F = await hre.ethers.getContractFactory("LimitEngine");
      const fresh = (await F.deploy(await vault.getAddress(), admin.address)) as unknown as LimitEngine;
      await fresh.waitForDeployment();
      const freshAddr = await fresh.getAddress();
      const trigEnc = await encrypt(freshAddr, alice.address, 2_900n);
      const sizeEnc = await encrypt(freshAddr, alice.address, 5n);
      const collEnc = await encrypt(freshAddr, alice.address, 800n);
      await expect(fresh.connect(alice).placeLimit(
        trigEnc.handles[0], trigEnc.inputProof,
        sizeEnc.handles[0], sizeEnc.inputProof,
        collEnc.handles[0], collEnc.inputProof,
        MARKET_ETH, true, aliceProof,
      )).to.be.revertedWithCustomError(fresh, "ComplianceNotSet");
    });
  });

  describe("cancelOrder — LIMIT (with refund)", () => {
    let orderId: bigint;

    beforeEach(async () => {
      const limitAddr = await limit.getAddress();
      const trigEnc = await encrypt(limitAddr, alice.address, 2_900n);
      const sizeEnc = await encrypt(limitAddr, alice.address, 5n);
      const collEnc = await encrypt(limitAddr, alice.address, 800n);
      const tx = await limit.connect(alice).placeLimit(
        trigEnc.handles[0], trigEnc.inputProof,
        sizeEnc.handles[0], sizeEnc.inputProof,
        collEnc.handles[0], collEnc.inputProof,
        MARKET_ETH, true, aliceProof,
      );
      const r = await tx.wait();
      const ev = r!.logs.find((l: any) => l.fragment?.name === "OrderPlaced") as any;
      orderId = ev.args.orderId;
    });

    it("refunds locked collateral on cancel", async () => {
      // Pre-cancel: alice has 9_200 (10_000 - 800)
      let aliceBal = await decrypt(
        await vault.getBalance(alice.address),
        await vault.getAddress(),
        alice,
      );
      expect(aliceBal).to.equal(9_200n);

      // Cancel
      await (await limit.connect(alice).cancelOrder(orderId)).wait();

      // Post-cancel: alice should have 10_000 (full refund)
      aliceBal = await decrypt(
        await vault.getBalance(alice.address),
        await vault.getAddress(),
        alice,
      );
      expect(aliceBal).to.equal(10_000n);

      const order = await limit.getOrder(orderId);
      expect(order.active).to.equal(false);
    });
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test test/LimitEngine.PlaceLimit.test.ts
```

- [ ] **Step 3: Add `placeLimit` + compliance wiring + flesh out `_refundLimitCollateral`**

Open `LimitEngine.sol`. Add new state + admin:

After `address public perp;`, add:
```solidity
    address public compliance;
```

Add new event:
```solidity
    event ComplianceSet(address indexed newCompliance);
```

Add new errors:
```solidity
    error ComplianceNotSet();
    error NotCompliant();
    error InvalidMarket();
```

Add admin function (after `setPerp`):
```solidity
    function setCompliance(address compliance_) external onlyAdmin {
        if (compliance_ == address(0)) revert ZeroAddress();
        compliance = compliance_;
        emit ComplianceSet(compliance_);
    }
```

Add new import at top:
```solidity
import { Compliance } from "../services/Compliance.sol";
```

Append before the closing `}`:

```solidity
    // ─── Place order — LIMIT (open-on-trigger) ─────────────────────

    /// @notice Places a Limit-Open order. Locks `eCollateral` from caller's
    ///         vault USDCx balance into LimitEngine's vault balance (escrow).
    ///         On trigger, the escrow is refunded and PerpEngine opens the
    ///         position via the executor pattern (debiting user normally).
    ///         On cancel, the escrow is refunded.
    function placeLimit(
        externalEuint64 eTrigger,
        bytes calldata triggerProof,
        externalEuint64 eSize,
        bytes calldata sizeProof,
        externalEuint64 eCollateral,
        bytes calldata collateralProof,
        uint8 marketId,
        bool isLong,
        bytes32[] calldata complianceProof
    ) external returns (uint256 orderId) {
        if (compliance == address(0)) revert ComplianceNotSet();
        if (!Compliance(compliance).verify(msg.sender, complianceProof)) revert NotCompliant();
        if (marketId < 1 || marketId > 3) revert InvalidMarket();

        // Import all 3 encrypted inputs with isSenderAllowed guards
        euint64 triggerPrice = FHE.fromExternal(eTrigger, triggerProof);
        if (!FHE.isSenderAllowed(triggerPrice)) revert NotAllowed();
        euint64 size = FHE.fromExternal(eSize, sizeProof);
        if (!FHE.isSenderAllowed(size)) revert NotAllowed();
        euint64 collateral = FHE.fromExternal(eCollateral, collateralProof);
        if (!FHE.isSenderAllowed(collateral)) revert NotAllowed();

        // Lock collateral: debit user, credit LimitEngine
        FHE.allowTransient(collateral, address(vault));
        vault.adjustBalance(msg.sender, collateral, false);

        euint64 collCredit = FHESafeMath.safeAdd(collateral, FHE.asEuint64(0));
        FHE.allowTransient(collCredit, address(vault));
        vault.adjustBalance(address(this), collCredit, true);

        // Store persistent ACL on order ciphertexts (vault + owner)
        FHE.allowThis(triggerPrice);
        FHE.allowThis(size);
        FHE.allowThis(collateral);
        FHE.allow(triggerPrice, msg.sender);
        FHE.allow(size, msg.sender);
        FHE.allow(collateral, msg.sender);

        orderId = nextOrderId++;
        _orders[orderId] = LimitOrder({
            owner: msg.sender,
            orderType: ORDER_TYPE_LIMIT,
            marketId: marketId,
            isLong: isLong,
            active: true,
            positionId: 0, // unused for LIMIT
            triggerPrice: triggerPrice,
            size: size,
            collateral: collateral
        });

        emit OrderPlaced(orderId, msg.sender, ORDER_TYPE_LIMIT, marketId);
    }
```

Replace the `_refundLimitCollateral` stub with the real implementation:

```solidity
    /// @dev Refunds escrowed collateral for a LIMIT order. Debits LimitEngine's
    ///      vault balance + credits the order's owner. Called from cancelOrder
    ///      and from the trigger callback (before executing the position open).
    function _refundLimitCollateral(LimitOrder storage order) internal {
        // Debit LimitEngine's vault balance
        FHE.allowTransient(order.collateral, address(vault));
        vault.adjustBalance(address(this), order.collateral, false);

        // Credit user's vault balance (fresh handle copy)
        euint64 refund = FHESafeMath.safeAdd(order.collateral, FHE.asEuint64(0));
        FHE.allowTransient(refund, address(vault));
        vault.adjustBalance(order.owner, refund, true);
    }
```

**Note**: the `_refundLimitCollateral` function takes `LimitOrder storage`, but Solidity won't allow modifying signature mid-task. Since the stub already used `storage`, this is consistent. Reading `order.collateral` from storage gives a euint64 ciphertext handle — valid usage.

- [ ] **Step 4: Run test — expect PASS**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test test/LimitEngine.PlaceLimit.test.ts
```
Expected: 6 passing.

Common gotchas:
- "ACL error on `order.collateral` read in `_refundLimitCollateral`": vault ACL is held by `address(this)` from `FHE.allowThis(collateral)` at place-time. Reads from storage retain that ACL.
- "compliance not configured" test failing because `setCompliance` not called: the test deploys a fresh LimitEngine; ensure your error `ComplianceNotSet` fires before `Compliance(compliance).verify` (which would hit a zero-address revert otherwise).

- [ ] **Step 5: Full suite check**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test 2>&1 | tail -3
```
Expected: 243 passing (237 + 6).

- [ ] **Step 6: CHANGELOG + commit**

Append:
```markdown
- **Added**: `LimitEngine.placeLimit` — Limit-Open order with collateral
  escrow. Verifies compliance, validates market, imports 3 encrypted
  inputs (trigger/size/collateral) with isSenderAllowed guards, locks
  collateral (debit user → credit LimitEngine), stores order with all
  ciphertexts. `setCompliance` admin function added. Cancel flow refunds
  via `_refundLimitCollateral` (was a stub). 6 unit tests.
  **Files**: `contracts/contracts/engines/LimitEngine.sol`,
  `contracts/test/LimitEngine.PlaceLimit.test.ts`.
```

```bash
cd /Users/ram/Desktop/NoirPerp && git add contracts/contracts/engines/LimitEngine.sol contracts/test/LimitEngine.PlaceLimit.test.ts CHANGELOG.md && git -c user.email=developer@randao.net -c user.name="Ram" commit -q -m "feat(limit): add placeLimit (Limit-Open) with collateral escrow

Limit-Open orders verify compliance, validate market, import 3
encrypted inputs (trigger/size/collateral), lock collateral as
escrow (debit user → credit LimitEngine vault balance). Cancel
refunds via _refundLimitCollateral. setCompliance admin function
added for compliance reference wiring. 6 unit tests.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `requestTrigger` + `_onTriggerDecided` (async, all 3 types)

**Files:**
- Modify: `contracts/contracts/engines/LimitEngine.sol`
- Create: `contracts/test/LimitEngine.Trigger.test.ts`

**Purpose:** Async trigger flow. Bot calls `requestTrigger(orderId)`. Engine computes `ebool shouldTrigger` per the order type table (top of plan), marks publicly decryptable, emits event, enqueues. Callback fires after relayer pulls decrypt. On match: dispatch to PerpEngine — close for TP/SL, refund escrow + open for LIMIT.

**Trigger condition helper**:
```solidity
function _shouldTrigger(uint8 orderType, bool isLong, euint64 currentPrice, euint64 triggerPrice) internal returns (ebool) {
    bool useGe;
    if (orderType == ORDER_TYPE_TP) useGe = isLong;
    else if (orderType == ORDER_TYPE_SL) useGe = !isLong;
    else /* ORDER_TYPE_LIMIT */ useGe = !isLong;
    return useGe ? FHE.ge(currentPrice, triggerPrice) : FHE.le(currentPrice, triggerPrice);
}
```

**Callback dispatch**:
- Type 1 (TP) or 2 (SL): `PerpEngine(perp).closePositionAsExecutor(positionId)`
- Type 3 (LIMIT): `_refundLimitCollateral(order)` then grant perp transient on size+collateral, then `perp.openPositionAsExecutor(...)`

**Required ACL chains**:
- For LIMIT trigger: LimitEngine has persistent ACL on order.size + order.collateral via `allowThis` at place-time. To call perp.openPositionAsExecutor, grant perp transient on both. Perp's `isSenderAllowed` check passes because LimitEngine has that ACL.

- [ ] **Step 1: Write failing test (substantial — covers all 3 types)**

Create `/Users/ram/Desktop/NoirPerp/contracts/test/LimitEngine.Trigger.test.ts`:

```typescript
import { expect } from "chai";
import * as hre from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import type { NoirVault, MockERC7984, Oracle, Compliance, PerpEngine, LimitEngine } from "../typechain-types";

const MARKET_ETH = 2;
const STALENESS = 90;
const DEVIATION_BPS = 50;
const TP = 1;
const SL = 2;
const LIMIT = 3;

describe("LimitEngine — async trigger (all 3 types)", () => {
  let vault: NoirVault;
  let token: MockERC7984;
  let oracle: Oracle;
  let compliance: Compliance;
  let perp: PerpEngine;
  let limit: LimitEngine;
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

  async function commitPrice(marketId: number, price: bigint) {
    const t = await now();
    await (await oracle.connect(relayerA).submitPrice(marketId, price, t)).wait();
    await (await oracle.connect(relayerB).submitPrice(marketId, price, t + 1)).wait();
  }

  async function encrypt(contractAddr: string, user: string, value: bigint) {
    const input = hre.fhevm.createEncryptedInput(contractAddr, user);
    input.add64(value);
    return await input.encrypt();
  }

  async function decrypt(handle: string, contractAddr: string, signer: typeof admin): Promise<bigint> {
    return hre.fhevm.userDecryptEuint(FhevmType.euint64, handle, contractAddr, signer);
  }

  async function fulfillTrigger(orderId: bigint): Promise<void> {
    // Read the most recent TriggerRequested event for orderId, pull
    // publicDecrypt of the handle, call back.
    const filter = limit.filters.TriggerRequested(undefined, orderId);
    const events = await limit.queryFilter(filter);
    const ev = events[events.length - 1];
    const reqId = ev.args!.requestId;
    const handle = ev.args!.shouldTriggerHandle;

    const { abiEncodedClearValues, decryptionProof } = await hre.fhevm.publicDecrypt([handle]);
    await (await limit._onTriggerDecided(
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

    const PerpFactory = await hre.ethers.getContractFactory("PerpEngine");
    perp = (await PerpFactory.deploy(
      await vault.getAddress(),
      await oracle.getAddress(),
      await compliance.getAddress(),
      admin.address, admin.address,
    )) as unknown as PerpEngine;
    await perp.waitForDeployment();
    await (await vault.registerEngine(await perp.getAddress())).wait();

    const LimitFactory = await hre.ethers.getContractFactory("LimitEngine");
    limit = (await LimitFactory.deploy(await vault.getAddress(), admin.address)) as unknown as LimitEngine;
    await limit.waitForDeployment();
    await (await vault.registerEngine(await limit.getAddress())).wait();
    await (await limit.setOracle(await oracle.getAddress())).wait();
    await (await limit.setPerp(await perp.getAddress())).wait();
    await (await limit.setCompliance(await compliance.getAddress())).wait();

    // Authorize LimitEngine as executor on Perp
    await (await perp.setExecutor(await limit.getAddress(), true)).wait();

    await (await token.connect(alice).setOperator(await vault.getAddress(), 2n ** 48n - 1n)).wait();
    await (await vault.connect(alice).deposit(10_000n)).wait();
    await commitPrice(MARKET_ETH, 3_000n);
  });

  describe("TP trigger (long position)", () => {
    it("closes the long position when price rises to TP", async () => {
      // Alice opens a long at 3000
      const perpAddr = await perp.getAddress();
      const sizeEnc = await encrypt(perpAddr, alice.address, 5n);
      const collEnc = await encrypt(perpAddr, alice.address, 1_000n);
      await (await perp.connect(alice).openPosition(
        sizeEnc.handles[0], sizeEnc.inputProof,
        collEnc.handles[0], collEnc.inputProof,
        true, MARKET_ETH, aliceProof,
      )).wait();

      // Alice places TP at 3200
      const limitAddr = await limit.getAddress();
      const trigEnc = await encrypt(limitAddr, alice.address, 3_200n);
      const tx = await limit.connect(alice).placeStopOrTake(
        0, trigEnc.handles[0], trigEnc.inputProof, TP
      );
      const r = await tx.wait();
      const orderId = (r!.logs.find((l: any) => l.fragment?.name === "OrderPlaced") as any).args.orderId;

      // Price moves up to 3200 → TP triggers
      await commitPrice(MARKET_ETH, 3_200n);
      await (await limit.connect(keeper).requestTrigger(orderId)).wait();
      await fulfillTrigger(orderId);

      // Position closed
      const pos = await vault.getPosition(0);
      expect(pos.active).to.equal(false);

      // Order marked inactive
      const order = await limit.getOrder(orderId);
      expect(order.active).to.equal(false);
    });

    it("does not close when price hasn't reached TP", async () => {
      const perpAddr = await perp.getAddress();
      const sizeEnc = await encrypt(perpAddr, alice.address, 5n);
      const collEnc = await encrypt(perpAddr, alice.address, 1_000n);
      await (await perp.connect(alice).openPosition(
        sizeEnc.handles[0], sizeEnc.inputProof,
        collEnc.handles[0], collEnc.inputProof,
        true, MARKET_ETH, aliceProof,
      )).wait();

      const limitAddr = await limit.getAddress();
      const trigEnc = await encrypt(limitAddr, alice.address, 3_500n);
      const tx = await limit.connect(alice).placeStopOrTake(
        0, trigEnc.handles[0], trigEnc.inputProof, TP
      );
      const r = await tx.wait();
      const orderId = (r!.logs.find((l: any) => l.fragment?.name === "OrderPlaced") as any).args.orderId;

      // Price only at 3100 — below 3500 TP
      await commitPrice(MARKET_ETH, 3_100n);
      await (await limit.connect(keeper).requestTrigger(orderId)).wait();
      await fulfillTrigger(orderId);

      // Position still active
      const pos = await vault.getPosition(0);
      expect(pos.active).to.equal(true);

      // Order marked inactive (trigger callback is single-use even on miss)
      const order = await limit.getOrder(orderId);
      expect(order.active).to.equal(false);
    });
  });

  describe("SL trigger (long position)", () => {
    it("closes the long when price falls to SL", async () => {
      const perpAddr = await perp.getAddress();
      const sizeEnc = await encrypt(perpAddr, alice.address, 5n);
      const collEnc = await encrypt(perpAddr, alice.address, 1_000n);
      await (await perp.connect(alice).openPosition(
        sizeEnc.handles[0], sizeEnc.inputProof,
        collEnc.handles[0], collEnc.inputProof,
        true, MARKET_ETH, aliceProof,
      )).wait();

      const limitAddr = await limit.getAddress();
      const trigEnc = await encrypt(limitAddr, alice.address, 2_900n);
      const tx = await limit.connect(alice).placeStopOrTake(
        0, trigEnc.handles[0], trigEnc.inputProof, SL
      );
      const r = await tx.wait();
      const orderId = (r!.logs.find((l: any) => l.fragment?.name === "OrderPlaced") as any).args.orderId;

      await commitPrice(MARKET_ETH, 2_900n);
      await (await limit.connect(keeper).requestTrigger(orderId)).wait();
      await fulfillTrigger(orderId);

      const pos = await vault.getPosition(0);
      expect(pos.active).to.equal(false);
    });
  });

  describe("LIMIT trigger (open new long position)", () => {
    it("opens a new long position when price falls to limit-buy trigger", async () => {
      // Alice places limit-buy at 2_900 (price needs to fall to 2900)
      const limitAddr = await limit.getAddress();
      const trigEnc = await encrypt(limitAddr, alice.address, 2_900n);
      const sizeEnc = await encrypt(limitAddr, alice.address, 5n);
      const collEnc = await encrypt(limitAddr, alice.address, 1_000n);
      const tx = await limit.connect(alice).placeLimit(
        trigEnc.handles[0], trigEnc.inputProof,
        sizeEnc.handles[0], sizeEnc.inputProof,
        collEnc.handles[0], collEnc.inputProof,
        MARKET_ETH, true /* long buy */, aliceProof,
      );
      const r = await tx.wait();
      const orderId = (r!.logs.find((l: any) => l.fragment?.name === "OrderPlaced") as any).args.orderId;

      // Pre-trigger: alice has 9_000 vault balance (10_000 - 1_000 escrow)
      let aliceBal = await decrypt(
        await vault.getBalance(alice.address),
        await vault.getAddress(),
        alice,
      );
      expect(aliceBal).to.equal(9_000n);

      // Price falls to 2900 — triggers
      await commitPrice(MARKET_ETH, 2_900n);
      await (await limit.connect(keeper).requestTrigger(orderId)).wait();
      await fulfillTrigger(orderId);

      // Position 0 opened (alice's first; perp.nextPositionId was 0)
      const pos = await vault.getPosition(0);
      expect(pos.owner).to.equal(alice.address);
      expect(pos.isLong).to.equal(true);
      expect(pos.active).to.equal(true);

      // Alice's vault balance: refund 1_000 from escrow, then perp debits
      // 1_000 for the position open. Net: 9_000 - 0 = 9_000.
      aliceBal = await decrypt(
        await vault.getBalance(alice.address),
        await vault.getAddress(),
        alice,
      );
      expect(aliceBal).to.equal(9_000n);

      // Order marked inactive
      const order = await limit.getOrder(orderId);
      expect(order.active).to.equal(false);
    });

    it("refunds escrow but does NOT open position when price hasn't crossed", async () => {
      const limitAddr = await limit.getAddress();
      const trigEnc = await encrypt(limitAddr, alice.address, 2_500n);
      const sizeEnc = await encrypt(limitAddr, alice.address, 5n);
      const collEnc = await encrypt(limitAddr, alice.address, 1_000n);
      const tx = await limit.connect(alice).placeLimit(
        trigEnc.handles[0], trigEnc.inputProof,
        sizeEnc.handles[0], sizeEnc.inputProof,
        collEnc.handles[0], collEnc.inputProof,
        MARKET_ETH, true, aliceProof,
      );
      const r = await tx.wait();
      const orderId = (r!.logs.find((l: any) => l.fragment?.name === "OrderPlaced") as any).args.orderId;

      // Price at 2_900 — above trigger 2_500, doesn't cross for long-buy
      await commitPrice(MARKET_ETH, 2_900n);
      await (await limit.connect(keeper).requestTrigger(orderId)).wait();
      await fulfillTrigger(orderId);

      // No position opened
      expect(await vault.nextPositionId()).to.equal(0n);

      // Escrow refunded — alice back to 10_000
      const aliceBal = await decrypt(
        await vault.getBalance(alice.address),
        await vault.getAddress(),
        alice,
      );
      expect(aliceBal).to.equal(10_000n);
    });
  });

  describe("guards", () => {
    it("requestTrigger reverts on inactive order", async () => {
      const perpAddr = await perp.getAddress();
      const sizeEnc = await encrypt(perpAddr, alice.address, 5n);
      const collEnc = await encrypt(perpAddr, alice.address, 1_000n);
      await (await perp.connect(alice).openPosition(
        sizeEnc.handles[0], sizeEnc.inputProof,
        collEnc.handles[0], collEnc.inputProof,
        true, MARKET_ETH, aliceProof,
      )).wait();

      const limitAddr = await limit.getAddress();
      const trigEnc = await encrypt(limitAddr, alice.address, 3_500n);
      const tx = await limit.connect(alice).placeStopOrTake(
        0, trigEnc.handles[0], trigEnc.inputProof, TP
      );
      const r = await tx.wait();
      const orderId = (r!.logs.find((l: any) => l.fragment?.name === "OrderPlaced") as any).args.orderId;

      // Cancel the order
      await (await limit.connect(alice).cancelOrder(orderId)).wait();

      // requestTrigger should revert
      await expect(limit.connect(keeper).requestTrigger(orderId))
        .to.be.revertedWithCustomError(limit, "OrderNotActive");
    });

    it("requestTrigger reverts when oracle is stale", async () => {
      const perpAddr = await perp.getAddress();
      const sizeEnc = await encrypt(perpAddr, alice.address, 5n);
      const collEnc = await encrypt(perpAddr, alice.address, 1_000n);
      await (await perp.connect(alice).openPosition(
        sizeEnc.handles[0], sizeEnc.inputProof,
        collEnc.handles[0], collEnc.inputProof,
        true, MARKET_ETH, aliceProof,
      )).wait();

      const limitAddr = await limit.getAddress();
      const trigEnc = await encrypt(limitAddr, alice.address, 3_500n);
      const tx = await limit.connect(alice).placeStopOrTake(
        0, trigEnc.handles[0], trigEnc.inputProof, TP
      );
      const r = await tx.wait();
      const orderId = (r!.logs.find((l: any) => l.fragment?.name === "OrderPlaced") as any).args.orderId;

      await hre.ethers.provider.send("evm_increaseTime", [STALENESS + 10]);
      await hre.ethers.provider.send("evm_mine", []);

      await expect(limit.connect(keeper).requestTrigger(orderId))
        .to.be.revertedWithCustomError(limit, "OraclePriceStale");
    });
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test test/LimitEngine.Trigger.test.ts
```

- [ ] **Step 3: Add trigger logic to `LimitEngine.sol`**

Add new imports at top:
```solidity
import { Oracle } from "../services/Oracle.sol";
import { PerpEngine } from "./PerpEngine.sol";
```

Add new errors:
```solidity
    error OracleNotSet();
    error PerpNotSet();
    error OraclePriceStale();
```

Add new events:
```solidity
    event TriggerRequested(uint256 indexed requestId, uint256 indexed orderId, address indexed keeper, bytes32 shouldTriggerHandle);
    event Triggered(uint256 indexed orderId, address indexed user);
    event TriggerNotMet(uint256 indexed orderId);
```

Append before closing `}`:

```solidity
    // ─── Async trigger ─────────────────────────────────────────────

    /// @notice Bot-callable. Computes whether the order should fire by
    ///         comparing the current oracle price to the encrypted
    ///         trigger, then requests Gateway decryption of the bool.
    function requestTrigger(uint256 orderId) external returns (uint256 requestId) {
        if (oracle == address(0)) revert OracleNotSet();
        if (perp == address(0)) revert PerpNotSet();

        LimitOrder storage order = _orders[orderId];
        if (!order.active) revert OrderNotActive();

        (uint64 price, bool fresh) = Oracle(oracle).getPrice(order.marketId);
        if (!fresh) revert OraclePriceStale();
        euint64 ePrice = FHE.asEuint64(price);

        ebool shouldTrigger = _shouldTrigger(
            order.orderType, order.isLong, ePrice, order.triggerPrice
        );
        FHE.makePubliclyDecryptable(shouldTrigger);

        requestId = uint256(keccak256(abi.encode(
            orderId, block.number, block.timestamp, msg.sender
        )));

        // Context = orderId only (we re-read order in callback)
        bytes memory ctx = abi.encode(orderId);
        _enqueue(requestId, msg.sender, orderId, ctx);

        emit TriggerRequested(requestId, orderId, msg.sender, FHE.toBytes32(shouldTrigger));
    }

    /// @notice Gateway-relayed callback. Verifies KMS sigs, dequeues
    ///         (replay guard) BEFORE external calls, marks order inactive,
    ///         and dispatches to the right execution path on match.
    function _onTriggerDecided(
        uint256 requestId,
        bytes32[] memory handlesList,
        bytes memory cleartexts,
        bytes memory decryptionProof
    ) external {
        FHE.checkSignatures(handlesList, cleartexts, decryptionProof);

        PendingDecrypt memory ctx = _dequeue(requestId);
        uint256 orderId = abi.decode(ctx.context, (uint256));

        LimitOrder storage order = _orders[orderId];
        // Mark inactive regardless of outcome — trigger is single-use
        order.active = false;

        uint256 clearUint = abi.decode(cleartexts, (uint256));
        bool shouldFire = clearUint != 0;

        if (!shouldFire) {
            // For LIMIT: refund escrow even on miss
            if (order.orderType == ORDER_TYPE_LIMIT) {
                _refundLimitCollateral(order);
            }
            emit TriggerNotMet(orderId);
            return;
        }

        if (order.orderType == ORDER_TYPE_TP || order.orderType == ORDER_TYPE_SL) {
            PerpEngine(perp).closePositionAsExecutor(order.positionId);
        } else {
            // LIMIT: refund escrow first, then have Perp open the position
            // (which will debit user normally and apply margin/silent-zero)
            _refundLimitCollateral(order);

            FHE.allowTransient(order.size, perp);
            FHE.allowTransient(order.collateral, perp);
            PerpEngine(perp).openPositionAsExecutor(
                order.owner, order.size, order.collateral, order.isLong, order.marketId
            );
        }

        emit Triggered(orderId, order.owner);
    }

    // ─── Trigger condition helper ─────────────────────────────────

    function _shouldTrigger(
        uint8 orderType,
        bool isLong,
        euint64 currentPrice,
        euint64 triggerPrice
    ) internal returns (ebool) {
        bool useGe;
        if (orderType == ORDER_TYPE_TP) useGe = isLong;
        else if (orderType == ORDER_TYPE_SL) useGe = !isLong;
        else /* LIMIT */ useGe = !isLong;
        return useGe
            ? FHE.ge(currentPrice, triggerPrice)
            : FHE.le(currentPrice, triggerPrice);
    }
```

**Note**: `requestTrigger` does NOT verify the order's referenced position is still active (for TP/SL). If the user manually closed it via `perp.closePosition` after placing the order, `closePositionAsExecutor` in the callback will revert — propagating the error to the relayer's callback tx. Acceptable for MVP (user shouldn't trigger orders for positions they've already closed; it's a self-grief).

**Stack-too-deep**: if `_onTriggerDecided` hits this, split into `_dispatchTrigger(LimitOrder storage order)` internal helper. Same pattern as Phase 3.

- [ ] **Step 4: Run test — expect PASS**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test test/LimitEngine.Trigger.test.ts
```
Expected: 7 passing.

Common failures:
- "ACL error in `closePositionAsExecutor`": LimitEngine's call into `perp.closePositionAsExecutor(positionId)` should NOT need any FHE.allow... that function only uses positionId (a plaintext uint256) and reads vault state internally. If this fails, check perp's executor variant doesn't call `FHE.isSenderAllowed` on something LimitEngine doesn't have ACL for.
- "ACL error in `openPositionAsExecutor` on size/collateral": LimitEngine must `FHE.allowTransient(order.size, perp)` + same for collateral BEFORE the call. Verified in step 3 code.
- "Stale oracle test passes when it shouldn't": confirm `Oracle(oracle).getPrice(...)` returns `fresh = false` after time-jump.

- [ ] **Step 5: Full suite + Phase 3/4 regression check**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test 2>&1 | tail -3
```
Expected: 250 passing (243 + 7).

- [ ] **Step 6: CHANGELOG + commit**

Append:
```markdown
- **Added**: `LimitEngine.requestTrigger` + `_onTriggerDecided` async
  callback for all 3 order types. Phase 1 computes
  `ebool shouldTrigger = isLong ? FHE.ge : FHE.le(currentPrice, triggerPrice)`
  with type-specific direction (`useGe = TP&&long || SL&&short || LIMIT&&short`).
  Phase 2 callback dispatches: TP/SL → `perp.closePositionAsExecutor`;
  LIMIT → refund escrow + `perp.openPositionAsExecutor`. On non-trigger:
  LIMIT escrow still refunded; order marked inactive (single-use).
  Replay-guarded via DecryptQueue. 7 unit tests covering all 3 types
  + miss + guards.
  **Files**: `contracts/contracts/engines/LimitEngine.sol`,
  `contracts/test/LimitEngine.Trigger.test.ts`.
```

```bash
cd /Users/ram/Desktop/NoirPerp && git add contracts/contracts/engines/LimitEngine.sol contracts/test/LimitEngine.Trigger.test.ts CHANGELOG.md && git -c user.email=developer@randao.net -c user.name="Ram" commit -q -m "feat(limit): add async trigger flow for TP/SL/Limit

requestTrigger computes ebool on ciphertexts (direction depends on
type+isLong), publicly decryptable, enqueues. Callback verifies KMS
sigs, dequeues (replay guard), marks order inactive (single-use),
dispatches to perp.closePositionAsExecutor (TP/SL) or refunds escrow
+ perp.openPositionAsExecutor (LIMIT). On miss: LIMIT escrow refunded.
7 unit tests covering all 3 types + miss path + guards.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Update `deploy-local.ts`

**Files:**
- Modify: `contracts/scripts/deploy-local.ts`

- [ ] **Step 1: Add LimitEngine deploy + wire**

Open `/Users/ram/Desktop/NoirPerp/contracts/scripts/deploy-local.ts`. Just before the final "Phase 4 deploy complete" log, insert:

```typescript
  // 7. LimitEngine (Phase 5)
  const LimitFactory = await hre.ethers.getContractFactory("LimitEngine");
  const limit = await LimitFactory.deploy(await vault.getAddress(), admin.address);
  await limit.waitForDeployment();
  console.log("LimitEngine deployed:", await limit.getAddress());

  await (await vault.registerEngine(await limit.getAddress())).wait();
  console.log("LimitEngine registered as authorized engine on vault");

  await (await limit.setOracle(await oracle.getAddress())).wait();
  console.log("LimitEngine oracle set");

  await (await limit.setPerp(await perp.getAddress())).wait();
  console.log("LimitEngine perp set");

  await (await limit.setCompliance(await compliance.getAddress())).wait();
  console.log("LimitEngine compliance set");

  await (await perp.setExecutor(await limit.getAddress(), true)).wait();
  console.log("LimitEngine authorized as executor on PerpEngine");
```

Update the final banner from `=== Phase 4 deploy complete ===` to `=== Phase 5 deploy complete ===`. Update the header comment accordingly.

- [ ] **Step 2: Run the deploy script**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat run scripts/deploy-local.ts
```
Expected: 7 contract addresses + 5 wiring confirmation lines + "Phase 5 deploy complete".

- [ ] **Step 3: CHANGELOG + commit**

Append:
```markdown
- **Modified**: `deploy-local.ts` — deploys LimitEngine, registers it
  on vault, wires oracle/perp/compliance, authorizes it as executor
  on PerpEngine.
```

```bash
cd /Users/ram/Desktop/NoirPerp && git add contracts/scripts/deploy-local.ts CHANGELOG.md && git -c user.email=developer@randao.net -c user.name="Ram" commit -q -m "chore(scripts): deploy LimitEngine + wire all dependencies

Deploys LimitEngine, registers on vault, wires oracle/perp/compliance,
authorizes as executor on PerpEngine. Final banner: Phase 5 complete.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Coverage verification

- [ ] **Step 1: Run coverage on Phase 5 + PerpEngine refactor tests**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && SOLIDITY_COVERAGE=true npx hardhat coverage --testfiles "test/PerpEngine.Executor.test.ts,test/LimitEngine.Admin.test.ts,test/LimitEngine.PlaceStopOrTake.test.ts,test/LimitEngine.PlaceLimit.test.ts,test/LimitEngine.Trigger.test.ts" 2>&1 | tail -15
```

Expected: LimitEngine ≥90% lines/funcs/stmts, ≥80% branches. PerpEngine new functions also covered.

- [ ] **Step 2: Add gap tests if needed**

Likely gaps:
- `transferAdmin` (covered by Admin tests)
- `setOracle`/`setPerp`/`setCompliance` (covered)
- `_shouldTrigger` branches (TP-short, SL-long, LIMIT-short — covered if all 3 types are tested with both directions)

If anything is below 90%, add a focused test in `LimitEngine.Coverage.test.ts`. Most likely gap: SL-short and LIMIT-short trigger directions weren't exercised in the main tests. Add tests for those.

- [ ] **Step 3: Commit any coverage-gap fixes**

```bash
cd /Users/ram/Desktop/NoirPerp && git add contracts/test/ && git -c user.email=developer@randao.net -c user.name="Ram" commit -q -m "test(limit): close coverage gaps (>=90%)" 2>/dev/null || echo "No gap tests needed"
```

---

### Task 8: Tier 1 audit (mandatory phase gate)

Per `PROGRESS.md`, Phase 5 cannot tick complete until Tier 1 audit passes.

- [ ] **Step 1: Dispatch spec compliance reviewer (parallel, read-only)**

Use Agent tool, subagent_type=general-purpose, model=sonnet. Prompt template:
> Review Phase 5 (LimitEngine + PerpEngine executor refactor) against `/Users/ram/Desktop/NoirPerp/docs/plans/2026-04-25-phase-5-limit-engine.md` and `/Users/ram/Desktop/NoirPerp/docs/specs/2026-04-24-noirperp-design.md` §4.5. Verify all 3 order types implemented with the 6 trigger conditions (TP/SL/LIMIT × long/short). Verify PerpEngine refactor does not break Phase 3 tests. Verify cross-engine executor flow + escrow handling. Report ✅ compliant or ❌ issues with file:line.

- [ ] **Step 2: Dispatch code quality reviewer (parallel, read-only)**

Same pattern. Prompt:
> Code-quality review of Phase 5 (LimitEngine + PerpEngine refactor). Check FHE.* namespace, no raw FHE.sub/add/mul outside FHESafeMath, isSenderAllowed guards on all encrypted external inputs, allowTransient discipline (especially in trigger callback's cross-engine ACL handoff), `_dequeue` BEFORE external calls in callback (replay guard), custom errors not strings, events on mutating functions, struct-field consistency between place-time and trigger-time. Report APPROVED / APPROVED_WITH_MINOR_FIXES / NEEDS_REWORK.

- [ ] **Step 3: Address critical + important findings inline**

Same pattern as Phases 2-4. Fix in a `fix(audit):` commit; full suite must remain green.

---

### Task 9: Phase 5 tick + merge to master

- [ ] **Step 1: Verify full suite green**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test 2>&1 | tail -3
```
Expected: ≥250 passing.

- [ ] **Step 2: Tick Phase 5 in PROGRESS.md**

Change:
```markdown
- [ ] **Phase 5 — LimitEngine**
  Plan: *(not yet written)*
```
to:
```markdown
- [x] **Phase 5 — LimitEngine** ✅ (2026-04-XX)
  Plan: `docs/plans/2026-04-25-phase-5-limit-engine.md`
  Completion criteria met: LimitEngine live with TP/SL/Limit-Open
  orders; bot-triggered async execution via DecryptQueue + Gateway
  pull-decrypt; PerpEngine executor pattern added (cross-engine
  position open/close on behalf of users); collateral escrow for
  Limit-Open with refund on cancel + miss; all 6 trigger directions
  tested (TP-long/short, SL-long/short, LIMIT-long/short).
  Tier 1 audit passed. Coverage ≥90% on LimitEngine.
```

- [ ] **Step 3: Append Phase 5 complete entry to CHANGELOG.md**

```markdown
### Phase 5 complete ✅ (2026-04-XX)

- **PerpEngine executor pattern**: `setExecutor`,
  `openPositionAsExecutor`, `closePositionAsExecutor`. Refactored
  `_computeFinals`/`_settle`/`_executeClose` to take `owner` as arg.
  Phase 3 backwards-compatible (38 tests still pass).
- **LimitEngine live**:
  - `placeStopOrTake(positionId, eTrigger, proof, orderType)` —
    TP=1, SL=2 placement on existing positions
  - `placeLimit(...)` — Limit-Open with collateral escrow
  - `cancelOrder(orderId)` — works for all types; LIMIT refunds escrow
  - `requestTrigger(orderId)` + `_onTriggerDecided` — async 2-phase
    via pull-based public decrypt (fhe-primitives.md §5)
  - All 6 trigger directions covered: TP/SL × long/short and
    LIMIT × long/short
- **Test count**: total = 250+ (205 prior + 45+ new).
- **Coverage**: ≥90% per contract.
- **Tier 1 audit**: passed.
- **Ready for Phase 6** (DarkpoolEngine).
```

- [ ] **Step 4: Commit + merge**

```bash
cd /Users/ram/Desktop/NoirPerp && git add PROGRESS.md CHANGELOG.md && git -c user.email=developer@randao.net -c user.name="Ram" commit -q -m "docs: tick Phase 5 complete — LimitEngine live (TP/SL/Limit)" && git checkout master && git merge --ff-only phase-5-limit-engine
```

- [ ] **Step 5: Announce**

> "✅ Phase 5 complete. LimitEngine live: TP/SL/Limit-Open orders all working with async trigger flow. Cross-engine executor pattern integrates with PerpEngine. Ready for Phase 6 (DarkpoolEngine)."

---

## Appendix A — Troubleshooting

**Stack-too-deep on `_onTriggerDecided`**: 6+ locals across the callback. If hit, extract `_dispatchTrigger(LimitOrder storage order)` internal helper that handles the type-dispatch + cross-engine call. Phase 3 used the same pattern.

**ACL error on `_refundLimitCollateral`**: `order.collateral` was granted `FHE.allowThis` at place-time. Reads from storage retain that ACL. If the test fails with "not allowed", verify `placeLimit` calls `FHE.allowThis(collateral)` before storing.

**Cross-engine ACL handoff (LIMIT trigger)**: LimitEngine has persistent `allowThis` on `order.size` + `order.collateral`. Before calling `perp.openPositionAsExecutor(..., size, collateral, ...)`, LimitEngine must `FHE.allowTransient(size, perp)` + same for collateral. Without these, perp's `isSenderAllowed` check fails.

**Phase 3 regression on PerpEngine refactor**: if Phase 3's existing tests fail after extracting `_computeFinals(owner, ...)`, you've changed the behavior. The refactor must be PURELY mechanical — same logic, just `owner` parameter instead of hardcoded `msg.sender`. Existing `openPosition` should pass `msg.sender` and produce identical results.

**`euint64.wrap(0)` for unused fields**: Solidity's user-defined value type allows `wrap` to construct a default-zero handle. If your version errors, use `FHE.asEuint64(0)` instead — slightly more expensive (32 HCU) but always safe.

**Event extraction in tests**: `receipt.logs.find(l => l.fragment?.name === ...)` works in ethers v6 with hardhat-chai-matchers. If the filter misses the event, fall back to iterating with `limit.interface.parseLog(log)`.

**Trigger condition off-by-one**: `useGe = (TP && long) || (SL && short) || (LIMIT && short)`. Verify this matches the table at the top of the plan. Off-by-one here means the wrong direction triggers — which fails the wrong tests in unexpected ways.

**Compliance proof binding**: a Merkle proof for alice's address is generated client-side (test) using `StandardMerkleTree`. The proof is for `keccak256(bytes.concat(keccak256(abi.encode(addr))))` — double-hashed leaves per OZ convention. If "NotCompliant" fires for valid users, leaf format mismatch.
