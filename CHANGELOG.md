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
