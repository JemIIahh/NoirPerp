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
