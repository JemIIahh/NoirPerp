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
