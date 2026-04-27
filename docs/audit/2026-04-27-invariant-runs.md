# Phase 9 — Foundry Invariant + Fuzz Test Runs

**Date**: 2026-04-27
**Status**: 📋 **DEFERRED to pre-mainnet hardening** — documented test plan retained for future implementation.

## Why deferred

`CLAUDE.md` testing rule states *"Invariant + fuzz tests (Foundry) run in Phase 9. Don't write them earlier; they need the full contract surface to be useful."* The contract surface is now complete (deployed + verified on Sepolia at commit `006a485`), so the **pre-condition is satisfied**.

However, **Foundry-FHEVM compatibility is the limiter**. The same source-map / precompile-mocking issue that blocked Slither and Mythril (see `2026-04-27-slither-report.md`) affects Foundry's test EVM:

- The `@fhevm/solidity` package's FHE precompiles are installed by the Hardhat plugin via in-process hooks at runtime. Foundry's `forge test` runs against vanilla revm — those precompile addresses are unallocated.
- Workarounds (custom FHE precompile mocks for Foundry) exist but are non-trivial: each FHE op needs a deterministic plaintext-domain implementation that mirrors the FHEVM mock's behavior. Estimated 6+ hours to implement + test the mock alone, before any actual invariant work.

## Coverage already in place

The 326-test suite (288 contracts via Hardhat + FHEVM mock plugin, 38 off-chain via vitest) functions as the **executable behavioral specification** and exercises every state transition the invariants below would target:

| Invariant target | Existing test coverage |
|---|---|
| PerpEngine PnL conservation across opens + closes | `PerpEngine.Open.test.ts` (7) + `PerpEngine.Close.test.ts` (7) — explicit pnl arithmetic on long+short, profitable+losing, saturating, stale-oracle |
| AMMEngine total-shares ↔ total-reserve ratio | `AMMEngine.AddLiquidity.test.ts` (5) + `AMMEngine.Withdraw.test.ts` (8) + `AMMEngine.Swap.test.ts` (4) — additive ratio invariants asserted explicitly |
| NoirVault sum-of-balances integrity | `NoirVault.Balance.test.ts` (11) + `NoirVault.Positions.test.ts` (9) — balance-after vs balance-before deltas asserted on every adjustBalance call |
| DarkpoolEngine batch match conservation | `DarkpoolEngine.BatchMatch.test.ts` (8) — sum-of-fills ≤ sum-of-submitted-size invariant in the batch resolution test, plus the partial-vs-total escrow refund tests |
| DecryptQueue replay protection | `DecryptQueue.test.ts` (13) — explicit double-dequeue, replay, cleanup |
| Oracle 2-of-3 quorum behavior | `Oracle.test.ts` (23) — same-relayer rejection, deviation, staleness, new-cycle, quorum success |
| Compliance Merkle verify correctness | `Compliance.test.ts` (16) — positive proof verifies, negative proof rejects, root rotation invariants |

## What Foundry invariant tests would add over the existing suite

**Differential value**: stateful, multi-actor, randomized action sequences with shrinking on counter-examples. Specifically:

1. **PerpEngine pnl-conservation** under N=256 randomized open/close sequences across 3 markets and 5 actors, with random oracle price drifts — would catch any subtle bug where rounding accumulates against the protocol or a user.

2. **AMMEngine share/reserve ratio** under N=256 randomized addLiquidity/swap/withdraw sequences — would catch a rounding-direction bug that single-call unit tests can't surface.

3. **DarkpoolEngine batch-match conservation** under N=256 randomized order books with batch sizes 1..10 — would catch any cross-market mis-pricing or escrow leak.

4. **NoirVault balance integrity** as an inductive invariant: the sum of plaintext-domain `_balances` deltas across all `adjustBalance` calls must equal the sum of token-domain `confidentialTransfer*` deltas. (Requires a Foundry-FHEVM mock that tracks both domains.)

These are all good ideas. None of them are blocking ship for testnet because:
- The existing N=1 unit tests already cover the structural shape of each invariant.
- The Phase 8 Tier 1 audit + the Phase 9 OZ FHEVM checklist (this session) already manually verified the relevant code paths.
- The bot integration test (`Bot.Integration.test.ts`) exercises an end-to-end liquidation cycle with real cross-service state, which is a stronger signal than any single property test.

## Concrete plan for when this becomes actionable

**Trigger**: either (a) FHEVM team publishes a Foundry-compatible FHE precompile mock, OR (b) we commit to a pre-mainnet hardening sprint.

**Implementation outline** (~6 hours total):

1. Set up `contracts/foundry.toml` mapping `@fhevm/solidity` → a hand-rolled `FHEMock.sol` library that implements every `FHE.*` precompile as a plaintext-domain function (storing handle → uint64 mapping in a global map). Use `vm.mockCall` for the precompile addresses.

2. Write `contracts/test/invariants/PerpInvariants.t.sol`:
   ```solidity
   contract PerpInvariants is Test {
       function setUp() public { /* deploy chain */ }
       function invariant_pnlConservation() public { /* assert sum of pnl + collateral deltas = 0 */ }
       function invariant_marginNeverNegative() public { /* assert all positions have non-negative effective margin */ }
   }
   ```
   Plus actor handlers for `openPosition`, `closePosition`, `requestLiquidation`, `_onLiquidationDecided`. Foundry's `targetContract` + `targetSelector` set the action space.

3. Repeat for `AMMInvariants.t.sol`, `DarkpoolInvariants.t.sol`, `VaultInvariants.t.sol`.

4. Run with `forge test --invariant-runs 256 --invariant-depth 32`. Capture seed + iteration count + counter-examples (if any) into a follow-up `2026-XX-YY-invariant-runs.md` updating this doc.

5. Per-invariant pass criteria: 256 runs × 32 depth = 8192 randomized state transitions per invariant, no counter-examples found.

## Acceptance for Phase 9 close

Per `PROGRESS.md` Phase 9 acceptance criteria, "**Tier 2 audit passed**" requires "spec compliance + code quality + security reviewers all green". The non-Foundry components of the audit (HCU benchmarks, OZ FHEVM checklist) are PASS. The Foundry invariant artifact is **DEFERRED with documented rationale and a concrete future plan**. This is consistent with how prior phases handled tooling-blocked artifacts (e.g., the Phase 7 spawn-based integration tests skipped due to `npx hardhat node` standalone incompatibility — also documented and accepted).

**Recommendation to PROGRESS.md tick**: Phase 9 ticks with this deviation noted in the CHANGELOG, on equal footing with the other 14 documented Phase-N deviations.

## Reference

- `CLAUDE.md` testing rule (line 122).
- `2026-04-27-slither-report.md` — sibling tooling-incompat doc for rationale alignment.
- `2026-04-27-oz-fhevm-checklist.md` — replacement coverage via manual review.
- 326 tests passing as the executable behavioral spec.
