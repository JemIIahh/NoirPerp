# NoirPerp — Changelog

Every change documented BEFORE commit. Entry format:
- **What changed / added**
- **Why** (ticket, decision reference, or inline reason)
- **Root cause** (for bug fixes)
- **What was tried** (for bug fixes — including things that didn't work)
- **Files touched**

Purpose: prevent re-fixing already-fixed bugs; prevent re-visiting
solved design decisions; give future agents full context.

---

## 2026-04-24

### Phase 0 scaffolding (in progress)

- **Added**: Design spec `docs/specs/2026-04-24-noirperp-design.md` —
  approved by CTO after full brainstorming session.
  **Why**: source-of-truth document for the rebuild; written before any
  code to prevent scope drift.
  **Files**: `docs/specs/2026-04-24-noirperp-design.md`.

- **Added**: Phase 0 implementation plan
  `docs/plans/2026-04-24-phase-0-scaffolding.md`.
  **Why**: bite-sized TDD task list for Phase 0 scaffolding + smoke test.
  **Files**: `docs/plans/2026-04-24-phase-0-scaffolding.md`.

- **Added**: Root `.gitignore`.
  **Why**: exclude node_modules, build artifacts, env files, IDE cruft.
  **Files**: `.gitignore`.

- **Added**: `CLAUDE.md` — pinned agent rules (Pillar 1).
  **Why**: anti-hallucination guardrail; locks FHEVM primitive
  assumptions, change-management rules, testing rules.
  **Files**: `CLAUDE.md`.

- **Added**: `PROGRESS.md` — phase tracker (Pillar 3).
  **Why**: anti-hallucination guardrail; single source of truth for
  phase state; enforces phase-gate discipline.
  **Files**: `PROGRESS.md`.

- **Added**: `CHANGELOG.md` — this file (Pillar 2).
  **Why**: anti-hallucination guardrail; every change logged before
  commit; Predictoor-pattern.
  **Files**: `CHANGELOG.md`.

- **Added**: `docs/fhe-primitives.md` (Pillar 4) — living FHEVM
  primitives reference, pinned package versions, Sepolia addresses,
  full op table with HCU costs, ACL model, async decryption pattern,
  known footguns.
  **Files**: `docs/fhe-primitives.md`.

- **Added**: `.claude/settings.local.json` — permission allowlist for
  Claude Code sessions (Pillar 4).
  **Files**: `.claude/settings.local.json`.

- **Added**: `contracts/package.json` + `package-lock.json` with pinned
  Hardhat + FHEVM + OZ toolchain.
  **Why**: Hardhat workspace scaffolding for the contracts module.
  **Files**: `contracts/package.json`, `contracts/package-lock.json`.

- **Added**: `contracts/hardhat.config.ts` + `contracts/tsconfig.json`.
  **Why**: Solidity 0.8.27 + cancun EVM + Sepolia network config.
  **Files**: `contracts/hardhat.config.ts`, `contracts/tsconfig.json`.

- **Added**: `contracts/.env.example`.
  **Files**: `contracts/.env.example`.

- **Added**: `contracts/contracts/Smoke.sol` + `contracts/test/Smoke.test.ts`.
  **Why**: FHEVM toolchain smoke test — deploys contract, trivially
  encrypts `uint64(42)`, grants ACL, mock-decrypts, compares to 42.
  Proves @fhevm/solidity + @fhevm/hardhat-plugin + typechain + mock
  decrypt all wired correctly.
  **Files**: `contracts/contracts/Smoke.sol`, `contracts/test/Smoke.test.ts`.

- **Corrected**: `docs/fhe-primitives.md` and `CLAUDE.md` both
  referenced a `SepoliaConfig` class from `@fhevm/solidity`. The
  actual v0.11.1 API exports `ZamaEthereumConfig` (auto-dispatches by
  chain ID). `SepoliaConfig` does not exist in the installed version.
  Discovered while writing Smoke.sol.
  **Root cause**: docs recon (2026-04-23) referenced an older API name
  from Zama docs; the installed package uses the newer unified name.
  **What was tried**: `import { SepoliaConfig } from
  "@fhevm/solidity/config/ZamaConfig.sol"` — import succeeded but no
  such symbol exists; switched to `ZamaEthereumConfig` which is
  exported and correctly handles Hardhat (31337) and Sepolia (11155111).
  **Files**: `docs/fhe-primitives.md` §2, `CLAUDE.md` Token/library rules.

- **Corrected**: `docs/fhe-primitives.md` pinned
  `@zama-fhe/relayer-sdk` to `^0.4.2`. Actual requirement is exact
  `0.4.1` — `@fhevm/hardhat-plugin@0.4.2` enforces strict version
  match at startup and errors otherwise.
  **Root cause**: docs recon reported SDK version `^0.4.2`; hardhat
  plugin version `^0.4.2` — assumed they'd be version-aligned.
  They're not; plugin insists on SDK `0.4.1` even though plugin itself
  is `0.4.2`.
  **What was tried**: installed `^0.4.2` → plugin threw version-check
  error; downgraded to `0.4.1` → works.
  **Files**: `docs/fhe-primitives.md` §1, `contracts/package.json`
  (via npm install downgrade).

- **Accommodation** (non-blocking): `contracts/package.json` gained
  `@nomicfoundation/hardhat-ignition`, `hardhat-ignition-ethers`,
  `hardhat-verify`, `ignition-core` as explicit devDependencies —
  these are standard Hardhat Toolbox peer deps that were missing from
  the plan's package.json. Also `@zama-fhe/relayer-sdk` moved from
  Phase 8 production to Phase 0 devDep (required at plugin init).
  Installed with `--legacy-peer-deps` due to toolbox expecting
  `hardhat-gas-reporter@^1` while we pin `^2` (tooling-only, no
  effect on FHE behavior).
  **Files**: `contracts/package.json`.

- **Note**: Node.js v25 is not officially supported by Hardhat v2
  (supports v20–v22 LTS). Smoke test passes despite the warning.
  If future phases fail with Node-related issues, downgrading Node
  to v22 LTS is the mitigation.

### Phase 0 complete ✅ (2026-04-24)

- **Scaffolding**: monorepo structure created (contracts/, frontend/,
  bot/, oracle-relayer/, compliance-backend/, docs/, assets/).
- **Guardrails (all 4 pillars populated)**:
  - `CLAUDE.md` — pinned agent rules
  - `CHANGELOG.md` — this file
  - `PROGRESS.md` — phase tracker
  - `docs/fhe-primitives.md` — verified FHEVM primitives reference
  - `.claude/settings.local.json` — permission allowlist
- **Contracts workspace**: Hardhat + FHEVM plugin + OZ confidential
  contracts + TypeScript + typechain installed; `hardhat.config.ts`
  and `tsconfig.json` written; Solidity 0.8.27 locked.
- **Toolchain smoke test**: `Smoke.sol` + `Smoke.test.ts` prove
  `FHE.asEuint64` + storage + ACL + mock decrypt all work
  end-to-end. `npx hardhat test` → 1 passing.
- **Why**: Phase 1 (shared libs) cannot start without a working
  FHEVM toolchain and the guardrail docs in place.
- **Files**: see individual commits in the `git log`
  (commit range `86103a6..HEAD` on branch `phase-0-scaffolding`).

### Phase 0 post-review fixes (2026-04-24)

Two independent reviewers (spec compliance + code quality) ran after
the phase-complete tick. Their findings, all addressed in one commit:

- **Fix (CRITICAL)**: `contracts/package.json` had an uncommitted
  local modification bumping `@zama-fhe/relayer-sdk` from `^0.4.2` to
  `^0.4.1`. Tests passed locally because `node_modules/` had the right
  version, but a fresh `git clone` + `npm install` would have
  re-installed `^0.4.2` and broken plugin init. Committed the pin,
  also tightened `^0.4.1` to exact `0.4.1` (plugin enforces exact).
  **Files**: `contracts/package.json`, `contracts/package-lock.json`.

- **Fix**: Added `fhevmTemp/` to `.gitignore`. `@fhevm/hardhat-plugin`
  creates this directory during compile/test as a working dir; was
  showing up as untracked noise in `git status`.
  Also removed duplicate `out/` entry that appeared under both
  "Build" and "Foundry (future)" sections.
  **Files**: `.gitignore`.

- **Fix**: `hardhat.config.ts` previously passed an empty-string
  `ETHERSCAN_API_KEY` to the etherscan config even when unset,
  producing misleading auth errors on `hardhat verify`. Now passes
  the config only when the key is set.
  **Files**: `contracts/hardhat.config.ts`.

- **Fix**: Removed `deploy:local` and `deploy:sepolia` scripts from
  `contracts/package.json` — they pointed at files that don't exist
  yet (Phase 2/3 adds real deploy scripts). Keeping them now would
  violate CLAUDE.md rule #4 ("no placeholder code").
  **Files**: `contracts/package.json`.

- **Fix**: Added explicit in-body comment on `Smoke.sol:setValue`
  marking it as TOOLCHAIN SMOKE TEST ONLY to prevent future agents
  from copy-pasting the open-setter pattern into real engines.
  **Files**: `contracts/contracts/Smoke.sol`.

- **Fix**: `docs/fhe-primitives.md` §9 referenced the smoke test file
  as `contracts/test/smoke.test.ts` (lowercase) — actual file is
  `Smoke.test.ts`. Matters on case-sensitive filesystems (Linux CI).
  **Files**: `docs/fhe-primitives.md`.

- **Added**: `docs/fhe-primitives.md` §10 — "Hardhat plugin
  integration notes" documenting the `import * as hre from "hardhat"`
  + `FhevmType from "@fhevm/hardhat-plugin"` API pattern we
  discovered. The `{ ethers, fhevm } from "hardhat"` pattern in the
  Phase 0 plan does NOT work; this note prevents future agents from
  re-tripping on it.
  **Files**: `docs/fhe-primitives.md`.

- **Deferred** (noted, not fixed in this commit): `tsconfig.json`
  does not `include` the `contracts/` directory. Low risk today
  (Solidity files don't go through tsc), but if we ever place `.ts`
  files under `contracts/contracts/` they'd be silently ignored.
  Will revisit when needed.

- **Deferred** (intentional historical artifact): `docs/specs/2026-04-24-noirperp-design.md`
  still references `SepoliaConfig` (should be `ZamaEthereumConfig`)
  and `@zama-fhe/relayer-sdk ^0.4.2` (should be exact `0.4.1`). The
  design spec is a point-in-time approved document; corrections live
  in `docs/fhe-primitives.md` (the LIVING DOC). Per CLAUDE.md
  priority, `fhe-primitives.md` overrides the spec for FHE primitive
  details.

### Phase 1 — Shared libs (in progress)

- **Added**: `contracts/contracts/lib/FHESafeMath.sol` — select-guarded
  `safeSub`, `safeAdd` (saturating), `absDiff` on `euint64`. Prevents
  silent underflow / overflow wraparound per OZ FHEVM security guide.
  **Why**: every engine's margin/PnL math runs through this lib; raw
  `FHE.sub` / `FHE.add` are banned outside of it (per CLAUDE.md rule #3).
  **Files**: `contracts/contracts/lib/FHESafeMath.sol`,
  `contracts/contracts/test-harness/FHESafeMathHarness.sol`,
  `contracts/test/FHESafeMath.test.ts`.

- **Added**: `contracts/contracts/lib/TickMath.sol` — ported from
  Uniswap v3-core (MIT). Pure math, no FHE. Used by AMMEngine
  (Phase 4) for concentrated-liquidity tick calculations.
  Exposes `getSqrtRatioAtTick`, `getTickAtSqrtRatio`, and bound
  constants `MIN_TICK`, `MAX_TICK`, `MIN_SQRT_RATIO`, `MAX_SQRT_RATIO`.
  13 unit tests passing.
  **Files**: `contracts/contracts/lib/TickMath.sol`,
  `contracts/contracts/test-harness/TickMathHarness.sol`,
  `contracts/test/TickMath.test.ts`.
  **Fix (plan bug resolved)**: the plan's symmetry test used `1n << 16n`
  as absolute tolerance for `sqrtPrice(-tick) * sqrtPrice(+tick) ≈ 2^192`.
  At tick ±1000 each `sqrtPrice` is ~2^96, so the product's ULP rounding
  drift propagates to ~2^95 absolute (relative error ~3e-30). The
  `2^16` bound was mathematically impossible. Corrected to `1n << 112n`
  which corresponds to relative precision better than 2^-80 — still a
  rigorous symmetry guarantee, just at the correct scale. Contract code
  unchanged (it's a verbatim UniV3 port and all 12 other tests verify
  correctness). All 13 TickMath tests now pass.
  **Root cause**: plan author confused absolute vs relative tolerance
  when writing the test.

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

- **Added**: `contracts/contracts/lib/MarginMath.sol` —
  multiplication-only margin / PnL / liquidation math. No `FHE.div`
  (ciphertext ÷ ciphertext does not exist); all ratio checks
  reformulated as multiplications. Depends on `FHESafeMath`.
  Functions: `notional`, `marginOK`, `pnlLong`, `pnlShort`,
  `shouldLiquidate`. 16 unit tests covering happy paths, boundaries,
  and zero-price-change edge cases.
  **Note**: `userDecryptEbool` IS available on
  `@fhevm/hardhat-plugin@0.4.2` as a first-class method
  (`hre.fhevm.userDecryptEbool(handle, contractAddress, signer)`).
  No fallback was needed; used directly as in the plan's primary path.
  **Files**: `contracts/contracts/lib/MarginMath.sol`,
  `contracts/contracts/test-harness/MarginMathHarness.sol`,
  `contracts/test/MarginMath.test.ts`.

### Phase 1 complete ✅ (2026-04-24)

- **All 4 shared libraries live**:
  - `FHESafeMath` — select-guarded arithmetic (safeSub, safeAdd, absDiff)
  - `TickMath` — UniV3 tick math (MIT port, pure)
  - `DecryptQueue` — async-decrypt state machine with replay guard
  - `MarginMath` — multiplication-only margin/PnL/liquidation math
- **Test count**: 57 passing (1 Smoke + 14 FHESafeMath + 13 TickMath +
  13 DecryptQueue + 16 MarginMath).
- **Coverage** (via `SOLIDITY_COVERAGE=true npx hardhat coverage`):
  - FHESafeMath: 100% / 100% / 100% / 100% (stmt/branch/func/line)
  - MarginMath:  100% / 100% / 100% / 100%
  - DecryptQueue: 100% / 100% / 100% / 100%
  - TickMath:   100% / 85.71% / 100% / 100% (branch coverage lower
    because UniV3 boundary revert paths are hard to exercise through
    the normal test surface; still above 80% threshold)
- **Note**: `hardhat coverage` requires `SOLIDITY_COVERAGE=true` env
  var for FHEVM plugin compatibility. Without it, the plugin errors
  with "Wrong Hardhat Network Config for Solidity Coverage". Future
  phases should use the same env var.
- **Plan bug caught + fixed**: TickMath symmetry test originally used
  `1n << 16n` absolute tolerance, which was mathematically impossible
  (products of ~2^96 operands have ~2^95 rounding drift). Tolerance
  corrected to `1n << 112n` (relative precision > 2^-80). Contract
  code unchanged — UniV3 port verified correct.
- **Why**: Phase 2 (Vault + services) and all subsequent engine phases
  depend on these libs. Every margin check, PnL calc, and async
  decrypt callback will flow through them.
- **Ready for Phase 2**: NoirVault, Oracle, Compliance services.

### Phase 2 — Task 1: MockERC7984 test fixture (2026-04-23)

- **Added**: `contracts/contracts/test-harness/MockERC7984.sol` — minimal
  ERC-7984 token mock for local Hardhat vault tests. Extends OZ's `ERC7984`
  base (openzeppelin/confidential-contracts v0.4.0). Exposes two mint
  entry points:
  - `mint(address, externalEuint64, bytes)` — proof-based mint (exercises
    the full `FHE.fromExternal` path).
  - `mintPlaintext(address, uint64)` — trivial-encrypt mint for tests that
    don't need the proof path.
  Both are open to any caller (test-only; NOT production-safe).
  **Why**: Vault tests in Task 5 need a locally deployable ERC-7984 token.
  On Sepolia the pre-deployed `cUSDCMock @ 0x7c5BF43B851c1dff1a4feE8dB225b87f2C223639`
  is used instead.
  **Files**: `contracts/contracts/test-harness/MockERC7984.sol`.

- **OZ API verified** (no deviations from plan template):
  - Constructor: `ERC7984(string name_, string symbol_, string contractURI_)`
    — three args as expected; mock passes `""` for contractURI.
  - Internal mint: `_mint(address to, euint64 amount) internal returns (euint64)`
    — exact signature assumed by the plan.
  - `ERC7984` is a concrete (non-abstract) base extending only `ERC165`.
    No abstract methods to implement.
  - The plan's template was used verbatim with one cosmetic fix: the
    NatSpec `@openzeppelin/...` package reference in the dev comment was
    changed to remove the leading `@` (Solidity's docstring parser
    interpreted it as an unknown NatSpec tag and threw `DocstringParsingError`).
    This is a doc-comment-only change; no logic was altered.

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
- **Added**: `contracts/contracts/services/Oracle.sol` — 2-of-3
  Chainlink relayer consensus for per-market price feeds (BTC=1,
  ETH=2, SOL=3). First submission stores pending; second submission
  from a different relayer within deviation tolerance + staleness
  window commits. Trivial-encrypts the committed price for FHE ops
  via `getEncryptedPrice`. 17 unit tests covering access control,
  quorum state machine (same-relayer, deviation-exceed, stale-pending,
  new-cycle-after-commit), freshness, encryption, admin rotation.
  **Files**: `contracts/contracts/services/Oracle.sol`,
  `contracts/test/Oracle.test.ts`.
- **Added**: `contracts/contracts/NoirVault.sol` (Task 4 scaffold —
  admin + engine authorization + pause). Subsequent tasks add balance
  ops and position storage. Uses OZ ERC-7984 interface for cUSDC
  reference (actual token address set at construction; zero-address
  allowed for admin-only tests). 15 unit tests covering construction,
  engine register/deregister, pause/unpause, admin transfer, zero-
  address guards. IERC7984 import path matches plan exactly:
  `openzeppelin/confidential-contracts/interfaces/IERC7984.sol`.
  **Files**: `contracts/contracts/NoirVault.sol`,
  `contracts/test/NoirVault.Admin.test.ts`.
- **Modified**: `contracts/contracts/NoirVault.sol` (Task 5 addition) —
  encrypted balance state + deposit/withdraw (user-facing) +
  adjustBalance (engine-only). Uses FHESafeMath for both safeAdd
  (deposits) and safeSub (withdrawals / debits). Saturating semantics
  on underflow prevent silent loss. 11 unit tests covering all three
  functions including pause gating and engine-only access control.
  **Deviation from plan**: `setOperator` called with `2n ** 48n - 1n`
  (uint48 max) rather than `2n ** 48n` (which overflows uint48 by 1);
  plan had an off-by-one in the far-future timestamp. `getBalance` is a
  view function returning the raw `euint64` handle; ACL grants issued at
  each mutation allow the user to decrypt client-side. Test count is 11
  (not 12) — plan's stated target matched a 12th test not included in
  the test file spec.
  **Files**: `contracts/contracts/NoirVault.sol`,
  `contracts/test/NoirVault.Balance.test.ts`.
- **Modified**: `contracts/contracts/NoirVault.sol` (Task 6 addition) —
  `Position` struct + `positions` mapping + `nextPositionId` counter +
  `writePosition` (engine-only) + `closePosition` (engine-only) +
  `getPosition` view. Positions store encrypted size / entryPrice /
  collateral plus plaintext isLong / marketId / owner / active. ACL:
  vault gets persistent `allowThis` per ciphertext; owner gets
  persistent `allow` to decrypt client-side. 9 unit tests via new
  `MockEngine` harness (plan target was ~10; 9 passing covers all paths).
  **Files**: `contracts/contracts/NoirVault.sol`,
  `contracts/contracts/test-harness/MockEngine.sol`,
  `contracts/test/NoirVault.Positions.test.ts`.
- **Added**: `contracts/scripts/deploy-local.ts` — one-shot Phase 2
  deploy script for the Hardhat local chain. Deploys MockERC7984,
  Compliance (empty root), Oracle (3 relayers = signers[1..3],
  staleness 90s, deviation 50bps), NoirVault. Template for Phase 3+
  engine deploys.
  **Files**: `contracts/scripts/deploy-local.ts`.

- **Added**: 6 Oracle coverage-gap tests (post-Task-6 review found
  the plan's Oracle test set missed `transferAdmin` entirely and
  didn't exercise the engine-facing `getEncryptedPrice` or the edge
  reverts `BadIndex` / `ZeroAddress` in `rotateRelayer`). Oracle
  coverage now 100% stmts / 100% funcs / 100% lines / 86.11% branches.
  **Files**: `contracts/test/Oracle.test.ts`.

- **Plan bug fixed inline**: Task 5's test used `2n ** 48n` as a
  far-future timestamp for `setOperator`. uint48 max is `2**48 - 1`;
  passing `2**48` overflows. Subagent corrected to `2n ** 48n - 1n`.

- **Plan test-count undercounting pattern**: Tasks 2, 3, 4, 6 all
  had actual test counts 1-2 higher than the plan estimated. No
  tests were skipped; plan author consistently undercounted leaf
  `it()` blocks. Final Phase 2 test totals: Compliance 16, Oracle
  23, Vault.Admin 15, Vault.Balance 11, Vault.Positions 9 = 74 new.

### Phase 2 complete ✅ (2026-04-24)

- **3 services + 1 vault live on local mock**:
  - `services/Compliance.sol` — Merkle allowlist w/ admin-controlled
    root + per-address revocation (OZ StandardMerkleTree convention)
  - `services/Oracle.sol` — 2-of-3 Chainlink relayer quorum, deviation
    tolerance (50bps), staleness window (90s), trivial-encrypts
    committed price for FHE downstream use
  - `NoirVault.sol` — sole owner of ciphertext state; encrypted
    balance mapping + deposit/withdraw (ERC-7984) + engine-gated
    adjustBalance + position storage + writePosition/closePosition
  - `test-harness/MockERC7984.sol` — local-test-only ERC-7984 mock
  - `test-harness/MockEngine.sol` — authorized-engine stand-in for
    vault mutator tests
- **Test count**: 131 total passing (57 prior + 74 Phase 2).
- **Coverage** (via `SOLIDITY_COVERAGE=true npx hardhat coverage`):
  - Compliance: 100% stmts / 100% branches / 100% funcs / 100% lines
  - Oracle:     100% stmts /  86.11% branches / 100% funcs / 100% lines
  - NoirVault:  100% stmts /  90.91% branches / 100% funcs / 100% lines
  - All ≥ 90% stmts/funcs/lines; all ≥ 80% branches (targets met).
- **Local deploy verified**: `npx hardhat run scripts/deploy-local.ts`
  prints 4 addresses cleanly. Script is the template for Phase 3+.
- **Sepolia deploy**: deferred to Phase 9 (needs funded key + real RPC).
- **Why**: Phase 3 PerpEngine can now call `vault.writePosition`,
  `vault.adjustBalance`, `oracle.getEncryptedPrice`, `compliance.verify`
  — all interfaces are live + tested.
- **Ready for Phase 3** (PerpEngine): open/close/liquidate for 3
  markets (BTC/ETH/SOL).

### Phase 1+2 retroactive Tier 1 audit (2026-04-24)

Ran spec-compliance + code-quality reviewer agents on Phases 1 and 2
before merging. Findings (2 critical, 5 important, several minor) all
addressed in follow-up commits. See CHANGELOG commits tagged
`fix(audit):` for details.

**Critical fixes**:
1. `NoirVault.writePosition` missing `FHE.isSenderAllowed` guards — CLAUDE.md
   rule #4 violation, real inference-attack vector.
2. `NoirVault.adjustBalance` took plaintext `uint64` instead of `euint64
   delta` — spec deviation that would have leaked engine-computed amounts
   to calldata and blocked Phase 3's PerpEngine.openPosition flow.

**Important fixes**:
3. `FHESafeMath.safeMul` added. `MarginMath` now routes every `FHE.mul`
   through it. Prevents silent-wrap in `shouldLiquidate` at
   `unrealizedLoss > 2^64 / 10_000 ≈ $1.8B USDC` (would have masked
   liquidation of deeply insolvent positions).
4. Oracle admin setters (`setStalenessSeconds`, `setDeviationBps`) now
   emit events (`StalenessChanged`, `DeviationBpsChanged`).
5. `DecryptQueue.cleanupStale` griefing vector documented (by-design,
   10x safety margin vs Gateway latency).
6. `NoirVault.withdraw` silent-zero ERC-7984 footgun documented.
7. `FHESafeMath.absDiff` select-guard pattern documented (raw `FHE.sub`
   safety rationale).

**Process fix** (the actual root cause): `PROGRESS.md` now mandates Tier 1
audit as a phase-completion criterion. Phase 0 had it; Phases 1-2 skipped
it; result was 2 critical + 5 important findings detected only on
retroactive review. Going forward every phase must pass Tier 1 before tick.

**Deferred (Phase 9 scope)**:
- `safeAdd` redundant `asEuint64(MAX_U64)` optimization
- Oracle ECDSA `sig` verification (msg.sender-as-attestation accepted for MVP)
- Test strengthening (pause-positive path, over-withdraw token delta check)

**Final Phase 2 test count**: 138 passing.

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

- **Added**: `contracts/contracts/engines/PerpEngine.sol` — perpetual
  futures engine (Task 2 scaffold: admin + openPosition). Inherits
  `DecryptQueue` for later async-liquidation work. Config locked at
  construction: MAX_LEVERAGE=20, MAINT_MARGIN=500bps, LIQ_FEE=50bps.
  `openPosition` synchronous: compliance gate, oracle freshness, then
  FHE-guarded balance + margin check with silent-zero on failure.
  7 unit tests.
  **Deviation**: `whenNotPaused` uses local `error VaultPaused()` on
  PerpEngine rather than `NoirVault.VaultPaused()` cross-contract
  reference. Solidity ^0.8.27 supports the cross-contract syntax but
  the local error is cleaner and avoids tight coupling. Stack-too-deep
  resolved by splitting `openPosition` into `_computeFinals` +
  `_settle` internal helpers (no viaIR needed).
  **Files**: `contracts/contracts/engines/PerpEngine.sol`,
  `contracts/test/PerpEngine.Open.test.ts`.
