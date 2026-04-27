# Phase 9 — Per-Contract Tier 2 Sign-Off

**Date**: 2026-04-27
**Scope**: All 7 NoirPerp contracts deployed on Sepolia (cUSDCMock excluded — it's Zama's pre-deployed canonical mock, not in our scope).
**Method**: Aggregation of HCU benchmarks, OZ FHEVM security checklist, manual function-by-function review, and existing 326-test green coverage. Slither + Mythril deferred (tooling incompatibility documented in `2026-04-27-slither-report.md`); Foundry invariants deferred with concrete plan in `2026-04-27-invariant-runs.md`.

**Sign-off scale**:
- ✅ **PASS** — fit for testnet, no findings.
- ✅✅ **PASS-with-deviations** — fit for testnet, documented spec deviations or operational constraints.
- ⚠️ **NEEDS-FIX** — issue blocks testnet.
- ❌ **CRITICAL** — issue blocks any deploy.

---

## NoirVault — `0x80c9EDF6aE02FC7574C4650271E18AE6038E9E08`

**Status**: ✅✅ **PASS-with-deviations**

20 unit tests (`NoirVault.{Admin,Balance,Positions,AccessGrants}.test.ts` = 5+11+9+5). Coverage: 100% stmts / 90.91% branches per Phase 2 PROGRESS entry. ZamaEthereumConfig inherited (FHE-using). 5 persistent `FHE.allow()` calls all granting access to user addresses for state they own (balances + positions). Engine authorization via `authorizedEngines[msg.sender]` mapping; admin-only `registerEngine` / `deregisterEngine`. Confidential transfers via `cUSDCMock.confidentialTransferFrom` (deposit) and `confidentialTransfer` (withdraw). Pause modifier on every state-mutating user path. **Documented deviations**: no `orders` mapping (each engine holds its own — Phase 5); no `grantTransient(engine, ct[])` helper (replaced by per-call `allowBalanceAccess` / `allowPositionAccess` — Phase 3); no `lpPositions` (lives in AMMEngine — Phase 4). All three are spec deviations carried forward from prior ticked phases.

## Compliance — `0x8cEc42F9Bd9D464dB7f9DF15C8A4ceecADE25E40`

**Status**: ✅ **PASS**

16 unit tests (`Compliance.test.ts`). Coverage: 100% stmts. Pure-Solidity Merkle verification — no FHE primitives, correctly does NOT inherit ZamaEthereumConfig. `OpenZeppelin/merkle-tree` library used both off-chain (compliance-backend) and on-chain (`verify`) ensuring cross-system root consistency (proven by the Phase 2 backend ↔ contract tests). `updateRoot` is `onlyAdmin`. Sepolia state: root `0xf80f63323f9de71cb652683f69df5ff6065631fe1c35a0d220f21302c2f1559e` synced 2026-04-27, includes admin (`0x87E69cA0…`) and the secondary seeded address.

## Oracle — `0xc6fC99BBBF12689831558c7B315bd9b5EdcBc3C0`

**Status**: ✅✅ **PASS-with-deviations**

23 unit tests (`Oracle.test.ts`). Coverage: 100% stmts / 86.11% branches. 2-of-3 quorum logic exercised across same-relayer rejection, deviation guard, staleness window, new-cycle commit. ZamaEthereumConfig inherited. `submitPrice` gated by `onlyRelayer` modifier. `rotateRelayer`, `setStalenessSeconds`, `setDeviationBps`, `transferAdmin` all `onlyAdmin`. Sepolia state: real Relayer A and B in slots 0 and 1 (rotated 2026-04-27 from placeholders); slot 2 retains placeholder C. Oracle currently fresh on BTC=60000, ETH=3000, SOL=150 (per `setup-sepolia.ts`). **Documented deviation**: spec §4.6 calls for `submitPrice(...,bytes calldata sig)` with secp256k1 sig recovery; implementation uses `onlyRelayer` msg.sender check (functionally equivalent for known relayer EOAs) — Phase 7 deviation, carried.

## PerpEngine — `0x3eE74fd082078B6aEEE3aA082606b12332Fd2678`

**Status**: ✅✅ **PASS-with-deviations**

38 unit tests across `PerpEngine.{Open,Close,Liquidation,MultiMarket,Executor,Admin}.test.ts` (7+7+4+3+5+12). Coverage: 97.53% stmts / 84.48% branches / 100% funcs / 97.96% lines per Phase 3 PROGRESS entry. ZamaEthereumConfig inherited. **HCU**: openPosition ~1.31M, closePosition ~720k, requestLiquidation ~700k, _onLiquidationDecided ~600k (all under 5M sequential). Heavy paths: 2 FHE.mul per open/close, 2 FHE.le for margin checks. `FHE.isSenderAllowed` on every external ciphertext entry. Async-decrypt callback `_onLiquidationDecided` follows canonical `checkSignatures → _dequeue → external` order. Executor pattern (Phase 5) lets LimitEngine + DarkpoolEngine settle via Perp without persistent ACL grants. **Documented deviation 1** (`requestLiquidation` non-payable, $ZAMA fee deferred — Phase 9 NatSpec on the function, plus `CHANGELOG.md` 2026-04-26 entry "$ZAMA fee question"). **Documented deviation 2** (close payouts via `vault.adjustBalance`, not direct `cUSDC.confidentialTransfer` — architectural choice, vault is the sole token-touching contract).

## AMMEngine — `0xE8B4fa802B7169a8c4972DeA2C6fc1503e3E2B99`

**Status**: ✅✅ **PASS-with-deviations**

29 unit tests (`AMMEngine.{AddLiquidity,Withdraw,Swap,Admin}.test.ts` = 5+8+4+12). Coverage: 100% stmts / 89.47% branches / 100% funcs / 100% lines per Phase 4 PROGRESS entry. ZamaEthereumConfig inherited. **HCU**: addLiquidity ~485k, swap ~950k, requestWithdraw ~290k, _onWithdrawDecided ~340k (all under 5M sequential). 3 persistent `FHE.allow()` calls grant share/synth balance access to user (`msg.sender` or share owner). Async-decrypt callback follows canonical order. **Documented deviations** (5, all carried from Phase 4): no UniV3 ticks (replaced by plaintext `totalShares` + `totalReserveUsdcx` + encrypted shares per LP), swap is one-direction USDCx → synthetic credit not symmetric pool, stranded forfeits + stranded swap fees (encrypted credits don't update plaintext counter), LP state in AMMEngine (not Vault), no TickMath usage. **Plus deviation 6** (`requestWithdraw` non-payable, $ZAMA fee deferred — Phase 9 NatSpec).

## LimitEngine — `0xdd4Dce185C7fb44ad60744ebb65951580EA8FE79`

**Status**: ✅✅ **PASS-with-deviations**

34 unit tests across `LimitEngine.{PlaceLimit,PlaceStopOrTake,Trigger,Admin}.test.ts` (5+7+5+17). Coverage: 100% stmts / 87.5% branches / 100% funcs / 100% lines per Phase 5 PROGRESS entry. ZamaEthereumConfig inherited. **HCU**: placeLimit ~430k, placeStopOrTake ~330k, requestTrigger ~600k (all under 5M sequential). 3 persistent `FHE.allow()` calls grant trigger/size/collateral access to order owner. Collateral escrow with refund on cancel + miss, verified by all 6 trigger directions (TP-long/short, SL-long/short, LIMIT-long/short). Stack-too-deep mitigated via `PlaceLimitInputs` struct (avoiding viaIR which would have broken 18 unrelated tests). **Documented deviations**: split into `placeStopOrTake` + `placeLimit` instead of single `placeLimit(orderType,...)` (functionally complete). **Plus** `requestTrigger` non-payable (Phase 9 $ZAMA fee NatSpec).

## DarkpoolEngine — `0x2031EF7D423bfF2FCa89C335919b11421317bD3d`

**Status**: ✅✅ **PASS-with-deviations**

30 unit tests (`DarkpoolEngine.{Submit,BatchMatch,Admin}.test.ts` = 9+8+13). Coverage: 100% stmts / 86.21% branches / 100% funcs / 100% lines per Phase 6 PROGRESS entry. ZamaEthereumConfig inherited. **HCU CRITICAL**: `requestBatchMatch` at N=10 = 4.89M HCU sequential (110k headroom against 5M limit). Keepers **must** cap `orderIds.length ≤ 10` — documented in NatSpec at `DarkpoolEngine.sol:222` but **not enforced on-chain**. Async-decrypt callback follows canonical order. Single Gateway decrypt resolves N orders at once via flat-tuple cleartext encoding (assembly word extraction — see Phase 6 fhe-primitives lesson). 3 persistent `FHE.allow()` calls grant size/collateral/limitPrice to order owner. Settlement via PerpEngine executor (Phase 5 carry-forward). **Documented deviations** (4, carried from Phase 6): no volume matching, no partial fills, oracle clearing price (per spec §11), settle via PerpEngine executor. **Plus** `requestBatchMatch` non-payable (Phase 9 $ZAMA fee NatSpec) and the operational N≤10 keeper-cap recommendation (`docs/audit/2026-04-27-oz-fhevm-checklist.md` Obs 1: defensive `MAX_BATCH` revert recommended pre-mainnet).

---

## Sign-off summary

| Contract | Tests | HCU | OZ Checklist | Status |
|---|---|---|---|---|
| NoirVault | 20 ✅ | n/a (no engine entry) | PASS | ✅✅ |
| Compliance | 16 ✅ | n/a (no FHE) | PASS | ✅ |
| Oracle | 23 ✅ | <100k | PASS | ✅✅ |
| PerpEngine | 38 ✅ | 1.31M | PASS | ✅✅ |
| AMMEngine | 29 ✅ | 950k | PASS | ✅✅ |
| LimitEngine | 34 ✅ | 600k | PASS | ✅✅ |
| DarkpoolEngine | 30 ✅ | 4.89M (N=10) | PASS | ✅✅ |

**Total**: 7/7 contracts PASS or PASS-with-deviations. **No critical or important findings**. **Zero NEEDS-FIX or CRITICAL items**. NoirPerp is fit for live Sepolia operation.

## Pre-mainnet hardening (out-of-scope for Phase 9 tick)

Recommended before any mainnet consideration:
1. **Defensive `MAX_BATCH` enforcement** in `DarkpoolEngine.requestBatchMatch` (see OZ Obs 1).
2. **KMS-managed signers** for the 2 Oracle relayers (see OZ Obs 2).
3. **Foundry invariant suite** once FHEVM-Foundry tooling matures (see `2026-04-27-invariant-runs.md`).
4. **Re-evaluate `$ZAMA fee` integration** once Zama's paid-decrypt API ships.
5. **Slither + Mythril sweeps** once their FHEVM source-map compatibility lands (`2026-04-27-slither-report.md`).
6. **External professional audit** (Trail of Bits / OpenZeppelin / Spearbit / Code4rena).

These are well-known hardening items and explicitly NOT testnet blockers.

## Reference

- HCU benchmarks: `docs/audit/2026-04-27-hcu-benchmarks.md`
- OZ FHEVM checklist: `docs/audit/2026-04-27-oz-fhevm-checklist.md`
- Slither status: `docs/audit/2026-04-27-slither-report.md`
- Foundry invariants plan: `docs/audit/2026-04-27-invariant-runs.md`
- Test count: 326 (288 contracts + 38 off-chain) all passing as of commit `006a485`.
