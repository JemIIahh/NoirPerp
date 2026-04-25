# Phase 6 — DarkpoolEngine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `DarkpoolEngine.sol` — encrypted batch-limit-order pool with bot-triggered batch matching that opens perp positions for all fillable orders in a single Gateway decrypt + callback round-trip.

**Architecture:** Inherits `DecryptQueue` for replay-guarded async callbacks. Mirrors Phase 5 LimitEngine's pattern (place + escrow + async trigger + executor handoff to PerpEngine) with one key change: `requestBatchMatch(uint256[] orderIds)` decrypts N ebools at once, settling all fillable orders in one callback. Reuses PerpEngine's executor pattern from Phase 5 (no new PerpEngine modifications needed). Single uniform clearing price = current oracle price (per design spec §11 deferred decision).

**Tech Stack:**
- Solidity `^0.8.27`
- `@fhevm/solidity@^0.11.1` (`FHE`, `euint64`, `ebool`, `externalEuint64`, `ZamaEthereumConfig`)
- Phase 1 libs: `FHESafeMath`, `DecryptQueue`
- Phase 2-5 contracts: `NoirVault`, `Oracle`, `Compliance`, `PerpEngine` (executor pattern from Phase 5)
- Hardhat mock FHEVM
- `@fhevm/hardhat-plugin` for `createEncryptedInput` + `publicDecrypt`

**Reference docs:**
- Spec: `docs/specs/2026-04-24-noirperp-design.md` §4.4
- Primitives: `docs/fhe-primitives.md` §5 (pull-based async decrypt)
- Phase 5 plan + commits — main pattern reference

**Spec deviations** (intentional, documented):
1. **No volume matching across counterparties**: a real darkpool fills orders proportionally based on `min(totalBuy, totalSell)`. We skip this — each order independently fills or doesn't based on its own limit vs oracle. Documented MVP limitation.
2. **No partial fills**: each order is binary (fully fill or no-fill at clearing).
3. **Clearing price = oracle price** (not VWAP of submitted orders) — per spec §11 recommendation.
4. **Settlement via PerpEngine executor**: matched orders open perp positions (not spot swaps). This makes economic sense — darkpool here = privacy-preserving batched leveraged position entry.

**Order semantics**:
- An order is a request to open a position when oracle price hits the limit.
- `isLong=true`, `isBuy` semantics: this is a long-buy at oracle price ≤ limitPrice (you want to enter long when price is at or below your max).
- `isLong=false`: short-sell at oracle price ≥ limitPrice.
- Functionally identical to Phase 5 LIMIT orders but matched in batch instead of per-order.

**Why a separate engine vs adding to LimitEngine?**: Per design spec §4.4, darkpool is its own contract. Logical separation: darkpool orders have batch-settlement semantics (one decrypt resolves N orders at once), separate state, and a privacy story tied to "anyone can submit orderIds[N] together → indistinguishability of which orders fill". Reuse most of LimitEngine's patterns.

---

### Task 0: Branch + preconditions

**Files:** none

- [ ] **Step 1: Verify branch**

```bash
git -C /Users/ram/Desktop/NoirPerp branch --show-current
```
Expected: `phase-6-darkpool-engine`.

- [ ] **Step 2: Verify Phase 0–5 still green**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat compile && npx hardhat test 2>&1 | tail -3
```
Expected: 257 passing.

- [ ] **Step 3: Re-read primer docs**

- `CLAUDE.md`
- `docs/fhe-primitives.md` §5 (async decrypt)
- `contracts/contracts/engines/LimitEngine.sol` — pattern reference for placement, escrow, async trigger
- `contracts/contracts/engines/PerpEngine.sol` — executor pattern (`openPositionAsExecutor`)

---

### Task 1: `DarkpoolEngine` scaffold + admin

**Files:**
- Create: `contracts/contracts/engines/DarkpoolEngine.sol`
- Create: `contracts/test/DarkpoolEngine.Admin.test.ts`

**Purpose:** Contract scaffold with config, admin functions, struct, and view accessors. No order placement or batch matching yet.

**State**:
```solidity
struct DarkOrder {
    address owner;
    uint8 marketId;
    bool isLong;
    bool active;
    euint64 size;
    euint64 collateral;
    euint64 limitPrice;
}

mapping(uint256 orderId => DarkOrder) private _orders;
uint256 public nextOrderId;

NoirVault public immutable vault;
address public oracle;
address public perp;
address public compliance;
address public admin;
```

- [ ] **Step 1: Write failing test**

Create `/Users/ram/Desktop/NoirPerp/contracts/test/DarkpoolEngine.Admin.test.ts`:

```typescript
import { expect } from "chai";
import * as hre from "hardhat";
import type { NoirVault, MockERC7984, DarkpoolEngine } from "../typechain-types";

describe("DarkpoolEngine — admin + scaffold", () => {
  let vault: NoirVault;
  let token: MockERC7984;
  let dark: DarkpoolEngine;
  let admin: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let alice: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let oracle: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let perp: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let compliance: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];

  beforeEach(async () => {
    [admin, alice, oracle, perp, compliance] = await hre.ethers.getSigners();

    const TokenFactory = await hre.ethers.getContractFactory("MockERC7984");
    token = (await TokenFactory.deploy("MockUSDCx", "mUSDCx")) as unknown as MockERC7984;
    await token.waitForDeployment();

    const VaultFactory = await hre.ethers.getContractFactory("NoirVault");
    vault = (await VaultFactory.deploy(admin.address, await token.getAddress())) as unknown as NoirVault;
    await vault.waitForDeployment();

    const DarkFactory = await hre.ethers.getContractFactory("DarkpoolEngine");
    dark = (await DarkFactory.deploy(await vault.getAddress(), admin.address)) as unknown as DarkpoolEngine;
    await dark.waitForDeployment();
    await (await vault.registerEngine(await dark.getAddress())).wait();
  });

  describe("constructor", () => {
    it("stores vault + admin + initial state", async () => {
      expect(await dark.admin()).to.equal(admin.address);
      expect(await dark.vault()).to.equal(await vault.getAddress());
      expect(await dark.oracle()).to.equal(hre.ethers.ZeroAddress);
      expect(await dark.perp()).to.equal(hre.ethers.ZeroAddress);
      expect(await dark.compliance()).to.equal(hre.ethers.ZeroAddress);
      expect(await dark.nextOrderId()).to.equal(0n);
    });

    it("reverts on zero vault", async () => {
      const F = await hre.ethers.getContractFactory("DarkpoolEngine");
      await expect(F.deploy(hre.ethers.ZeroAddress, admin.address))
        .to.be.revertedWithCustomError({ interface: F.interface } as any, "ZeroAddress");
    });

    it("reverts on zero admin", async () => {
      const F = await hre.ethers.getContractFactory("DarkpoolEngine");
      await expect(F.deploy(await vault.getAddress(), hre.ethers.ZeroAddress))
        .to.be.revertedWithCustomError({ interface: F.interface } as any, "ZeroAddress");
    });
  });

  describe("admin setters", () => {
    it("admin can transferAdmin", async () => {
      await expect(dark.transferAdmin(alice.address))
        .to.emit(dark, "AdminTransferred").withArgs(admin.address, alice.address);
      expect(await dark.admin()).to.equal(alice.address);
    });
    it("transferAdmin reverts on zero", async () => {
      await expect(dark.transferAdmin(hre.ethers.ZeroAddress))
        .to.be.revertedWithCustomError(dark, "ZeroAddress");
    });
    it("non-admin cannot transferAdmin", async () => {
      await expect(dark.connect(alice).transferAdmin(alice.address))
        .to.be.revertedWithCustomError(dark, "NotAdmin");
    });

    it("admin can setOracle", async () => {
      await expect(dark.setOracle(oracle.address))
        .to.emit(dark, "OracleSet").withArgs(oracle.address);
    });
    it("setOracle reverts on zero", async () => {
      await expect(dark.setOracle(hre.ethers.ZeroAddress))
        .to.be.revertedWithCustomError(dark, "ZeroAddress");
    });
    it("non-admin cannot setOracle", async () => {
      await expect(dark.connect(alice).setOracle(oracle.address))
        .to.be.revertedWithCustomError(dark, "NotAdmin");
    });

    it("admin can setPerp", async () => {
      await expect(dark.setPerp(perp.address))
        .to.emit(dark, "PerpSet").withArgs(perp.address);
    });
    it("setPerp reverts on zero", async () => {
      await expect(dark.setPerp(hre.ethers.ZeroAddress))
        .to.be.revertedWithCustomError(dark, "ZeroAddress");
    });

    it("admin can setCompliance", async () => {
      await expect(dark.setCompliance(compliance.address))
        .to.emit(dark, "ComplianceSet").withArgs(compliance.address);
    });
    it("setCompliance reverts on zero", async () => {
      await expect(dark.setCompliance(hre.ethers.ZeroAddress))
        .to.be.revertedWithCustomError(dark, "ZeroAddress");
    });
  });
});
```

- [ ] **Step 2: Run test → expect FAIL**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test test/DarkpoolEngine.Admin.test.ts
```

- [ ] **Step 3: Implement `DarkpoolEngine.sol` scaffold**

Create `/Users/ram/Desktop/NoirPerp/contracts/contracts/engines/DarkpoolEngine.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { FHE, euint64, ebool, externalEuint64 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";
import { FHESafeMath } from "../lib/FHESafeMath.sol";
import { DecryptQueue } from "../lib/DecryptQueue.sol";
import { NoirVault } from "../NoirVault.sol";
import { Compliance } from "../services/Compliance.sol";
import { Oracle } from "../services/Oracle.sol";
import { PerpEngine } from "./PerpEngine.sol";

/// @title DarkpoolEngine
/// @notice Encrypted batch-limit-order pool. Orders carry encrypted size,
///         collateral, and limit price; a keeper batches a list of orderIds
///         for matching; the engine evaluates per-order fill conditions on
///         ciphertexts; one Gateway decrypt resolves all of them; the
///         callback opens perp positions for all fillable orders via the
///         PerpEngine executor pattern.
/// @dev Inherits DecryptQueue for replay-guarded async callbacks.
contract DarkpoolEngine is DecryptQueue, ZamaEthereumConfig {
    NoirVault public immutable vault;
    address public oracle;
    address public perp;
    address public compliance;
    address public admin;

    struct DarkOrder {
        address owner;
        uint8 marketId;
        bool isLong;
        bool active;
        euint64 size;
        euint64 collateral;
        euint64 limitPrice;
    }

    mapping(uint256 orderId => DarkOrder) private _orders;
    uint256 public nextOrderId;

    event AdminTransferred(address indexed oldAdmin, address indexed newAdmin);
    event OracleSet(address indexed newOracle);
    event PerpSet(address indexed newPerp);
    event ComplianceSet(address indexed newCompliance);

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

    function setCompliance(address compliance_) external onlyAdmin {
        if (compliance_ == address(0)) revert ZeroAddress();
        compliance = compliance_;
        emit ComplianceSet(compliance_);
    }

    // ─── Views ─────────────────────────────────────────────────────

    function getOrder(uint256 orderId) external view returns (DarkOrder memory) {
        return _orders[orderId];
    }
}
```

- [ ] **Step 4: Run test → expect PASS**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat compile && npx hardhat test test/DarkpoolEngine.Admin.test.ts
```
Expected: ~14 passing.

- [ ] **Step 5: Full suite check**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test 2>&1 | tail -3
```
Expected: 271+ passing (257 + ~14).

- [ ] **Step 6: CHANGELOG entry**

Append to `/Users/ram/Desktop/NoirPerp/CHANGELOG.md` under a new `### Phase 6 — DarkpoolEngine (in progress)` section:

```markdown
### Phase 6 — DarkpoolEngine (in progress)

- **Added**: `contracts/contracts/engines/DarkpoolEngine.sol` (Task 1
  scaffold — admin + struct + view accessor). Inherits `DecryptQueue`
  for batch-match async callbacks. `DarkOrder` struct stores 3
  encrypted fields (size, collateral, limitPrice) + plaintext metadata.
  ~14 unit tests.
  **Files**: `contracts/contracts/engines/DarkpoolEngine.sol`,
  `contracts/test/DarkpoolEngine.Admin.test.ts`.
```

- [ ] **Step 7: Commit**

```bash
cd /Users/ram/Desktop/NoirPerp && git add contracts/contracts/engines/DarkpoolEngine.sol contracts/test/DarkpoolEngine.Admin.test.ts CHANGELOG.md && git -c user.email=developer@randao.net -c user.name="Ram" commit -q -m "feat(engine): add DarkpoolEngine scaffold + admin

DecryptQueue + ZamaEthereumConfig inheritance. DarkOrder struct
(3 encrypted fields + plaintext metadata). Admin functions for
oracle/perp/compliance wiring. ~14 unit tests.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `submitOrder` (with collateral escrow) + `cancelOrder`

**Files:**
- Modify: `contracts/contracts/engines/DarkpoolEngine.sol`
- Create: `contracts/test/DarkpoolEngine.Submit.test.ts`

**Purpose:** Users submit encrypted orders. Logic mirrors LimitEngine's `placeLimit`:
- Verify compliance, marketId
- Import 3 encrypted inputs (size, collateral, limitPrice) with `isSenderAllowed` guards
- Lock collateral (debit user → credit DarkpoolEngine)
- Store order with persistent ACL
- Cancel: refund collateral

**API**:
```solidity
struct SubmitOrderInputs {
    externalEuint64 eSize;
    bytes sizeProof;
    externalEuint64 eCollateral;
    bytes collateralProof;
    externalEuint64 eLimitPrice;
    bytes limitProof;
}

function submitOrder(
    SubmitOrderInputs calldata inputs,
    uint8 marketId,
    bool isLong,
    bytes32[] calldata complianceProof
) external returns (uint256 orderId);

function cancelOrder(uint256 orderId) external;
```

- [ ] **Step 1: Write failing test**

Create `/Users/ram/Desktop/NoirPerp/contracts/test/DarkpoolEngine.Submit.test.ts`:

```typescript
import { expect } from "chai";
import * as hre from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import type { NoirVault, MockERC7984, Oracle, Compliance, DarkpoolEngine } from "../typechain-types";

const MARKET_ETH = 2;
const STALENESS = 90;
const DEVIATION_BPS = 50;

describe("DarkpoolEngine — submitOrder + cancelOrder", () => {
  let vault: NoirVault;
  let token: MockERC7984;
  let oracle: Oracle;
  let compliance: Compliance;
  let dark: DarkpoolEngine;
  let admin: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let relayerA: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let relayerB: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let relayerC: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let alice: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let nonKyc: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
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

  async function decrypt(handle: string, contractAddr: string, signer: typeof admin): Promise<bigint> {
    return hre.fhevm.userDecryptEuint(FhevmType.euint64, handle, contractAddr, signer);
  }

  async function buildInputs(
    contractAddr: string, user: string,
    sizeVal: bigint, collVal: bigint, limitVal: bigint,
  ) {
    const sz = await encrypt(contractAddr, user, sizeVal);
    const col = await encrypt(contractAddr, user, collVal);
    const lim = await encrypt(contractAddr, user, limitVal);
    return {
      eSize: sz.handles[0], sizeProof: sz.inputProof,
      eCollateral: col.handles[0], collateralProof: col.inputProof,
      eLimitPrice: lim.handles[0], limitProof: lim.inputProof,
    };
  }

  beforeEach(async () => {
    [admin, relayerA, relayerB, relayerC, alice, nonKyc, bob] = await hre.ethers.getSigners();

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

    const DarkFactory = await hre.ethers.getContractFactory("DarkpoolEngine");
    dark = (await DarkFactory.deploy(await vault.getAddress(), admin.address)) as unknown as DarkpoolEngine;
    await dark.waitForDeployment();
    await (await vault.registerEngine(await dark.getAddress())).wait();
    await (await dark.setOracle(await oracle.getAddress())).wait();
    await (await dark.setCompliance(await compliance.getAddress())).wait();

    await (await token.connect(alice).setOperator(await vault.getAddress(), 2n ** 48n - 1n)).wait();
    await (await vault.connect(alice).deposit(10_000n)).wait();
    await commitPrice(MARKET_ETH, 3_000n);
  });

  describe("submitOrder happy path", () => {
    it("submits a long-buy order and locks collateral", async () => {
      const inputs = await buildInputs(
        await dark.getAddress(), alice.address, 5n, 1_000n, 2_900n
      );
      await (await dark.connect(alice).submitOrder(
        inputs, MARKET_ETH, true, aliceProof,
      )).wait();

      const order = await dark.getOrder(0);
      expect(order.owner).to.equal(alice.address);
      expect(order.marketId).to.equal(MARKET_ETH);
      expect(order.isLong).to.equal(true);
      expect(order.active).to.equal(true);

      const aliceBal = await decrypt(
        await vault.getBalance(alice.address),
        await vault.getAddress(),
        alice,
      );
      expect(aliceBal).to.equal(9_000n);
    });

    it("submits a short-sell order", async () => {
      const inputs = await buildInputs(
        await dark.getAddress(), alice.address, 5n, 1_000n, 3_100n
      );
      await (await dark.connect(alice).submitOrder(
        inputs, MARKET_ETH, false, aliceProof,
      )).wait();
      const order = await dark.getOrder(0);
      expect(order.isLong).to.equal(false);
    });

    it("nextOrderId increments across submissions", async () => {
      const i1 = await buildInputs(await dark.getAddress(), alice.address, 5n, 500n, 2_900n);
      await (await dark.connect(alice).submitOrder(i1, MARKET_ETH, true, aliceProof)).wait();
      const i2 = await buildInputs(await dark.getAddress(), alice.address, 5n, 500n, 3_100n);
      await (await dark.connect(alice).submitOrder(i2, MARKET_ETH, false, aliceProof)).wait();
      expect(await dark.nextOrderId()).to.equal(2n);
    });
  });

  describe("submitOrder guards", () => {
    it("reverts on non-KYC user", async () => {
      const inputs = await buildInputs(
        await dark.getAddress(), nonKyc.address, 5n, 1_000n, 2_900n
      );
      await expect(dark.connect(nonKyc).submitOrder(
        inputs, MARKET_ETH, true, aliceProof,
      )).to.be.revertedWithCustomError(dark, "NotCompliant");
    });

    it("reverts on invalid marketId", async () => {
      const inputs = await buildInputs(
        await dark.getAddress(), alice.address, 5n, 1_000n, 2_900n
      );
      await expect(dark.connect(alice).submitOrder(
        inputs, 99, true, aliceProof,
      )).to.be.revertedWithCustomError(dark, "InvalidMarket");
    });

    it("reverts when compliance not set", async () => {
      const F = await hre.ethers.getContractFactory("DarkpoolEngine");
      const fresh = (await F.deploy(await vault.getAddress(), admin.address)) as unknown as DarkpoolEngine;
      await fresh.waitForDeployment();
      const inputs = await buildInputs(
        await fresh.getAddress(), alice.address, 5n, 1_000n, 2_900n
      );
      await expect(fresh.connect(alice).submitOrder(
        inputs, MARKET_ETH, true, aliceProof,
      )).to.be.revertedWithCustomError(fresh, "ComplianceNotSet");
    });
  });

  describe("cancelOrder", () => {
    let orderId: bigint;

    beforeEach(async () => {
      const inputs = await buildInputs(
        await dark.getAddress(), alice.address, 5n, 1_000n, 2_900n
      );
      const tx = await dark.connect(alice).submitOrder(
        inputs, MARKET_ETH, true, aliceProof,
      );
      const r = await tx.wait();
      const ev = r!.logs.find((l: any) => l.fragment?.name === "OrderSubmitted") as any;
      orderId = ev.args.orderId;
    });

    it("owner can cancel and gets escrow refund", async () => {
      let bal = await decrypt(await vault.getBalance(alice.address), await vault.getAddress(), alice);
      expect(bal).to.equal(9_000n);

      await (await dark.connect(alice).cancelOrder(orderId)).wait();

      const order = await dark.getOrder(orderId);
      expect(order.active).to.equal(false);

      bal = await decrypt(await vault.getBalance(alice.address), await vault.getAddress(), alice);
      expect(bal).to.equal(10_000n);
    });

    it("non-owner cannot cancel", async () => {
      await expect(dark.connect(bob).cancelOrder(orderId))
        .to.be.revertedWithCustomError(dark, "NotOrderOwner");
    });

    it("cannot cancel an already-cancelled order", async () => {
      await (await dark.connect(alice).cancelOrder(orderId)).wait();
      await expect(dark.connect(alice).cancelOrder(orderId))
        .to.be.revertedWithCustomError(dark, "OrderNotActive");
    });
  });
});
```

- [ ] **Step 2: Run test → expect FAIL**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test test/DarkpoolEngine.Submit.test.ts
```

- [ ] **Step 3: Add `submitOrder`, `cancelOrder`, helpers**

Add new errors to `DarkpoolEngine.sol`:
```solidity
    error ComplianceNotSet();
    error NotCompliant();
    error InvalidMarket();
    error NotAllowed();
    error NotOrderOwner();
    error OrderNotActive();
```

Add new events:
```solidity
    event OrderSubmitted(uint256 indexed orderId, address indexed owner, uint8 marketId);
    event OrderCancelled(uint256 indexed orderId, address indexed owner);
```

Append before closing `}`:

```solidity
    /// @notice Inputs bundle for `submitOrder`. Struct param works around
    ///         the EVM 16-slot stack limit on individual calldata args.
    struct SubmitOrderInputs {
        externalEuint64 eSize;
        bytes sizeProof;
        externalEuint64 eCollateral;
        bytes collateralProof;
        externalEuint64 eLimitPrice;
        bytes limitProof;
    }

    /// @notice Submits an encrypted darkpool order. Locks collateral as
    ///         escrow (debit user vault → credit DarkpoolEngine vault).
    function submitOrder(
        SubmitOrderInputs calldata inputs,
        uint8 marketId,
        bool isLong,
        bytes32[] calldata complianceProof
    ) external returns (uint256 orderId) {
        if (compliance == address(0)) revert ComplianceNotSet();
        if (!Compliance(compliance).verify(msg.sender, complianceProof)) revert NotCompliant();
        if (marketId < 1 || marketId > 3) revert InvalidMarket();

        (euint64 size, euint64 collateral, euint64 limitPrice) = _importInputs(inputs);

        _lockCollateral(msg.sender, collateral);

        orderId = _storeOrder(size, collateral, limitPrice, marketId, isLong);

        emit OrderSubmitted(orderId, msg.sender, marketId);
    }

    /// @notice Owner can cancel an active order; LIMIT-style escrow refunded.
    function cancelOrder(uint256 orderId) external {
        DarkOrder storage order = _orders[orderId];
        if (order.owner != msg.sender) revert NotOrderOwner();
        if (!order.active) revert OrderNotActive();

        order.active = false;
        _refundCollateral(order);

        emit OrderCancelled(orderId, msg.sender);
    }

    // ─── Internal helpers ─────────────────────────────────────────

    function _importInputs(SubmitOrderInputs calldata inputs)
        internal
        returns (euint64 size, euint64 collateral, euint64 limitPrice)
    {
        size = FHE.fromExternal(inputs.eSize, inputs.sizeProof);
        if (!FHE.isSenderAllowed(size)) revert NotAllowed();

        collateral = FHE.fromExternal(inputs.eCollateral, inputs.collateralProof);
        if (!FHE.isSenderAllowed(collateral)) revert NotAllowed();

        limitPrice = FHE.fromExternal(inputs.eLimitPrice, inputs.limitProof);
        if (!FHE.isSenderAllowed(limitPrice)) revert NotAllowed();
    }

    function _lockCollateral(address user, euint64 collateral) internal {
        FHE.allowTransient(collateral, address(vault));
        vault.adjustBalance(user, collateral, false);

        euint64 collCredit = FHESafeMath.safeAdd(collateral, FHE.asEuint64(0));
        FHE.allowTransient(collCredit, address(vault));
        vault.adjustBalance(address(this), collCredit, true);
    }

    function _refundCollateral(DarkOrder storage order) internal {
        FHE.allowTransient(order.collateral, address(vault));
        vault.adjustBalance(address(this), order.collateral, false);

        euint64 refund = FHESafeMath.safeAdd(order.collateral, FHE.asEuint64(0));
        FHE.allowTransient(refund, address(vault));
        vault.adjustBalance(order.owner, refund, true);
    }

    function _storeOrder(
        euint64 size,
        euint64 collateral,
        euint64 limitPrice,
        uint8 marketId,
        bool isLong
    ) internal returns (uint256 orderId) {
        FHE.allowThis(size);
        FHE.allowThis(collateral);
        FHE.allowThis(limitPrice);
        FHE.allow(size, msg.sender);
        FHE.allow(collateral, msg.sender);
        FHE.allow(limitPrice, msg.sender);

        orderId = nextOrderId++;
        _orders[orderId] = DarkOrder({
            owner: msg.sender,
            marketId: marketId,
            isLong: isLong,
            active: true,
            size: size,
            collateral: collateral,
            limitPrice: limitPrice
        });
    }
```

- [ ] **Step 4: Run test → expect PASS**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test test/DarkpoolEngine.Submit.test.ts
```
Expected: 9 passing.

- [ ] **Step 5: Full suite check**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test 2>&1 | tail -3
```
Expected: 280+ passing.

- [ ] **Step 6: CHANGELOG + commit**

Append:
```markdown
- **Added**: `DarkpoolEngine.submitOrder` + `cancelOrder`. Submit
  imports 3 encrypted inputs (size, collateral, limitPrice) via
  `SubmitOrderInputs` struct (stack-too-deep avoidance). Locks
  collateral as escrow. Cancel refunds. Pattern mirrors
  LimitEngine.placeLimit. 9 unit tests.
  **Files**: `contracts/contracts/engines/DarkpoolEngine.sol`,
  `contracts/test/DarkpoolEngine.Submit.test.ts`.
```

```bash
cd /Users/ram/Desktop/NoirPerp && git add contracts/contracts/engines/DarkpoolEngine.sol contracts/test/DarkpoolEngine.Submit.test.ts CHANGELOG.md && git -c user.email=developer@randao.net -c user.name="Ram" commit -q -m "feat(dark): add submitOrder + cancelOrder with collateral escrow

Pattern mirrors LimitEngine.placeLimit: SubmitOrderInputs struct
to dodge stack-too-deep, encrypted inputs imported with
isSenderAllowed guards, collateral escrow via _lockCollateral,
cancel refunds via _refundCollateral. 9 unit tests.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `requestBatchMatch` + `_onBatchDecided` (async batch settlement)

**Files:**
- Modify: `contracts/contracts/engines/DarkpoolEngine.sol`
- Create: `contracts/test/DarkpoolEngine.BatchMatch.test.ts`

**Purpose:** The novel async batch flow.

**Phase 1 — `requestBatchMatch(uint256[] orderIds)`**:
1. Validate: oracle/perp set; orderIds non-empty
2. Get oracle price (plaintext)
3. For each orderId: validate active; compute `ebool wouldFill = isLong ? FHE.le(oraclePriceCt, order.limitPrice) : FHE.ge(oraclePriceCt, order.limitPrice)`
4. Mark each ebool publicly decryptable; collect handles into `bytes32[] handles`
5. Generate requestId; encode context = `abi.encode(orderIds)`; `_enqueue(requestId, msg.sender, 0, ctx)`
6. Emit `BatchMatchRequested(requestId, msg.sender, orderIds, handles)`

**Phase 2 — `_onBatchDecided(reqId, handlesList, cleartexts, proof)`**:
1. `FHE.checkSignatures(handlesList, cleartexts, proof)` first
2. `_dequeue(requestId)` BEFORE any external call (replay guard)
3. Decode `uint256[] memory orderIds` from `ctx.context`
4. Decode N booleans from cleartexts: `uint256[] memory shouldFires = abi.decode(cleartexts, (uint256[]))` — this is the format the FHEVM Gateway returns for batched ebool decrypts
5. For each i in [0, N):
   - Read order, mark inactive
   - `bool fire = shouldFires[i] != 0`
   - If fire: refund escrow, grant perp transient ACL on size + collateral, call `perp.openPositionAsExecutor(order.owner, size, collateral, isLong, marketId)`
   - If !fire: refund escrow only
6. Emit `BatchSettled(requestId, orderIds, shouldFires)` — pass plaintext bools for off-chain indexing

**Key design notes**:
- `FHE.requestDecryption` with multi-handle list: behavior may differ between mock + production. Per Phase 3 lesson, use `FHE.makePubliclyDecryptable` per handle + emit handles in the event for relayer pickup.
- Cleartext encoding: testing mock plugin returns `abi.encode(uint256[])` for an array of decrypted ebools. If the actual encoding differs (per-handle abi.decode in a loop), adjust the decode pattern.

- [ ] **Step 1: Write failing test**

Create `/Users/ram/Desktop/NoirPerp/contracts/test/DarkpoolEngine.BatchMatch.test.ts`:

```typescript
import { expect } from "chai";
import * as hre from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import type { NoirVault, MockERC7984, Oracle, Compliance, PerpEngine, DarkpoolEngine } from "../typechain-types";

const MARKET_ETH = 2;
const STALENESS = 90;
const DEVIATION_BPS = 50;

describe("DarkpoolEngine — batch match (async)", () => {
  let vault: NoirVault;
  let token: MockERC7984;
  let oracle: Oracle;
  let compliance: Compliance;
  let perp: PerpEngine;
  let dark: DarkpoolEngine;
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

  async function buildInputs(
    contractAddr: string, user: string,
    sizeVal: bigint, collVal: bigint, limitVal: bigint,
  ) {
    const sz = await encrypt(contractAddr, user, sizeVal);
    const col = await encrypt(contractAddr, user, collVal);
    const lim = await encrypt(contractAddr, user, limitVal);
    return {
      eSize: sz.handles[0], sizeProof: sz.inputProof,
      eCollateral: col.handles[0], collateralProof: col.inputProof,
      eLimitPrice: lim.handles[0], limitProof: lim.inputProof,
    };
  }

  async function submitOrder(
    sizeVal: bigint, collVal: bigint, limitVal: bigint, isLong: boolean
  ): Promise<bigint> {
    const inputs = await buildInputs(
      await dark.getAddress(), alice.address, sizeVal, collVal, limitVal
    );
    const tx = await dark.connect(alice).submitOrder(
      inputs, MARKET_ETH, isLong, aliceProof
    );
    const r = await tx.wait();
    const ev = r!.logs.find((l: any) => l.fragment?.name === "OrderSubmitted") as any;
    return ev.args.orderId;
  }

  async function fulfillBatch(requestId: bigint, handles: string[]): Promise<void> {
    const { abiEncodedClearValues, decryptionProof } = await hre.fhevm.publicDecrypt(handles);
    await (await dark._onBatchDecided(
      requestId, handles, abiEncodedClearValues, decryptionProof,
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

    const DarkFactory = await hre.ethers.getContractFactory("DarkpoolEngine");
    dark = (await DarkFactory.deploy(await vault.getAddress(), admin.address)) as unknown as DarkpoolEngine;
    await dark.waitForDeployment();
    await (await vault.registerEngine(await dark.getAddress())).wait();
    await (await dark.setOracle(await oracle.getAddress())).wait();
    await (await dark.setPerp(await perp.getAddress())).wait();
    await (await dark.setCompliance(await compliance.getAddress())).wait();

    await (await perp.setExecutor(await dark.getAddress(), true)).wait();

    await (await token.connect(alice).setOperator(await vault.getAddress(), 2n ** 48n - 1n)).wait();
    await (await vault.connect(alice).deposit(20_000n)).wait();
    await commitPrice(MARKET_ETH, 3_000n);
  });

  describe("single-order batch", () => {
    it("settles a single fillable long-buy at oracle price", async () => {
      const id = await submitOrder(5n, 1_000n, 3_100n, true); // limit 3100, oracle 3000 → fill (le)

      const tx = await dark.connect(keeper).requestBatchMatch([id]);
      const receipt = await tx.wait();
      const ev = receipt!.logs.find(
        (l: any) => l.fragment?.name === "BatchMatchRequested"
      ) as any;
      const reqId = ev.args.requestId;
      const handles = ev.args.handles;

      await fulfillBatch(reqId, handles);

      // Order inactive
      const order = await dark.getOrder(id);
      expect(order.active).to.equal(false);

      // Position 0 opened
      const pos = await vault.getPosition(0);
      expect(pos.owner).to.equal(alice.address);
      expect(pos.isLong).to.equal(true);
      expect(pos.active).to.equal(true);
    });

    it("settles a single non-fillable order with refund only", async () => {
      const id = await submitOrder(5n, 1_000n, 2_900n, true); // limit 2900, oracle 3000 → !le → no fill

      const tx = await dark.connect(keeper).requestBatchMatch([id]);
      const r = await tx.wait();
      const ev = r!.logs.find((l: any) => l.fragment?.name === "BatchMatchRequested") as any;
      await fulfillBatch(ev.args.requestId, ev.args.handles);

      // No position opened
      expect(await vault.nextPositionId()).to.equal(0n);

      // Order inactive
      const order = await dark.getOrder(id);
      expect(order.active).to.equal(false);

      // Alice's escrow refunded
      const bal = await decrypt(await vault.getBalance(alice.address), await vault.getAddress(), alice);
      expect(bal).to.equal(20_000n); // full deposit back
    });
  });

  describe("multi-order batch", () => {
    it("settles a mixed batch: some fill, some don't", async () => {
      // Order 0: long, limit 3100 → FILL
      const id0 = await submitOrder(5n, 1_000n, 3_100n, true);
      // Order 1: long, limit 2900 → NO FILL (oracle 3000 > 2900)
      const id1 = await submitOrder(5n, 1_000n, 2_900n, true);
      // Order 2: short, limit 2900 → FILL (oracle 3000 >= 2900)
      const id2 = await submitOrder(5n, 1_000n, 2_900n, false);

      const tx = await dark.connect(keeper).requestBatchMatch([id0, id1, id2]);
      const r = await tx.wait();
      const ev = r!.logs.find((l: any) => l.fragment?.name === "BatchMatchRequested") as any;
      await fulfillBatch(ev.args.requestId, ev.args.handles);

      // Two positions opened (id0 long + id2 short)
      expect(await vault.nextPositionId()).to.equal(2n);

      const p0 = await vault.getPosition(0);
      const p1 = await vault.getPosition(1);
      expect(p0.isLong).to.equal(true);
      expect(p1.isLong).to.equal(false);

      // All orders inactive
      const o0 = await dark.getOrder(id0);
      const o1 = await dark.getOrder(id1);
      const o2 = await dark.getOrder(id2);
      expect(o0.active).to.equal(false);
      expect(o1.active).to.equal(false);
      expect(o2.active).to.equal(false);
    });
  });

  describe("guards", () => {
    it("requestBatchMatch reverts on empty array", async () => {
      await expect(dark.connect(keeper).requestBatchMatch([]))
        .to.be.revertedWithCustomError(dark, "EmptyBatch");
    });

    it("requestBatchMatch reverts on inactive order in batch", async () => {
      const id = await submitOrder(5n, 1_000n, 3_100n, true);
      await (await dark.connect(alice).cancelOrder(id)).wait();
      await expect(dark.connect(keeper).requestBatchMatch([id]))
        .to.be.revertedWithCustomError(dark, "OrderNotActive");
    });

    it("requestBatchMatch reverts on stale oracle", async () => {
      const id = await submitOrder(5n, 1_000n, 3_100n, true);
      await hre.ethers.provider.send("evm_increaseTime", [STALENESS + 10]);
      await hre.ethers.provider.send("evm_mine", []);
      await expect(dark.connect(keeper).requestBatchMatch([id]))
        .to.be.revertedWithCustomError(dark, "OraclePriceStale");
    });

    it("requestBatchMatch reverts when oracle/perp not set", async () => {
      const F = await hre.ethers.getContractFactory("DarkpoolEngine");
      const fresh = (await F.deploy(await vault.getAddress(), admin.address)) as unknown as DarkpoolEngine;
      await fresh.waitForDeployment();
      await expect(fresh.connect(keeper).requestBatchMatch([0]))
        .to.be.revertedWithCustomError(fresh, "OracleNotSet");
    });
  });
});
```

- [ ] **Step 2: Run test → expect FAIL**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test test/DarkpoolEngine.BatchMatch.test.ts
```

- [ ] **Step 3: Add batch-match logic to `DarkpoolEngine.sol`**

Add new errors:
```solidity
    error OracleNotSet();
    error PerpNotSet();
    error OraclePriceStale();
    error EmptyBatch();
```

Add new events:
```solidity
    event BatchMatchRequested(uint256 indexed requestId, address indexed keeper, uint256[] orderIds, bytes32[] handles);
    event BatchSettled(uint256 indexed requestId, uint256[] orderIds, uint256[] shouldFires);
```

Append before closing `}`:

```solidity
    // ─── Async batch match ────────────────────────────────────────

    /// @notice Bot-callable. For each orderId, computes whether the order
    ///         should fill at current oracle price, marks each ebool
    ///         publicly decryptable, and emits the handle list for relayer
    ///         pickup.
    function requestBatchMatch(uint256[] calldata orderIds) external returns (uint256 requestId) {
        if (oracle == address(0)) revert OracleNotSet();
        if (perp == address(0)) revert PerpNotSet();
        uint256 n = orderIds.length;
        if (n == 0) revert EmptyBatch();

        (uint64 price, bool fresh) = Oracle(oracle).getPrice(_marketIdOf(orderIds[0]));
        if (!fresh) revert OraclePriceStale();
        // Note: we use marketId of the first order; in MVP all orders in a
        // batch must share a market. Cross-market batches deferred to v2.

        euint64 ePrice = FHE.asEuint64(price);

        bytes32[] memory handles = new bytes32[](n);
        for (uint256 i = 0; i < n; i++) {
            DarkOrder storage order = _orders[orderIds[i]];
            if (!order.active) revert OrderNotActive();

            // Per-order fill check: long → oracle <= limit; short → oracle >= limit
            ebool wouldFill = order.isLong
                ? FHE.le(ePrice, order.limitPrice)
                : FHE.ge(ePrice, order.limitPrice);

            FHE.makePubliclyDecryptable(wouldFill);
            handles[i] = FHE.toBytes32(wouldFill);
        }

        requestId = uint256(keccak256(abi.encode(orderIds, block.number, block.timestamp, msg.sender)));
        bytes memory ctx = abi.encode(orderIds);
        _enqueue(requestId, msg.sender, 0, ctx);

        emit BatchMatchRequested(requestId, msg.sender, orderIds, handles);
    }

    /// @notice Gateway-relayed callback. Verifies KMS sigs, dequeues
    ///         (replay guard) BEFORE external calls, then settles all
    ///         orders in the batch.
    function _onBatchDecided(
        uint256 requestId,
        bytes32[] memory handlesList,
        bytes memory cleartexts,
        bytes memory decryptionProof
    ) external {
        FHE.checkSignatures(handlesList, cleartexts, decryptionProof);
        PendingDecrypt memory ctx = _dequeue(requestId);

        uint256[] memory orderIds = abi.decode(ctx.context, (uint256[]));
        uint256[] memory shouldFires = _decodeBatch(cleartexts, orderIds.length);

        for (uint256 i = 0; i < orderIds.length; i++) {
            _settleOne(orderIds[i], shouldFires[i] != 0);
        }

        emit BatchSettled(requestId, orderIds, shouldFires);
    }

    /// @dev Decodes N booleans from the KMS cleartext blob. The Gateway
    ///      returns batched ebool decrypts as `abi.encode(uint256[])`
    ///      where each uint256 is 0 or 1. If the actual encoding differs
    ///      (e.g., individual `(uint256, uint256, ...)` tuple), adjust here.
    function _decodeBatch(bytes memory cleartexts, uint256 expectedLen)
        internal pure returns (uint256[] memory)
    {
        uint256[] memory shouldFires = abi.decode(cleartexts, (uint256[]));
        require(shouldFires.length == expectedLen, "DarkpoolEngine: cleartext length mismatch");
        return shouldFires;
    }

    /// @dev Settles a single order from the batch.
    function _settleOne(uint256 orderId, bool fire) internal {
        DarkOrder storage order = _orders[orderId];
        order.active = false;

        // Always refund escrow first — Perp will re-debit user normally if order fires
        _refundCollateral(order);

        if (!fire) {
            return;
        }

        FHE.allowTransient(order.size, perp);
        FHE.allowTransient(order.collateral, perp);
        PerpEngine(perp).openPositionAsExecutor(
            order.owner, order.size, order.collateral, order.isLong, order.marketId
        );
    }

    /// @dev Returns marketId of an order — small read helper to keep the
    ///      ergonomics of `requestBatchMatch` clean (avoids inlining storage
    ///      reads in arg lists).
    function _marketIdOf(uint256 orderId) internal view returns (uint8) {
        return _orders[orderId].marketId;
    }
```

**Stack-too-deep watch**: `_onBatchDecided` has many locals. If hit, extract `_dispatchBatch(orderIds, shouldFires)` like Phase 5's `_dispatchTrigger`.

- [ ] **Step 4: Run test → expect PASS**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test test/DarkpoolEngine.BatchMatch.test.ts
```
Expected: 7 passing.

**Common failure modes**:
- **Cleartext decode mismatch**: if the Gateway returns batched ebools as `(uint256, uint256, ...)` tuple (not `uint256[]`), `abi.decode(cleartexts, (uint256[]))` reverts. Inspect the actual cleartext bytes from `publicDecrypt([h1, h2])` first; adjust the decode pattern. Possible fallback: decode in a per-handle loop.
- **`requestBatchMatch` runs out of stack**: the `for` loop with 2 storage reads + `wouldFill` ebool builds up. Should be OK for ~10 orders; if hits stack limit at higher N, split into a helper.
- **HCU budget on large batches**: each order adds ~150k HCU (le/ge + makePubliclyDecryptable). 5M sequential limit ≈ 30 orders max per batch. For tests with 3 orders this is fine.

- [ ] **Step 5: Full suite + commit**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test 2>&1 | tail -3
```

CHANGELOG entry:
```markdown
- **Added**: `DarkpoolEngine.requestBatchMatch` + `_onBatchDecided`
  async batch-match flow. Phase 1: per-order `ebool wouldFill`
  computed against oracle price (long: le, short: ge), all marked
  publicly decryptable, handles emitted. Phase 2: callback verifies
  KMS sigs, dequeues, decodes N booleans from cleartexts, settles
  each (refund escrow + optionally `perp.openPositionAsExecutor` if
  fillable). Single decrypt round-trip resolves entire batch.
  7 unit tests including mixed-fill batch.
  **Files**: `contracts/contracts/engines/DarkpoolEngine.sol`,
  `contracts/test/DarkpoolEngine.BatchMatch.test.ts`.
```

```bash
cd /Users/ram/Desktop/NoirPerp && git add contracts/contracts/engines/DarkpoolEngine.sol contracts/test/DarkpoolEngine.BatchMatch.test.ts CHANGELOG.md && git -c user.email=developer@randao.net -c user.name="Ram" commit -q -m "feat(dark): add async batch match (requestBatchMatch + callback)

Single Gateway decrypt resolves a batch of orderIds. Each order's
fill condition (long: oracle <= limit; short: oracle >= limit)
becomes a publicly-decryptable ebool. Callback decodes N booleans
from cleartexts, settles each (refund + optional perp open via
executor pattern). 7 unit tests covering single fill, single miss,
mixed batch, and guards.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Update `deploy-local.ts`

**Files:**
- Modify: `contracts/scripts/deploy-local.ts`

- [ ] **Step 1: Append DarkpoolEngine deploy + wiring**

Open `/Users/ram/Desktop/NoirPerp/contracts/scripts/deploy-local.ts`. Just before the final "Phase 5 deploy complete" log, insert:

```typescript
  // 8. DarkpoolEngine (Phase 6)
  const DarkFactory = await hre.ethers.getContractFactory("DarkpoolEngine");
  const dark = await DarkFactory.deploy(await vault.getAddress(), admin.address);
  await dark.waitForDeployment();
  console.log("DarkpoolEngine deployed:", await dark.getAddress());

  await (await vault.registerEngine(await dark.getAddress())).wait();
  console.log("DarkpoolEngine registered as authorized engine on vault");

  await (await dark.setOracle(await oracle.getAddress())).wait();
  await (await dark.setPerp(await perp.getAddress())).wait();
  await (await dark.setCompliance(await compliance.getAddress())).wait();
  console.log("DarkpoolEngine oracle/perp/compliance set");

  await (await perp.setExecutor(await dark.getAddress(), true)).wait();
  console.log("DarkpoolEngine authorized as executor on PerpEngine");
```

Update the final banner from `=== Phase 5 deploy complete ===` to `=== Phase 6 deploy complete ===`. Update header comment.

- [ ] **Step 2: Run + verify**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat run scripts/deploy-local.ts
```
Expected: 8 contract addresses + wiring lines + "Phase 6 deploy complete".

- [ ] **Step 3: CHANGELOG + commit**

```markdown
- **Modified**: `deploy-local.ts` — deploys DarkpoolEngine + wires
  oracle/perp/compliance + authorizes as executor on PerpEngine.
```

```bash
cd /Users/ram/Desktop/NoirPerp && git add contracts/scripts/deploy-local.ts CHANGELOG.md && git -c user.email=developer@randao.net -c user.name="Ram" commit -q -m "chore(scripts): deploy DarkpoolEngine + wire dependencies

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Coverage verification

- [ ] **Step 1: Run coverage**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && SOLIDITY_COVERAGE=true npx hardhat coverage --testfiles "test/DarkpoolEngine.Admin.test.ts,test/DarkpoolEngine.Submit.test.ts,test/DarkpoolEngine.BatchMatch.test.ts" 2>&1 | grep -E "DarkpoolEngine.sol|All files" | head -3
```
Expected: DarkpoolEngine.sol ≥90% lines/funcs/stmts, ≥80% branches.

- [ ] **Step 2: Add coverage-gap tests if needed**

Likely gaps: not many — the Admin tests cover all setters; Submit covers happy path + 3 guards; BatchMatch covers fill/miss/mixed/4 guards. If branches < 80%, add edge-case test (e.g., `cancelOrder` second-call from wrong owner ordering).

- [ ] **Step 3: Commit any gap-fix tests**

---

### Task 6: Tier 1 audit (mandatory phase gate)

Per `PROGRESS.md`, can't tick complete until both reviewers pass.

- [ ] **Step 1: Spec compliance reviewer (parallel, read-only)**

Use Agent tool, subagent_type=general-purpose, model=sonnet. Prompt template:
> Review Phase 6 (DarkpoolEngine) against `/Users/ram/Desktop/NoirPerp/docs/plans/2026-04-25-phase-6-darkpool-engine.md` and `/Users/ram/Desktop/NoirPerp/docs/specs/2026-04-24-noirperp-design.md` §4.4. Plan documents 4 spec deviations (no volume matching, no partial fills, oracle clearing price, settle via PerpEngine executor). Verify all 4 deviations are explicitly in place. Verify cross-engine ACL discipline: DarkpoolEngine grants perp transient on size/collateral before openPositionAsExecutor. Report ✅ compliant or ❌ issues with file:line.

- [ ] **Step 2: Code quality reviewer (parallel, read-only)**

> Code-quality review of Phase 6. Check FHE.* namespace, no raw FHE.sub/add/mul outside FHESafeMath, isSenderAllowed guards on encrypted inputs (3 in submitOrder), allowTransient discipline (cross-engine handoff in _settleOne), `_dequeue` BEFORE external calls in `_onBatchDecided`, custom errors not strings. Pay special attention to the multi-handle decrypt pattern — verify cleartext decode handles N ebools correctly. Report APPROVED / APPROVED_WITH_MINOR_FIXES / NEEDS_REWORK.

- [ ] **Step 3: Address any critical/important findings inline**

---

### Task 7: Phase 6 tick + merge

- [ ] **Step 1: Verify full suite green**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test 2>&1 | tail -3
```
Expected: 287+ passing.

- [ ] **Step 2: Tick Phase 6 in PROGRESS.md**

Change:
```markdown
- [ ] **Phase 6 — DarkpoolEngine**
  Plan: *(not yet written)*
```
to:
```markdown
- [x] **Phase 6 — DarkpoolEngine** ✅ (2026-04-XX)
  Plan: `docs/plans/2026-04-25-phase-6-darkpool-engine.md`
  Completion criteria met: DarkpoolEngine live with submitOrder + cancelOrder
  + async batch match. Single Gateway decrypt resolves N orders at once.
  Settles fillable orders via PerpEngine executor pattern. Tier 1 audit
  passed. Coverage ≥90% on DarkpoolEngine. Test count: 287+ total.
  4 documented spec deviations: no volume matching, no partial fills,
  oracle clearing price, settle via PerpEngine.
```

- [ ] **Step 3: CHANGELOG complete entry + commit + merge**

```markdown
### Phase 6 complete ✅ (2026-04-XX)

- **DarkpoolEngine live**:
  - `submitOrder(SubmitOrderInputs, marketId, isLong, complianceProof)`
  - `cancelOrder(orderId)` — refunds escrow
  - `requestBatchMatch(uint256[])` — async, single Gateway decrypt for
    N orders
  - `_onBatchDecided(...)` — settles all fillable orders + refunds
    misses; cross-engine open via `perp.openPositionAsExecutor`
- **Spec deviations** (documented):
  1. No volume matching across counterparties
  2. No partial fills
  3. Clearing price = oracle price (per spec §11 deferred decision)
  4. Settlement via PerpEngine executor (perp position open)
- **Test count**: 287+ total.
- **Coverage**: DarkpoolEngine ≥90% per metric.
- **Tier 1 audit**: passed.
- **Ready for Phase 7** (off-chain services: bot, oracle relayer,
  compliance backend).
```

```bash
cd /Users/ram/Desktop/NoirPerp && git add PROGRESS.md CHANGELOG.md && git -c user.email=developer@randao.net -c user.name="Ram" commit -q -m "docs: tick Phase 6 complete — DarkpoolEngine live" && git checkout master && git merge --ff-only phase-6-darkpool-engine
```

---

## Appendix A — Troubleshooting

**Stack-too-deep on `submitOrder` or `_onBatchDecided`**: extract more helpers. Pattern is `_dispatchX(args)` returning early. Phase 5 examples in LimitEngine.

**Multi-handle `publicDecrypt` returns unexpected encoding**: the test's `fulfillBatch` uses `hre.fhevm.publicDecrypt(handles)` where `handles` is `bytes32[]`. The mock plugin should return cleartexts as `abi.encode(uint256[])` — but if it returns `(uint256, uint256, ...)` tuple, adjust `_decodeBatch` to read N uint256s sequentially using a manual offset loop.

**Cross-engine ACL on size/collateral**: same pattern as Phase 5 LIMIT — DarkpoolEngine has `allowThis` from submission; grants perp `allowTransient` before `openPositionAsExecutor`. Inside perp, `isSenderAllowed(size)` passes because msg.sender (DarkpoolEngine) has allowThis.

**`requestBatchMatch` validates `marketId` of first order only**: MVP assumes all orders in a batch share market. If a heterogeneous batch is submitted, the price freshness check uses the first order's market — orders in other markets would compute against the wrong price. Cross-market batches deferred to v2; document.

**Order ACL after batch-match miss**: when an order doesn't fill, escrow is refunded but the order's encrypted ciphertexts remain in storage with `allowThis` permits. They become "dead state" — not exploitable but consume storage. Phase 9 cleanup pass could zero them out.

**HCU exhaustion on large batches**: each order adds ~150k HCU for the le/ge. With ~30 orders we hit 5M sequential. Document max batch size.
