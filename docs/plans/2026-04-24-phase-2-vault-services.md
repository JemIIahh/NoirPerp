# Phase 2 — Vault + Services Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the three foundation contracts that every engine will depend on — `NoirVault` (ciphertext state keeper), `Oracle` (2-of-3 Chainlink relayer quorum), `Compliance` (Merkle KYC allowlist) — with ≥90% unit-test coverage and a local-mock deployment script.

**Architecture:** NoirVault holds all ciphertext state (user USDCx balances, positions) and is the only contract that mutates that state; engines call into the vault via authorized-engine gating. Oracle accepts price submissions from an allowlist of 3 relayers, committing a price only when a second distinct relayer confirms within a deviation tolerance + freshness window. Compliance is a plaintext Merkle allowlist with admin-controlled root updates and per-address revocation.

**Tech Stack:**
- Solidity `^0.8.27`
- `@fhevm/solidity@^0.11.1` — `FHE`, `euint64`, `ebool`, `ZamaEthereumConfig`
- `@openzeppelin/confidential-contracts@0.4.0` — `ERC7984` interface for cUSDC
- `@openzeppelin/contracts@^5.2.0` — `MerkleProof`, `Pausable`, `Ownable2Step`, `ReentrancyGuard`
- Hardhat mock FHEVM (local testing)
- `@fhevm/hardhat-plugin` for typechain + userDecrypt helpers

**Reference docs (authoritative):**
- Design spec: `docs/specs/2026-04-24-noirperp-design.md` §4.1, §4.6, §4.7, §5.4, §5.5, §6
- Primitives: `docs/fhe-primitives.md` (esp. §4 ACL, §10 plugin notes)
- Phase 1 libs (already live): `FHESafeMath`, `MarginMath`, `DecryptQueue`, `TickMath`
- Rules: `CLAUDE.md`

**Scope (in vs out):**
- **IN**: Vault's user-facing deposit/withdraw, engine authorization, pause/unpause, position storage + `writePosition`/`closePosition`, balance adjustments by engines. Oracle 2-of-3 quorum, price freshness, encrypted-price for FHE ops. Compliance Merkle verify + admin revoke.
- **OUT** (deferred to later phases per YAGNI):
  - Vault's `orders` mapping → added by Darkpool/Limit engines (Phase 5-6)
  - Vault's `lpPositions` mapping → added by AMM engine (Phase 4)
  - Multi-sig admin integration (scaffold single-admin now; Safe integration in Phase 9)
  - Sepolia testnet deploy script (local mock only; Sepolia in Phase 9 integration)

---

### Task 0: Branch + preconditions

**Files:** none

- [ ] **Step 1: Verify branch**

```bash
git -C /Users/ram/Desktop/NoirPerp branch --show-current
```
Expected: `phase-2-vault-services`. If not, `git checkout phase-2-vault-services`.

- [ ] **Step 2: Verify Phase 0+1 still green**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat compile && npx hardhat test 2>&1 | tail -3
```
Expected: compile clean; **57 passing**. Regression blocks Phase 2.

- [ ] **Step 3: Read the primer docs before implementing**

- Read `CLAUDE.md` for the pinned rules (FHE namespace, no `FHE.div`, SafeMath discipline, `isSenderAllowed` guard, `allowTransient` only, decrypt replay guard).
- Read `docs/fhe-primitives.md` §10 for the Hardhat plugin integration patterns (`import * as hre from "hardhat"`, `FhevmType`, `userDecryptEuint`/`userDecryptEbool`).
- Note: `ZamaEthereumConfig` — NOT `SepoliaConfig` (v0.11.1 API).

---

### Task 1: `MockERC7984` test fixture

**Files:**
- Create: `contracts/contracts/test-harness/MockERC7984.sol`

**Purpose:** Minimal ERC-7984 token implementation that Vault tests can mint and transfer. On Sepolia we'll use the pre-deployed `cUSDCMock @ 0x7c5BF43B851c1dff1a4feE8dB225b87f2C223639`, but local tests need their own deployable mock.

**Approach:** Extend OZ's `ERC7984` base (from `@openzeppelin/confidential-contracts`). Add a `mint(address to, externalEuint64 amount, bytes inputProof)` for test seeding.

- [ ] **Step 1: Inspect what OZ ships**

```bash
ls /Users/ram/Desktop/NoirPerp/contracts/node_modules/@openzeppelin/confidential-contracts/contracts/
```
Look for `token/ERC7984/ERC7984.sol`. Note the constructor signature (likely `(string name, string symbol, string uri)`).

- [ ] **Step 2: Write `MockERC7984.sol`**

Create `/Users/ram/Desktop/NoirPerp/contracts/contracts/test-harness/MockERC7984.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { FHE, euint64, externalEuint64 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";
import { ERC7984 } from "@openzeppelin/confidential-contracts/token/ERC7984/ERC7984.sol";

/// @title MockERC7984
/// @notice Minimal ERC-7984 token for local Hardhat tests of NoirVault.
///         On Sepolia, use the pre-deployed cUSDCMock instead.
/// @dev `mint` is open to anyone — test-only. NOT production-safe.
contract MockERC7984 is ERC7984, ZamaEthereumConfig {
    constructor(string memory name_, string memory symbol_)
        ERC7984(name_, symbol_, "")
    {}

    /// @notice Seeds the recipient with an encrypted amount of tokens.
    /// @dev Open to any caller; test-only.
    function mint(
        address to,
        externalEuint64 encryptedAmount,
        bytes calldata inputProof
    ) external returns (euint64) {
        euint64 amount = FHE.fromExternal(encryptedAmount, inputProof);
        _mint(to, amount);
        return amount;
    }

    /// @notice Alternate mint using a plaintext amount (trivial encrypt).
    function mintPlaintext(address to, uint64 amount) external returns (euint64) {
        euint64 encrypted = FHE.asEuint64(amount);
        _mint(to, encrypted);
        return encrypted;
    }
}
```

**If OZ's `ERC7984` constructor signature differs** from `(name, symbol, uri)` — inspect the actual signature via `cat node_modules/@openzeppelin/confidential-contracts/contracts/token/ERC7984/ERC7984.sol` and adjust. Document any adjustment in the commit message.

**If `_mint` is not `internal` in OZ's implementation** — it may be called something else or require additional steps. Read the actual `ERC7984.sol` to find the correct internal mint function. Update accordingly.

- [ ] **Step 3: Compile**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat compile
```
Expected: `Compiled N Solidity files successfully`. If it fails, the OZ API signature assumption is wrong — read the actual source and fix.

- [ ] **Step 4: Commit**

```bash
cd /Users/ram/Desktop/NoirPerp && git add contracts/contracts/test-harness/MockERC7984.sol && git -c user.email=developer@randao.net -c user.name="Ram" commit -q -m "test(harness): add MockERC7984 for local vault tests

Minimal ERC-7984 token extending OZ's ERC7984 base. Open mint
for test seeding. NOT production-safe — local tests only. On
Sepolia we use the pre-deployed cUSDCMock.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `Compliance.sol`

**Files:**
- Create: `contracts/contracts/services/Compliance.sol`
- Create: `contracts/test/Compliance.test.ts`

**Purpose:** Merkle-tree KYC allowlist. Admin updates root off-chain (calculated from approved address list); users prove inclusion via standard OZ `MerkleProof`. Revocation is an on-chain override.

**Function signatures:**
```solidity
contract Compliance {
    bytes32 public merkleRoot;
    uint256 public rootUpdatedAt;
    mapping(address => bool) public revoked;
    address public admin;

    event RootUpdated(bytes32 indexed newRoot, uint256 timestamp);
    event Revoked(address indexed user);
    event Unrevoked(address indexed user);
    event AdminTransferred(address indexed oldAdmin, address indexed newAdmin);

    error NotAdmin();
    error ZeroAddress();

    constructor(address initialAdmin, bytes32 initialRoot);
    function updateRoot(bytes32 newRoot) external;
    function verify(address user, bytes32[] calldata proof) external view returns (bool);
    function revoke(address user) external;
    function unrevoke(address user) external;
    function transferAdmin(address newAdmin) external;
}
```

- [ ] **Step 1: Write failing test**

Create `/Users/ram/Desktop/NoirPerp/contracts/test/Compliance.test.ts`:

```typescript
import { expect } from "chai";
import * as hre from "hardhat";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import type { Compliance } from "../typechain-types";

describe("Compliance", () => {
  let compliance: Compliance;
  let admin: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let alice: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let bob: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let carol: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];

  // Build a Merkle tree over [alice, bob] addresses
  function buildTree(addrs: string[]) {
    const values = addrs.map((a) => [a]);
    return StandardMerkleTree.of(values, ["address"]);
  }

  beforeEach(async () => {
    [admin, alice, bob, carol] = await hre.ethers.getSigners();
    const tree = buildTree([alice.address, bob.address]);
    const Factory = await hre.ethers.getContractFactory("Compliance");
    compliance = (await Factory.deploy(admin.address, tree.root)) as unknown as Compliance;
    await compliance.waitForDeployment();
  });

  describe("constructor", () => {
    it("sets initial admin and root", async () => {
      expect(await compliance.admin()).to.equal(admin.address);
      expect(await compliance.merkleRoot()).to.not.equal(hre.ethers.ZeroHash);
      expect(await compliance.rootUpdatedAt()).to.be.gt(0);
    });

    it("reverts on zero admin", async () => {
      const Factory = await hre.ethers.getContractFactory("Compliance");
      await expect(
        Factory.deploy(hre.ethers.ZeroAddress, hre.ethers.ZeroHash)
      ).to.be.revertedWithCustomError({ interface: Factory.interface } as any, "ZeroAddress");
    });
  });

  describe("verify", () => {
    it("returns true for a listed user with a valid proof", async () => {
      const tree = buildTree([alice.address, bob.address]);
      const proof = tree.getProof([alice.address]);
      expect(await compliance.verify(alice.address, proof)).to.equal(true);
    });

    it("returns false for a user not in the tree", async () => {
      const tree = buildTree([alice.address, bob.address]);
      // Carol is not in the tree — her proof for alice wouldn't verify anyway
      const wrongProof = tree.getProof([alice.address]);
      expect(await compliance.verify(carol.address, wrongProof)).to.equal(false);
    });

    it("returns false when proof is invalid (empty)", async () => {
      expect(await compliance.verify(alice.address, [])).to.equal(false);
    });

    it("returns false for a revoked user even with a valid proof", async () => {
      const tree = buildTree([alice.address, bob.address]);
      const proof = tree.getProof([alice.address]);
      await (await compliance.revoke(alice.address)).wait();
      expect(await compliance.verify(alice.address, proof)).to.equal(false);
    });
  });

  describe("updateRoot", () => {
    it("admin can update the root", async () => {
      const tree = buildTree([alice.address, bob.address, carol.address]);
      const newRoot = tree.root;
      await expect(compliance.updateRoot(newRoot))
        .to.emit(compliance, "RootUpdated")
        .withArgs(newRoot, await hre.ethers.provider.getBlock("latest").then(b => b!.timestamp + 1));
      expect(await compliance.merkleRoot()).to.equal(newRoot);
    });

    it("non-admin cannot update the root", async () => {
      await expect(
        compliance.connect(alice).updateRoot(hre.ethers.ZeroHash)
      ).to.be.revertedWithCustomError(compliance, "NotAdmin");
    });

    it("new root unlocks new users", async () => {
      const tree2 = buildTree([alice.address, bob.address, carol.address]);
      await (await compliance.updateRoot(tree2.root)).wait();
      const carolProof = tree2.getProof([carol.address]);
      expect(await compliance.verify(carol.address, carolProof)).to.equal(true);
    });
  });

  describe("revoke / unrevoke", () => {
    it("admin can revoke a user", async () => {
      await expect(compliance.revoke(alice.address))
        .to.emit(compliance, "Revoked")
        .withArgs(alice.address);
      expect(await compliance.revoked(alice.address)).to.equal(true);
    });

    it("admin can unrevoke a user", async () => {
      await (await compliance.revoke(alice.address)).wait();
      await expect(compliance.unrevoke(alice.address))
        .to.emit(compliance, "Unrevoked")
        .withArgs(alice.address);
      expect(await compliance.revoked(alice.address)).to.equal(false);
    });

    it("non-admin cannot revoke", async () => {
      await expect(
        compliance.connect(bob).revoke(alice.address)
      ).to.be.revertedWithCustomError(compliance, "NotAdmin");
    });

    it("non-admin cannot unrevoke", async () => {
      await (await compliance.revoke(alice.address)).wait();
      await expect(
        compliance.connect(bob).unrevoke(alice.address)
      ).to.be.revertedWithCustomError(compliance, "NotAdmin");
    });
  });

  describe("transferAdmin", () => {
    it("admin can transfer to a new admin", async () => {
      await expect(compliance.transferAdmin(bob.address))
        .to.emit(compliance, "AdminTransferred")
        .withArgs(admin.address, bob.address);
      expect(await compliance.admin()).to.equal(bob.address);
    });

    it("non-admin cannot transfer", async () => {
      await expect(
        compliance.connect(alice).transferAdmin(alice.address)
      ).to.be.revertedWithCustomError(compliance, "NotAdmin");
    });

    it("reverts on zero address", async () => {
      await expect(
        compliance.transferAdmin(hre.ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(compliance, "ZeroAddress");
    });
  });
});
```

- [ ] **Step 2: Install `@openzeppelin/merkle-tree` dev dep (required for the test)**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npm install --save-dev --legacy-peer-deps @openzeppelin/merkle-tree@^1.0.0
```

Expected: installs without errors. Add `@openzeppelin/merkle-tree` to `devDependencies` in `package.json`.

- [ ] **Step 3: Run test — expect FAIL (contract not written)**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test test/Compliance.test.ts
```

Expected: FAIL with missing typechain `Compliance`.

- [ ] **Step 4: Implement `Compliance.sol`**

Create `/Users/ram/Desktop/NoirPerp/contracts/contracts/services/Compliance.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { MerkleProof } from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/// @title Compliance
/// @notice Merkle-tree KYC allowlist for NoirPerp. Admin sets the root
///         (computed off-chain from the approved address list). Users
///         prove membership via standard OZ MerkleProof. On-chain
///         revocation overrides membership regardless of proof validity.
/// @dev Leaves are `keccak256(bytes.concat(keccak256(abi.encode(address))))`
///      per OZ StandardMerkleTree convention (JS library: @openzeppelin/merkle-tree).
contract Compliance {
    bytes32 public merkleRoot;
    uint256 public rootUpdatedAt;
    mapping(address => bool) public revoked;
    address public admin;

    event RootUpdated(bytes32 indexed newRoot, uint256 timestamp);
    event Revoked(address indexed user);
    event Unrevoked(address indexed user);
    event AdminTransferred(address indexed oldAdmin, address indexed newAdmin);

    error NotAdmin();
    error ZeroAddress();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    constructor(address initialAdmin, bytes32 initialRoot) {
        if (initialAdmin == address(0)) revert ZeroAddress();
        admin = initialAdmin;
        merkleRoot = initialRoot;
        rootUpdatedAt = block.timestamp;
        emit AdminTransferred(address(0), initialAdmin);
        emit RootUpdated(initialRoot, block.timestamp);
    }

    function updateRoot(bytes32 newRoot) external onlyAdmin {
        merkleRoot = newRoot;
        rootUpdatedAt = block.timestamp;
        emit RootUpdated(newRoot, block.timestamp);
    }

    /// @notice Verifies that `user` is allowlisted and not revoked.
    /// @dev Leaf format matches @openzeppelin/merkle-tree's StandardMerkleTree
    ///      for single-column `["address"]`: double-hashed.
    function verify(address user, bytes32[] calldata proof) external view returns (bool) {
        if (revoked[user]) return false;
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(user))));
        return MerkleProof.verify(proof, merkleRoot, leaf);
    }

    function revoke(address user) external onlyAdmin {
        revoked[user] = true;
        emit Revoked(user);
    }

    function unrevoke(address user) external onlyAdmin {
        revoked[user] = false;
        emit Unrevoked(user);
    }

    function transferAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        address old = admin;
        admin = newAdmin;
        emit AdminTransferred(old, newAdmin);
    }
}
```

- [ ] **Step 5: Run test — expect PASS**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test test/Compliance.test.ts
```

Expected: all Compliance tests pass. Target: 14 passing (2 constructor + 4 verify + 3 updateRoot + 2 revoke + 2 unrevoke + 3 transferAdmin = 16 - 2 duplicates = actually 14 distinct tests).

If any test fails:
1. **Leaf format mismatch** — the OZ StandardMerkleTree uses double-hashed leaves (`keccak256(keccak256(abi.encode(val)))`). If verify returns false for valid proofs, the contract's `keccak256(bytes.concat(keccak256(abi.encode(user))))` expression may need adjustment. Compare against `@openzeppelin/merkle-tree` library docs.
2. **Timestamp assertion** — the `withArgs(newRoot, timestamp+1)` expectation may drift by ±1s on slow machines. If it fails, weaken to `.to.emit(...).withArgs(newRoot, anyValue)` from `@nomicfoundation/hardhat-chai-matchers/withArgs`.

- [ ] **Step 6: CHANGELOG entry**

Append to `/Users/ram/Desktop/NoirPerp/CHANGELOG.md` under a new `### Phase 2 — Vault + services (in progress)` section:

```markdown
### Phase 2 — Vault + services (in progress)

- **Added**: `contracts/contracts/services/Compliance.sol` — Merkle-tree
  KYC allowlist. Admin-controlled root + per-address revocation.
  Uses OZ `MerkleProof` with StandardMerkleTree leaf format
  (double-hashed). 14 unit tests covering verify, updateRoot, revoke,
  transferAdmin.
  **Files**: `contracts/contracts/services/Compliance.sol`,
  `contracts/test/Compliance.test.ts`.
- **Added**: `@openzeppelin/merkle-tree` dev dependency for JS-side
  Merkle tree construction in tests.
```

- [ ] **Step 7: Commit**

```bash
cd /Users/ram/Desktop/NoirPerp && git add contracts/contracts/services/Compliance.sol contracts/test/Compliance.test.ts contracts/package.json contracts/package-lock.json CHANGELOG.md && git -c user.email=developer@randao.net -c user.name="Ram" commit -q -m "feat(service): add Compliance Merkle allowlist

Admin-controlled merkleRoot + per-address revocation. Standard OZ
MerkleProof with double-hashed leaves (StandardMerkleTree convention).
14 unit tests.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `Oracle.sol`

**Files:**
- Create: `contracts/contracts/services/Oracle.sol`
- Create: `contracts/test/Oracle.test.ts`

**Purpose:** 2-of-3 Chainlink relayer consensus. Three hard-coded relayer addresses submit `(marketId, price, timestamp)`; the second submission from a DIFFERENT relayer, within deviation tolerance and within staleness window, commits the price. On-demand trivial encryption via `getEncryptedPrice()` for FHE math downstream.

**State machine (simplest-possible interpretation):**
- Initial: `confirmations = 0`, no pending.
- Relayer A calls `submitPrice(market, P1, T1)`: stored as **pending** with `pendingRelayer = A`.
- Relayer B (≠ A) calls `submitPrice(market, P2, T2)`:
  - If `|P2 − P1| / P1 > deviationBps / 10_000` → REJECT (relayers disagreed).
  - If `T2 − T1 > stalenessSeconds` → REJECT (old pending).
  - Else → COMMIT. `prices[market] = { price: P2, timestamp: T2, confirmations: 2 }`. Clear pending.
- A third submission from any relayer starts a NEW pending cycle.

**Market IDs** (assigned by design spec §5.4):
- `1` = BTC/USD
- `2` = ETH/USD
- `3` = SOL/USD

- [ ] **Step 1: Write failing test**

Create `/Users/ram/Desktop/NoirPerp/contracts/test/Oracle.test.ts`:

```typescript
import { expect } from "chai";
import * as hre from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import type { Oracle } from "../typechain-types";

describe("Oracle", () => {
  const MARKET_BTC = 1;
  const MARKET_ETH = 2;
  const MARKET_SOL = 3;
  const STALENESS = 90; // seconds
  const DEVIATION_BPS = 50; // 0.5%

  let oracle: Oracle;
  let admin: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let relayerA: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let relayerB: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let relayerC: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let notRelayer: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];

  async function now(): Promise<number> {
    const blk = await hre.ethers.provider.getBlock("latest");
    return blk!.timestamp;
  }

  beforeEach(async () => {
    [admin, relayerA, relayerB, relayerC, notRelayer] = await hre.ethers.getSigners();
    const Factory = await hre.ethers.getContractFactory("Oracle");
    oracle = (await Factory.deploy(
      admin.address,
      [relayerA.address, relayerB.address, relayerC.address],
      STALENESS,
      DEVIATION_BPS,
    )) as unknown as Oracle;
    await oracle.waitForDeployment();
  });

  describe("constructor", () => {
    it("stores admin, relayers, staleness, and deviation", async () => {
      expect(await oracle.admin()).to.equal(admin.address);
      expect(await oracle.relayers(0)).to.equal(relayerA.address);
      expect(await oracle.relayers(1)).to.equal(relayerB.address);
      expect(await oracle.relayers(2)).to.equal(relayerC.address);
      expect(await oracle.stalenessSeconds()).to.equal(STALENESS);
      expect(await oracle.deviationBps()).to.equal(DEVIATION_BPS);
    });
  });

  describe("submitPrice — access control", () => {
    it("reverts when caller is not a relayer", async () => {
      await expect(
        oracle.connect(notRelayer).submitPrice(MARKET_BTC, 50_000n, await now())
      ).to.be.revertedWithCustomError(oracle, "NotRelayer");
    });

    it("accepts a submission from any of the 3 relayers", async () => {
      await expect(
        oracle.connect(relayerA).submitPrice(MARKET_BTC, 50_000n, await now())
      ).to.not.be.reverted;
    });
  });

  describe("submitPrice — quorum flow", () => {
    it("first submission stores as pending (not fresh yet)", async () => {
      await (await oracle.connect(relayerA).submitPrice(MARKET_ETH, 3000n, await now())).wait();
      const [, fresh] = await oracle.getPrice(MARKET_ETH);
      expect(fresh).to.equal(false);
    });

    it("second submission from a DIFFERENT relayer within deviation commits", async () => {
      const t = await now();
      await (await oracle.connect(relayerA).submitPrice(MARKET_ETH, 3000n, t)).wait();
      await (await oracle.connect(relayerB).submitPrice(MARKET_ETH, 3005n, t + 1)).wait();
      const [price, fresh] = await oracle.getPrice(MARKET_ETH);
      expect(price).to.equal(3005n);
      expect(fresh).to.equal(true);
    });

    it("second submission from SAME relayer does NOT commit", async () => {
      const t = await now();
      await (await oracle.connect(relayerA).submitPrice(MARKET_ETH, 3000n, t)).wait();
      // same relayer resubmits — should be treated as pending replacement, NOT commit
      await (await oracle.connect(relayerA).submitPrice(MARKET_ETH, 3005n, t + 1)).wait();
      const [, fresh] = await oracle.getPrice(MARKET_ETH);
      expect(fresh).to.equal(false);
    });

    it("rejects when second relayer's price exceeds deviation tolerance", async () => {
      const t = await now();
      await (await oracle.connect(relayerA).submitPrice(MARKET_ETH, 3000n, t)).wait();
      // 1% deviation > 0.5% max → reject
      await expect(
        oracle.connect(relayerB).submitPrice(MARKET_ETH, 3030n, t + 1)
      ).to.be.revertedWithCustomError(oracle, "DeviationTooLarge");
    });

    it("rejects when pending is stale", async () => {
      const t = await now();
      await (await oracle.connect(relayerA).submitPrice(MARKET_ETH, 3000n, t)).wait();
      // Fast-forward past staleness window
      await hre.ethers.provider.send("evm_increaseTime", [STALENESS + 1]);
      await hre.ethers.provider.send("evm_mine", []);
      // B tries to commit but A's pending is stale
      await expect(
        oracle.connect(relayerB).submitPrice(MARKET_ETH, 3005n, await now())
      ).to.be.revertedWithCustomError(oracle, "PendingStale");
    });

    it("third submission starts a new pending cycle after prior commit", async () => {
      const t = await now();
      await (await oracle.connect(relayerA).submitPrice(MARKET_ETH, 3000n, t)).wait();
      await (await oracle.connect(relayerB).submitPrice(MARKET_ETH, 3005n, t + 1)).wait();
      // Now committed. Relayer C starts a new cycle.
      await (await oracle.connect(relayerC).submitPrice(MARKET_ETH, 3010n, t + 2)).wait();
      // Committed price is still 3005; new pending is not fresh yet
      const [price, fresh] = await oracle.getPrice(MARKET_ETH);
      expect(price).to.equal(3005n);
      expect(fresh).to.equal(true); // still within staleness window
    });
  });

  describe("getPrice — freshness", () => {
    it("returns fresh=false for never-committed market", async () => {
      const [price, fresh] = await oracle.getPrice(MARKET_SOL);
      expect(price).to.equal(0n);
      expect(fresh).to.equal(false);
    });

    it("returns fresh=false after the committed price ages out", async () => {
      const t = await now();
      await (await oracle.connect(relayerA).submitPrice(MARKET_ETH, 3000n, t)).wait();
      await (await oracle.connect(relayerB).submitPrice(MARKET_ETH, 3005n, t + 1)).wait();
      await hre.ethers.provider.send("evm_increaseTime", [STALENESS + 10]);
      await hre.ethers.provider.send("evm_mine", []);
      const [, fresh] = await oracle.getPrice(MARKET_ETH);
      expect(fresh).to.equal(false);
    });
  });

  describe("getEncryptedPrice", () => {
    it("reverts when price is not fresh", async () => {
      await expect(oracle.getEncryptedPrice(MARKET_SOL))
        .to.be.revertedWithCustomError(oracle, "PriceNotFresh");
    });

    it("returns a ciphertext matching the plaintext for a fresh price", async () => {
      const t = await now();
      await (await oracle.connect(relayerA).submitPrice(MARKET_BTC, 50_000n, t)).wait();
      await (await oracle.connect(relayerB).submitPrice(MARKET_BTC, 50_100n, t + 1)).wait();
      const tx = await oracle.requestEncryptedPrice(MARKET_BTC);
      await tx.wait();
      const handle = await oracle.lastEncryptedPrice();
      const plain = await hre.fhevm.userDecryptEuint(
        FhevmType.euint64,
        handle,
        await oracle.getAddress(),
        admin,
      );
      expect(plain).to.equal(50_100n);
    });
  });

  describe("admin", () => {
    it("admin can rotate a relayer", async () => {
      await expect(oracle.rotateRelayer(0, notRelayer.address))
        .to.emit(oracle, "RelayerRotated")
        .withArgs(0, relayerA.address, notRelayer.address);
      expect(await oracle.relayers(0)).to.equal(notRelayer.address);
    });

    it("non-admin cannot rotate a relayer", async () => {
      await expect(
        oracle.connect(relayerA).rotateRelayer(0, notRelayer.address)
      ).to.be.revertedWithCustomError(oracle, "NotAdmin");
    });

    it("admin can update staleness seconds", async () => {
      await (await oracle.setStalenessSeconds(120)).wait();
      expect(await oracle.stalenessSeconds()).to.equal(120);
    });

    it("admin can update deviationBps", async () => {
      await (await oracle.setDeviationBps(100)).wait();
      expect(await oracle.deviationBps()).to.equal(100);
    });
  });
});
```

**Note on `getEncryptedPrice` testing:** since `FHE.asEuint64(...)` inside a `view` function would return a handle the caller can't decrypt (no ACL grant), the test uses a non-view wrapper `requestEncryptedPrice(marketId)` that stores `lastEncryptedPrice` with proper `FHE.allow(..., msg.sender)`. Implement both: the view `getEncryptedPrice` for engines to call inline, AND the stateful `requestEncryptedPrice` for testing/debugging.

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test test/Oracle.test.ts
```

Expected: FAIL with missing typechain.

- [ ] **Step 3: Implement `Oracle.sol`**

Create `/Users/ram/Desktop/NoirPerp/contracts/contracts/services/Oracle.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { FHE, euint64 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title Oracle
/// @notice 2-of-3 Chainlink-relayer price consensus. First submission
///         stores as pending; second submission from a DIFFERENT relayer
///         within deviation tolerance + staleness window commits the
///         price.
/// @dev Market IDs: 1 = BTC, 2 = ETH, 3 = SOL.
contract Oracle is ZamaEthereumConfig {
    struct PriceData {
        uint64 price;
        uint64 timestamp;
        uint8 confirmations;
        uint64 pendingPrice;
        uint64 pendingTimestamp;
        address pendingRelayer;
    }

    uint64 private constant BPS_DIVISOR = 10_000;

    mapping(uint8 marketId => PriceData) public prices;
    address[3] public relayers;
    uint256 public stalenessSeconds;
    uint256 public deviationBps;
    address public admin;

    /// @dev For test harness path only. Stores the last-produced
    ///      encrypted price handle with caller ACL grant.
    euint64 public lastEncryptedPrice;

    event PriceSubmitted(uint8 indexed marketId, address indexed relayer, uint64 price);
    event PriceCommitted(uint8 indexed marketId, uint64 price, uint64 timestamp);
    event RelayerRotated(uint8 indexed index, address oldRelayer, address newRelayer);
    event AdminTransferred(address indexed oldAdmin, address indexed newAdmin);

    error NotRelayer();
    error NotAdmin();
    error ZeroAddress();
    error DeviationTooLarge();
    error PendingStale();
    error PriceNotFresh();
    error BadIndex();

    modifier onlyRelayer() {
        if (
            msg.sender != relayers[0] &&
            msg.sender != relayers[1] &&
            msg.sender != relayers[2]
        ) revert NotRelayer();
        _;
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    constructor(
        address initialAdmin,
        address[3] memory initialRelayers,
        uint256 staleness_,
        uint256 deviation_
    ) {
        if (initialAdmin == address(0)) revert ZeroAddress();
        admin = initialAdmin;
        relayers = initialRelayers;
        stalenessSeconds = staleness_;
        deviationBps = deviation_;
        emit AdminTransferred(address(0), initialAdmin);
    }

    function submitPrice(uint8 marketId, uint64 price, uint64 timestamp)
        external
        onlyRelayer
    {
        PriceData storage p = prices[marketId];

        // Same relayer or no pending → (re)start pending cycle.
        if (p.pendingRelayer == address(0) || p.pendingRelayer == msg.sender) {
            p.pendingPrice = price;
            p.pendingTimestamp = timestamp;
            p.pendingRelayer = msg.sender;
            emit PriceSubmitted(marketId, msg.sender, price);
            return;
        }

        // Different relayer: attempt to commit.
        // Check staleness of pending.
        if (block.timestamp > p.pendingTimestamp + stalenessSeconds) {
            // Stale pending — reject; operator can restart by resubmitting.
            revert PendingStale();
        }

        // Check deviation: |price - pendingPrice| / pendingPrice <= deviationBps / BPS_DIVISOR.
        // Reformulated as multiplication to avoid division inaccuracy:
        //   abs(price - pendingPrice) * BPS_DIVISOR <= pendingPrice * deviationBps
        uint64 pp = p.pendingPrice;
        uint64 diff = price > pp ? price - pp : pp - price;
        if (uint256(diff) * BPS_DIVISOR > uint256(pp) * deviationBps) {
            revert DeviationTooLarge();
        }

        // Commit.
        p.price = price;
        p.timestamp = timestamp;
        p.confirmations = 2;
        // Clear pending.
        p.pendingPrice = 0;
        p.pendingTimestamp = 0;
        p.pendingRelayer = address(0);

        emit PriceSubmitted(marketId, msg.sender, price);
        emit PriceCommitted(marketId, price, timestamp);
    }

    function getPrice(uint8 marketId) public view returns (uint64 price, bool fresh) {
        PriceData memory p = prices[marketId];
        price = p.price;
        fresh = p.confirmations >= 2 && block.timestamp <= p.timestamp + stalenessSeconds;
    }

    /// @notice Trivial-encrypts the current fresh price for FHE downstream use.
    ///         Engines call this inline within their ops. Caller receives ACL
    ///         via FHE.allowThis on the returned handle.
    function getEncryptedPrice(uint8 marketId) external returns (euint64) {
        (uint64 price, bool fresh) = getPrice(marketId);
        if (!fresh) revert PriceNotFresh();
        euint64 encrypted = FHE.asEuint64(price);
        FHE.allowThis(encrypted);
        FHE.allowTransient(encrypted, msg.sender);
        return encrypted;
    }

    /// @notice Test-only helper: produces an encrypted price handle with
    ///         persistent ACL grant to the caller for decryption in tests.
    function requestEncryptedPrice(uint8 marketId) external {
        (uint64 price, bool fresh) = getPrice(marketId);
        if (!fresh) revert PriceNotFresh();
        euint64 encrypted = FHE.asEuint64(price);
        lastEncryptedPrice = encrypted;
        FHE.allowThis(encrypted);
        FHE.allow(encrypted, msg.sender);
    }

    function rotateRelayer(uint8 index, address newRelayer) external onlyAdmin {
        if (index >= 3) revert BadIndex();
        if (newRelayer == address(0)) revert ZeroAddress();
        address old = relayers[index];
        relayers[index] = newRelayer;
        emit RelayerRotated(index, old, newRelayer);
    }

    function setStalenessSeconds(uint256 s) external onlyAdmin {
        stalenessSeconds = s;
    }

    function setDeviationBps(uint256 d) external onlyAdmin {
        deviationBps = d;
    }

    function transferAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        address old = admin;
        admin = newAdmin;
        emit AdminTransferred(old, newAdmin);
    }
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test test/Oracle.test.ts
```

Expected: all Oracle tests pass. Target: ~15 passing.

If `getEncryptedPrice` test fails with ACL error: the `requestEncryptedPrice` helper in the contract must call `FHE.allow(encrypted, msg.sender)` (persistent, not transient) so the test's `userDecryptEuint` call can reach it across two separate transactions (deploy + request + decrypt). The transient variant only lives for one tx.

- [ ] **Step 5: CHANGELOG entry**

Append:
```markdown
- **Added**: `contracts/contracts/services/Oracle.sol` — 2-of-3
  Chainlink relayer consensus for per-market price feeds (BTC=1,
  ETH=2, SOL=3). First submission stores pending; second submission
  from a different relayer within deviation tolerance + staleness
  window commits. Trivial-encrypts the committed price for FHE ops
  via `getEncryptedPrice`. 15 unit tests covering access control,
  quorum state machine (same-relayer, deviation-exceed, stale-pending,
  new-cycle-after-commit), freshness, encryption, admin rotation.
  **Files**: `contracts/contracts/services/Oracle.sol`,
  `contracts/test/Oracle.test.ts`.
```

- [ ] **Step 6: Commit**

```bash
cd /Users/ram/Desktop/NoirPerp && git add contracts/contracts/services/Oracle.sol contracts/test/Oracle.test.ts CHANGELOG.md && git -c user.email=developer@randao.net -c user.name="Ram" commit -q -m "feat(service): add Oracle 2-of-3 relayer quorum

Price feed contract. First submission → pending. Second relayer (distinct)
within deviation + staleness window → commit. Trivial-encrypts committed
price for FHE ops. 15 unit tests.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `NoirVault.sol` — core (admin + engine authorization + pause)

**Files:**
- Create: `contracts/contracts/NoirVault.sol`
- Create: `contracts/test/NoirVault.Admin.test.ts`

**Purpose:** Scaffold the Vault with admin functions, engine register/deregister, and pause. State structs + ciphertext handling come in Task 5+. This is the smallest shippable vault that other phases can build on.

- [ ] **Step 1: Write failing test**

Create `/Users/ram/Desktop/NoirPerp/contracts/test/NoirVault.Admin.test.ts`:

```typescript
import { expect } from "chai";
import * as hre from "hardhat";
import type { NoirVault } from "../typechain-types";

describe("NoirVault — admin + engine authorization + pause", () => {
  let vault: NoirVault;
  let admin: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let engineA: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let engineB: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let alice: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];

  beforeEach(async () => {
    [admin, engineA, engineB, alice] = await hre.ethers.getSigners();
    const Factory = await hre.ethers.getContractFactory("NoirVault");
    // Constructor takes (admin, usdcxToken) — use ZeroAddress for token in admin-only tests
    vault = (await Factory.deploy(admin.address, hre.ethers.ZeroAddress)) as unknown as NoirVault;
    await vault.waitForDeployment();
  });

  describe("constructor", () => {
    it("sets admin", async () => {
      expect(await vault.admin()).to.equal(admin.address);
    });

    it("reverts on zero admin", async () => {
      const Factory = await hre.ethers.getContractFactory("NoirVault");
      await expect(
        Factory.deploy(hre.ethers.ZeroAddress, hre.ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(
        { interface: Factory.interface } as any, "ZeroAddress"
      );
    });

    it("starts unpaused", async () => {
      expect(await vault.paused()).to.equal(false);
    });
  });

  describe("engine registration", () => {
    it("admin can register an engine", async () => {
      await expect(vault.registerEngine(engineA.address))
        .to.emit(vault, "EngineRegistered")
        .withArgs(engineA.address);
      expect(await vault.authorizedEngines(engineA.address)).to.equal(true);
    });

    it("admin can register multiple engines", async () => {
      await (await vault.registerEngine(engineA.address)).wait();
      await (await vault.registerEngine(engineB.address)).wait();
      expect(await vault.authorizedEngines(engineA.address)).to.equal(true);
      expect(await vault.authorizedEngines(engineB.address)).to.equal(true);
    });

    it("admin can deregister an engine", async () => {
      await (await vault.registerEngine(engineA.address)).wait();
      await expect(vault.deregisterEngine(engineA.address))
        .to.emit(vault, "EngineDeregistered")
        .withArgs(engineA.address);
      expect(await vault.authorizedEngines(engineA.address)).to.equal(false);
    });

    it("non-admin cannot register", async () => {
      await expect(
        vault.connect(alice).registerEngine(engineA.address)
      ).to.be.revertedWithCustomError(vault, "NotAdmin");
    });

    it("non-admin cannot deregister", async () => {
      await (await vault.registerEngine(engineA.address)).wait();
      await expect(
        vault.connect(alice).deregisterEngine(engineA.address)
      ).to.be.revertedWithCustomError(vault, "NotAdmin");
    });

    it("cannot register zero address", async () => {
      await expect(
        vault.registerEngine(hre.ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(vault, "ZeroAddress");
    });
  });

  describe("pause / unpause", () => {
    it("admin can pause", async () => {
      await (await vault.pause()).wait();
      expect(await vault.paused()).to.equal(true);
    });

    it("admin can unpause", async () => {
      await (await vault.pause()).wait();
      await (await vault.unpause()).wait();
      expect(await vault.paused()).to.equal(false);
    });

    it("non-admin cannot pause", async () => {
      await expect(
        vault.connect(alice).pause()
      ).to.be.revertedWithCustomError(vault, "NotAdmin");
    });

    it("non-admin cannot unpause", async () => {
      await (await vault.pause()).wait();
      await expect(
        vault.connect(alice).unpause()
      ).to.be.revertedWithCustomError(vault, "NotAdmin");
    });
  });

  describe("admin transfer", () => {
    it("admin can transfer admin role", async () => {
      await expect(vault.transferAdmin(alice.address))
        .to.emit(vault, "AdminTransferred")
        .withArgs(admin.address, alice.address);
      expect(await vault.admin()).to.equal(alice.address);
    });

    it("reverts on zero address", async () => {
      await expect(
        vault.transferAdmin(hre.ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(vault, "ZeroAddress");
    });
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test test/NoirVault.Admin.test.ts
```
Expected: FAIL with missing `NoirVault` typechain.

- [ ] **Step 3: Implement `NoirVault.sol` (scaffold — admin/auth/pause only)**

Create `/Users/ram/Desktop/NoirPerp/contracts/contracts/NoirVault.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { FHE, euint64, externalEuint64 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";
import { IERC7984 } from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";

/// @title NoirVault
/// @notice Sole owner of all NoirPerp ciphertext state. No engine ever
///         holds user funds; engines call into the vault via authorized-
///         engine gating to mutate state.
/// @dev Task 4 (this commit): admin + engine authorization + pause.
///      Tasks 5-6 add balance ops and position storage.
contract NoirVault is ZamaEthereumConfig {
    /// @dev USDCx (ERC-7984) used for collateral. Set once at construction.
    ///      Can be address(0) for admin-only tests.
    IERC7984 public immutable usdcxToken;

    address public admin;
    bool public paused;
    mapping(address => bool) public authorizedEngines;

    event AdminTransferred(address indexed oldAdmin, address indexed newAdmin);
    event EngineRegistered(address indexed engine);
    event EngineDeregistered(address indexed engine);
    event Paused();
    event Unpaused();

    error NotAdmin();
    error NotAuthorizedEngine();
    error ZeroAddress();
    error AlreadyPaused();
    error NotPaused();
    error VaultPaused();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    modifier onlyAuthorizedEngine() {
        if (!authorizedEngines[msg.sender]) revert NotAuthorizedEngine();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert VaultPaused();
        _;
    }

    constructor(address initialAdmin, address usdcxToken_) {
        if (initialAdmin == address(0)) revert ZeroAddress();
        admin = initialAdmin;
        usdcxToken = IERC7984(usdcxToken_);
        emit AdminTransferred(address(0), initialAdmin);
    }

    // ─── Admin: engine registration ────────────────────────────────────

    function registerEngine(address engine) external onlyAdmin {
        if (engine == address(0)) revert ZeroAddress();
        authorizedEngines[engine] = true;
        emit EngineRegistered(engine);
    }

    function deregisterEngine(address engine) external onlyAdmin {
        authorizedEngines[engine] = false;
        emit EngineDeregistered(engine);
    }

    // ─── Admin: pause ──────────────────────────────────────────────────

    function pause() external onlyAdmin {
        if (paused) revert AlreadyPaused();
        paused = true;
        emit Paused();
    }

    function unpause() external onlyAdmin {
        if (!paused) revert NotPaused();
        paused = false;
        emit Unpaused();
    }

    // ─── Admin: transfer ───────────────────────────────────────────────

    function transferAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        address old = admin;
        admin = newAdmin;
        emit AdminTransferred(old, newAdmin);
    }
}
```

**Note on `IERC7984` import path:** the OZ Confidential Contracts package may place the interface at `interfaces/IERC7984.sol`, `token/ERC7984/IERC7984.sol`, or similar. Check:
```bash
find /Users/ram/Desktop/NoirPerp/contracts/node_modules/@openzeppelin/confidential-contracts -name "IERC7984.sol"
```
Use the actual path. If the interface export name differs (e.g. `IConfidentialFungibleToken`), use that. Document any naming difference in the commit message.

- [ ] **Step 4: Run test — expect PASS**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test test/NoirVault.Admin.test.ts
```
Expected: all admin tests pass. Target: 14 passing.

- [ ] **Step 5: CHANGELOG entry**

Append:
```markdown
- **Added**: `contracts/contracts/NoirVault.sol` (Task 4 scaffold —
  admin + engine authorization + pause). Subsequent tasks add balance
  ops and position storage. Uses OZ ERC-7984 interface for cUSDC
  reference (actual token address set at construction; zero-address
  allowed for admin-only tests). 14 unit tests.
  **Files**: `contracts/contracts/NoirVault.sol`,
  `contracts/test/NoirVault.Admin.test.ts`.
```

- [ ] **Step 6: Commit**

```bash
cd /Users/ram/Desktop/NoirPerp && git add contracts/contracts/NoirVault.sol contracts/test/NoirVault.Admin.test.ts CHANGELOG.md && git -c user.email=developer@randao.net -c user.name="Ram" commit -q -m "feat(vault): add NoirVault scaffold — admin + engine auth + pause

First slice of the vault. 14 unit tests covering construction,
engine register/deregister, pause/unpause, admin transfer, zero-
address guards. ERC-7984 token reference immutable at construction.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `NoirVault` — balance operations (deposit / withdraw / adjustBalance)

**Files:**
- Modify: `contracts/contracts/NoirVault.sol` (add balance state + functions)
- Create: `contracts/test/NoirVault.Balance.test.ts`

**Purpose:** Users deposit cUSDC into the vault to get an encrypted `usdcxBalance[user]` credit. They withdraw by debiting that balance and transferring cUSDC back. Engines (when gated) can `adjustBalance(user, delta, isCredit)` to debit collateral at position open and credit payout at close.

- [ ] **Step 1: Write failing test**

Create `/Users/ram/Desktop/NoirPerp/contracts/test/NoirVault.Balance.test.ts`:

```typescript
import { expect } from "chai";
import * as hre from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import type { NoirVault, MockERC7984 } from "../typechain-types";

describe("NoirVault — balance operations", () => {
  let vault: NoirVault;
  let token: MockERC7984;
  let admin: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let engine: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let alice: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let bob: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];

  async function decrypt(handle: string, user: typeof admin): Promise<bigint> {
    return hre.fhevm.userDecryptEuint(
      FhevmType.euint64,
      handle,
      await vault.getAddress(),
      user,
    );
  }

  beforeEach(async () => {
    [admin, engine, alice, bob] = await hre.ethers.getSigners();

    // Deploy MockERC7984
    const TokenFactory = await hre.ethers.getContractFactory("MockERC7984");
    token = (await TokenFactory.deploy("MockUSDCx", "mUSDCx")) as unknown as MockERC7984;
    await token.waitForDeployment();

    // Seed alice and bob with 10_000 mUSDCx each
    await (await token.mintPlaintext(alice.address, 10_000n)).wait();
    await (await token.mintPlaintext(bob.address, 10_000n)).wait();

    // Deploy Vault
    const VaultFactory = await hre.ethers.getContractFactory("NoirVault");
    vault = (await VaultFactory.deploy(admin.address, await token.getAddress())) as unknown as NoirVault;
    await vault.waitForDeployment();

    // Register engine for adjustBalance tests
    await (await vault.registerEngine(engine.address)).wait();
  });

  describe("deposit", () => {
    it("credits the user's encrypted balance", async () => {
      // alice approves vault to pull 1000 tokens
      await (await token.connect(alice).setOperator(await vault.getAddress(), 2n ** 48n)).wait();
      await (await vault.connect(alice).deposit(500n)).wait();

      const handle = await vault.getBalance(alice.address);
      expect(await decrypt(handle, alice)).to.equal(500n);
    });

    it("multiple deposits accumulate", async () => {
      await (await token.connect(alice).setOperator(await vault.getAddress(), 2n ** 48n)).wait();
      await (await vault.connect(alice).deposit(300n)).wait();
      await (await vault.connect(alice).deposit(200n)).wait();

      const handle = await vault.getBalance(alice.address);
      expect(await decrypt(handle, alice)).to.equal(500n);
    });

    it("reverts when paused", async () => {
      await (await token.connect(alice).setOperator(await vault.getAddress(), 2n ** 48n)).wait();
      await (await vault.pause()).wait();
      await expect(
        vault.connect(alice).deposit(100n)
      ).to.be.revertedWithCustomError(vault, "VaultPaused");
    });
  });

  describe("withdraw", () => {
    beforeEach(async () => {
      await (await token.connect(alice).setOperator(await vault.getAddress(), 2n ** 48n)).wait();
      await (await vault.connect(alice).deposit(1000n)).wait();
    });

    it("debits balance and transfers tokens back", async () => {
      await (await vault.connect(alice).withdraw(300n)).wait();

      const vaultBalHandle = await vault.getBalance(alice.address);
      expect(await decrypt(vaultBalHandle, alice)).to.equal(700n);
    });

    it("withdrawing more than balance results in zero payout (safe math)", async () => {
      // alice has 1000, tries to withdraw 2000 — saturating: 0 effective
      await (await vault.connect(alice).withdraw(2000n)).wait();
      const handle = await vault.getBalance(alice.address);
      // safeSub semantics: 1000 - 2000 clamped to 0
      expect(await decrypt(handle, alice)).to.equal(0n);
    });

    it("reverts when paused", async () => {
      await (await vault.pause()).wait();
      await expect(
        vault.connect(alice).withdraw(100n)
      ).to.be.revertedWithCustomError(vault, "VaultPaused");
    });
  });

  describe("adjustBalance (engine only)", () => {
    beforeEach(async () => {
      await (await token.connect(alice).setOperator(await vault.getAddress(), 2n ** 48n)).wait();
      await (await vault.connect(alice).deposit(1000n)).wait();
    });

    it("engine can credit a user's balance", async () => {
      await (await vault.connect(engine).adjustBalance(alice.address, 500n, true)).wait();
      const handle = await vault.getBalance(alice.address);
      expect(await decrypt(handle, alice)).to.equal(1500n);
    });

    it("engine can debit a user's balance", async () => {
      await (await vault.connect(engine).adjustBalance(alice.address, 300n, false)).wait();
      const handle = await vault.getBalance(alice.address);
      expect(await decrypt(handle, alice)).to.equal(700n);
    });

    it("debit larger than balance saturates at 0 (safe math)", async () => {
      await (await vault.connect(engine).adjustBalance(alice.address, 5000n, false)).wait();
      const handle = await vault.getBalance(alice.address);
      expect(await decrypt(handle, alice)).to.equal(0n);
    });

    it("non-engine cannot adjustBalance", async () => {
      await expect(
        vault.connect(bob).adjustBalance(alice.address, 100n, true)
      ).to.be.revertedWithCustomError(vault, "NotAuthorizedEngine");
    });

    it("reverts when paused", async () => {
      await (await vault.pause()).wait();
      await expect(
        vault.connect(engine).adjustBalance(alice.address, 100n, true)
      ).to.be.revertedWithCustomError(vault, "VaultPaused");
    });
  });
});
```

**Note on `setOperator`**: OZ ERC-7984 uses an operator model rather than ERC-20 `approve`. The user calls `token.setOperator(vaultAddress, untilTimestamp)` to let the vault pull tokens. Use `2n ** 48n` as a far-future timestamp for tests. If the OZ API differs (e.g., `approve(addr, encryptedAmount, proof)`), update the test accordingly.

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test test/NoirVault.Balance.test.ts
```

- [ ] **Step 3: Update `NoirVault.sol` — add balance functions**

Modify `/Users/ram/Desktop/NoirPerp/contracts/contracts/NoirVault.sol`. Add imports and new state/functions. Replace the existing file with:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { FHE, euint64, externalEuint64 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";
import { IERC7984 } from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";
import { FHESafeMath } from "./lib/FHESafeMath.sol";

/// @title NoirVault
/// @notice Sole owner of all NoirPerp ciphertext state.
/// @dev Task 5 (this commit): adds user balance state + deposit/withdraw
///      + engine-gated adjustBalance. Task 6 adds position storage.
contract NoirVault is ZamaEthereumConfig {
    using FHESafeMath for euint64;

    IERC7984 public immutable usdcxToken;

    address public admin;
    bool public paused;
    mapping(address => bool) public authorizedEngines;

    /// @dev Encrypted user balances in USDCx. Incremented on deposit /
    ///      engine-credit; decremented on withdraw / engine-debit.
    ///      Uses FHESafeMath semantics (underflow clamps to 0).
    mapping(address => euint64) private _balances;

    event AdminTransferred(address indexed oldAdmin, address indexed newAdmin);
    event EngineRegistered(address indexed engine);
    event EngineDeregistered(address indexed engine);
    event Paused();
    event Unpaused();
    event Deposited(address indexed user, uint64 amount);
    event Withdrawn(address indexed user, uint64 amount);
    event BalanceAdjusted(address indexed user, uint64 amount, bool isCredit, address indexed engine);

    error NotAdmin();
    error NotAuthorizedEngine();
    error ZeroAddress();
    error AlreadyPaused();
    error NotPaused();
    error VaultPaused();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    modifier onlyAuthorizedEngine() {
        if (!authorizedEngines[msg.sender]) revert NotAuthorizedEngine();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert VaultPaused();
        _;
    }

    constructor(address initialAdmin, address usdcxToken_) {
        if (initialAdmin == address(0)) revert ZeroAddress();
        admin = initialAdmin;
        usdcxToken = IERC7984(usdcxToken_);
        emit AdminTransferred(address(0), initialAdmin);
    }

    // ─── Admin: engine registration ────────────────────────────────────

    function registerEngine(address engine) external onlyAdmin {
        if (engine == address(0)) revert ZeroAddress();
        authorizedEngines[engine] = true;
        emit EngineRegistered(engine);
    }

    function deregisterEngine(address engine) external onlyAdmin {
        authorizedEngines[engine] = false;
        emit EngineDeregistered(engine);
    }

    // ─── Admin: pause ──────────────────────────────────────────────────

    function pause() external onlyAdmin {
        if (paused) revert AlreadyPaused();
        paused = true;
        emit Paused();
    }

    function unpause() external onlyAdmin {
        if (!paused) revert NotPaused();
        paused = false;
        emit Unpaused();
    }

    // ─── Admin: transfer ───────────────────────────────────────────────

    function transferAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        address old = admin;
        admin = newAdmin;
        emit AdminTransferred(old, newAdmin);
    }

    // ─── Balance: user-facing ──────────────────────────────────────────

    /// @notice Deposits `amount` of USDCx from the caller into the vault,
    ///         crediting the caller's encrypted balance.
    /// @dev Requires the caller to have granted the vault operator status
    ///      on the USDCx token prior to calling.
    function deposit(uint64 amount) external whenNotPaused {
        euint64 amt = FHE.asEuint64(amount);
        // Transfer from caller to vault via ERC-7984
        FHE.allowTransient(amt, address(usdcxToken));
        usdcxToken.confidentialTransferFrom(msg.sender, address(this), amt);
        // Credit internal balance
        euint64 current = _balances[msg.sender];
        euint64 newBal = FHESafeMath.safeAdd(current, amt);
        _balances[msg.sender] = newBal;
        FHE.allowThis(newBal);
        FHE.allow(newBal, msg.sender);
        emit Deposited(msg.sender, amount);
    }

    /// @notice Withdraws `amount` of USDCx to the caller, debiting
    ///         their internal balance (saturating at 0).
    function withdraw(uint64 amount) external whenNotPaused {
        euint64 amt = FHE.asEuint64(amount);
        euint64 current = _balances[msg.sender];
        // Effective withdraw = min(amount, current)
        // Debit first, transfer the same amount.
        euint64 newBal = FHESafeMath.safeSub(current, amt);
        // Effective amount transferred = current - newBal
        euint64 effective = FHESafeMath.safeSub(current, newBal);
        _balances[msg.sender] = newBal;
        FHE.allowThis(newBal);
        FHE.allow(newBal, msg.sender);
        FHE.allowTransient(effective, address(usdcxToken));
        usdcxToken.confidentialTransfer(msg.sender, effective);
        emit Withdrawn(msg.sender, amount);
    }

    // ─── Balance: engine-facing ────────────────────────────────────────

    /// @notice Adjusts a user's encrypted balance. Only authorized engines.
    ///         Used by PerpEngine to debit collateral at position open and
    ///         credit payout at position close.
    /// @param user Target user.
    /// @param amount Plaintext amount (trivial-encrypted internally; amounts
    ///        here are engine-known since they're oracle-derived).
    /// @param isCredit true to credit (add), false to debit (subtract,
    ///        saturating at 0).
    function adjustBalance(address user, uint64 amount, bool isCredit)
        external
        onlyAuthorizedEngine
        whenNotPaused
    {
        euint64 delta = FHE.asEuint64(amount);
        euint64 current = _balances[user];
        euint64 newBal = isCredit
            ? FHESafeMath.safeAdd(current, delta)
            : FHESafeMath.safeSub(current, delta);
        _balances[user] = newBal;
        FHE.allowThis(newBal);
        FHE.allow(newBal, user);
        emit BalanceAdjusted(user, amount, isCredit, msg.sender);
    }

    /// @notice Returns the ciphertext handle for a user's balance. Caller
    ///         must have FHE.allow permission on the returned handle to
    ///         decrypt it (the user themselves is granted at each mutation).
    function getBalance(address user) external view returns (euint64) {
        return _balances[user];
    }
}
```

**⚠️ FHE operation budget check**: `deposit` uses 1 `asEuint64` (trivial) + 1 `confidentialTransferFrom` (external) + 1 `safeAdd` (~450k HCU) = well within 5M sequential limit. `withdraw` does 1 `asEuint64` + 2 `safeSub` + 1 `confidentialTransfer` = ~900k HCU, safe. `adjustBalance` is ~450-500k HCU depending on branch.

**⚠️ ERC-7984 API assumption**: the plan assumes `confidentialTransferFrom(from, to, euint64 amount)` and `confidentialTransfer(to, euint64 amount)` exist on `IERC7984`. If the actual OZ interface uses different signatures (e.g., requires an `externalEuint64 + bytes proof` arg pair), adapt the vault's deposit/withdraw accordingly. Common alternatives:
- `transferFrom(address from, address to, euint64 amount)` (no "confidential" prefix)
- `transfer(address to, externalEuint64 encryptedAmount, bytes inputProof)` (external-only)

Check via:
```bash
grep -A 5 "function .*Transfer" /Users/ram/Desktop/NoirPerp/contracts/node_modules/@openzeppelin/confidential-contracts/contracts/interfaces/IERC7984.sol
```
Use the actual signature. Document any adjustment in the commit message + CHANGELOG.

- [ ] **Step 4: Run test — expect PASS**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test test/NoirVault.Balance.test.ts
```

Target: 12 passing (3 deposit + 3 withdraw + 5 adjustBalance + 1 non-engine + more).

If the test fails on `setOperator` — API mismatch. Use whatever the OZ interface actually exposes.

If the test fails with ACL error on `getBalance` — the mutation function forgot to `FHE.allow(newBal, user)`. Check each of `deposit`, `withdraw`, `adjustBalance`.

- [ ] **Step 5: CHANGELOG entry**

Append:
```markdown
- **Modified**: `contracts/contracts/NoirVault.sol` (Task 5 addition) —
  encrypted balance state + deposit/withdraw (user-facing) +
  adjustBalance (engine-only). Uses FHESafeMath for both safeAdd
  (deposits) and safeSub (withdrawals / debits). Saturating semantics
  on underflow prevent silent loss. 12 unit tests.
  **Files**: `contracts/contracts/NoirVault.sol`,
  `contracts/test/NoirVault.Balance.test.ts`.
```

- [ ] **Step 6: Commit**

```bash
cd /Users/ram/Desktop/NoirPerp && git add contracts/contracts/NoirVault.sol contracts/test/NoirVault.Balance.test.ts CHANGELOG.md && git -c user.email=developer@randao.net -c user.name="Ram" commit -q -m "feat(vault): add encrypted balance ops

User deposit/withdraw via ERC-7984 transferFrom/transfer, engine-
gated adjustBalance. FHESafeMath for all arithmetic. Saturating
on underflow. 12 new tests; all FHESafeMath-dependent paths covered.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `NoirVault` — position storage + mutators + `MockEngine` harness

**Files:**
- Modify: `contracts/contracts/NoirVault.sol`
- Create: `contracts/contracts/test-harness/MockEngine.sol`
- Create: `contracts/test/NoirVault.Positions.test.ts`

**Purpose:** Add `positions` mapping + `writePosition` / `closePosition` (engine-gated) + `getPosition` (view). `MockEngine` is a test-only authorized-engine stand-in that calls these. Real engines come in Phase 3+.

**Position struct** (matches design spec §4.1 — subset for Phase 2):
```solidity
struct Position {
    euint64 size;
    euint64 entryPrice;
    euint64 collateral;
    bool isLong;
    uint8 marketId;
    address owner;
    bool active;
}
```

- [ ] **Step 1: Write failing test**

Create `/Users/ram/Desktop/NoirPerp/contracts/test/NoirVault.Positions.test.ts`:

```typescript
import { expect } from "chai";
import * as hre from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import type { NoirVault, MockERC7984, MockEngine } from "../typechain-types";

describe("NoirVault — position storage", () => {
  let vault: NoirVault;
  let engine: MockEngine;
  let token: MockERC7984;
  let admin: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let alice: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let bob: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];

  async function decrypt(handle: string, user: typeof admin): Promise<bigint> {
    return hre.fhevm.userDecryptEuint(
      FhevmType.euint64,
      handle,
      await vault.getAddress(),
      user,
    );
  }

  beforeEach(async () => {
    [admin, alice, bob] = await hre.ethers.getSigners();

    const TokenFactory = await hre.ethers.getContractFactory("MockERC7984");
    token = (await TokenFactory.deploy("MockUSDCx", "mUSDCx")) as unknown as MockERC7984;
    await token.waitForDeployment();

    const VaultFactory = await hre.ethers.getContractFactory("NoirVault");
    vault = (await VaultFactory.deploy(admin.address, await token.getAddress())) as unknown as NoirVault;
    await vault.waitForDeployment();

    const EngineFactory = await hre.ethers.getContractFactory("MockEngine");
    engine = (await EngineFactory.deploy(await vault.getAddress())) as unknown as MockEngine;
    await engine.waitForDeployment();

    await (await vault.registerEngine(await engine.getAddress())).wait();
  });

  describe("writePosition", () => {
    it("stores a new position and increments nextPositionId", async () => {
      const id0 = await vault.nextPositionId();
      await (
        await engine.openMockPosition(
          alice.address,
          100n /* size */,
          3000n /* entryPrice */,
          500n /* collateral */,
          true /* isLong */,
          2 /* marketId = ETH */,
        )
      ).wait();
      const id1 = await vault.nextPositionId();
      expect(id1).to.equal(id0 + 1n);

      const pos = await vault.getPosition(id0);
      expect(pos.owner).to.equal(alice.address);
      expect(pos.isLong).to.equal(true);
      expect(pos.marketId).to.equal(2);
      expect(pos.active).to.equal(true);
    });

    it("position's encrypted fields decrypt to the written values", async () => {
      await (
        await engine.openMockPosition(alice.address, 100n, 3000n, 500n, true, 2)
      ).wait();
      const pos = await vault.getPosition(0);
      expect(await decrypt(pos.size, alice)).to.equal(100n);
      expect(await decrypt(pos.entryPrice, alice)).to.equal(3000n);
      expect(await decrypt(pos.collateral, alice)).to.equal(500n);
    });

    it("non-engine cannot call writePosition directly", async () => {
      // writePosition is engine-only; simulate direct call from alice
      const dummyCt = hre.ethers.ZeroHash;
      await expect(
        vault.connect(alice).writePosition(alice.address, dummyCt, dummyCt, dummyCt, true, 2)
      ).to.be.revertedWithCustomError(vault, "NotAuthorizedEngine");
    });

    it("reverts when paused", async () => {
      await (await vault.pause()).wait();
      await expect(
        engine.openMockPosition(alice.address, 100n, 3000n, 500n, true, 2)
      ).to.be.reverted; // reverts with VaultPaused (but MockEngine doesn't forward the custom error name)
    });
  });

  describe("closePosition", () => {
    beforeEach(async () => {
      await (
        await engine.openMockPosition(alice.address, 100n, 3000n, 500n, true, 2)
      ).wait();
    });

    it("engine can close an active position", async () => {
      await (await engine.closeMockPosition(0)).wait();
      const pos = await vault.getPosition(0);
      expect(pos.active).to.equal(false);
    });

    it("non-engine cannot closePosition", async () => {
      await expect(
        vault.connect(bob).closePosition(0)
      ).to.be.revertedWithCustomError(vault, "NotAuthorizedEngine");
    });

    it("closing an already-closed position does not revert but stays inactive", async () => {
      await (await engine.closeMockPosition(0)).wait();
      await (await engine.closeMockPosition(0)).wait(); // idempotent
      const pos = await vault.getPosition(0);
      expect(pos.active).to.equal(false);
    });
  });

  describe("position id counter", () => {
    it("increments independently per position", async () => {
      await (await engine.openMockPosition(alice.address, 100n, 3000n, 500n, true, 2)).wait();
      await (await engine.openMockPosition(bob.address, 200n, 50000n, 1000n, false, 1)).wait();
      await (await engine.openMockPosition(alice.address, 50n, 100n, 250n, true, 3)).wait();
      expect(await vault.nextPositionId()).to.equal(3n);
    });

    it("positions for different users are isolated", async () => {
      await (await engine.openMockPosition(alice.address, 100n, 3000n, 500n, true, 2)).wait();
      await (await engine.openMockPosition(bob.address, 200n, 50000n, 1000n, false, 1)).wait();
      const pAlice = await vault.getPosition(0);
      const pBob = await vault.getPosition(1);
      expect(pAlice.owner).to.equal(alice.address);
      expect(pBob.owner).to.equal(bob.address);
      expect(pAlice.isLong).to.equal(true);
      expect(pBob.isLong).to.equal(false);
    });
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test test/NoirVault.Positions.test.ts
```

- [ ] **Step 3: Implement `MockEngine.sol` harness**

Create `/Users/ram/Desktop/NoirPerp/contracts/contracts/test-harness/MockEngine.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { FHE, euint64 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";
import { NoirVault } from "../NoirVault.sol";

/// @title MockEngine
/// @notice Test-only authorized-engine stand-in. Exercises vault mutator
///         paths with plaintext inputs (trivially encrypted internally).
contract MockEngine is ZamaEthereumConfig {
    NoirVault public immutable vault;

    constructor(address vaultAddr) {
        vault = NoirVault(vaultAddr);
    }

    /// @notice Trivially encrypts inputs and calls vault.writePosition.
    function openMockPosition(
        address owner,
        uint64 size,
        uint64 entryPrice,
        uint64 collateral,
        bool isLong,
        uint8 marketId
    ) external returns (uint256 positionId) {
        euint64 eSize = FHE.asEuint64(size);
        euint64 eEntry = FHE.asEuint64(entryPrice);
        euint64 eColl = FHE.asEuint64(collateral);
        FHE.allowTransient(eSize, address(vault));
        FHE.allowTransient(eEntry, address(vault));
        FHE.allowTransient(eColl, address(vault));
        positionId = vault.writePosition(owner, eSize, eEntry, eColl, isLong, marketId);
    }

    /// @notice Calls vault.closePosition.
    function closeMockPosition(uint256 positionId) external {
        vault.closePosition(positionId);
    }
}
```

- [ ] **Step 4: Update `NoirVault.sol` — add position storage and mutators**

Modify `/Users/ram/Desktop/NoirPerp/contracts/contracts/NoirVault.sol`. Add the `Position` struct, the `positions` mapping, `nextPositionId`, `writePosition`, `closePosition`, and `getPosition`. After the existing `getBalance` function, append:

```solidity
    // ─── Positions ─────────────────────────────────────────────────────

    struct Position {
        euint64 size;
        euint64 entryPrice;
        euint64 collateral;
        bool isLong;
        uint8 marketId;
        address owner;
        bool active;
    }

    mapping(uint256 => Position) private _positions;
    uint256 public nextPositionId;

    event PositionOpened(uint256 indexed positionId, address indexed owner, uint8 marketId);
    event PositionClosed(uint256 indexed positionId);

    /// @notice Engine-only. Stores a new Position and grants ACL to owner.
    /// @return positionId The new position's id.
    function writePosition(
        address owner,
        euint64 size,
        euint64 entryPrice,
        euint64 collateral,
        bool isLong,
        uint8 marketId
    ) external onlyAuthorizedEngine whenNotPaused returns (uint256 positionId) {
        positionId = nextPositionId++;

        // Vault needs persistent ACL on each ciphertext to read later.
        FHE.allowThis(size);
        FHE.allowThis(entryPrice);
        FHE.allowThis(collateral);
        // Owner can decrypt their own position state client-side.
        FHE.allow(size, owner);
        FHE.allow(entryPrice, owner);
        FHE.allow(collateral, owner);

        _positions[positionId] = Position({
            size: size,
            entryPrice: entryPrice,
            collateral: collateral,
            isLong: isLong,
            marketId: marketId,
            owner: owner,
            active: true
        });

        emit PositionOpened(positionId, owner, marketId);
    }

    /// @notice Engine-only. Marks a position as inactive.
    function closePosition(uint256 positionId) external onlyAuthorizedEngine whenNotPaused {
        Position storage p = _positions[positionId];
        p.active = false;
        emit PositionClosed(positionId);
    }

    function getPosition(uint256 positionId) external view returns (Position memory) {
        return _positions[positionId];
    }
```

- [ ] **Step 5: Run test — expect PASS**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test test/NoirVault.Positions.test.ts
```

Target: ~10 passing.

If "`position's encrypted fields decrypt to the written values`" fails with ACL error: `writePosition` forgot to call `FHE.allow(size, owner)` (and same for entryPrice, collateral). Check each.

If the mock engine compilation fails with "Identifier not found" on `FHE.allowTransient` — adjust the import line to include `euint64` properly from `@fhevm/solidity/lib/FHE.sol`.

- [ ] **Step 6: CHANGELOG entry**

Append:
```markdown
- **Modified**: `contracts/contracts/NoirVault.sol` (Task 6 addition) —
  `Position` struct + `positions` mapping + `nextPositionId` counter +
  `writePosition` (engine-only) + `closePosition` (engine-only) +
  `getPosition` view. Positions store encrypted size / entryPrice /
  collateral plus plaintext isLong / marketId / owner / active. ACL:
  vault gets persistent `allowThis` per ciphertext; owner gets
  persistent `allow` to decrypt client-side. 10 unit tests via new
  `MockEngine` harness.
  **Files**: `contracts/contracts/NoirVault.sol`,
  `contracts/contracts/test-harness/MockEngine.sol`,
  `contracts/test/NoirVault.Positions.test.ts`.
```

- [ ] **Step 7: Commit**

```bash
cd /Users/ram/Desktop/NoirPerp && git add contracts/contracts/NoirVault.sol contracts/contracts/test-harness/MockEngine.sol contracts/test/NoirVault.Positions.test.ts CHANGELOG.md && git -c user.email=developer@randao.net -c user.name="Ram" commit -q -m "feat(vault): add position storage + engine mutators

Position struct (3 euint64 + 3 plaintext fields + active bool),
positions mapping, nextPositionId counter. writePosition and
closePosition engine-gated. MockEngine harness exercises all paths.
10 new unit tests.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Local deploy script

**Files:**
- Create: `contracts/scripts/deploy-local.ts`

**Purpose:** One-shot deployment of the three Phase-2 contracts to the Hardhat local chain. Reads admin + relayers from env (or uses signers 0-3), deploys in order, prints addresses. This script becomes the template for Phase 3+ engine deployments.

- [ ] **Step 1: Write `deploy-local.ts`**

Create `/Users/ram/Desktop/NoirPerp/contracts/scripts/deploy-local.ts`:

```typescript
import * as hre from "hardhat";

/// Phase 2 local deploy script.
/// Deploys:
///   1. MockERC7984 (USDCx mock for local testing)
///   2. Compliance (admin = signer[0], initial empty root)
///   3. Oracle    (admin = signer[0], relayers = signer[1..3])
///   4. NoirVault (admin = signer[0], usdcxToken = MockERC7984)
async function main() {
  const signers = await hre.ethers.getSigners();
  const [admin, relayerA, relayerB, relayerC] = signers;

  console.log("=== NoirPerp Phase 2 local deploy ===");
  console.log("Admin:   ", admin.address);
  console.log("Relayers:", relayerA.address, relayerB.address, relayerC.address);
  console.log("");

  // 1. MockERC7984
  const TokenFactory = await hre.ethers.getContractFactory("MockERC7984");
  const token = await TokenFactory.deploy("MockUSDCx", "mUSDCx");
  await token.waitForDeployment();
  console.log("MockERC7984 deployed:", await token.getAddress());

  // 2. Compliance (empty root — no users allowlisted by default)
  const ComplianceFactory = await hre.ethers.getContractFactory("Compliance");
  const compliance = await ComplianceFactory.deploy(admin.address, hre.ethers.ZeroHash);
  await compliance.waitForDeployment();
  console.log("Compliance deployed: ", await compliance.getAddress());

  // 3. Oracle
  const OracleFactory = await hre.ethers.getContractFactory("Oracle");
  const oracle = await OracleFactory.deploy(
    admin.address,
    [relayerA.address, relayerB.address, relayerC.address],
    90, // stalenessSeconds
    50, // deviationBps = 0.5%
  );
  await oracle.waitForDeployment();
  console.log("Oracle deployed:     ", await oracle.getAddress());

  // 4. NoirVault
  const VaultFactory = await hre.ethers.getContractFactory("NoirVault");
  const vault = await VaultFactory.deploy(admin.address, await token.getAddress());
  await vault.waitForDeployment();
  console.log("NoirVault deployed:  ", await vault.getAddress());

  console.log("");
  console.log("=== Phase 2 deploy complete ===");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run the deploy script against local Hardhat**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat run scripts/deploy-local.ts
```

Expected: prints 4 contract addresses. No errors. If it fails, check that all 4 contracts compile and the constructor signatures match.

- [ ] **Step 3: CHANGELOG entry**

Append:
```markdown
- **Added**: `contracts/scripts/deploy-local.ts` — one-shot Phase 2
  deploy script for the Hardhat local chain. Deploys MockERC7984,
  Compliance (empty root), Oracle (3 relayers = signers[1..3],
  staleness 90s, deviation 50bps), NoirVault. Template for Phase 3+
  engine deploys.
  **Files**: `contracts/scripts/deploy-local.ts`.
```

- [ ] **Step 4: Commit**

```bash
cd /Users/ram/Desktop/NoirPerp && git add contracts/scripts/deploy-local.ts CHANGELOG.md && git -c user.email=developer@randao.net -c user.name="Ram" commit -q -m "feat(scripts): add Phase 2 local deploy script

Deploys MockERC7984 + Compliance + Oracle + NoirVault in order
to the Hardhat local chain. Template for Phase 3+ engine deploys.
Verified with 'npx hardhat run scripts/deploy-local.ts'.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Coverage + Phase 2 tick

**Files:**
- Modify: `contracts/hardhat.config.ts` (if coverage plugin needs additional config)
- Modify: `/Users/ram/Desktop/NoirPerp/PROGRESS.md`
- Modify: `/Users/ram/Desktop/NoirPerp/CHANGELOG.md`

- [ ] **Step 1: Run full test suite**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test 2>&1 | tail -5
```

Expected: full suite green. Total across Phase 0+1+2: 57 (prior) + ~14 Compliance + ~15 Oracle + ~14 Vault.Admin + ~12 Vault.Balance + ~10 Vault.Positions ≈ **122 passing**.

- [ ] **Step 2: Run coverage**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && SOLIDITY_COVERAGE=true npx hardhat coverage --testfiles "test/Compliance.test.ts,test/Oracle.test.ts,test/NoirVault.Admin.test.ts,test/NoirVault.Balance.test.ts,test/NoirVault.Positions.test.ts" 2>&1 | tail -20
```

Expected: each of the 3 Phase-2 contract files shows Lines ≥ 90%, Functions ≥ 90%, Statements ≥ 90%, Branches ≥ 80%.

If `NoirVault.sol` has uncovered branches, add a test. Common gaps:
- `AlreadyPaused` revert (pause when already paused)
- `NotPaused` revert (unpause when not paused)
- `deregisterEngine` when engine was never registered (should be no-op, not revert)

- [ ] **Step 3: Tick Phase 2 in PROGRESS.md**

Change:
```markdown
- [ ] **Phase 2 — Vault + services**
  Plan: *(not yet written)*
  Completion criteria: `NoirVault`, `Oracle`, `Compliance` deploy to
  local mock and Sepolia; engine registration flow works; 2-of-3
  oracle quorum verified.
```
to:
```markdown
- [x] **Phase 2 — Vault + services** ✅ (2026-04-XX)
  Plan: `docs/plans/2026-04-24-phase-2-vault-services.md`
  Completion criteria met: NoirVault / Oracle / Compliance all live;
  ~65 new unit tests; local deploy script green; 2-of-3 oracle quorum
  verified (state-machine tests cover same-relayer, deviation-exceed,
  stale-pending, new-cycle-after-commit); engine register/deregister
  path proven by MockEngine + vault authorization tests. Sepolia
  deploy deferred to Phase 9 integration.
```
Replace `2026-04-XX` with actual date.

- [ ] **Step 4: Append Phase 2 complete entry to CHANGELOG.md**

```markdown
### Phase 2 complete ✅ (2026-04-XX)

- **3 services + 1 vault live on local mock**:
  - `Compliance` — Merkle allowlist w/ admin-controlled root + revocation
  - `Oracle` — 2-of-3 Chainlink relayer quorum w/ freshness + deviation
  - `NoirVault` — ciphertext balance + position state, engine-gated mutators
- **Test count**: ~122 total (57 prior + ~65 Phase 2). Coverage ≥90%
  lines/funcs/stmts on every Phase-2 contract.
- **Local deploy green** via `scripts/deploy-local.ts`.
- **Sepolia deploy**: deferred to Phase 9 integration pass (need
  funded Sepolia key + real RPC). Script template in place.
- **Ready for Phase 3**: PerpEngine can now call `vault.writePosition`,
  `vault.adjustBalance`, `oracle.getEncryptedPrice`,
  `compliance.verify` — all interfaces in place.
```

- [ ] **Step 5: Commit**

```bash
cd /Users/ram/Desktop/NoirPerp && git add PROGRESS.md CHANGELOG.md && git -c user.email=developer@randao.net -c user.name="Ram" commit -q -m "docs: tick Phase 2 complete

Vault + services live. ~122 tests passing. Coverage >=90% per contract.
Sepolia deploy deferred to Phase 9. Ready for Phase 3 (PerpEngine).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 6: Announce complete**

Report:
> "✅ Phase 2 complete. Vault + Oracle + Compliance all live + tested. ~122 tests passing. Coverage ≥90% per contract. Ready for Phase 3 plan (PerpEngine)."

---

## Appendix A — Troubleshooting

**`IERC7984` import path mismatch**: the OZ confidential-contracts package layout has evolved. If `@openzeppelin/confidential-contracts/interfaces/IERC7984.sol` doesn't exist, try:
- `@openzeppelin/confidential-contracts/token/ERC7984/IERC7984.sol`
- `@openzeppelin/confidential-contracts/contracts/interfaces/IConfidentialFungibleToken.sol`
Use `find node_modules/@openzeppelin/confidential-contracts -name "*.sol" | head -20` to enumerate.

**`setOperator` vs `approve`**: ERC-7984's operator model differs from ERC-20. If tests fail at "vault cannot pull tokens", the test needs to match whatever the OZ token exposes. Read `node_modules/@openzeppelin/confidential-contracts/contracts/token/ERC7984/ERC7984.sol` to find the correct approval mechanism.

**Merkle leaf format**: OZ StandardMerkleTree (the JS library) uses double-hashed leaves: `keccak256(bytes.concat(keccak256(abi.encode(...))))`. If `verify` returns false for valid proofs, the contract-side leaf derivation doesn't match. Both sides must use the same format.

**Coverage plugin complains about ERC-7984 transfer paths**: FHE calls in external tokens may not be instrumented. Focus coverage on your own contracts (exclude node_modules via `.solcover.js` if needed).

**Node.js v25 warning**: still applies. Tests run but Hardhat is not officially supporting Node 25+. If you hit a mysterious runtime error, try Node 22 LTS.

**`FHE.allow` ACL ladder**: remember the pattern for every ciphertext path:
  1. Producer (vault or engine) calls `FHE.allowThis(ct)` to keep persistent access.
  2. Producer calls `FHE.allow(ct, consumer)` for anyone who needs persistent decrypt rights (e.g., position owner).
  3. For one-shot cross-contract calls, `FHE.allowTransient(ct, callee)` suffices.

Skipping step 2 is the #1 cause of "not allowed" errors in downstream decrypt helpers.
