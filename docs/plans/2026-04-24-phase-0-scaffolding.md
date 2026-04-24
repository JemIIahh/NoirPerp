# Phase 0 — Scaffolding & Guardrails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the NoirPerp monorepo with anti-hallucination guardrails, install and configure the FHEVM toolchain, and prove end-to-end that `FHE.asEuint64` works on the local FHEVM mock via a smoke test.

**Architecture:** Monorepo at `/Users/ram/Desktop/NoirPerp/` with four Node workspaces (`contracts/`, `frontend/`, `bot/`, `oracle-relayer/`, `compliance-backend/`) plus `docs/`. Phase 0 builds only the contracts workspace skeleton; other workspaces scaffold in their own phases. Four anti-hallucination "pillars" (`CLAUDE.md`, `CHANGELOG.md`, `PROGRESS.md`, `docs/fhe-primitives.md`) are created with real content — not placeholders.

**Tech Stack (locked):**
- `@fhevm/solidity@^0.11.1`
- `@fhevm/hardhat-plugin@^0.4.2`
- `@fhevm/mock-utils@^0.4.2`
- `@zama-fhe/relayer-sdk@^0.4.2` (Phase 8)
- `@openzeppelin/confidential-contracts@0.4.0`
- `@openzeppelin/contracts@^5.2.0`
- `hardhat@^2.22.0`
- `solidity@0.8.27` (FHEVM-compatible range)
- `ethers@^6.13.0`
- `typescript@^5.5.0`
- `chai@^4.5.0`, `mocha@^10.7.0`

**Reference spec:** `docs/specs/2026-04-24-noirperp-design.md`

---

### Task 0: Verify environment preconditions

**Files:** none (verification only)

- [ ] **Step 1: Verify Node.js ≥ 20**

Run: `node -v`
Expected: `v20.x.x` or higher. If < 20, install Node 20+ before continuing (FHEVM plugin requires Node 20+).

- [ ] **Step 2: Verify npm ≥ 10**

Run: `npm -v`
Expected: `10.x.x` or higher.

- [ ] **Step 3: Verify git and working directory**

Run: `cd /Users/ram/Desktop/NoirPerp && git status`
Expected: shows the existing `design.md` commit on `main`. If not a git repo, the design-spec commit workflow was skipped — stop and investigate.

- [ ] **Step 4: Verify internet access to npm registry**

Run: `npm ping`
Expected: `Ping success:` response. Required for `npm install` later in this phase.

---

### Task 1: Create the monorepo directory skeleton

**Files:**
- Create: `/Users/ram/Desktop/NoirPerp/contracts/` (directory)
- Create: `/Users/ram/Desktop/NoirPerp/frontend/` (directory, empty placeholder)
- Create: `/Users/ram/Desktop/NoirPerp/bot/` (directory, empty placeholder)
- Create: `/Users/ram/Desktop/NoirPerp/oracle-relayer/` (directory, empty placeholder)
- Create: `/Users/ram/Desktop/NoirPerp/compliance-backend/` (directory, empty placeholder)
- Create: `/Users/ram/Desktop/NoirPerp/assets/` (directory)
- Create: `/Users/ram/Desktop/NoirPerp/.claude/` (directory)
- Create: `/Users/ram/Desktop/NoirPerp/contracts/contracts/` (where `.sol` files live)
- Create: `/Users/ram/Desktop/NoirPerp/contracts/contracts/engines/`
- Create: `/Users/ram/Desktop/NoirPerp/contracts/contracts/services/`
- Create: `/Users/ram/Desktop/NoirPerp/contracts/contracts/lib/`
- Create: `/Users/ram/Desktop/NoirPerp/contracts/test/`
- Create: `/Users/ram/Desktop/NoirPerp/contracts/scripts/`

- [ ] **Step 1: Create all directories with a single command**

Run:
```bash
cd /Users/ram/Desktop/NoirPerp && mkdir -p \
  contracts/contracts/engines \
  contracts/contracts/services \
  contracts/contracts/lib \
  contracts/test \
  contracts/scripts \
  frontend \
  bot \
  oracle-relayer \
  compliance-backend \
  assets \
  .claude
```

- [ ] **Step 2: Verify structure**

Run: `cd /Users/ram/Desktop/NoirPerp && ls -la`
Expected: shows `contracts`, `frontend`, `bot`, `oracle-relayer`, `compliance-backend`, `assets`, `.claude`, `docs`, `.git`.

- [ ] **Step 3: Commit**

Run:
```bash
cd /Users/ram/Desktop/NoirPerp && git add -A && git commit -q -m "chore: scaffold monorepo directory skeleton

Per Phase 0 plan. Empty placeholder dirs for frontend/bot/oracle-relayer/
compliance-backend will be populated in later phases.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

Note: empty dirs don't commit in git — Step 3 may say "nothing to commit". That's fine; they become real in later tasks when files are added.

---

### Task 2: Create the root `.gitignore`

**Files:**
- Create: `/Users/ram/Desktop/NoirPerp/.gitignore`

- [ ] **Step 1: Write `.gitignore`**

Create `/Users/ram/Desktop/NoirPerp/.gitignore` with content:

```
# Node
node_modules/
npm-debug.log
yarn-error.log
pnpm-debug.log

# Build
dist/
build/
out/
artifacts/
cache/
typechain/
typechain-types/
.fhevm/

# Hardhat
coverage/
coverage.json
.coverage_contracts/
.coverage_cache/

# Env + secrets
.env
.env.local
.env.*.local
*.pem
*.key

# IDE
.idea/
.vscode/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Frontend
frontend/dist/
frontend/.vite/

# Logs
*.log
logs/

# Foundry (future)
out/
cache_forge/
broadcast/
```

- [ ] **Step 2: Commit**

Run:
```bash
cd /Users/ram/Desktop/NoirPerp && git add .gitignore && git commit -q -m "chore: add root .gitignore

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Write `CLAUDE.md` (Pillar 1 — pinned rules)

**Files:**
- Create: `/Users/ram/Desktop/NoirPerp/CLAUDE.md`

- [ ] **Step 1: Write `CLAUDE.md`**

Create `/Users/ram/Desktop/NoirPerp/CLAUDE.md` with content:

```markdown
# NoirPerp — Agent Instructions (PINNED)

This file loads automatically into every Claude Code session in this repo.
These rules override defaults. Violations block commits.

## What NoirPerp is
Privacy-preserving perpetual-futures DEX on Zama FHEVM (Sepolia, v0.12.1).
Ground-up rewrite of ZKPerp (Aleo → FHE). Design spec:
`docs/specs/2026-04-24-noirperp-design.md` — read it before any work.

## FHEVM primitive rules (the load-bearing ones)

1. **Namespace is `FHE.*`** — never `TFHE.*`. The old API was deprecated in
   FHEVM v0.9. If you see `TFHE.` in any code, it's wrong, migrate it.

2. **`FHE.div(euint64, euint64)` does not exist.** Ciphertext ÷ ciphertext
   is unsupported. Reformulate every ratio check as multiplication:
   `a × MAX >= b × price` instead of `b × price / a <= 1/MAX`.

3. **FHE arithmetic is UNCHECKED.** `FHE.sub(a, b)` wraps silently on
   underflow. Always use `FHESafeMath.safeSub` / `safeAdd` from `lib/`.
   Raw `FHE.sub` / `FHE.add` are banned outside the lib.

4. **Every engine entry requires `require(FHE.isSenderAllowed(ct))`.**
   Skipping this enables inference attacks where a caller routes a
   ciphertext they shouldn't have access to through our engine.

5. **ACL discipline**: engines use `allowTransient` only. Persistent
   `allow` lives inside the Vault for state it owns. Never grant
   persistent `allow` to an engine — it becomes a disclosure oracle.

6. **Decrypt callbacks**: every `_on*Decided` callback must call
   `DecryptQueue.dequeue(reqId)` BEFORE any external call. Replay guard.
   Also must call `FHE.checkSignatures(reqId, cleartexts, proof)` first.

7. **HCU budget is 5M sequential / 20M global per tx.** Deep FHE
   multiplication chains (>~10 muls deep) will blow the sequential
   limit. Batch operations across txs when necessary.

## Token / library rules

- Token standard is **ERC-7984** via `@openzeppelin/confidential-contracts@0.4.0`.
  Not `ConfidentialERC20` (renamed symbol, gone).
- USDCx on Sepolia: use the pre-deployed `cUSDCMock @ 0x7c5BF43B851c1dff1a4feE8dB225b87f2C223639`.
  Do not deploy your own wrapper.
- Contracts inherit `SepoliaConfig` from `@fhevm/solidity/config/ZamaConfig.sol`
  to auto-wire KMS + coprocessor addresses.

## Change management rules

1. **`CHANGELOG.md` entry BEFORE commit.** No commit without the
   corresponding entry. Format: what changed, why, files touched.

2. **`PROGRESS.md` updated on phase completion.** A phase is "complete"
   only when its checkbox is ticked, tests are green, and CHANGELOG has
   the entry. Phase N+1 may not start otherwise.

3. **Never change FHE primitive assumptions without re-verifying
   `docs/fhe-primitives.md`.** If something in that doc seems wrong,
   re-fetch the Zama docs, update the primitives doc, then proceed.

4. **No placeholder code.** Never write `// TODO`, `// implement later`,
   or stub functions that revert. Complete the task or don't claim it
   done.

5. **No new files unless the plan says so.** If a file isn't listed in
   the current phase's implementation plan, don't create it. If you
   need one that isn't planned, propose the addition and wait.

## Testing rules

- Every new Solidity function ships with at least one unit test (Hardhat
  + FHEVM mock). Coverage target per engine: ≥90%.
- Failing tests block commits. Do not push around a failing test by
  commenting it out; fix the root cause or mark it `.skip` with a
  CHANGELOG entry explaining why.
- Invariant + fuzz tests (Foundry) run in Phase 9. Don't write them
  earlier; they need the full contract surface to be useful.

## What NOT to do

- Don't add error handling, retries, or fallbacks for scenarios the
  design spec doesn't call out. Trust the spec's error-handling table
  in Section 6.
- Don't refactor unrelated code while making a targeted change.
- Don't write new docs unless the current phase's plan says so. The
  spec is the source of truth for design; CHANGELOG tracks history;
  PROGRESS tracks state. Don't proliferate.
- Don't invent FHEVM primitives. If it's not in `docs/fhe-primitives.md`
  or the Zama docs, it doesn't exist.
- Don't skip the `FHE.isSenderAllowed` guard. Ever. Even for internal
  helpers. It's cheap and load-bearing.

## Reference resources (authoritative, in priority order)

1. `docs/specs/2026-04-24-noirperp-design.md` — design spec (this project)
2. `docs/fhe-primitives.md` — verified FHEVM primitives (this project)
3. `docs/security-checklist.md` — OZ FHEVM security guide applied here
4. https://docs.zama.org/protocol — Zama Protocol canonical docs
5. https://github.com/zama-ai/fhevm — FHEVM source
6. https://github.com/OpenZeppelin/openzeppelin-confidential-contracts — ERC-7984 source
```

- [ ] **Step 2: Commit**

Run:
```bash
cd /Users/ram/Desktop/NoirPerp && git add CLAUDE.md && git commit -q -m "docs: add CLAUDE.md pinned agent rules

Pillar 1 of the anti-hallucination guardrails. Locks FHEVM primitive
assumptions (FHE namespace, no FHE.div(ct,ct), SafeMath discipline,
isSenderAllowed guard, allowTransient-only in engines, replay guard
pattern, HCU budget) as hard rules that load every session.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Write `PROGRESS.md` (Pillar 3 — phase tracker)

**Files:**
- Create: `/Users/ram/Desktop/NoirPerp/PROGRESS.md`

- [ ] **Step 1: Write `PROGRESS.md`**

Create `/Users/ram/Desktop/NoirPerp/PROGRESS.md` with content:

```markdown
# NoirPerp — Phase Progress

Source of truth for which phase we're in. Tick the checkbox only when:
1. All tasks in that phase's implementation plan are done
2. All tests (unit + integration) pass
3. `CHANGELOG.md` has a phase-completion entry

Phase N+1 does not start until Phase N is ticked.

---

- [ ] **Phase 0 — Scaffolding & guardrails**
  Plan: `docs/plans/2026-04-24-phase-0-scaffolding.md`
  Completion criteria: monorepo structure exists, 4 guardrail pillars
  populated, Hardhat + FHEVM plugin installed, smoke test passes
  (`FHE.asEuint64` on local mock works).

- [ ] **Phase 1 — Shared libs**
  Plan: `docs/plans/2026-04-24-phase-1-shared-libs.md` *(not yet written)*
  Completion criteria: `FHESafeMath`, `MarginMath`, `TickMath`,
  `DecryptQueue` implemented with ≥90% unit-test coverage.

- [ ] **Phase 2 — Vault + services**
  Plan: *(not yet written)*
  Completion criteria: `NoirVault`, `Oracle`, `Compliance` deploy to
  local mock and Sepolia; engine registration flow works; 2-of-3
  oracle quorum verified.

- [ ] **Phase 3 — PerpEngine**
  Plan: *(not yet written)*
  Completion criteria: open/close/liquidate work for BTC/ETH/SOL on
  Sepolia; bot-triggered liquidation end-to-end.

- [ ] **Phase 4 — AMMEngine**
  Plan: *(not yet written)*

- [ ] **Phase 5 — LimitEngine**
  Plan: *(not yet written)*

- [ ] **Phase 6 — DarkpoolEngine**
  Plan: *(not yet written)*

- [ ] **Phase 7 — Off-chain services (bot, oracle-relayer, compliance-backend)**
  Plan: *(not yet written)*

- [ ] **Phase 8 — Frontend**
  Plan: *(not yet written)*

- [ ] **Phase 9 — Integration + audit**
  Plan: *(not yet written)*

- [ ] **Phase 10 — Docs + video + submission**
  Plan: *(not yet written)*

---

## Phase-writing protocol

- Next phase's plan is written ONLY after the current phase is ticked.
- Each plan lives at `docs/plans/YYYY-MM-DD-phase-N-<name>.md`.
- Write the plan using the superpowers:writing-plans skill.
- Execute using superpowers:subagent-driven-development or
  superpowers:executing-plans.
```

- [ ] **Step 2: Commit**

Run:
```bash
cd /Users/ram/Desktop/NoirPerp && git add PROGRESS.md && git commit -q -m "docs: add PROGRESS.md phase tracker

Pillar 3 of anti-hallucination guardrails. Source of truth for which
phase is in progress vs complete. Phase-gate discipline: N+1 does not
start until N is ticked, tests green, CHANGELOG updated.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Write initial `CHANGELOG.md` (Pillar 2)

**Files:**
- Create: `/Users/ram/Desktop/NoirPerp/CHANGELOG.md`

- [ ] **Step 1: Write `CHANGELOG.md`**

Create `/Users/ram/Desktop/NoirPerp/CHANGELOG.md` with content:

```markdown
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
```

- [ ] **Step 2: Commit**

Run:
```bash
cd /Users/ram/Desktop/NoirPerp && git add CHANGELOG.md && git commit -q -m "docs: add CHANGELOG.md (Pillar 2)

Anti-hallucination guardrail. Every change documented BEFORE commit.
Entry format: what/why/root cause/what was tried/files. Prevents
re-fixing already-fixed bugs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Write `docs/fhe-primitives.md` (Pillar 4 — living spec)

**Files:**
- Create: `/Users/ram/Desktop/NoirPerp/docs/fhe-primitives.md`

- [ ] **Step 1: Write `docs/fhe-primitives.md`**

Create `/Users/ram/Desktop/NoirPerp/docs/fhe-primitives.md` with content:

```markdown
# FHEVM Primitives Reference (LIVING DOC)

**Source**: Zama Protocol docs, verified 2026-04-23.
**FHEVM version**: v0.12.1 (deployed Sepolia 2026-04-14).
**Re-verify this doc** whenever the main Zama docs ship a new major
version, OR whenever any agent is tempted to assume a primitive works
differently from what's written here.

---

## 1. Package pins (DO NOT BUMP without re-verification)

| Package | Version |
|---------|---------|
| `@fhevm/solidity` | `^0.11.1` |
| `@fhevm/hardhat-plugin` | `^0.4.2` |
| `@fhevm/mock-utils` | `^0.4.2` |
| `@zama-fhe/relayer-sdk` | `^0.4.2` |
| `@openzeppelin/confidential-contracts` | `0.4.0` (pinned, not ^) |
| `@openzeppelin/contracts` | `^5.2.0` |
| `hardhat` | `^2.22.0` |
| Solidity pragma | `^0.8.27` |

## 2. Sepolia addresses

| Contract | Address |
|----------|---------|
| KMS | `0x0309b4308A6AC121B9b3A960aC7Bc9bd8256cf38` |
| Coprocessor | `0xc22E393D2A1C1BD65c88d34a3bE4DD77e8952E71` |
| HCULimit | `0xa10998783c8CF88D886Bc30307e631D6686F0A22` |
| cUSDCMock (USDCx) | `0x7c5BF43B851c1dff1a4feE8dB225b87f2C223639` |
| cUSDTMock | `0x4E7B06D78965594eB5EF5414c357ca21E1554491` |

Contracts inherit `SepoliaConfig` from
`@fhevm/solidity/config/ZamaConfig.sol` to auto-wire these.

## 3. Supported operations on `euint64`

HCU costs from Zama's protocol docs. "Scalar" = ct op plaintext; "Non-scalar" = ct op ct.

| Op | Scalar HCU | Non-scalar HCU | Notes |
|----|-----------|----------------|-------|
| `add` | 133,000 | 162,000 | UNCHECKED — use `FHESafeMath.safeAdd` |
| `sub` | 133,000 | 162,000 | UNCHECKED — use `FHESafeMath.safeSub` |
| `mul` | 365,000 | 596,000 | ~8–15 deep fits in 5M sequential |
| `div` | 715,000 | **unsupported** | **CT ÷ CT does not exist**. Reformulate as mul. |
| `rem` | 1,153,000 | **unsupported** | Same as `div` |
| `and` / `or` / `xor` | 34,000 | 34,000 | |
| `shl` / `shr` | 34,000 | ~209,000 | |
| `rotl` / `rotr` | 34,000 | ~209,000 | |
| `eq` | 83,000 | 120,000 | |
| `ne` | 84,000 | 118,000 | |
| `ge` | 116,000 | 152,000 | |
| `gt` | 117,000 | 152,000 | |
| `le` | 119,000 | 149,000 | |
| `lt` | 118,000 | 146,000 | |
| `min` | 150,000 | 219,000 | |
| `max` | 149,000 | 218,000 | |
| `neg` | — | 131,000 | non-scalar only |
| `not` | — | 63 | non-scalar only |
| `select(ebool, ct, ct)` | — | 55,000 | non-scalar only |
| `randEuint64` | 24,000 | — | |
| `asEuint64(uint64)` | 32 | — | "trivial encrypt" — effectively free |

### Global limits per transaction
- **20,000,000 HCU** total (any op combination)
- **5,000,000 HCU** sequential depth
- Plus normal EVM gas (30M Sepolia block limit)

## 4. ACL functions

| Function | Purpose | Persistence |
|----------|---------|-------------|
| `FHE.allow(ct, addr)` | Grant decrypt/use permission | Persistent (storage) |
| `FHE.allowTransient(ct, addr)` | Grant for current tx only | Transient (EIP-1153) |
| `FHE.allowThis(ct)` | Shorthand for `allow(ct, address(this))` | Persistent |
| `FHE.isSenderAllowed(ct)` | Check sender permission on a ct | Read-only |
| `FHE.checkSignatures(reqId, cleartexts, proof)` | Verify KMS decrypt proof | Read-only |

**ACL rules (load-bearing):**
- Every engine entry must call `require(FHE.isSenderAllowed(ct))` on
  each ciphertext input. Inference-attack guard.
- `allowTransient` does NOT auto-propagate through call chains.
  Explicitly chain: `ct.allowTransient(addr1).allowTransient(addr2)`.
- Engines use `allowTransient` only. Persistent `allow` lives inside
  Vault for state it owns.

## 5. Async decryption

Synchronous decryption does NOT exist on FHEVM. All reveals are async:

```solidity
// Request decrypt (payable — $ZAMA fee)
uint256 reqId = FHE.requestDecryption(
    bytes32[] memory ctHandles,
    bytes4 callbackSelector
);

// Callback (called by Gateway 15–60s later)
function _onDecided(
    uint256 reqId,
    bytes memory cleartexts,
    bytes memory decryptionProof
) external {
    FHE.checkSignatures(reqId, cleartexts, decryptionProof);
    // ALWAYS delete pending entry BEFORE external calls — replay guard
    delete pending[reqId];
    bool decoded = abi.decode(cleartexts, (bool));
    // ... act on decoded
}
```

**Fees** (published, paid in $ZAMA pegged to USD):
- Decryption: $0.001–$0.1 per ciphertext (subscription discounts available)
- ZKPoK verification (on encrypted input): $0.005–$0.5 per encrypted input
- Bridge: $0.01–$1

Fees can be paid by end user, frontend, or relayer — user need not hold $ZAMA.

**User-side decrypt** (for "show me my balance" flows): uses Relayer
SDK's `userDecrypt` — requires user signature; self-relaying model
since v0.9. Not the same as contract-requested decryption.

## 6. External encrypted inputs

Users encrypt client-side via `@zama-fhe/relayer-sdk`. Function
signatures receive inputs as:

```solidity
function foo(externalEuint64 eValue, bytes calldata inputProof) external {
    euint64 value = FHE.fromExternal(eValue, inputProof);
    require(FHE.isSenderAllowed(value), "not allowed");
    // ... use value
}
```

`inputProof` is a ZK proof of knowledge that the encrypted value is
well-formed. Verification cost: $0.005–$0.5 per input (see fees above).

## 7. Known footguns (from OZ FHEVM Security Guide, Feb 2026)

1. **Silent overflow**: FHE arithmetic is unchecked. Use
   `FHESafeMath.safeSub / safeAdd` with `select`-guarded fallback.
2. **Over-broad ACL**: persistent `allow` to a permissive contract
   makes it a disclosure oracle. Prefer `allowTransient`.
3. **Replay in async callbacks**: stateless callbacks let attackers
   re-submit decrypt results. Always `delete pending[reqId]` BEFORE
   external calls in the callback.
4. **Silent-zero transfers**: ERC-7984 transfers silently clamp to 0
   on insufficient balance. Post-transfer, verify encrypted delta via
   `select` and reject if 0.
5. **Pre-finality disclosure**: reorgs can retroactively reveal + then
   revert. Add 3-block finality delay before liquidation callback acts.
6. **Inference via `isSenderAllowed`**: always verify caller
   authorization on received ct handles.

## 8. Operations that do NOT exist (STOP if you're tempted)

- `FHE.div(euint64, euint64)` — ct ÷ ct. Roadmap says "coming soon"
  with no ETA. Reformulate as multiplication.
- `FHE.rem(euint64, euint64)` — same.
- `ebytes` — removed in a recent version.
- Signed `eintX` types — "coming soon"; use uint64 with sign via bool flag.
- Synchronous decrypt — doesn't exist. All async.
- Anything with "loop over all positions" — you'll hit the 5M HCU
  sequential limit. Batch across txs.

## 9. Re-verification checklist

When updating this doc:
1. Fetch https://docs.zama.org/protocol/llms-full.txt — current full corpus
2. Check `@fhevm/solidity` on npm for new major versions
3. Check OpenZeppelin confidential-contracts changelog
4. Update version pins in §1, addresses in §2, op table in §3
5. Test the smoke test in `contracts/test/smoke.test.ts` still passes
6. Commit with `docs: refresh FHEVM primitives (verified YYYY-MM-DD)`
```

- [ ] **Step 2: Commit**

Run:
```bash
cd /Users/ram/Desktop/NoirPerp && git add docs/fhe-primitives.md && git commit -q -m "docs: add fhe-primitives.md (Pillar 4)

Living source-of-truth doc for FHEVM v0.12.1 primitives as verified
on 2026-04-23. Covers: package pins, Sepolia addresses, full op table
with HCU costs, ACL model, async decryption pattern, external inputs,
known footguns, ops that do NOT exist (FHE.div ct/ct, rem, ebytes,
signed ints, sync decrypt).

Any agent tempted to assume a primitive works a certain way must read
this first.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Write `.claude/settings.local.json` (permissions allowlist)

**Files:**
- Create: `/Users/ram/Desktop/NoirPerp/.claude/settings.local.json`

- [ ] **Step 1: Write `.claude/settings.local.json`**

Create `/Users/ram/Desktop/NoirPerp/.claude/settings.local.json` with content:

```json
{
  "permissions": {
    "allow": [
      "Bash(mkdir:*)",
      "Bash(ls:*)",
      "Bash(cat:*)",
      "Bash(node:*)",
      "Bash(npm:*)",
      "Bash(npx:*)",
      "Bash(pnpm:*)",
      "Bash(yarn:*)",
      "Bash(npx hardhat:*)",
      "Bash(npx hardhat compile)",
      "Bash(npx hardhat test)",
      "Bash(npx hardhat test:*)",
      "Bash(npx hardhat node)",
      "Bash(npx hardhat run:*)",
      "Bash(npx hardhat coverage)",
      "Bash(npx hardhat verify:*)",
      "Bash(forge:*)",
      "Bash(cast:*)",
      "Bash(anvil:*)",
      "Bash(slither:*)",
      "Bash(myth:*)",
      "Bash(git status)",
      "Bash(git diff:*)",
      "Bash(git log:*)",
      "Bash(git add:*)",
      "Bash(git commit:*)",
      "Bash(git push:*)",
      "Bash(git checkout:*)",
      "Bash(git branch:*)",
      "Bash(git stash:*)",
      "Bash(which:*)",
      "WebFetch(domain:docs.zama.org)",
      "WebFetch(domain:community.zama.org)",
      "WebFetch(domain:docs.openzeppelin.com)",
      "WebFetch(domain:github.com)",
      "WebFetch(domain:raw.githubusercontent.com)",
      "WebFetch(domain:registry.npmjs.org)"
    ],
    "deny": []
  }
}
```

- [ ] **Step 2: Commit**

Run:
```bash
cd /Users/ram/Desktop/NoirPerp && git add .claude/settings.local.json && git commit -q -m "chore: add .claude/settings.local.json (Pillar 4)

Permission allowlist for Claude Code sessions. Bash allowlist covers
npm/hardhat/foundry/git; WebFetch limited to Zama + OZ + GitHub + npm
registry. Blocks arbitrary destructive commands by default.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Initialize `contracts/package.json`

**Files:**
- Create: `/Users/ram/Desktop/NoirPerp/contracts/package.json`

- [ ] **Step 1: Write `contracts/package.json`**

Create `/Users/ram/Desktop/NoirPerp/contracts/package.json` with content:

```json
{
  "name": "@noirperp/contracts",
  "version": "0.1.0",
  "private": true,
  "description": "NoirPerp smart contracts (Vault + engines + services) on Zama FHEVM",
  "license": "MIT",
  "scripts": {
    "compile": "hardhat compile",
    "test": "hardhat test",
    "test:sepolia": "hardhat test --network sepolia",
    "coverage": "hardhat coverage",
    "node": "hardhat node",
    "deploy:local": "hardhat run scripts/deploy-local.ts",
    "deploy:sepolia": "hardhat run scripts/deploy-sepolia.ts --network sepolia",
    "clean": "hardhat clean",
    "typechain": "hardhat typechain"
  },
  "devDependencies": {
    "@fhevm/hardhat-plugin": "^0.4.2",
    "@fhevm/mock-utils": "^0.4.2",
    "@nomicfoundation/hardhat-chai-matchers": "^2.0.8",
    "@nomicfoundation/hardhat-ethers": "^3.0.8",
    "@nomicfoundation/hardhat-network-helpers": "^1.0.12",
    "@nomicfoundation/hardhat-toolbox": "^5.0.0",
    "@typechain/ethers-v6": "^0.5.1",
    "@typechain/hardhat": "^9.1.0",
    "@types/chai": "^4.3.20",
    "@types/mocha": "^10.0.10",
    "@types/node": "^22.0.0",
    "chai": "^4.5.0",
    "dotenv": "^16.4.7",
    "ethers": "^6.13.0",
    "hardhat": "^2.22.0",
    "hardhat-gas-reporter": "^2.2.0",
    "mocha": "^10.7.0",
    "solidity-coverage": "^0.8.14",
    "ts-node": "^10.9.2",
    "typechain": "^8.3.2",
    "typescript": "^5.5.0"
  },
  "dependencies": {
    "@fhevm/solidity": "^0.11.1",
    "@openzeppelin/confidential-contracts": "0.4.0",
    "@openzeppelin/contracts": "^5.2.0"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run:
```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npm install
```

Expected: installs packages without errors. Warnings about peer deps
are OK. If anything **fails**, check the version pins in
`docs/fhe-primitives.md` — a pinned version may have been yanked from
npm.

- [ ] **Step 3: Verify `@fhevm/solidity` installed**

Run:
```bash
cd /Users/ram/Desktop/NoirPerp/contracts && ls node_modules/@fhevm/solidity/
```
Expected: directory listing including `config/ZamaConfig.sol` and `lib/FHE.sol`.

- [ ] **Step 4: Commit**

Run:
```bash
cd /Users/ram/Desktop/NoirPerp && git add contracts/package.json contracts/package-lock.json && git commit -q -m "chore(contracts): initialize Hardhat workspace package.json

Pins verified against docs/fhe-primitives.md:
- @fhevm/solidity ^0.11.1
- @fhevm/hardhat-plugin ^0.4.2
- @openzeppelin/confidential-contracts 0.4.0
- @openzeppelin/contracts ^5.2.0
- hardhat ^2.22.0

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Write `contracts/hardhat.config.ts`

**Files:**
- Create: `/Users/ram/Desktop/NoirPerp/contracts/hardhat.config.ts`
- Create: `/Users/ram/Desktop/NoirPerp/contracts/tsconfig.json`

- [ ] **Step 1: Write `contracts/tsconfig.json`**

Create `/Users/ram/Desktop/NoirPerp/contracts/tsconfig.json` with content:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "strict": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "outDir": "./dist",
    "declaration": false,
    "sourceMap": true
  },
  "include": [
    "./hardhat.config.ts",
    "./scripts/**/*",
    "./test/**/*",
    "./typechain-types/**/*"
  ]
}
```

- [ ] **Step 2: Write `contracts/hardhat.config.ts`**

Create `/Users/ram/Desktop/NoirPerp/contracts/hardhat.config.ts` with content:

```typescript
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@fhevm/hardhat-plugin";
import * as dotenv from "dotenv";

dotenv.config();

const PRIVATE_KEY = process.env.PRIVATE_KEY ?? "";
const SEPOLIA_RPC_URL =
  process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia.publicnode.com";
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY ?? "";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.27",
    settings: {
      optimizer: {
        enabled: true,
        runs: 800,
      },
      evmVersion: "cancun",
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    sepolia: {
      url: SEPOLIA_RPC_URL,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
      chainId: 11155111,
    },
  },
  etherscan: {
    apiKey: {
      sepolia: ETHERSCAN_API_KEY,
    },
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    currency: "USD",
  },
  mocha: {
    timeout: 120_000,
  },
};

export default config;
```

- [ ] **Step 3: Compile the empty project (verifies config)**

Run:
```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat compile
```

Expected: `Nothing to compile` or `Compiled 0 Solidity files`. Any
error = config is broken; investigate before continuing.

- [ ] **Step 4: Commit**

Run:
```bash
cd /Users/ram/Desktop/NoirPerp && git add contracts/hardhat.config.ts contracts/tsconfig.json && git commit -q -m "chore(contracts): add hardhat.config.ts + tsconfig

Solidity 0.8.27 (FHEVM-compatible), optimizer runs=800, cancun EVM.
Sepolia network wired via SEPOLIA_RPC_URL + PRIVATE_KEY env.
Empty compile verified.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Add `.env.example`

**Files:**
- Create: `/Users/ram/Desktop/NoirPerp/contracts/.env.example`

- [ ] **Step 1: Write `contracts/.env.example`**

Create `/Users/ram/Desktop/NoirPerp/contracts/.env.example` with content:

```bash
# Sepolia RPC — use Alchemy, Infura, or a public endpoint
SEPOLIA_RPC_URL=https://ethereum-sepolia.publicnode.com

# Deployer private key (0x-prefixed). Use a NEW key, not your main wallet.
# Fund via https://sepoliafaucet.com
PRIVATE_KEY=

# Optional: verify contracts post-deploy
ETHERSCAN_API_KEY=

# Optional: gas report
REPORT_GAS=false
```

- [ ] **Step 2: Commit**

Run:
```bash
cd /Users/ram/Desktop/NoirPerp && git add contracts/.env.example && git commit -q -m "chore(contracts): add .env.example

Documents required env vars: SEPOLIA_RPC_URL, PRIVATE_KEY,
ETHERSCAN_API_KEY, REPORT_GAS. Actual .env is gitignored.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Write smoke-test Solidity contract

**Files:**
- Create: `/Users/ram/Desktop/NoirPerp/contracts/contracts/Smoke.sol`

**Purpose**: prove end-to-end that `FHE.asEuint64` works on the local
FHEVM mock. This is the simplest possible FHE contract — stores a
trivially-encrypted uint64, lets anyone read the handle, no mutations.
If this compiles + tests pass, the toolchain is good.

- [ ] **Step 1: Write `contracts/contracts/Smoke.sol`**

Create `/Users/ram/Desktop/NoirPerp/contracts/contracts/Smoke.sol` with content:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { FHE, euint64 } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

/// @notice Phase 0 smoke test. Proves toolchain works: FHE.asEuint64
///         trivially encrypts a plaintext into a ciphertext handle,
///         stores it, and grants the caller persistent read permission.
contract Smoke is SepoliaConfig {
    euint64 private _value;

    /// @notice Stores a trivially-encrypted uint64 and allows msg.sender to decrypt it.
    /// @param plainValue The plaintext value to trivially encrypt.
    function setValue(uint64 plainValue) external {
        euint64 encrypted = FHE.asEuint64(plainValue);
        _value = encrypted;
        FHE.allowThis(encrypted);
        FHE.allow(encrypted, msg.sender);
    }

    /// @notice Returns the ciphertext handle. Caller must be allowed.
    function getValue() external view returns (euint64) {
        return _value;
    }
}
```

- [ ] **Step 2: Compile**

Run:
```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat compile
```

Expected: `Compiled 1 Solidity file successfully`. If the compiler
errors on the `import` lines, verify `@fhevm/solidity` is installed
(`ls node_modules/@fhevm/solidity/lib/FHE.sol`).

- [ ] **Step 3: Commit**

Run:
```bash
cd /Users/ram/Desktop/NoirPerp && git add contracts/contracts/Smoke.sol && git commit -q -m "test(contracts): add Smoke.sol FHEVM toolchain smoke test

Minimal contract proving @fhevm/solidity import + FHE.asEuint64 +
storage + ACL (allowThis / allow) work. Will be removed at end of
Phase 0 once the mock test passes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Write smoke-test Hardhat test

**Files:**
- Create: `/Users/ram/Desktop/NoirPerp/contracts/test/Smoke.test.ts`

- [ ] **Step 1: Write failing test first (TDD)**

Create `/Users/ram/Desktop/NoirPerp/contracts/test/Smoke.test.ts` with content:

```typescript
import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import type { Smoke } from "../typechain-types";

describe("Smoke (FHEVM toolchain)", () => {
  let smoke: Smoke;
  let owner: Awaited<ReturnType<typeof ethers.getSigners>>[number];

  beforeEach(async () => {
    [owner] = await ethers.getSigners();
    const Smoke = await ethers.getContractFactory("Smoke");
    smoke = (await Smoke.deploy()) as unknown as Smoke;
    await smoke.waitForDeployment();
  });

  it("stores a trivially-encrypted value and lets owner decrypt it", async () => {
    const plain = 42n;

    const tx = await smoke.setValue(plain);
    await tx.wait();

    const handle = await smoke.getValue();
    expect(handle).to.not.equal(ethers.ZeroHash);

    // Decrypt via FHEVM mock (hardhat-plugin exposes `fhevm.decrypt64`)
    const decrypted = await fhevm.userDecryptEuint(
      fhevm.FhevmType.euint64,
      handle,
      await smoke.getAddress(),
      owner,
    );

    expect(decrypted).to.equal(plain);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL (contract not compiled into typechain yet)**

Run:
```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test
```

Expected: FAIL with a TypeScript error like `Cannot find module
'../typechain-types'` OR with the test body running but decrypt
failing — either proves we need typechain types generated.

- [ ] **Step 3: Generate typechain types**

Run:
```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat typechain
```

Expected: `Generated X typings!` message; creates
`contracts/typechain-types/` directory.

- [ ] **Step 4: Run test — expect PASS**

Run:
```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test
```

Expected: `Smoke (FHEVM toolchain)` describe block; 1 passing test.
If the test fails:
1. Read the failure carefully. `fhevm.userDecryptEuint` signature may
   differ by plugin version. Check `node_modules/@fhevm/hardhat-plugin/README.md`
   for the current API and update the test accordingly.
2. If the mock claims the handle is "not allowed", the `FHE.allow(encrypted, msg.sender)`
   line in `Smoke.sol` isn't working — investigate before patching over.

- [ ] **Step 5: Commit**

Run:
```bash
cd /Users/ram/Desktop/NoirPerp && git add contracts/test/Smoke.test.ts && git commit -q -m "test(contracts): Smoke toolchain test passes on FHEVM mock

Proves end-to-end: deploy contract, call setValue(42), read handle,
mock-decrypt handle, compare to 42. Green = Phase 0 toolchain ready
for Phase 1 lib work.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: Write `docs/security-checklist.md` stub

**Files:**
- Create: `/Users/ram/Desktop/NoirPerp/docs/security-checklist.md`

**Purpose**: create a stub that Phase 9 (integration + audit) fills in
with the full OZ FHEVM Security Guide walkthrough. For now, list the
categories and each contract to be reviewed.

- [ ] **Step 1: Write `docs/security-checklist.md`**

Create `/Users/ram/Desktop/NoirPerp/docs/security-checklist.md` with content:

```markdown
# NoirPerp — Security Checklist

Filled in during Phase 9 (Integration + audit). Phase-gate rule:
every checkbox below must be ticked before submission.

Source: [OpenZeppelin FHEVM Security Guide (Feb 2026)](https://www.openzeppelin.com/news/a-developers-guide-to-fhevm-security).

---

## Category A — FHE arithmetic hygiene

- [ ] No raw `FHE.sub` or `FHE.add` outside `lib/FHESafeMath.sol`
- [ ] Every arithmetic path that might underflow uses `safeSub` / `safeAdd`
- [ ] Overflow cases explicitly tested (collateral, payout, balance paths)

## Category B — ACL discipline

- [ ] Every engine entry function calls `require(FHE.isSenderAllowed(ct))`
      on every ciphertext input
- [ ] No engine grants persistent `allow` — only `allowTransient`
- [ ] Vault is the only contract granting persistent `allow` on state it owns
- [ ] Multi-contract call chains explicitly chain `allowTransient`

## Category C — Async decryption callbacks

- [ ] Every `_on*Decided` callback calls `FHE.checkSignatures` first
- [ ] Every callback calls `DecryptQueue.dequeue(reqId)` BEFORE any
      external call (replay guard)
- [ ] 3-block finality delay on liquidation callbacks (reorg protection)
- [ ] Timeout sweep: stale pending entries are cleaned up

## Category D — ERC-7984 interaction

- [ ] Post-transfer, verify encrypted delta via `FHE.select` and reject
      if 0 (silent-zero protection)
- [ ] No assumption that `confidentialTransfer(...)` transfers the full amount

## Category E — Oracle freshness

- [ ] Every price-dependent op calls `require(oracle.isFresh(marketId))`
- [ ] Staleness window documented and conservative
- [ ] 2-of-3 quorum enforced; no single-relayer price commit

## Category F — Admin + pause

- [ ] All admin functions gated by multisig (Safe 2-of-3)
- [ ] `NoirVault.emergencyPause` cascades to all engines
- [ ] Engine registration + deregistration via multisig only

## Category G — Tooling

- [ ] Slither run clean (or all warnings triaged)
- [ ] Mythril run clean (or all warnings triaged)
- [ ] HCU budget tests green (no op > 5M sequential, 20M global)
- [ ] Invariant tests (Foundry) green for 10,000+ runs
- [ ] Full Sepolia E2E walkthrough documented

## Per-contract sign-off

- [ ] `NoirVault.sol`
- [ ] `engines/PerpEngine.sol`
- [ ] `engines/AMMEngine.sol`
- [ ] `engines/DarkpoolEngine.sol`
- [ ] `engines/LimitEngine.sol`
- [ ] `services/Oracle.sol`
- [ ] `services/Compliance.sol`
- [ ] `lib/FHESafeMath.sol`
- [ ] `lib/MarginMath.sol`
- [ ] `lib/TickMath.sol`
- [ ] `lib/DecryptQueue.sol`
```

- [ ] **Step 2: Commit**

Run:
```bash
cd /Users/ram/Desktop/NoirPerp && git add docs/security-checklist.md && git commit -q -m "docs: add security-checklist.md stub

Phase 9 will fill in the walkthrough. Categories cover FHE arithmetic
hygiene, ACL discipline, async decrypt callbacks, ERC-7984, oracle
freshness, admin/pause, tooling, and per-contract sign-off.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: Write `README.md` skeleton

**Files:**
- Create: `/Users/ram/Desktop/NoirPerp/README.md`

**Purpose**: placeholder that Phase 10 polishes. Phase 0 just needs
enough that a new agent landing in the repo knows what it is + where
to look.

- [ ] **Step 1: Write `README.md`**

Create `/Users/ram/Desktop/NoirPerp/README.md` with content:

```markdown
# NoirPerp

Privacy-preserving perpetual-futures DEX on Zama FHEVM.
Ground-up rewrite of ZKPerp (Aleo → FHE).

**Status**: Phase 0 — scaffolding. See `PROGRESS.md`.

---

## What this is

A decentralised perpetual-futures exchange where position size,
collateral, entry price, PnL, leverage, and order details remain
encrypted end-to-end using Fully Homomorphic Encryption. All
sensitive state transitions are computed on ciphertexts; only final
decision bits (e.g. *"should this position be liquidated?"*) are
decrypted, via Zama's Gateway KMS.

## Architecture

Layered Vault + Engines pattern:
- **`NoirVault`** holds all ciphertext state (balances, positions, orders)
- **Engines** (Perp, AMM, Darkpool, Limit) are stateless; they request
  transient ACL permits from the Vault, compute new state in FHE,
  and write results back
- **Services** (Oracle, Compliance) are read-only dependencies

See `docs/specs/2026-04-24-noirperp-design.md` for the full design.

## Repo layout

```
contracts/             Hardhat workspace (Solidity + FHEVM)
frontend/              React + Vite (Phase 8)
bot/                   orchestrator liveness provider (Phase 7)
oracle-relayer/        3-relayer Chainlink quorum (Phase 7)
compliance-backend/    Merkle allowlist API (Phase 7)
docs/
  specs/               design specs
  plans/               implementation plans (one per phase)
  fhe-primitives.md    verified FHEVM primitives reference
  security-checklist.md audit checklist
```

## Getting started (Phase 0 — toolchain check)

```bash
cd contracts
cp .env.example .env   # leave PRIVATE_KEY blank unless deploying
npm install
npx hardhat compile
npx hardhat test       # runs Smoke toolchain test
```

If `npx hardhat test` passes, toolchain is good; ready for Phase 1.

## Development rules

See `CLAUDE.md` for the pinned rules that every contributor (human
or agent) must follow. Highlights:
- FHEVM API is `FHE.*`, never `TFHE.*`
- No `FHE.div(euint64, euint64)` — reformulate as multiplication
- Every engine entry requires `FHE.isSenderAllowed(ct)` guard
- `CHANGELOG.md` entry before every commit

## License

MIT
```

- [ ] **Step 2: Commit**

Run:
```bash
cd /Users/ram/Desktop/NoirPerp && git add README.md && git commit -q -m "docs: add README.md skeleton

Phase 10 will polish. For now: what NoirPerp is, architecture summary,
repo layout, Phase 0 getting-started instructions, pointer to
CLAUDE.md for rules.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 15: Tick Phase 0 complete in `PROGRESS.md` + final CHANGELOG entry

**Files:**
- Modify: `/Users/ram/Desktop/NoirPerp/PROGRESS.md`
- Modify: `/Users/ram/Desktop/NoirPerp/CHANGELOG.md`

- [ ] **Step 1: Verify all prior tasks green**

Run:
```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat compile && npx hardhat test
```

Expected: compile succeeds, `Smoke` test passes. If anything fails,
fix it before proceeding — do not tick Phase 0.

- [ ] **Step 2: Tick Phase 0 checkbox in `PROGRESS.md`**

In `/Users/ram/Desktop/NoirPerp/PROGRESS.md`, change:

```
- [ ] **Phase 0 — Scaffolding & guardrails**
```

to:

```
- [x] **Phase 0 — Scaffolding & guardrails** ✅ (2026-04-XX)
```

Replace `2026-04-XX` with the actual completion date.

- [ ] **Step 3: Add Phase 0 completion entry to `CHANGELOG.md`**

Append to `/Users/ram/Desktop/NoirPerp/CHANGELOG.md` (under the
existing 2026-04-24 section):

```markdown
### Phase 0 complete ✅

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
  end-to-end. `npx hardhat test` green.
- **Why**: Phase 1 (shared libs) cannot start without a working
  FHEVM toolchain and the guardrail docs in place.
- **Files**: see individual commits in the `git log`.
```

- [ ] **Step 4: Commit**

Run:
```bash
cd /Users/ram/Desktop/NoirPerp && git add PROGRESS.md CHANGELOG.md && git commit -q -m "docs: tick Phase 0 complete — scaffolding + guardrails ready

All 4 anti-hallucination pillars populated. Hardhat + FHEVM toolchain
installed and smoke-tested (npx hardhat test green). Ready for Phase 1
(shared libs: FHESafeMath, MarginMath, TickMath, DecryptQueue).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: Announce Phase 0 complete**

Report to the user:
> "✅ Phase 0 complete. Scaffolding + guardrails + toolchain smoke test all green. Ready to write the Phase 1 plan (shared libs)."

---

## Appendix A — Troubleshooting

**`npm install` fails on `@fhevm/hardhat-plugin`**: check Node version
is ≥ 20. Older Node chokes on FHEVM plugin's ES modules.

**`npx hardhat compile` errors on `import "@fhevm/solidity/..."`**: check
that `node_modules/@fhevm/solidity/lib/FHE.sol` exists. If not, re-run
`npm install` in `contracts/`.

**`Smoke` test hangs**: the mock FHEVM does async decrypt simulation;
timeouts >60s suggest the mock isn't wired. Check
`@fhevm/hardhat-plugin` is in `devDependencies` AND imported at the
top of `hardhat.config.ts`.

**`fhevm.userDecryptEuint` signature mismatch**: plugin API evolves. If
the test errors on that call, read
`node_modules/@fhevm/hardhat-plugin/README.md` for the current signature
and update the test. Then update `docs/fhe-primitives.md` §9 with a
note about the new signature.
