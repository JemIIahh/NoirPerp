# Phase 3 — PerpEngine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `PerpEngine.sol` — perpetual-futures engine with synchronous open/close and asynchronous liquidation — supporting 3 markets (BTC/ETH/SOL), integrated with NoirVault (state), Oracle (price), Compliance (KYC), and Phase 1 libs (FHESafeMath, MarginMath, DecryptQueue).

**Architecture:** PerpEngine inherits `DecryptQueue` for async-decrypt replay guard. All state lives in the Vault; engine is stateless except config + `liquidationPool`. `openPosition` and `closePosition` are fully synchronous — user-visible outcome is determined in one tx via `FHE.select`-guarded math. `requestLiquidation` + `_onLiquidationDecided` is a 2-phase async state machine: margin check computed as `ebool` on ciphertexts, only that single bit is decrypted via Gateway, and the callback conditionally executes the liquidation.

**Tech Stack:**
- Solidity `^0.8.27`
- `@fhevm/solidity@^0.11.1` (`FHE`, `euint64`, `ebool`, `externalEuint64`, `ZamaEthereumConfig`)
- Phase 1 libs: `FHESafeMath` (safeAdd/Sub/Mul/absDiff), `MarginMath`, `DecryptQueue`
- Phase 2 contracts: `NoirVault`, `Oracle`, `Compliance`
- Hardhat mock FHEVM (for local testing — auto-fulfills `FHE.requestDecryption`)
- `@openzeppelin/merkle-tree` (test-side compliance proofs)

**Reference docs:**
- Spec: `docs/specs/2026-04-24-noirperp-design.md` §4.2, §5.1, §5.2, §5.3
- Primitives: `docs/fhe-primitives.md` §5 (async decryption), §4 (ACL)
- Rules: `CLAUDE.md`
- Prior phases: `docs/plans/2026-04-24-phase-{0,1,2}-*.md`

**Market IDs**: `1 = BTC/USD`, `2 = ETH/USD`, `3 = SOL/USD`.

**Config constants** (locked at construction, not governable in v1):
- `MAX_LEVERAGE = 20` (20×)
- `MAINTENANCE_MARGIN_BPS = 500` (5%)
- `LIQUIDATOR_FEE_BPS = 50` (0.5%)

**Scope out (deferred)**:
- Funding rate (per design spec §11 open question; OK for testnet perps)
- Multi-collateral (only USDCx)
- 3-block finality delay on liquidation callback (nice-to-have per spec §6; skip for v1 — Hardhat mock auto-fulfills)
- Sepolia deploy (Phase 9)

---

### Task 0: Branch + preconditions

**Files:** none

- [ ] **Step 1: Verify branch**

```bash
git -C /Users/ram/Desktop/NoirPerp branch --show-current
```
Expected: `phase-3-perp-engine`. If not, `git checkout phase-3-perp-engine`.

- [ ] **Step 2: Verify Phase 0-2 still green**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat compile && npx hardhat test 2>&1 | tail -3
```
Expected: compile clean; **138 passing**. Any regression blocks Phase 3.

- [ ] **Step 3: Re-read the key docs**

- `CLAUDE.md` — pinned rules, especially FHE.isSenderAllowed guards and no raw FHE.sub/add/mul outside FHESafeMath
- `docs/fhe-primitives.md` — especially §5 (async decryption pattern)
- `docs/specs/2026-04-24-noirperp-design.md` §5.1 (open flow), §5.2 (liquidation flow), §5.3 (close flow)

---

### Task 1: Vault additions — `allowBalanceAccess` + `allowPositionAccess`

**Files:**
- Modify: `contracts/contracts/NoirVault.sol`
- Create: `contracts/test/NoirVault.AccessGrants.test.ts`

**Purpose:** Engines need to read vault-stored ciphertexts (balances, positions) and operate on them in FHE. The vault is the ACL owner (`allowThis`), so only it can grant others access. These two functions let an authorized engine request transient access to specific state — the vault returns the handle and grants engine transient ACL in the same call. Satisfies design spec §4.1 `grantTransient`.

**Signatures:**
```solidity
/// @notice Grants msg.sender (authorized engine) transient ACL on user's
///         balance ciphertext + returns the handle.
function allowBalanceAccess(address user) external onlyAuthorizedEngine returns (euint64);

/// @notice Grants msg.sender (authorized engine) transient ACL on position's
///         size/entryPrice/collateral ciphertexts + returns the Position struct.
function allowPositionAccess(uint256 positionId) external onlyAuthorizedEngine returns (Position memory);
```

- [ ] **Step 1: Write failing test**

Create `/Users/ram/Desktop/NoirPerp/contracts/test/NoirVault.AccessGrants.test.ts`:

```typescript
import { expect } from "chai";
import * as hre from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import type { NoirVault, MockERC7984, MockEngine } from "../typechain-types";

describe("NoirVault — engine access grants", () => {
  let vault: NoirVault;
  let token: MockERC7984;
  let mockEngine: MockEngine;
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

    const EngineFactory = await hre.ethers.getContractFactory("MockEngine");
    mockEngine = (await EngineFactory.deploy(await vault.getAddress())) as unknown as MockEngine;
    await mockEngine.waitForDeployment();
    await (await vault.registerEngine(await mockEngine.getAddress())).wait();
  });

  describe("allowBalanceAccess", () => {
    it("returns the balance handle for an engine to use", async () => {
      // Seed alice with a deposit first
      await (await token.mintPlaintext(alice.address, 10_000n)).wait();
      await (await token.connect(alice).setOperator(await vault.getAddress(), 2n ** 48n - 1n)).wait();
      await (await vault.connect(alice).deposit(500n)).wait();

      // Engine calls allowBalanceAccess via its harness helper
      await (await mockEngine.readAndCopyBalance(alice.address)).wait();
      const handle = await mockEngine.lastReadBalance();
      // MockEngine grants msg.sender (test runner) persistent allow on the copy
      const decoded = await hre.fhevm.userDecryptEuint(
        FhevmType.euint64,
        handle,
        await mockEngine.getAddress(),
        admin,
      );
      expect(decoded).to.equal(500n);
    });

    it("reverts when non-engine calls it", async () => {
      await expect(
        vault.connect(bob).allowBalanceAccess(alice.address)
      ).to.be.revertedWithCustomError(vault, "NotAuthorizedEngine");
    });
  });

  describe("allowPositionAccess", () => {
    it("returns the position struct with engine ACL on each ciphertext field", async () => {
      // Engine opens a mock position first (exercising writePosition path)
      await (await mockEngine.openMockPosition(alice.address, 100n, 3000n, 500n, true, 2)).wait();

      // Then reads it via allowPositionAccess
      await (await mockEngine.readAndCopyPosition(0)).wait();
      const sizeHandle = await mockEngine.lastReadSize();
      const entryHandle = await mockEngine.lastReadEntry();
      const collHandle = await mockEngine.lastReadCollateral();

      const decrypt = async (h: string) =>
        hre.fhevm.userDecryptEuint(FhevmType.euint64, h, await mockEngine.getAddress(), admin);

      expect(await decrypt(sizeHandle)).to.equal(100n);
      expect(await decrypt(entryHandle)).to.equal(3000n);
      expect(await decrypt(collHandle)).to.equal(500n);
    });

    it("reverts when non-engine calls it", async () => {
      await (await mockEngine.openMockPosition(alice.address, 100n, 3000n, 500n, true, 2)).wait();
      await expect(
        vault.connect(bob).allowPositionAccess(0)
      ).to.be.revertedWithCustomError(vault, "NotAuthorizedEngine");
    });

    it("returns public struct fields alongside encrypted ones", async () => {
      await (await mockEngine.openMockPosition(alice.address, 100n, 3000n, 500n, true, 2)).wait();
      await (await mockEngine.readAndCopyPosition(0)).wait();
      expect(await mockEngine.lastReadOwner()).to.equal(alice.address);
      expect(await mockEngine.lastReadMarketId()).to.equal(2);
      expect(await mockEngine.lastReadIsLong()).to.equal(true);
      expect(await mockEngine.lastReadActive()).to.equal(true);
    });
  });
});
```

- [ ] **Step 2: Run test — expect FAIL (functions don't exist yet)**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test test/NoirVault.AccessGrants.test.ts
```
Expected: compile or runtime error — `allowBalanceAccess` / `allowPositionAccess` missing.

- [ ] **Step 3: Add `allowBalanceAccess` and `allowPositionAccess` to `NoirVault.sol`**

Open `/Users/ram/Desktop/NoirPerp/contracts/contracts/NoirVault.sol`. Immediately after the existing `getBalance` function (before the `// ─── Positions ───` banner), insert:

```solidity
    /// @notice Engine-only. Grants `msg.sender` transient ACL on the user's
    ///         encrypted balance + returns the handle. Use from engines that
    ///         need to read a balance for FHE computation (e.g., affordability
    ///         check in PerpEngine.openPosition).
    /// @dev Vault is the persistent ACL owner; only the vault can grant
    ///      transient access to other contracts. The returned handle is
    ///      tx-scoped for the caller.
    function allowBalanceAccess(address user)
        external
        onlyAuthorizedEngine
        returns (euint64)
    {
        euint64 bal = _balances[user];
        FHE.allowTransient(bal, msg.sender);
        return bal;
    }
```

Then, after the existing `getPosition` function, insert:

```solidity
    /// @notice Engine-only. Grants `msg.sender` transient ACL on each of the
    ///         position's encrypted fields (size, entryPrice, collateral) and
    ///         returns the full struct. Used by PerpEngine.closePosition and
    ///         PerpEngine.requestLiquidation to read stored state.
    function allowPositionAccess(uint256 positionId)
        external
        onlyAuthorizedEngine
        returns (Position memory)
    {
        Position memory p = _positions[positionId];
        FHE.allowTransient(p.size, msg.sender);
        FHE.allowTransient(p.entryPrice, msg.sender);
        FHE.allowTransient(p.collateral, msg.sender);
        return p;
    }
```

- [ ] **Step 4: Extend `MockEngine.sol` with test helpers**

Open `/Users/ram/Desktop/NoirPerp/contracts/contracts/test-harness/MockEngine.sol`. Append (before the closing `}`):

```solidity
    // ─── Access-grant helpers (for Phase 3 Task 1 tests) ──────────────

    euint64 public lastReadBalance;

    euint64 public lastReadSize;
    euint64 public lastReadEntry;
    euint64 public lastReadCollateral;
    address public lastReadOwner;
    uint8 public lastReadMarketId;
    bool public lastReadIsLong;
    bool public lastReadActive;

    /// @notice Calls vault.allowBalanceAccess, stores the handle with
    ///         persistent allow to the tx sender so tests can decrypt.
    function readAndCopyBalance(address user) external {
        euint64 bal = vault.allowBalanceAccess(user);
        lastReadBalance = bal;
        FHE.allowThis(bal);
        FHE.allow(bal, msg.sender);
    }

    /// @notice Calls vault.allowPositionAccess, copies all fields to
    ///         storage with persistent allow for test decryption.
    function readAndCopyPosition(uint256 positionId) external {
        NoirVault.Position memory p = vault.allowPositionAccess(positionId);
        lastReadSize = p.size;
        lastReadEntry = p.entryPrice;
        lastReadCollateral = p.collateral;
        lastReadOwner = p.owner;
        lastReadMarketId = p.marketId;
        lastReadIsLong = p.isLong;
        lastReadActive = p.active;
        FHE.allowThis(p.size);
        FHE.allowThis(p.entryPrice);
        FHE.allowThis(p.collateral);
        FHE.allow(p.size, msg.sender);
        FHE.allow(p.entryPrice, msg.sender);
        FHE.allow(p.collateral, msg.sender);
    }
```

- [ ] **Step 5: Run test — expect PASS**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test test/NoirVault.AccessGrants.test.ts
```
Expected: all 5 tests pass.

If "returns the balance handle" fails with ACL error: the test flow requires MockEngine to do `allowThis` + `allow(..., msg.sender)` so `admin` (the test runner / tx sender) can decrypt across the post-tx boundary. Verify the MockEngine helper does both.

- [ ] **Step 6: Verify full suite still green**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test 2>&1 | tail -3
```
Expected: **143 passing** (138 prior + 5 new).

- [ ] **Step 7: CHANGELOG entry**

Append to `/Users/ram/Desktop/NoirPerp/CHANGELOG.md` under a new `### Phase 3 — PerpEngine (in progress)` section:

```markdown
### Phase 3 — PerpEngine (in progress)

- **Added**: `NoirVault.allowBalanceAccess(user)` and
  `NoirVault.allowPositionAccess(positionId)` — engine-gated functions
  that grant `msg.sender` (authorized engine) transient ACL on the
  vault-stored ciphertexts and return the handles. Satisfies design
  spec §4.1's `grantTransient` contract. Enables PerpEngine to read
  vault state and compute FHE ops on it.
  Also added access-grant helpers to MockEngine harness for tests.
  5 unit tests (balance access + position access + non-engine guards).
  **Files**: `contracts/contracts/NoirVault.sol`,
  `contracts/contracts/test-harness/MockEngine.sol`,
  `contracts/test/NoirVault.AccessGrants.test.ts`.
```

- [ ] **Step 8: Commit**

```bash
cd /Users/ram/Desktop/NoirPerp && git add contracts/contracts/NoirVault.sol contracts/contracts/test-harness/MockEngine.sol contracts/test/NoirVault.AccessGrants.test.ts CHANGELOG.md && git -c user.email=developer@randao.net -c user.name="Ram" commit -q -m "feat(vault): add allowBalanceAccess + allowPositionAccess

Engine-gated functions that grant msg.sender transient ACL on
vault-stored ciphertexts and return the handles. Satisfies design
spec §4.1 grantTransient contract. Prerequisite for PerpEngine
to read vault state in FHE computations. 5 unit tests.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `PerpEngine` — scaffold + `openPosition` (synchronous)

**Files:**
- Create: `contracts/contracts/engines/PerpEngine.sol`
- Create: `contracts/test/PerpEngine.Open.test.ts`

**Purpose:** First slice of PerpEngine. Constructor wires vault/oracle/compliance + locks config. `openPosition` implements the synchronous select-guarded flow from design spec §5.1: verify compliance, fetch oracle price, trivial-encrypt it, check `balanceOK AND marginOK` on ciphertexts, select-zero if either fails, debit collateral from vault, write position.

**Constructor signature:**
```solidity
constructor(
    address vault_,
    address oracle_,
    address compliance_,
    address liquidationPool_,
    address admin_
);
```

**Core function:**
```solidity
function openPosition(
    externalEuint64 eSize, bytes calldata sizeProof,
    externalEuint64 eCollateral, bytes calldata collateralProof,
    bool isLong,
    uint8 marketId,
    bytes32[] calldata complianceProof
) external whenNotPaused returns (uint256 positionId);
```

- [ ] **Step 1: Write failing test**

Create `/Users/ram/Desktop/NoirPerp/contracts/test/PerpEngine.Open.test.ts`:

```typescript
import { expect } from "chai";
import * as hre from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import type { NoirVault, MockERC7984, Oracle, Compliance, PerpEngine } from "../typechain-types";

const MARKET_BTC = 1;
const MARKET_ETH = 2;
const MARKET_SOL = 3;
const STALENESS = 90;
const DEVIATION_BPS = 50;
const MAX_LEVERAGE = 20;
const MAINT_MARGIN_BPS = 500;
const LIQ_FEE_BPS = 50;

describe("PerpEngine — openPosition", () => {
  let vault: NoirVault;
  let token: MockERC7984;
  let oracle: Oracle;
  let compliance: Compliance;
  let engine: PerpEngine;
  let admin: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let relayerA: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let relayerB: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let relayerC: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let alice: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let nonKycUser: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];

  let aliceProof: string[];

  async function now(): Promise<number> {
    const blk = await hre.ethers.provider.getBlock("latest");
    return blk!.timestamp;
  }

  async function encryptInput(contract: string, user: string, value: bigint) {
    const input = hre.fhevm.createEncryptedInput(contract, user);
    input.add64(value);
    return await input.encrypt();
  }

  async function commitPrice(marketId: number, price: bigint) {
    const t = await now();
    await (await oracle.connect(relayerA).submitPrice(marketId, price, t)).wait();
    await (await oracle.connect(relayerB).submitPrice(marketId, price, t + 1)).wait();
  }

  beforeEach(async () => {
    [admin, relayerA, relayerB, relayerC, alice, nonKycUser] = await hre.ethers.getSigners();

    // Deploy token + seed alice
    const TokenFactory = await hre.ethers.getContractFactory("MockERC7984");
    token = (await TokenFactory.deploy("MockUSDCx", "mUSDCx")) as unknown as MockERC7984;
    await token.waitForDeployment();
    await (await token.mintPlaintext(alice.address, 100_000n)).wait();

    // Deploy vault
    const VaultFactory = await hre.ethers.getContractFactory("NoirVault");
    vault = (await VaultFactory.deploy(admin.address, await token.getAddress())) as unknown as NoirVault;
    await vault.waitForDeployment();

    // Deploy oracle
    const OracleFactory = await hre.ethers.getContractFactory("Oracle");
    oracle = (await OracleFactory.deploy(
      admin.address,
      [relayerA.address, relayerB.address, relayerC.address],
      STALENESS,
      DEVIATION_BPS,
    )) as unknown as Oracle;
    await oracle.waitForDeployment();

    // Deploy compliance with alice's address allowlisted
    const tree = StandardMerkleTree.of([[alice.address]], ["address"]);
    aliceProof = tree.getProof([alice.address]);
    const ComplianceFactory = await hre.ethers.getContractFactory("Compliance");
    compliance = (await ComplianceFactory.deploy(admin.address, tree.root)) as unknown as Compliance;
    await compliance.waitForDeployment();

    // Deploy engine
    const EngineFactory = await hre.ethers.getContractFactory("PerpEngine");
    engine = (await EngineFactory.deploy(
      await vault.getAddress(),
      await oracle.getAddress(),
      await compliance.getAddress(),
      admin.address, // liquidationPool = admin in tests
      admin.address,
    )) as unknown as PerpEngine;
    await engine.waitForDeployment();

    // Authorize engine on vault
    await (await vault.registerEngine(await engine.getAddress())).wait();

    // Alice deposits 10_000 into vault
    await (await token.connect(alice).setOperator(await vault.getAddress(), 2n ** 48n - 1n)).wait();
    await (await vault.connect(alice).deposit(10_000n)).wait();

    // Commit an ETH price so tests have fresh oracle
    await commitPrice(MARKET_ETH, 3000n);
  });

  describe("happy path", () => {
    it("opens a long position when margin + balance are sufficient", async () => {
      // size = 10 ETH, collateral = 1500 USDC at 3000/ETH
      // notional = 10 * 3000 = 30_000 ; capacity = 1500 * 20 = 30_000 → exactly allowed
      const engineAddr = await engine.getAddress();
      const sizeEnc = await encryptInput(engineAddr, alice.address, 10n);
      const collEnc = await encryptInput(engineAddr, alice.address, 1500n);

      const tx = await engine.connect(alice).openPosition(
        sizeEnc.handles[0],
        sizeEnc.inputProof,
        collEnc.handles[0],
        collEnc.inputProof,
        true, // isLong
        MARKET_ETH,
        aliceProof,
      );
      const receipt = await tx.wait();
      expect(receipt!.status).to.equal(1);

      // First position → id 0
      const pos = await vault.getPosition(0);
      expect(pos.owner).to.equal(alice.address);
      expect(pos.isLong).to.equal(true);
      expect(pos.marketId).to.equal(MARKET_ETH);
      expect(pos.active).to.equal(true);

      // Decrypt position values (alice should have allow via writePosition grant)
      const size = await hre.fhevm.userDecryptEuint(FhevmType.euint64, pos.size, await vault.getAddress(), alice);
      const coll = await hre.fhevm.userDecryptEuint(FhevmType.euint64, pos.collateral, await vault.getAddress(), alice);
      const entry = await hre.fhevm.userDecryptEuint(FhevmType.euint64, pos.entryPrice, await vault.getAddress(), alice);
      expect(size).to.equal(10n);
      expect(coll).to.equal(1500n);
      expect(entry).to.equal(3000n);

      // Alice's vault balance debited by 1500 → 10_000 - 1500 = 8_500
      const balHandle = await vault.getBalance(alice.address);
      const bal = await hre.fhevm.userDecryptEuint(FhevmType.euint64, balHandle, await vault.getAddress(), alice);
      expect(bal).to.equal(8_500n);
    });

    it("opens a short position", async () => {
      const engineAddr = await engine.getAddress();
      const sizeEnc = await encryptInput(engineAddr, alice.address, 5n);
      const collEnc = await encryptInput(engineAddr, alice.address, 1000n);

      await (await engine.connect(alice).openPosition(
        sizeEnc.handles[0], sizeEnc.inputProof,
        collEnc.handles[0], collEnc.inputProof,
        false, MARKET_ETH, aliceProof,
      )).wait();

      const pos = await vault.getPosition(0);
      expect(pos.isLong).to.equal(false);
    });
  });

  describe("silent-zero (insufficient margin)", () => {
    it("writes a 0-size / 0-collateral position when leverage exceeds max", async () => {
      // size = 10 ETH, collateral = 100 USDC → notional 30_000, capacity 2_000 → FAIL
      const engineAddr = await engine.getAddress();
      const sizeEnc = await encryptInput(engineAddr, alice.address, 10n);
      const collEnc = await encryptInput(engineAddr, alice.address, 100n);

      await (await engine.connect(alice).openPosition(
        sizeEnc.handles[0], sizeEnc.inputProof,
        collEnc.handles[0], collEnc.inputProof,
        true, MARKET_ETH, aliceProof,
      )).wait();

      const pos = await vault.getPosition(0);
      expect(pos.active).to.equal(true); // position does get written
      const size = await hre.fhevm.userDecryptEuint(FhevmType.euint64, pos.size, await vault.getAddress(), alice);
      const coll = await hre.fhevm.userDecryptEuint(FhevmType.euint64, pos.collateral, await vault.getAddress(), alice);
      expect(size).to.equal(0n);
      expect(coll).to.equal(0n);

      // Balance not debited
      const balHandle = await vault.getBalance(alice.address);
      const bal = await hre.fhevm.userDecryptEuint(FhevmType.euint64, balHandle, await vault.getAddress(), alice);
      expect(bal).to.equal(10_000n);
    });
  });

  describe("silent-zero (insufficient balance)", () => {
    it("writes a 0-size / 0-collateral position when collateral > balance", async () => {
      // alice has 10_000 in vault. Submits collateral = 20_000.
      // Even though margin would be fine (20k * 20 = 400k >= size * price),
      // balance check fails → final values zeroed.
      const engineAddr = await engine.getAddress();
      const sizeEnc = await encryptInput(engineAddr, alice.address, 100n);
      const collEnc = await encryptInput(engineAddr, alice.address, 20_000n);

      await (await engine.connect(alice).openPosition(
        sizeEnc.handles[0], sizeEnc.inputProof,
        collEnc.handles[0], collEnc.inputProof,
        true, MARKET_ETH, aliceProof,
      )).wait();

      const pos = await vault.getPosition(0);
      const coll = await hre.fhevm.userDecryptEuint(FhevmType.euint64, pos.collateral, await vault.getAddress(), alice);
      expect(coll).to.equal(0n);

      const balHandle = await vault.getBalance(alice.address);
      const bal = await hre.fhevm.userDecryptEuint(FhevmType.euint64, balHandle, await vault.getAddress(), alice);
      expect(bal).to.equal(10_000n); // unchanged
    });
  });

  describe("guards", () => {
    it("reverts on non-KYC user", async () => {
      const engineAddr = await engine.getAddress();
      const sizeEnc = await encryptInput(engineAddr, nonKycUser.address, 10n);
      const collEnc = await encryptInput(engineAddr, nonKycUser.address, 1500n);

      await expect(
        engine.connect(nonKycUser).openPosition(
          sizeEnc.handles[0], sizeEnc.inputProof,
          collEnc.handles[0], collEnc.inputProof,
          true, MARKET_ETH, aliceProof, // wrong proof for nonKycUser
        )
      ).to.be.revertedWithCustomError(engine, "NotCompliant");
    });

    it("reverts on stale oracle", async () => {
      // Jump time past staleness window
      await hre.ethers.provider.send("evm_increaseTime", [STALENESS + 10]);
      await hre.ethers.provider.send("evm_mine", []);

      const engineAddr = await engine.getAddress();
      const sizeEnc = await encryptInput(engineAddr, alice.address, 10n);
      const collEnc = await encryptInput(engineAddr, alice.address, 1500n);

      await expect(
        engine.connect(alice).openPosition(
          sizeEnc.handles[0], sizeEnc.inputProof,
          collEnc.handles[0], collEnc.inputProof,
          true, MARKET_ETH, aliceProof,
        )
      ).to.be.revertedWithCustomError(engine, "OraclePriceStale");
    });

    it("reverts on invalid market id", async () => {
      const engineAddr = await engine.getAddress();
      const sizeEnc = await encryptInput(engineAddr, alice.address, 10n);
      const collEnc = await encryptInput(engineAddr, alice.address, 1500n);

      await expect(
        engine.connect(alice).openPosition(
          sizeEnc.handles[0], sizeEnc.inputProof,
          collEnc.handles[0], collEnc.inputProof,
          true, 99, aliceProof, // invalid marketId
        )
      ).to.be.revertedWithCustomError(engine, "InvalidMarket");
    });
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test test/PerpEngine.Open.test.ts
```
Expected: FAIL with missing `PerpEngine` typechain.

- [ ] **Step 3: Implement `PerpEngine.sol`**

Create `/Users/ram/Desktop/NoirPerp/contracts/contracts/engines/PerpEngine.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { FHE, euint64, ebool, externalEuint64 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";
import { FHESafeMath } from "../lib/FHESafeMath.sol";
import { MarginMath } from "../lib/MarginMath.sol";
import { DecryptQueue } from "../lib/DecryptQueue.sol";
import { NoirVault } from "../NoirVault.sol";
import { Oracle } from "../services/Oracle.sol";
import { Compliance } from "../services/Compliance.sol";

/// @title PerpEngine
/// @notice Perpetual futures engine. Open/close synchronous; liquidation async.
///         All ciphertext state lives in NoirVault; this contract is stateless
///         except for config and the decrypt-request queue (inherited).
/// @dev Inherits DecryptQueue for async-liquidation replay guard + timeout.
///      `openPosition` and `closePosition` are sync because the entire flow
///      produces a verifiable outcome in one tx (via FHE.select-guarded math).
///      `requestLiquidation` → `_onLiquidationDecided` is 2-phase: FHE margin
///      check produces `ebool`, Gateway KMS decrypts the bit, callback acts.
contract PerpEngine is DecryptQueue, ZamaEthereumConfig {
    NoirVault public immutable vault;
    Oracle public immutable oracle;
    Compliance public immutable compliance;

    address public admin;
    address public liquidationPool;

    uint64 public constant MAX_LEVERAGE = 20;
    uint64 public constant MAINTENANCE_MARGIN_BPS = 500;   // 5%
    uint64 public constant LIQUIDATOR_FEE_BPS = 50;        // 0.5%
    uint64 private constant BPS_DIVISOR = 10_000;

    event PositionOpened(uint256 indexed positionId, address indexed owner, uint8 marketId);
    event LiquidationRequested(uint256 indexed requestId, uint256 indexed positionId, address indexed keeper);
    event Liquidated(uint256 indexed positionId, address indexed keeper);
    event LiquidationChecked(uint256 indexed positionId);
    event PositionClosed(uint256 indexed positionId, address indexed owner);
    event AdminTransferred(address indexed oldAdmin, address indexed newAdmin);
    event LiquidationPoolChanged(address indexed oldPool, address indexed newPool);

    error NotAdmin();
    error NotCompliant();
    error OraclePriceStale();
    error InvalidMarket();
    error ZeroAddress();
    error NotPositionOwner();
    error PositionNotActive();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    modifier whenNotPaused() {
        // Cascade from vault's pause state.
        if (vault.paused()) revert NoirVault.VaultPaused();
        _;
    }

    constructor(
        address vault_,
        address oracle_,
        address compliance_,
        address liquidationPool_,
        address admin_
    ) {
        if (vault_ == address(0) || oracle_ == address(0) || compliance_ == address(0)
            || liquidationPool_ == address(0) || admin_ == address(0)) {
            revert ZeroAddress();
        }
        vault = NoirVault(vault_);
        oracle = Oracle(oracle_);
        compliance = Compliance(compliance_);
        liquidationPool = liquidationPool_;
        admin = admin_;
        emit AdminTransferred(address(0), admin_);
        emit LiquidationPoolChanged(address(0), liquidationPool_);
    }

    // ─── Admin ─────────────────────────────────────────────────────────

    function transferAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        address old = admin;
        admin = newAdmin;
        emit AdminTransferred(old, newAdmin);
    }

    function setLiquidationPool(address newPool) external onlyAdmin {
        if (newPool == address(0)) revert ZeroAddress();
        address old = liquidationPool;
        liquidationPool = newPool;
        emit LiquidationPoolChanged(old, newPool);
    }

    // ─── Open position (synchronous) ───────────────────────────────────

    /// @notice Opens a perpetual position. If margin or balance insufficient,
    ///         final size/collateral silently zero (position still written).
    ///         User decrypts their own position client-side to see outcome.
    function openPosition(
        externalEuint64 eSize,
        bytes calldata sizeProof,
        externalEuint64 eCollateral,
        bytes calldata collateralProof,
        bool isLong,
        uint8 marketId,
        bytes32[] calldata complianceProof
    ) external whenNotPaused returns (uint256 positionId) {
        // Compliance gate
        if (!compliance.verify(msg.sender, complianceProof)) revert NotCompliant();
        // Market gate
        if (marketId < 1 || marketId > 3) revert InvalidMarket();
        // Oracle freshness
        (uint64 price, bool fresh) = oracle.getPrice(marketId);
        if (!fresh) revert OraclePriceStale();

        // Import encrypted inputs (with proofs)
        euint64 size = FHE.fromExternal(eSize, sizeProof);
        euint64 collateral = FHE.fromExternal(eCollateral, collateralProof);
        require(FHE.isSenderAllowed(size), "PerpEngine: size not allowed");
        require(FHE.isSenderAllowed(collateral), "PerpEngine: collateral not allowed");

        // Trivial-encrypt price
        euint64 ePrice = FHE.asEuint64(price);

        // Read user's current vault balance (transient ACL via vault helper)
        euint64 balance = vault.allowBalanceAccess(msg.sender);

        // FHE checks: balanceOK (balance >= collateral) AND marginOK
        ebool balanceOK = FHE.ge(balance, collateral);
        euint64 notionalValue = MarginMath.notional(size, ePrice);
        ebool marginOK = MarginMath.marginOK(collateral, notionalValue, MAX_LEVERAGE);
        ebool allOK = FHE.and(balanceOK, marginOK);

        // Silent-zero if either check fails
        euint64 zero = FHE.asEuint64(0);
        euint64 finalSize = FHE.select(allOK, size, zero);
        euint64 finalCollateral = FHE.select(allOK, collateral, zero);

        // Debit vault balance by finalCollateral
        FHE.allowTransient(finalCollateral, address(vault));
        vault.adjustBalance(msg.sender, finalCollateral, false);

        // Write the position to vault. Grant vault transient on all ciphertext args.
        // (finalCollateral was already granted transient above, but allowTransient is
        // tx-scoped and idempotent — granting again is cheap.)
        FHE.allowTransient(finalSize, address(vault));
        FHE.allowTransient(ePrice, address(vault));
        FHE.allowTransient(finalCollateral, address(vault));
        positionId = vault.writePosition(
            msg.sender,
            finalSize,
            ePrice,
            finalCollateral,
            isLong,
            marketId
        );

        emit PositionOpened(positionId, msg.sender, marketId);
    }
}
```

**⚠️ NoirVault.VaultPaused error access**: the engine's `whenNotPaused` modifier reverts with `NoirVault.VaultPaused()`. This syntax accesses a custom error from an imported contract. If Solidity ^0.8.27 doesn't accept this syntax, the fallback is to define a local `error VaultPaused()` on PerpEngine and use it, OR use a string revert. Check compilation; adjust if needed and document the deviation.

- [ ] **Step 4: Compile**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat compile
```
Expected: `Compiled N Solidity files successfully`. Any error → read carefully, the import paths or the NoirVault.VaultPaused syntax may need adjustment.

- [ ] **Step 5: Run the open tests**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test test/PerpEngine.Open.test.ts
```
Expected: 6 passing (2 happy + 1 insufficient-margin + 1 insufficient-balance + 3 guards). Investigate failures:

- **ACL error on `balance` read**: `vault.allowBalanceAccess(msg.sender)` returns a ciphertext with transient-to-engine. PerpEngine should be able to use it directly in `FHE.ge(balance, collateral)`. If fails, verify Task 1 step 3's `FHE.allowTransient(bal, msg.sender)` is present in the vault function.
- **`NotCompliant` fires incorrectly**: the Merkle proof format must match `keccak256(bytes.concat(keccak256(abi.encode(user))))` in both JS and Solidity. Phase 2 already tested this — shouldn't break.
- **`createEncryptedInput` not a function**: check the Relayer SDK version; API might be `hre.fhevm.createEncryptedInput(contractAddress, userAddress)`. Inspect `@fhevm/hardhat-plugin/dist/index.d.ts` if unsure.

- [ ] **Step 6: CHANGELOG entry**

Append:
```markdown
- **Added**: `contracts/contracts/engines/PerpEngine.sol` — perpetual
  futures engine (Task 2 scaffold: admin + openPosition). Inherits
  `DecryptQueue` for later async-liquidation work. Config locked at
  construction: MAX_LEVERAGE=20, MAINT_MARGIN=500bps, LIQ_FEE=50bps.
  `openPosition` synchronous: compliance gate, oracle freshness, then
  FHE-guarded balance + margin check with silent-zero on failure.
  6 unit tests.
  **Files**: `contracts/contracts/engines/PerpEngine.sol`,
  `contracts/test/PerpEngine.Open.test.ts`.
```

- [ ] **Step 7: Commit**

```bash
cd /Users/ram/Desktop/NoirPerp && git add contracts/contracts/engines/PerpEngine.sol contracts/test/PerpEngine.Open.test.ts CHANGELOG.md && git -c user.email=developer@randao.net -c user.name="Ram" commit -q -m "feat(engine): add PerpEngine scaffold + openPosition (sync)

Inherits DecryptQueue for async-liquidation replay guard. Config
locked at construction: MAX_LEVERAGE=20, MAINT_MARGIN=500bps,
LIQ_FEE=50bps. openPosition is fully synchronous: compliance gate,
oracle freshness, then FHE-guarded balance + margin check with
silent-zero semantics on failure. User decrypts position
client-side to observe the outcome.

6 unit tests (long happy path, short, insufficient margin, insufficient
balance, non-KYC, stale oracle, invalid market).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `PerpEngine` — `closePosition` (synchronous)

**Files:**
- Modify: `contracts/contracts/engines/PerpEngine.sol` (append `closePosition`)
- Create: `contracts/test/PerpEngine.Close.test.ts`

**Purpose:** User-initiated close. Synchronous PnL computation in FHE (split into profit/loss branches per `MarginMath.pnlLong`/`pnlShort`), payout = `safeAdd(safeSub(collateral, loss), profit)`, credit user balance, mark position closed.

- [ ] **Step 1: Write failing test**

Create `/Users/ram/Desktop/NoirPerp/contracts/test/PerpEngine.Close.test.ts`:

```typescript
import { expect } from "chai";
import * as hre from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import type { NoirVault, MockERC7984, Oracle, Compliance, PerpEngine } from "../typechain-types";

const MARKET_ETH = 2;
const STALENESS = 90;
const DEVIATION_BPS = 50;

describe("PerpEngine — closePosition", () => {
  let vault: NoirVault;
  let token: MockERC7984;
  let oracle: Oracle;
  let compliance: Compliance;
  let engine: PerpEngine;
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
      admin.address,
      [relayerA.address, relayerB.address, relayerC.address],
      STALENESS, DEVIATION_BPS,
    )) as unknown as Oracle;
    await oracle.waitForDeployment();

    const tree = StandardMerkleTree.of([[alice.address]], ["address"]);
    aliceProof = tree.getProof([alice.address]);
    const ComplianceFactory = await hre.ethers.getContractFactory("Compliance");
    compliance = (await ComplianceFactory.deploy(admin.address, tree.root)) as unknown as Compliance;
    await compliance.waitForDeployment();

    const EngineFactory = await hre.ethers.getContractFactory("PerpEngine");
    engine = (await EngineFactory.deploy(
      await vault.getAddress(),
      await oracle.getAddress(),
      await compliance.getAddress(),
      admin.address,
      admin.address,
    )) as unknown as PerpEngine;
    await engine.waitForDeployment();

    await (await vault.registerEngine(await engine.getAddress())).wait();

    await (await token.connect(alice).setOperator(await vault.getAddress(), 2n ** 48n - 1n)).wait();
    await (await vault.connect(alice).deposit(10_000n)).wait();

    // Commit price at entry
    await commitPrice(MARKET_ETH, 3000n);

    // Alice opens a 10-ETH long at 3000 with 1500 collateral (10x leverage)
    const engineAddr = await engine.getAddress();
    const sizeEnc = await encrypt(engineAddr, alice.address, 10n);
    const collEnc = await encrypt(engineAddr, alice.address, 1500n);
    await (await engine.connect(alice).openPosition(
      sizeEnc.handles[0], sizeEnc.inputProof,
      collEnc.handles[0], collEnc.inputProof,
      true, MARKET_ETH, aliceProof,
    )).wait();
    // Position 0 is now open. Vault balance = 10_000 - 1500 = 8_500.
  });

  describe("profitable long close", () => {
    it("pays out collateral + profit when price rises", async () => {
      // Price 3000 → 3100 means profit = size * (3100 - 3000) = 10 * 100 = 1000
      // Payout = collateral + profit - loss = 1500 + 1000 - 0 = 2500
      await commitPrice(MARKET_ETH, 3100n);

      await (await engine.connect(alice).closePosition(0)).wait();

      const balHandle = await vault.getBalance(alice.address);
      const bal = await decrypt(balHandle, await vault.getAddress(), alice);
      // Balance = 8_500 (post-open) + 2_500 (payout) = 11_000
      expect(bal).to.equal(11_000n);

      const pos = await vault.getPosition(0);
      expect(pos.active).to.equal(false);
    });
  });

  describe("losing long close", () => {
    it("returns collateral minus loss when price falls", async () => {
      // Price 3000 → 2950 means loss = size * (3000 - 2950) = 10 * 50 = 500
      // Payout = max(0, 1500 - 500) + 0 = 1000
      await commitPrice(MARKET_ETH, 2950n);

      await (await engine.connect(alice).closePosition(0)).wait();

      const balHandle = await vault.getBalance(alice.address);
      const bal = await decrypt(balHandle, await vault.getAddress(), alice);
      // Balance = 8_500 + 1_000 = 9_500
      expect(bal).to.equal(9_500n);
    });

    it("saturates payout at 0 when loss exceeds collateral", async () => {
      // Price 3000 → 2000 means loss = 10 * 1000 = 10_000, exceeding 1500 collateral
      // Payout = safeSub(1500, 10000) = 0, + 0 profit = 0
      await commitPrice(MARKET_ETH, 2000n);

      await (await engine.connect(alice).closePosition(0)).wait();

      const balHandle = await vault.getBalance(alice.address);
      const bal = await decrypt(balHandle, await vault.getAddress(), alice);
      // Balance = 8_500 + 0 = 8_500 (unchanged)
      expect(bal).to.equal(8_500n);
    });
  });

  describe("flat close (no price change)", () => {
    it("returns exactly the collateral", async () => {
      // Price unchanged at 3000 → profit = 0, loss = 0 → payout = 1500
      await (await engine.connect(alice).closePosition(0)).wait();

      const balHandle = await vault.getBalance(alice.address);
      const bal = await decrypt(balHandle, await vault.getAddress(), alice);
      expect(bal).to.equal(10_000n); // 8_500 + 1_500
    });
  });

  describe("guards", () => {
    it("reverts if caller is not the position owner", async () => {
      await expect(
        engine.connect(bob).closePosition(0)
      ).to.be.revertedWithCustomError(engine, "NotPositionOwner");
    });

    it("reverts on already-closed position", async () => {
      await (await engine.connect(alice).closePosition(0)).wait();
      await expect(
        engine.connect(alice).closePosition(0)
      ).to.be.revertedWithCustomError(engine, "PositionNotActive");
    });

    it("reverts on stale oracle at close time", async () => {
      await hre.ethers.provider.send("evm_increaseTime", [STALENESS + 10]);
      await hre.ethers.provider.send("evm_mine", []);

      await expect(
        engine.connect(alice).closePosition(0)
      ).to.be.revertedWithCustomError(engine, "OraclePriceStale");
    });
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test test/PerpEngine.Close.test.ts
```
Expected: FAIL — `closePosition` not implemented yet.

- [ ] **Step 3: Implement `closePosition` in `PerpEngine.sol`**

Append to `PerpEngine.sol` (before the closing `}`):

```solidity
    // ─── Close position (synchronous) ──────────────────────────────────

    /// @notice Closes a caller-owned position. Computes encrypted PnL
    ///         synchronously using multiplication-only math, credits payout
    ///         to the caller's vault balance, and marks the position inactive.
    /// @dev Caller decrypts their updated balance client-side to observe
    ///      realized value. Saturating safe-math throughout — losses that
    ///      exceed collateral produce 0 payout, never negative.
    function closePosition(uint256 positionId) external whenNotPaused {
        // Fetch position with transient ACL on each ciphertext field
        NoirVault.Position memory p = vault.allowPositionAccess(positionId);

        // Ownership + lifecycle guards (plaintext fields, no FHE needed)
        if (p.owner != msg.sender) revert NotPositionOwner();
        if (!p.active) revert PositionNotActive();

        // Oracle freshness
        (uint64 price, bool fresh) = oracle.getPrice(p.marketId);
        if (!fresh) revert OraclePriceStale();
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

        // Mark position closed
        vault.closePosition(positionId);

        emit PositionClosed(positionId, p.owner);
    }
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test test/PerpEngine.Close.test.ts
```
Expected: 6 passing.

Common failure modes:
- **"not allowed" on `p.collateral`**: `allowPositionAccess` must grant transient to `msg.sender` (the engine). Verify Task 1's implementation.
- **Profit calculation gives wrong value**: verify `MarginMath.pnlLong` signature matches — it returns `(euint64 profit, euint64 loss)` where both are non-negative and exactly one is non-zero.
- **Saturation test fails**: ensure `safeSub` + `safeAdd` are used, not raw ops.

- [ ] **Step 5: Verify full suite green**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test 2>&1 | tail -3
```
Expected: **155 passing** (143 + 6 open + 6 close).

- [ ] **Step 6: CHANGELOG entry**

Append:
```markdown
- **Added**: `PerpEngine.closePosition(positionId)` — synchronous close.
  Fetches position via `vault.allowPositionAccess`, computes encrypted
  PnL via `MarginMath.pnlLong/pnlShort` (profit/loss branches), pays
  out `safeAdd(safeSub(collateral, loss), profit)` to user's vault
  balance, marks position inactive. Saturating throughout — loss
  exceeding collateral produces 0 payout. 6 unit tests (profitable,
  losing, max-loss-saturation, flat, ownership, double-close, stale oracle).
  **Files**: `contracts/contracts/engines/PerpEngine.sol`,
  `contracts/test/PerpEngine.Close.test.ts`.
```

- [ ] **Step 7: Commit**

```bash
cd /Users/ram/Desktop/NoirPerp && git add contracts/contracts/engines/PerpEngine.sol contracts/test/PerpEngine.Close.test.ts CHANGELOG.md && git -c user.email=developer@randao.net -c user.name="Ram" commit -q -m "feat(engine): add PerpEngine.closePosition (sync)

Synchronous close: reads position via vault.allowPositionAccess,
computes encrypted PnL (MarginMath.pnlLong/Short returning
profit/loss branches), pays out safeAdd(safeSub(collateral, loss),
profit) saturating. Credits vault balance, marks position inactive.
6 unit tests covering profitable, losing, max-loss-saturation, flat,
ownership guard, double-close guard, stale oracle.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `PerpEngine` — `requestLiquidation` + `_onLiquidationDecided` (async)

**Files:**
- Modify: `contracts/contracts/engines/PerpEngine.sol` (append)
- Create: `contracts/test/PerpEngine.Liquidation.test.ts`

**Purpose:** Bot-triggered liquidation. Two-phase state machine: (1) `requestLiquidation` computes underwater-ness on ciphertexts, produces an `ebool`, requests Gateway decryption, enqueues the pending state; (2) `_onLiquidationDecided` fires ~15-60s later, verifies the Gateway signature, dequeues (replay guard), and conditionally liquidates — forfeiting collateral to `liquidationPool` minus a keeper fee.

- [ ] **Step 1: Write failing test**

Create `/Users/ram/Desktop/NoirPerp/contracts/test/PerpEngine.Liquidation.test.ts`:

```typescript
import { expect } from "chai";
import * as hre from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import type { NoirVault, MockERC7984, Oracle, Compliance, PerpEngine } from "../typechain-types";

const MARKET_ETH = 2;
const STALENESS = 90;
const DEVIATION_BPS = 50;

describe("PerpEngine — liquidation (async)", () => {
  let vault: NoirVault;
  let token: MockERC7984;
  let oracle: Oracle;
  let compliance: Compliance;
  let engine: PerpEngine;
  let admin: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let relayerA: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let relayerB: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let relayerC: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let alice: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let keeper: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let pool: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
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

  async function decrypt(handle: string, contractAddr: string, signer: typeof admin): Promise<bigint> {
    return hre.fhevm.userDecryptEuint(FhevmType.euint64, handle, contractAddr, signer);
  }

  beforeEach(async () => {
    [admin, relayerA, relayerB, relayerC, alice, keeper, pool] = await hre.ethers.getSigners();

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

    const EngineFactory = await hre.ethers.getContractFactory("PerpEngine");
    engine = (await EngineFactory.deploy(
      await vault.getAddress(),
      await oracle.getAddress(),
      await compliance.getAddress(),
      pool.address,   // liquidationPool = separate account
      admin.address,
    )) as unknown as PerpEngine;
    await engine.waitForDeployment();

    await (await vault.registerEngine(await engine.getAddress())).wait();

    await (await token.connect(alice).setOperator(await vault.getAddress(), 2n ** 48n - 1n)).wait();
    await (await vault.connect(alice).deposit(10_000n)).wait();

    // Entry price 3000
    await commitPrice(MARKET_ETH, 3000n);

    // Alice opens 10-ETH long with 1500 collateral. Entry notional = 30_000.
    // Maintenance margin = 500bps → liquidation when loss >= 5% of collateral = 75
    // Loss = size * (entry - curr) = 10 * (3000 - curr). Liq threshold: 10 * delta >= 75 → delta >= 7.5
    // So price drop of 7.5 triggers liquidation.
    const engineAddr = await engine.getAddress();
    const sizeEnc = await encrypt(engineAddr, alice.address, 10n);
    const collEnc = await encrypt(engineAddr, alice.address, 1500n);
    await (await engine.connect(alice).openPosition(
      sizeEnc.handles[0], sizeEnc.inputProof,
      collEnc.handles[0], collEnc.inputProof,
      true, MARKET_ETH, aliceProof,
    )).wait();
  });

  describe("underwater position", () => {
    it("liquidates when price drops sufficiently", async () => {
      // Drop price to 2990 → loss = 10 * 10 = 100. Loss/collateral = 100/1500 = 6.67%
      // Maintenance = 5%. 6.67% >= 5% → liquidate.
      await commitPrice(MARKET_ETH, 2990n);

      // Bot requests liquidation
      const reqTx = await engine.connect(keeper).requestLiquidation(0);
      const reqReceipt = await reqTx.wait();
      expect(reqReceipt!.status).to.equal(1);

      // In mock FHEVM, the Gateway callback auto-fulfills. Advance by awaiting
      // the plugin's fulfillment helper. If hre.fhevm exposes a waitForDecrypts
      // method, use it; otherwise mine a few blocks and inspect emitted events.
      await hre.fhevm.awaitDecryptionOracle();

      // Position should now be closed
      const pos = await vault.getPosition(0);
      expect(pos.active).to.equal(false);

      // Pool balance credited (1500 - 1500*50bps = 1500 - 7.5, rounded: 1492 or 1493)
      const poolBalHandle = await vault.getBalance(pool.address);
      const poolBal = await decrypt(poolBalHandle, await vault.getAddress(), pool);
      // Fee = 1500 * 50 / 10000 = 7
      expect(poolBal).to.equal(1500n - 7n);

      // Keeper balance credited with the 7-unit fee
      const keeperBalHandle = await vault.getBalance(keeper.address);
      const keeperBal = await decrypt(keeperBalHandle, await vault.getAddress(), keeper);
      expect(keeperBal).to.equal(7n);
    });
  });

  describe("healthy position", () => {
    it("does not liquidate when price is only slightly adverse", async () => {
      // Drop price to 2999 → loss = 10. Loss/collateral = 10/1500 = 0.67% < 5%
      await commitPrice(MARKET_ETH, 2999n);

      await (await engine.connect(keeper).requestLiquidation(0)).wait();
      await hre.fhevm.awaitDecryptionOracle();

      // Position should still be active
      const pos = await vault.getPosition(0);
      expect(pos.active).to.equal(true);
    });
  });

  describe("guards", () => {
    it("reverts requestLiquidation on non-active position", async () => {
      // Close the position first
      await (await engine.connect(alice).closePosition(0)).wait();

      await expect(
        engine.connect(keeper).requestLiquidation(0)
      ).to.be.revertedWithCustomError(engine, "PositionNotActive");
    });

    it("reverts requestLiquidation on stale oracle", async () => {
      await hre.ethers.provider.send("evm_increaseTime", [STALENESS + 10]);
      await hre.ethers.provider.send("evm_mine", []);

      await expect(
        engine.connect(keeper).requestLiquidation(0)
      ).to.be.revertedWithCustomError(engine, "OraclePriceStale");
    });
  });
});
```

**IMPORTANT — Gateway mock helper**: `hre.fhevm.awaitDecryptionOracle()` is the expected helper to force the mock FHEVM to fulfill pending `FHE.requestDecryption` callbacks. If the exact name differs in `@fhevm/hardhat-plugin@0.4.2`, check the plugin's README or `dist/index.d.ts` for the correct API. Common alternatives:
- `hre.fhevm.awaitDecryptions()`
- `hre.fhevm.fulfillDecryptions()`
- Automatic fulfillment within the same tx (no explicit await needed)

Adjust the test accordingly. Document in CHANGELOG if the API differs.

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test test/PerpEngine.Liquidation.test.ts
```

- [ ] **Step 3: Implement `requestLiquidation` + callback**

Append to `PerpEngine.sol` (before the closing `}`):

```solidity
    // ─── Liquidation (asynchronous 2-phase) ────────────────────────────

    /// @notice Bot-callable. Evaluates margin on ciphertexts; requests
    ///         Gateway decryption of the `underwater` ebool. The callback
    ///         `_onLiquidationDecided` executes the actual liquidation
    ///         (15-60s later on Sepolia; near-instant on mock).
    /// @dev Keeper pays the Gateway decrypt fee (~$0.001-$0.1 in $ZAMA).
    ///      If position is not underwater, the callback is a no-op and
    ///      the fee is lost to the keeper. Keepers should watch for
    ///      significant price moves before triggering.
    function requestLiquidation(uint256 positionId) external whenNotPaused returns (uint256 requestId) {
        NoirVault.Position memory p = vault.allowPositionAccess(positionId);
        if (!p.active) revert PositionNotActive();

        (uint64 price, bool fresh) = oracle.getPrice(p.marketId);
        if (!fresh) revert OraclePriceStale();
        euint64 ePrice = FHE.asEuint64(price);

        // Compute unrealized loss via pnlLong / pnlShort
        (euint64 profit, euint64 loss) = p.isLong
            ? MarginMath.pnlLong(p.size, p.entryPrice, ePrice)
            : MarginMath.pnlShort(p.size, p.entryPrice, ePrice);
        // profit is unused for liquidation — we only care about loss
        profit; // silence unused-variable warning

        // Liquidation condition: loss × BPS >= collateral × MAINT_BPS
        ebool underwater = MarginMath.shouldLiquidate(
            p.collateral,
            loss,
            MAINTENANCE_MARGIN_BPS
        );

        // Request Gateway decryption of the single bool
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(underwater);
        requestId = FHE.requestDecryption(cts, this._onLiquidationDecided.selector);

        // Enqueue pending entry. Context = positionId (single uint256 fits).
        _enqueue(requestId, msg.sender, positionId, "");

        emit LiquidationRequested(requestId, positionId, msg.sender);
    }

    /// @notice Gateway KMS callback. MUST check signatures, dequeue (replay
    ///         guard) BEFORE external calls, then act on the decrypted bool.
    /// @dev Called by the Gateway oracle. `cleartexts` encodes a single bool.
    function _onLiquidationDecided(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory decryptionProof
    ) external {
        FHE.checkSignatures(requestId, cleartexts, decryptionProof);

        // Dequeue BEFORE any external call — replay guard.
        PendingDecrypt memory ctx = _dequeue(requestId);

        bool shouldLiq = abi.decode(cleartexts, (bool));
        uint256 positionId = ctx.contextId;
        address keeper = ctx.caller;

        if (!shouldLiq) {
            emit LiquidationChecked(positionId);
            return;
        }

        // Re-read the position (may have closed between request + callback;
        // idempotent if already inactive — closePosition is a no-op).
        NoirVault.Position memory p = vault.allowPositionAccess(positionId);
        if (!p.active) {
            emit LiquidationChecked(positionId);
            return;
        }

        // Split collateral into keeper fee and forfeit-to-pool.
        // keeperFee = collateral * LIQ_FEE / BPS_DIVISOR
        // forfeit = collateral - keeperFee
        euint64 feeBps = FHE.asEuint64(LIQUIDATOR_FEE_BPS);
        euint64 bpsDiv = FHE.asEuint64(BPS_DIVISOR);
        // On-chain "mul then div by constant" is safe here because BPS_DIVISOR
        // is a plaintext uint64; we'd use FHE.div(ct, uint64), which is supported.
        euint64 keeperFee = FHE.div(FHESafeMath.safeMul(p.collateral, feeBps), BPS_DIVISOR);
        // silence unused
        bpsDiv;
        euint64 forfeit = FHESafeMath.safeSub(p.collateral, keeperFee);

        // Credit keeper and pool
        FHE.allowTransient(keeperFee, address(vault));
        vault.adjustBalance(keeper, keeperFee, true);
        FHE.allowTransient(forfeit, address(vault));
        vault.adjustBalance(liquidationPool, forfeit, true);

        // Close the position
        vault.closePosition(positionId);

        emit Liquidated(positionId, keeper);
    }
```

**⚠️ FHE.div(euint64, uint64) availability**: per `docs/fhe-primitives.md` §3, `FHE.div` with a plaintext (scalar) divisor is supported (715k HCU). Only ct/ct division is banned. The `keeperFee = ... / BPS_DIVISOR` computation uses the scalar form — confirm with the docs and adjust if the API is `FHE.divScalar` or similar. If it's genuinely unavailable, the fallback is:
- Compute `keeperFee` off-chain by decrypting `p.collateral` via another Gateway callback (adds another 15-60s roundtrip) — NOT worth it.
- OR: use bitshift approximation. LIQ_FEE_BPS=50, BPS_DIVISOR=10_000. `50/10_000 = 1/200`. No clean bitshift. Stick with scalar div if supported.
- OR: store fee as a fixed shift count (e.g., `>> 7 ≈ /128`). Imprecise but cheap. Document the precision loss.

- [ ] **Step 4: Run test — expect PASS**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test test/PerpEngine.Liquidation.test.ts
```
Expected: 4 passing.

Common failure modes:
- **`hre.fhevm.awaitDecryptionOracle` not a function**: API name differs. Find the actual via `cat node_modules/@fhevm/hardhat-plugin/dist/index.d.ts | grep -i "await\|decrypt"`. Adapt the test.
- **Liquidation does not fire on clearly underwater position**: the ciphertext margin condition may not match. Double-check `MarginMath.shouldLiquidate` is `loss × BPS_DIVISOR >= collateral × MAINT_BPS`. At loss=100, coll=1500, maint=500: 100*10_000 = 1M ≥ 1500*500 = 750k → yes liquidate. If the test expects liquidation and it fails, check that you're passing `loss` (the 2nd return of `pnlLong`), not `profit`.
- **Pool/keeper balances off-by-a-few**: integer division rounds down. Fee = `1500 * 50 / 10_000 = 7` (since `75000 / 10_000 = 7.5 → 7`). Forfeit = `1500 - 7 = 1493`. Adjust test expectations if off by 1.

- [ ] **Step 5: Full suite check**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test 2>&1 | tail -3
```
Expected: **~159 passing** (155 + 4).

- [ ] **Step 6: CHANGELOG entry**

Append:
```markdown
- **Added**: `PerpEngine.requestLiquidation(positionId)` +
  `_onLiquidationDecided(reqId, cleartexts, proof)` callback. Two-phase
  async state machine: (1) compute `shouldLiquidate` ebool on ciphertexts
  via `MarginMath.shouldLiquidate`, request Gateway decryption; (2)
  callback checks signatures, dequeues (replay guard), conditionally
  liquidates. On liquidation: keeper fee (50bps) credited to caller,
  remainder forfeited to `liquidationPool`. Position marked closed.
  4 unit tests: underwater→liquidate, healthy→no-op, already-closed
  guard, stale oracle guard. Uses `hre.fhevm.awaitDecryptionOracle()`
  in mock env.
  **Files**: `contracts/contracts/engines/PerpEngine.sol`,
  `contracts/test/PerpEngine.Liquidation.test.ts`.
```

- [ ] **Step 7: Commit**

```bash
cd /Users/ram/Desktop/NoirPerp && git add contracts/contracts/engines/PerpEngine.sol contracts/test/PerpEngine.Liquidation.test.ts CHANGELOG.md && git -c user.email=developer@randao.net -c user.name="Ram" commit -q -m "feat(engine): add async liquidation (2-phase Gateway decrypt)

requestLiquidation computes ebool underwater on ciphertexts,
enqueues via DecryptQueue, triggers FHE.requestDecryption.
_onLiquidationDecided callback verifies signatures, dequeues BEFORE
external calls (replay guard), then splits collateral between keeper
(LIQ_FEE_BPS=50) and liquidationPool on underwater confirmation.

4 unit tests covering all 4 branches of the 2-phase state machine.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Multi-market smoke test (BTC/ETH/SOL)

**Files:**
- Create: `contracts/test/PerpEngine.MultiMarket.test.ts`

**Purpose:** Design spec requires all 3 markets work. Prior tests used ETH only. This task runs a quick open+close cycle for each of BTC/ETH/SOL to verify the `marketId` dispatch works and oracle prices route correctly.

- [ ] **Step 1: Write the test**

Create `/Users/ram/Desktop/NoirPerp/contracts/test/PerpEngine.MultiMarket.test.ts`:

```typescript
import { expect } from "chai";
import * as hre from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import type { NoirVault, MockERC7984, Oracle, Compliance, PerpEngine } from "../typechain-types";

describe("PerpEngine — multi-market (BTC/ETH/SOL)", () => {
  const MARKETS = [
    { id: 1, name: "BTC", price: 50_000n, size: 1n, coll: 3_000n },
    { id: 2, name: "ETH", price: 3_000n, size: 10n, coll: 2_000n },
    { id: 3, name: "SOL", price: 150n, size: 100n, coll: 1_000n },
  ];
  const STALENESS = 90;
  const DEVIATION_BPS = 50;

  let vault: NoirVault;
  let token: MockERC7984;
  let oracle: Oracle;
  let compliance: Compliance;
  let engine: PerpEngine;
  let admin: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let relayerA: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let relayerB: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let relayerC: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let alice: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
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

  beforeEach(async () => {
    [admin, relayerA, relayerB, relayerC, alice] = await hre.ethers.getSigners();

    const TokenFactory = await hre.ethers.getContractFactory("MockERC7984");
    token = (await TokenFactory.deploy("MockUSDCx", "mUSDCx")) as unknown as MockERC7984;
    await token.waitForDeployment();
    await (await token.mintPlaintext(alice.address, 1_000_000n)).wait();

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

    const EngineFactory = await hre.ethers.getContractFactory("PerpEngine");
    engine = (await EngineFactory.deploy(
      await vault.getAddress(),
      await oracle.getAddress(),
      await compliance.getAddress(),
      admin.address,
      admin.address,
    )) as unknown as PerpEngine;
    await engine.waitForDeployment();

    await (await vault.registerEngine(await engine.getAddress())).wait();
    await (await token.connect(alice).setOperator(await vault.getAddress(), 2n ** 48n - 1n)).wait();
    await (await vault.connect(alice).deposit(100_000n)).wait();
  });

  for (const m of MARKETS) {
    it(`opens and closes a ${m.name} position`, async () => {
      await commitPrice(m.id, m.price);

      const engineAddr = await engine.getAddress();
      const sizeEnc = await encrypt(engineAddr, alice.address, m.size);
      const collEnc = await encrypt(engineAddr, alice.address, m.coll);
      await (await engine.connect(alice).openPosition(
        sizeEnc.handles[0], sizeEnc.inputProof,
        collEnc.handles[0], collEnc.inputProof,
        true, m.id, aliceProof,
      )).wait();

      const nextId = await vault.nextPositionId();
      const positionId = nextId - 1n;
      const pos = await vault.getPosition(positionId);
      expect(pos.marketId).to.equal(m.id);
      expect(pos.active).to.equal(true);

      // Close at same price (flat PnL)
      await (await engine.connect(alice).closePosition(positionId)).wait();
      const closedPos = await vault.getPosition(positionId);
      expect(closedPos.active).to.equal(false);
    });
  }
});
```

- [ ] **Step 2: Run test — expect PASS**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test test/PerpEngine.MultiMarket.test.ts
```
Expected: 3 passing (one per market).

- [ ] **Step 3: Full suite green**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test 2>&1 | tail -3
```
Expected: **~162 passing** (159 + 3).

- [ ] **Step 4: CHANGELOG entry + commit**

Append:
```markdown
- **Added**: `test/PerpEngine.MultiMarket.test.ts` — open+close cycle
  for all 3 markets (BTC=1, ETH=2, SOL=3) verifying marketId dispatch
  + oracle routing. 3 tests.
  **Files**: `contracts/test/PerpEngine.MultiMarket.test.ts`.
```

```bash
cd /Users/ram/Desktop/NoirPerp && git add contracts/test/PerpEngine.MultiMarket.test.ts CHANGELOG.md && git -c user.email=developer@randao.net -c user.name="Ram" commit -q -m "test(engine): multi-market open+close for BTC/ETH/SOL

Confirms marketId dispatch and oracle routing work for all 3 markets.
3 passing tests — design-spec completion criterion met.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Update `deploy-local.ts` to include PerpEngine

**Files:**
- Modify: `contracts/scripts/deploy-local.ts`

- [ ] **Step 1: Append PerpEngine deploy to the script**

Open `/Users/ram/Desktop/NoirPerp/contracts/scripts/deploy-local.ts`. Just before the final `"=== Phase 2 deploy complete ==="` log, insert:

```typescript
  // 5. PerpEngine (Phase 3)
  const PerpFactory = await hre.ethers.getContractFactory("PerpEngine");
  const perp = await PerpFactory.deploy(
    await vault.getAddress(),
    await oracle.getAddress(),
    await compliance.getAddress(),
    admin.address, // liquidationPool = admin for local
    admin.address,
  );
  await perp.waitForDeployment();
  console.log("PerpEngine deployed: ", await perp.getAddress());

  // Register PerpEngine as authorized on vault
  await (await vault.registerEngine(await perp.getAddress())).wait();
  console.log("PerpEngine registered as authorized engine on vault");
```

Also update the final log line to `=== Phase 3 deploy complete ===`.

- [ ] **Step 2: Run the deploy script**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat run scripts/deploy-local.ts
```
Expected: prints 5 addresses (4 prior + PerpEngine) and "PerpEngine registered". No errors.

- [ ] **Step 3: CHANGELOG + commit**

Append:
```markdown
- **Modified**: `contracts/scripts/deploy-local.ts` — includes
  PerpEngine deploy + auto-registration on vault.
  **Files**: `contracts/scripts/deploy-local.ts`.
```

```bash
cd /Users/ram/Desktop/NoirPerp && git add contracts/scripts/deploy-local.ts CHANGELOG.md && git -c user.email=developer@randao.net -c user.name="Ram" commit -q -m "chore(scripts): deploy PerpEngine locally + auto-register

deploy-local.ts now deploys PerpEngine after vault/oracle/compliance
and registers it as an authorized engine. Verified green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Coverage verification

**Files:** none (produces `coverage/` artifact, gitignored)

- [ ] **Step 1: Run coverage on all engine + access-grant tests**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && SOLIDITY_COVERAGE=true npx hardhat coverage --testfiles "test/NoirVault.AccessGrants.test.ts,test/PerpEngine.Open.test.ts,test/PerpEngine.Close.test.ts,test/PerpEngine.Liquidation.test.ts,test/PerpEngine.MultiMarket.test.ts" 2>&1 | tail -20
```
Expected: PerpEngine and NoirVault.sol both show ≥90% lines/funcs/stmts, ≥80% branches.

- [ ] **Step 2: Add coverage-gap tests if needed**

Likely gaps on PerpEngine:
- `transferAdmin` happy path + zero-address + non-admin revert
- `setLiquidationPool` happy path + zero-address + non-admin revert
- Constructor zero-address reverts (5 of them)

If coverage < threshold, add these tests to a new `PerpEngine.Admin.test.ts`:

```typescript
// Minimal sketch — expand as needed to close gaps
describe("PerpEngine — admin", () => {
  // ... same setup as other tests ...

  it("admin can transferAdmin", async () => {
    await expect(engine.transferAdmin(alice.address))
      .to.emit(engine, "AdminTransferred").withArgs(admin.address, alice.address);
  });
  it("non-admin cannot transferAdmin", async () => {
    await expect(engine.connect(alice).transferAdmin(alice.address))
      .to.be.revertedWithCustomError(engine, "NotAdmin");
  });
  it("transferAdmin reverts on zero address", async () => {
    await expect(engine.transferAdmin(hre.ethers.ZeroAddress))
      .to.be.revertedWithCustomError(engine, "ZeroAddress");
  });
  // Same 3 tests for setLiquidationPool ...
  // Constructor zero-address reverts: test each of the 5 args independently
});
```

- [ ] **Step 3: Commit coverage fixes if any**

```bash
cd /Users/ram/Desktop/NoirPerp && git add contracts/test/ && git -c user.email=developer@randao.net -c user.name="Ram" commit -q -m "test(engine): close PerpEngine coverage gaps (>=90%)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Tier 1 audit (spec compliance + code quality reviewers)

**Files:** none (review-only, read-only subagents)

Per the PROGRESS.md phase gate, Phase 3 cannot tick complete until Tier 1 audit passes. This task dispatches both reviewers in parallel (read-only, safe to parallelize).

- [ ] **Step 1: Dispatch spec compliance reviewer (subagent, parallel)**

Use the Agent tool with `general-purpose` subagent, model `sonnet`. Prompt:
> Review the Phase 3 (PerpEngine) implementation against the plan and design spec. Read `/Users/ram/Desktop/NoirPerp/docs/plans/2026-04-24-phase-3-perp-engine.md` for what was planned and `/Users/ram/Desktop/NoirPerp/docs/specs/2026-04-24-noirperp-design.md` §4.2, §5.1-5.3 for the design. Inspect all PerpEngine + test files + NoirVault additions. Verify every spec requirement is met, flag deviations + YAGNI violations. Do NOT write code. Report ✅ compliant or ❌ issues with file:line references.

- [ ] **Step 2: Dispatch code quality reviewer (subagent, parallel)**

Same pattern. Prompt:
> Code-quality review of Phase 3 (PerpEngine). Read `/Users/ram/Desktop/NoirPerp/CLAUDE.md` and `docs/fhe-primitives.md` for rules. Check: FHE.* namespace, no raw FHE.sub/add/mul outside FHESafeMath, isSenderAllowed guards on engine entries, allowTransient-only (no persistent allow to engine), decrypt callbacks call _dequeue BEFORE external calls + checkSignatures, custom errors not strings, events on mutating functions. Report APPROVED / APPROVED_WITH_MINOR_FIXES / NEEDS_REWORK with critical/important/minor findings and file:line.

- [ ] **Step 3: Wait for both reports, address critical + important findings**

If NEEDS_REWORK: fix the critical issues in a dedicated `fix(audit):` commit, re-run tests, re-dispatch reviewers. Repeat until both pass.

Minor findings may be deferred with explicit CHANGELOG notation.

---

### Task 9: Phase 3 tick + CHANGELOG close + merge to master

**Files:**
- Modify: `/Users/ram/Desktop/NoirPerp/PROGRESS.md`
- Modify: `/Users/ram/Desktop/NoirPerp/CHANGELOG.md`

- [ ] **Step 1: Verify full suite + coverage still green**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test 2>&1 | tail -3
```
Expected: all tests passing, count ~162+.

- [ ] **Step 2: Tick Phase 3 in PROGRESS.md**

Change:
```markdown
- [ ] **Phase 3 — PerpEngine**
  Plan: *(not yet written)*
  Completion criteria: open/close/liquidate work for BTC/ETH/SOL on
  Sepolia; bot-triggered liquidation end-to-end.
```
to:
```markdown
- [x] **Phase 3 — PerpEngine** ✅ (2026-04-XX)
  Plan: `docs/plans/2026-04-24-phase-3-perp-engine.md`
  Completion criteria met: PerpEngine live on local mock; open +
  close work for all 3 markets (BTC/ETH/SOL); async liquidation
  via Gateway decrypt verified end-to-end (mock); Tier 1 audit
  passed; coverage ≥90% on engine + vault-additions. Sepolia
  deploy deferred to Phase 9.
```

- [ ] **Step 3: Append Phase 3 complete entry to CHANGELOG**

```markdown
### Phase 3 complete ✅ (2026-04-XX)

- **PerpEngine live**:
  - `openPosition` — sync, FHE.select-guarded balance + margin check
  - `closePosition` — sync, profit/loss branch math, saturating payout
  - `requestLiquidation` + `_onLiquidationDecided` — async 2-phase
    via DecryptQueue; keeper fee (50 bps) + forfeit to liquidationPool
  - 3 markets: BTC=1, ETH=2, SOL=3
- **Vault additions**: `allowBalanceAccess`, `allowPositionAccess` —
  satisfy design spec §4.1 grantTransient contract.
- **Test count**: (prior + Phase 3 total).
- **Coverage**: ≥90% stmts/funcs/lines, ≥80% branches on PerpEngine
  and NoirVault additions.
- **Tier 1 audit**: passed (no critical/important findings outstanding).
- **Deferred**: funding rate (spec §11 open question), 3-block
  finality delay on liquidation callback (Phase 9), Sepolia deploy.
- **Ready for Phase 4** (AMMEngine): LP pool will reclaim
  liquidationPool forfeits as seed reserves.
```

- [ ] **Step 4: Commit**

```bash
cd /Users/ram/Desktop/NoirPerp && git add PROGRESS.md CHANGELOG.md && git -c user.email=developer@randao.net -c user.name="Ram" commit -q -m "docs: tick Phase 3 complete — PerpEngine live

Open/close/liquidate working across BTC/ETH/SOL. Async liquidation
via Gateway decrypt callback verified. Tier 1 audit passed.
Coverage >=90%. Ready for Phase 4 (AMMEngine).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: Merge to master**

```bash
cd /Users/ram/Desktop/NoirPerp && git checkout master && git merge --ff-only phase-3-perp-engine
```

- [ ] **Step 6: Announce complete**

Report:
> "✅ Phase 3 complete. PerpEngine live, all 3 markets open/close/liquidate. Async Gateway decrypt flow working. Ready for Phase 4 (AMMEngine)."

---

## Appendix A — Troubleshooting

**`hre.fhevm.createEncryptedInput` not a function**: the Relayer SDK API may be exposed differently. Check `cat node_modules/@fhevm/hardhat-plugin/dist/index.d.ts | grep -i "createEncrypted\|encryptInput"`. Alternatives: `fhevm.createInstance(...)` + `instance.createEncryptedInput(...)`.

**`hre.fhevm.awaitDecryptionOracle` not found**: try `awaitDecryptions`, `fulfillDecryptionRequests`, or none at all (mock may auto-fulfill). If the callback doesn't fire in tests, check for events via `queryFilter` on `LiquidationRequested` + manually step time.

**`FHE.div(euint64, uint64)` unsupported**: if the scalar div form doesn't exist either, fallback to bit-shift approximation (imprecise, document) or decrypt collateral via a secondary Gateway callback (slow).

**`NoirVault.VaultPaused()` syntax rejected**: define `error VaultPaused()` locally on PerpEngine and use it instead of the cross-contract reference. Functionally equivalent.

**Mock Gateway callback reverts with "not allowed"**: the callback receives `bytes cleartexts` — decoding may require the correct tuple format. Single bool = `abi.decode(cleartexts, (bool))`. Multi-value = `abi.decode(cleartexts, (bool, uint64))` etc.

**"position not owner" when alice calls closePosition**: `p.owner` on the Position struct is the `address` field; should match `msg.sender` exactly. Verify writePosition stored it correctly.

**HCU limit hit on a single FHE op chain**: openPosition uses ~7-8 ops (2 mul for notional + capacity, 1 ge for balance, 1 ge for margin, 1 and, 2 select). Total ~3-4M HCU. Well under 5M sequential. If hit, batch differently.
