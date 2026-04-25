# NoirPerp — Phase Progress

Source of truth for which phase we're in. Tick the checkbox only when
ALL of the following are met:

1. **All tasks** in that phase's implementation plan are done
2. **All tests** (unit + integration) pass
3. **Coverage** ≥ 90% stmts/funcs/lines and ≥ 80% branches per new contract
4. **Tier 1 audit** passed — both reviewers green:
   - Spec compliance reviewer (built what plan specified, nothing more/less)
   - Code quality reviewer (no critical/important issues unresolved)
   - Critical/important findings MUST be fixed before the tick.
   - Minor findings may be deferred with explicit CHANGELOG notation.
5. **`CHANGELOG.md`** has a phase-completion entry documenting what
   shipped, what was deferred, and any spec deviations
6. **Branch merged** to `master` via fast-forward

Phase N+1 does not start until Phase N is ticked.

Tier 2 audit (Slither + Mythril + OZ security checklist + invariants +
fuzz + HCU benchmarks + per-contract sign-off) runs once in Phase 9.

---

- [x] **Phase 0 — Scaffolding & guardrails** ✅ (2026-04-24)
  Plan: `docs/plans/2026-04-24-phase-0-scaffolding.md`
  Completion criteria met: monorepo structure exists, 4 guardrail
  pillars populated (CLAUDE.md, PROGRESS.md, CHANGELOG.md,
  docs/fhe-primitives.md + .claude/settings.local.json), Hardhat +
  FHEVM plugin installed, Smoke test green (`npx hardhat test` →
  1 passing).

- [x] **Phase 1 — Shared libs** ✅ (2026-04-24)
  Plan: `docs/plans/2026-04-24-phase-1-shared-libs.md`
  Completion criteria met: all 4 libs implemented; 57 unit tests
  passing (1 Smoke + 14 FHESafeMath + 13 TickMath + 13 DecryptQueue
  + 16 MarginMath); solidity-coverage: 100% lines/funcs/stmts per
  lib, branches 100% for 3 libs + 85.71% for TickMath (UniV3
  boundary reverts hard to exercise fully, still above 80% threshold).

- [x] **Phase 2 — Vault + services** ✅ (2026-04-24)
  Plan: `docs/plans/2026-04-24-phase-2-vault-services.md`
  Completion criteria met: NoirVault / Oracle / Compliance all live on
  local mock (Sepolia deferred to Phase 9); engine registration via
  `MockEngine` proves authorization flow; 2-of-3 oracle quorum
  verified (same-relayer / deviation / staleness / new-cycle cases all
  tested); 131 tests total passing (57 prior + 74 new: 16 Compliance
  + 23 Oracle + 15 Vault.Admin + 11 Vault.Balance + 9 Vault.Positions);
  coverage: Compliance 100%, NoirVault 100% stmts / 90.91% branches,
  Oracle 100% stmts / 86.11% branches.

- [x] **Phase 3 — PerpEngine** ✅ (2026-04-24)
  Plan: `docs/plans/2026-04-24-phase-3-perp-engine.md`
  Completion criteria met: PerpEngine live on local mock; open +
  close + liquidate work for all 3 markets (BTC=1, ETH=2, SOL=3);
  async liquidation via pull-based public-decrypt pattern verified
  end-to-end; Tier 1 audit ran + 2 critical + 3 important findings
  fixed pre-merge; coverage 97.53% stmts / 84.48% branches / 100%
  funcs / 97.96% lines on PerpEngine; 176 tests passing (138 prior
  + 38 new: 5 AccessGrants + 7 Open + 7 Close + 4 Liquidation + 3
  MultiMarket + 12 Admin). Key discovery: FHEVM v0.11.1 async
  decryption is pull-based (relayer-mediated), NOT push-callback;
  `docs/fhe-primitives.md` §5 corrected. Sepolia deploy deferred
  to Phase 9.

- [x] **Phase 4 — AMMEngine** ✅ (2026-04-24)
  Plan: `docs/plans/2026-04-24-phase-4-amm-engine.md`
  Completion criteria met: AMMEngine live on local mock; addLiquidity
  (sync), requestWithdraw (async via pull-based public decrypt), swap
  (sync oracle-pegged) all working. PerpEngine.liquidationPool repointed
  to AMM; forfeit flow verified end-to-end. 5 documented spec deviations
  (no UniV3, plaintext pool totals, stranded forfeits, no TickMath,
  LP state in AMM). Tier 1 audit passed (1 critical flagged — debatable
  ACL ordering — fixed defensively + 3 important findings addressed).
  205 tests passing (176 prior + 29 new). Coverage on AMMEngine:
  100% stmts / 89.47% branches / 100% funcs / 100% lines. Key plan-bug
  caught by subagent: FHE.eq→FHE.le for partial-withdraw support.

- [x] **Phase 5 — LimitEngine** ✅ (2026-04-25)
  Plan: `docs/plans/2026-04-25-phase-5-limit-engine.md`
  Completion criteria met: LimitEngine live with all 3 order types
  (TP=1, SL=2, LIMIT=3); bot-triggered async execution via DecryptQueue
  + Gateway pull-decrypt; PerpEngine executor pattern added (cross-
  engine `openPositionAsExecutor` + `closePositionAsExecutor`); collateral
  escrow for Limit-Open with refund on cancel + miss; all 6 trigger
  directions tested (TP-long/short, SL-long/short, LIMIT-long/short).
  Tier 1 audit passed (1 critical fixed defensively + 3 important fixed
  pre-merge). 257 tests passing. Coverage on LimitEngine: 100% stmts /
  87.5% branches / 100% funcs / 100% lines. Phase 3 backwards-compat
  preserved (33 PerpEngine tests still green after refactor).
  Plan-time stack-too-deep mitigated via `PlaceLimitInputs` struct param
  (avoided viaIR which would have broken 18 other tests).

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
