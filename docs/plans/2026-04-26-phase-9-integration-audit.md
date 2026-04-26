# Phase 9 — Integration + Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take the spec-complete contract surface (Phases 0–6 ✅) + functional off-chain stack (Phase 7 ✅) + redesigned frontend (Phase 8 ✅) and ship them to **Ethereum Sepolia (Zama fhEVM-enabled, chainId 11155111)** as the live demo deployment. Then run a full Tier 2 audit pass and tick the protocol as production-ready (within testnet scope).

**Why now:** All 8 phase plans 0–8 are ticked. 326 tests pass. Pre-Sepolia spec audit found zero logic gaps + zero stubs — only operational shipblockers (no `deploy-sepolia.ts`, no canonical-USDCx wiring on Sepolia, $ZAMA-fee deviation living in CHANGELOG instead of NatSpec). This phase clears those + executes the formal audit Phase 9 has been holding since Phase 3.

**Architecture / approach:**
- **One Sepolia deploy.** Eight contracts, deterministic order (matches `deploy-local.ts`), single deployer EOA. Deploy artifact written to `contracts/deployments/sepolia.json`.
- **USDCx is NOT redeployed.** Per `CLAUDE.md` token rule, `NoirVault` constructor receives the pre-deployed Zama `cUSDCMock` at `0x7c5BF43B851c1dff1a4feE8dB225b87f2C223639`. NoirPerp users mint cUSDCMock from Zama's existing faucet, then deposit into NoirVault.
- **Three relayer EOAs** for the 2-of-3 oracle quorum, each separately funded with Sepolia ETH. Relayer A and B run in `oracle-relayer`; relayer C stays offline (matches Phase 7's "C offline" deviation).
- **Etherscan verification** of all 8 contracts via `hardhat-toolbox`'s built-in `etherscan` plugin.
- **Tier 2 audit** runs in parallel with the deploy (against the deployed bytecode + the source).
- **Frontend smoke** against the live deploy validates the full FHE round-trip (encrypt → on-chain compute → real `userDecrypt`), which has been deferred since Phase 8 (local mock returns `0n`).

**Reference docs:**
- Spec: `docs/specs/2026-04-24-noirperp-design.md` §3 architecture, §8 deploy scripts, §10 phase 9 line 481+
- Pre-Sepolia audit notes: see `2026-04-26` CHANGELOG entry + audit-subagent report (in conversation history)
- BlindPay's Sepolia deploy as a precedent: `~/Desktop/BlindPay/contracts/scripts/deploy.ts` + `frontend/.env`

**Spec deviations carried into Phase 9** (intentional, documented in prior phases — re-listed for the audit's benefit):

1. **AMM has no UniV3 ticks.** Phase 4. Plaintext `totalShares` + `totalReserveUsdcx`; encrypted shares per LP. AMM `swap` is single-direction USDCx → synthetic credit.
2. **Stranded forfeits + stranded swap fees** in AMMEngine. Encrypted credits don't update plaintext counter. Phase 4.
3. **LP state lives in AMMEngine, not NoirVault**. Phase 4.
4. **Vault has no `orders` mapping** — engines hold their own `_orders`. Phase 5.
5. **No `grantTransient(engine, ct[])` Vault helper** — replaced by per-call `allowBalanceAccess` / `allowPositionAccess`. Phase 3.
6. **Darkpool: no volume matching, no partial fills, oracle clearing price, settle via PerpEngine executor.** Phase 6.
7. **LimitEngine split into `placeStopOrTake` + `placeLimit`** rather than one polymorphic entry. Phase 5.
8. **Oracle uses `onlyRelayer` msg.sender check, not secp256k1 sig recovery.** Functionally equivalent for known relayer EOAs.
9. **No $ZAMA fee on async entry points** (`requestLiquidation`, `requestWithdraw`, `requestTrigger`, `requestBatchMatch`). Sepolia is free-tier today; FHEVM v0.11.1 has no published fee API. Decision **(b)** from `2026-04-26` audit reasoning: NatSpec the deviation on each function rather than add a speculative `payable`. **Task 1 below applies this.**
10. **Compliance is a JSON allowlist stub** (no $ZAMA / KYC provider). Phase 7.
11. **Bot is single-process** (no Redis), 4 watchers in one Node process. Phase 7.
12. **Off-chain integration tests skip the spawn-based path** (Tasks 3 + 6 from Phase 7) — covered by Phase 2 Oracle/Compliance + Task 13 cross-service smoke.

---

## Task scope summary

| # | Task | Estimated | Blocking? |
|---|---|---|---|
| 1 | $ZAMA-fee deviation NatSpec on 4 async entry points | 15 min | yes |
| 2 | `contracts/scripts/deploy-sepolia.ts` | 30 min | yes |
| 3 | `.env.example` updates (contracts + frontend) | 10 min | yes |
| 4 | (User action) Generate + fund deployer + relayer EOAs | user | yes |
| 5 | Run Sepolia deploy → write `deployments/sepolia.json` | 15 min | yes |
| 6 | Etherscan verify 8 contracts | 15 min | yes |
| 7 | `setup-sepolia.ts` (mint cUSDCMock to admin via Zama faucet, set vault operator, commit oracle prices) | 20 min | yes |
| 8 | Sync compliance root via existing `sync-compliance-root.ts --network sepolia` | 5 min | yes |
| 9 | Update `frontend/.env` for Sepolia + deploy frontend (Vercel/Netlify/Cloudflare) | 15 min | yes |
| 10 | Smoke the live demo end-to-end (open + close + LP add + dark-pool submit + KYC + reveal) | 30 min | yes |
| 11 | Slither sweep on all engines + libs | 30 min | for ✅ tick |
| 12 | Mythril sweep on PerpEngine + AMMEngine + LimitEngine + DarkpoolEngine | 60 min | for ✅ tick |
| 13 | OpenZeppelin FHEVM security checklist re-walk against deployed source | 60 min | for ✅ tick |
| 14 | Foundry invariant + fuzz tests on engines | 4 hr | for ✅ tick |
| 15 | HCU benchmarks (`PerpEngine.openPosition`, AMM swap, dark batch match) against Zama 5M sequential / 20M global | 60 min | for ✅ tick |
| 16 | Per-contract sign-off doc at `docs/audit/2026-04-26-tier-2-signoff.md` | 60 min | for ✅ tick |

Tasks 1–10 are deploy-blocking. Tasks 11–16 are audit-blocking but can run in parallel after deploy.

---

### Task 1: NatSpec the $ZAMA-fee deviation on async entry points

**Files (modify):**
- `contracts/contracts/engines/PerpEngine.sol` — `requestLiquidation`
- `contracts/contracts/engines/AMMEngine.sol` — `requestWithdraw` (or whatever the async withdraw entry is)
- `contracts/contracts/engines/LimitEngine.sol` — the bot-trigger entry point
- `contracts/contracts/engines/DarkpoolEngine.sol` — `requestBatchMatch`

**Why option (b) and not (a):** see CHANGELOG entry dated 2026-04-26, "$ZAMA fee question" reasoning. TL;DR: FHEVM v0.11.1 exposes no fee API; a speculative `payable` doesn't future-proof, just adds a dead `msg.value` path. NatSpec discharges the audit's finding (deviation should be discoverable on the function, not buried in a phase CHANGELOG).

- [ ] **Step 1**: For each of the four functions, add a `/// @notice Spec deviation: ...` block immediately above the function declaration. Block content (parameterize per-function):

```solidity
/// @notice Spec §5.2 deviation: this function is non-payable and does
///         not forward a $ZAMA decrypt fee. FHEVM v0.11.1 exposes no
///         on-chain fee API; Sepolia Gateway decrypts are free-tier.
///         If Zama enables paid decrypts, a contract upgrade integrating
///         the actual API is required (a speculative `payable` here
///         would not match the future shape). See CHANGELOG entry
///         2026-04-26 "$ZAMA fee question" for the full reasoning.
```

- [ ] **Step 2**: `npm run lint` in `contracts/` (compiles + typechain regen) — must be clean.
- [ ] **Step 3**: `npx hardhat test` — must still be 288 passing (no behavior change).

### Task 2: `contracts/scripts/deploy-sepolia.ts`

**Files (create):**
- `contracts/scripts/deploy-sepolia.ts`

Mirrors `deploy-local.ts` step-for-step, with these specific changes:

1. **Skip the `MockERC7984` deploy entirely.** No `await ethers.getContractFactory("MockERC7984")` line.
2. **Hard-code the Zama cUSDCMock address** at the top of the script:
   ```ts
   const SEPOLIA_CUSDC_MOCK = "0x7c5BF43B851c1dff1a4feE8dB225b87f2C223639";
   ```
3. **Pass `SEPOLIA_CUSDC_MOCK` as `usdcxToken`** into `NoirVault` constructor. Skip the local mock minting (Task 7 covers Sepolia faucet flow).
4. **Read three relayer addresses from env**:
   ```ts
   const RELAYER_A = process.env.RELAYER_A_ADDRESS;
   const RELAYER_B = process.env.RELAYER_B_ADDRESS;
   const RELAYER_C = process.env.RELAYER_C_ADDRESS;
   if (!RELAYER_A || !RELAYER_B || !RELAYER_C) {
     throw new Error("RELAYER_A/B/C_ADDRESS env vars required for Sepolia deploy");
   }
   ```
5. **Write deploy artifact to `contracts/deployments/sepolia.json`** (not `local.json`). `chainId: 11155111`, `network: "sepolia"`. Include all 8 contract addresses + relayers + admin.
6. **Engine wiring identical to local**: PerpEngine.liquidationPool → AMMEngine; LimitEngine + DarkpoolEngine authorized as PerpEngine executors; engines registered on NoirVault.
7. **Idempotency**: if `deployments/sepolia.json` already exists, abort with a clear error (deploys are not redoable). User must manually `rm deployments/sepolia.json` to re-deploy from scratch.

- [ ] **Step 1**: Write the script.
- [ ] **Step 2**: `npx hardhat compile` — clean.
- [ ] **Step 3**: Dry-run by reading the script with no env vars set; expected: throws `RELAYER_A/B/C_ADDRESS env vars required`.

### Task 3: `.env.example` updates

**Files (modify):**
- `contracts/.env.example`
- `frontend/.env.example`

- [ ] **Step 1** — `contracts/.env.example`: add (or document) these vars:

```
# Sepolia deploy
PRIVATE_KEY=<deployer EOA private key — needs ~0.5 Sepolia ETH>
SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
ETHERSCAN_API_KEY=<get from etherscan.io for verification>
RELAYER_A_ADDRESS=0x...
RELAYER_B_ADDRESS=0x...
RELAYER_C_ADDRESS=0x...
```

- [ ] **Step 2** — `frontend/.env.example`: add Sepolia block (the existing commented block in `.env.example` is incomplete; flesh it out):

```
# Sepolia (Phase 9)
VITE_DEPLOYMENT_NETWORK=sepolia
VITE_CHAIN_ID=11155111
VITE_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
VITE_COMPLIANCE_API_URL=https://compliance.<your-domain>
VITE_WC_PROJECT_ID=<get from cloud.walletconnect.com — required for mobile QR flow on Sepolia>
```

### Task 4 (USER ACTION): Generate + fund deployer + relayer EOAs

User action — out of agent scope. Required before Task 5 can run:

- [ ] **Step 1**: Generate 4 fresh EOAs (deployer + relayer A/B/C). Recommended: use a hardware wallet for the deployer; `cast wallet new` for relayers (read-only addresses don't need private keys; they only sign oracle pushes via the oracle-relayer service).
- [ ] **Step 2**: Fund the deployer with ~0.5 Sepolia ETH (8 deploys + ~6 wiring txs + buffer). Faucet: https://sepoliafaucet.com or https://www.alchemy.com/faucets/ethereum-sepolia.
- [ ] **Step 3**: Fund relayers A and B with ~0.1 Sepolia ETH each (they sign every oracle tick — 30s cadence × 3 markets × 2 relayers).
- [ ] **Step 4**: Paste addresses + deployer private key into `contracts/.env`.
- [ ] **Step 5**: Paste relayer A and B private keys into `oracle-relayer/.env`.

### Task 5: Run Sepolia deploy

- [ ] **Step 1**: From `contracts/`:
  ```bash
  npx hardhat compile
  npx hardhat run scripts/deploy-sepolia.ts --network sepolia
  ```
- [ ] **Step 2**: Verify `deployments/sepolia.json` was written with `chainId: 11155111` and 8 contract addresses.
- [ ] **Step 3**: Sanity-check addresses on https://sepolia.etherscan.io — each should show a `Contract Creation` tx from the deployer.

### Task 6: Etherscan verify

`hardhat.config.ts` already has the `etherscan: { apiKey: { sepolia: ETHERSCAN_API_KEY } }` block.

- [ ] **Step 1**: For each of the 8 deployed contracts, run:
  ```bash
  npx hardhat verify --network sepolia <ADDRESS> <CONSTRUCTOR_ARGS...>
  ```
- [ ] **Step 2**: Verify on Etherscan that all 8 show "Contract Source Code Verified" with green checks.
- [ ] **Step 3** (optional): Add an "Explorer" links table to `deployments/sepolia.json` so the frontend can deep-link to verified source.

### Task 7: Sepolia setup-demo (cUSDCMock mint + vault operator + oracle prices)

**Files (create):**
- `contracts/scripts/setup-sepolia.ts`

Local's `setup-demo.ts` mints a million USDCx into the admin from our own MockERC7984. On Sepolia we don't own cUSDCMock — instead, the admin mints from Zama's public faucet on `0x7c5BF43B851c1dff1a4feE8dB225b87f2C223639`. Check the contract source on Etherscan to find the public mint function shape (likely `mint(uint64)` or `mint(address, uint64)`).

- [ ] **Step 1**: Implement `setup-sepolia.ts`: (a) mint ~1M cUSDCMock to admin if mint fn is open-public; (b) `noirVault.setOperator(...)` to allow vault to pull USDCx from admin; (c) commit BTC/ETH/SOL oracle prices via the 2-of-3 quorum (relayer A + B from env keys).
- [ ] **Step 2**: Run `npx hardhat run scripts/setup-sepolia.ts --network sepolia`.
- [ ] **Step 3**: Confirm on Etherscan that admin has cUSDCMock balance (encrypted balance, but the tx receipt is visible) and that Oracle's BTC/ETH/SOL prices are committed.

### Task 8: Sync compliance root on Sepolia

The existing `sync-compliance-root.ts` reads `deployments/<network>.json` and pushes the backend's merkle root on-chain. Should work as-is on `--network sepolia` once the compliance-backend is running and reachable.

- [ ] **Step 1**: Start `compliance-backend` (likely on a public host — Render / Fly.io / Railway / a VPS — pointed at the live `Compliance.sol` address from `sepolia.json`).
- [ ] **Step 2**: `cd contracts && npx hardhat run scripts/sync-compliance-root.ts --network sepolia`. Verify on-chain root matches backend root.

### Task 9: Frontend Sepolia env + deploy

- [ ] **Step 1**: Update `frontend/.env` with Sepolia values (Task 3 captured the shape).
- [ ] **Step 2**: `cd frontend && npm run build`. Confirm clean build (no TFHE WASM errors; relayer SDK lazy-loads its production path on Sepolia network).
- [ ] **Step 3**: Deploy `frontend/dist/` to chosen host (Vercel / Netlify / Cloudflare Pages). Confirm public URL renders the landing.
- [ ] **Step 4**: Set up `compliance-backend` on a public host with TLS; update `VITE_COMPLIANCE_API_URL` accordingly; redeploy frontend.

### Task 10: Live smoke

- [ ] **Step 1**: Visit live URL with a Sepolia-funded MetaMask / OKX / WalletConnect mobile wallet that holds a small balance of cUSDCMock (Zama faucet).
- [ ] **Step 2**: Compliance page → "allowlisted" if deployer's address is in the seeded allowlist.
- [ ] **Step 3**: Deposit cUSDCMock into NoirVault. Reveal vault balance — **should now show actual plaintext** (the local-mock `0n` deferred from Phase 8 is now exercised on Sepolia).
- [ ] **Step 4**: Open ETH long, size 0.1, collateral 100. Sign. Verify position appears + size/entry/collateral reveal correctly.
- [ ] **Step 5**: Close position. Verify async decrypt completes (bot's decrypt-relay watcher must be running).
- [ ] **Step 6**: AMM addLiquidity 50. Verify totalShares update.
- [ ] **Step 7**: Darkpool submit → cancel. Verify order appears + disappears.
- [ ] **Step 8**: Capture screenshots / video for Phase 10 demo asset.

### Task 11–16: Tier 2 Audit

These can run after Tasks 1–10 ship; they're acceptance gates for the **✅ phase tick**, not for the deploy itself. Each task lands a deliverable file in `docs/audit/2026-04-26-*`:

- [ ] **Task 11**: Run Slither: `cd contracts && slither . --filter-paths "node_modules|test"`. Categorize findings: critical / important / minor / observation. Critical + important must be fixed before tick. File: `docs/audit/2026-04-26-slither-report.md`.
- [ ] **Task 12**: Run Mythril on the 4 engines. File: `docs/audit/2026-04-26-mythril-report.md`.
- [ ] **Task 13**: Walk OpenZeppelin's FHEVM security checklist (https://github.com/OpenZeppelin/openzeppelin-confidential-contracts) function-by-function. File: `docs/audit/2026-04-26-oz-fhevm-checklist.md`.
- [ ] **Task 14**: Add Foundry invariant + fuzz tests under `contracts/test/invariants/`. Per `CLAUDE.md` testing rule: invariant + fuzz tests run in Phase 9. Target invariants: PerpEngine pnl-conservation, AMM share-supply ↔ reserve ratio, vault balance-sum integrity, DarkpoolEngine match-conservation. File: `docs/audit/2026-04-26-invariant-runs.md` with seed + iteration counts.
- [ ] **Task 15**: HCU benchmarks. Use `forge test --gas-report` + Zama's HCU profiling tool (if available) on the heaviest paths: `PerpEngine.openPosition`, `AMMEngine.swap`, `DarkpoolEngine._onBatchDecided` (worst-case N=10 orders). Confirm sequential ≤ 5M and global ≤ 20M per `CLAUDE.md` rule 7. File: `docs/audit/2026-04-26-hcu-benchmarks.md`.
- [ ] **Task 16**: Per-contract sign-off. For each of the 8 contracts, write a 1-paragraph "audited / passed / known-deviations" block. File: `docs/audit/2026-04-26-tier-2-signoff.md`. This is the artifact PROGRESS.md asks for.

---

## Acceptance criteria (✅ tick conditions)

Per `PROGRESS.md` rules, Phase 9 ticks only when:

1. **All tasks 1–10** complete (live deploy + verified + smoked).
2. **All audit tasks 11–16** complete with critical / important findings fixed.
3. **All tests** still pass (288 contracts + 38 off-chain = 326 + any new Foundry invariant runs).
4. **Coverage ≥ 90% stmts/funcs/lines + ≥ 80% branches** per new contract — Phase 9 adds no new contracts, but the existing coverage targets must not regress.
5. **Tier 2 audit passed** — the spec-compliance + code-quality + security reviewers all green per the per-contract sign-off doc.
6. **`CHANGELOG.md`** has a phase-completion entry documenting deploy addresses, verification links, audit findings, deviations.
7. **Branch merged** to `master` via fast-forward.
8. **`PROGRESS.md`** Phase 9 checkbox ticked with completion criteria summary.

Phase 10 (Docs + video + submission) does not start until Phase 9 is ticked.

---

## Phase deviations (in advance)

If any of the following emerge during execution, document inline and continue:

1. **Slither / Mythril false positives**: many FHE-specific patterns (uncheckered `FHE.sub` is fine because we use `FHESafeMath`; `FHE.isSenderAllowed` looks like missing access control to a static analyzer that doesn't model the FHEVM permission system) trigger false-positives. Document each false positive in the audit report; do not "fix" the underlying code unless a real issue is found.
2. **HCU budget cliffs**: if `DarkpoolEngine._onBatchDecided` blows the 5M sequential limit at N=10, reduce `MAX_BATCH` and document in CHANGELOG.
3. **Etherscan verification failure on FHEVM-precompile-using contracts**: the FHE precompiles aren't in Etherscan's standard EVM model. May need to use Sourcify or a manual verification flow. Document the path used.
4. **Zama faucet rate-limited**: if cUSDCMock faucet limits prevent admin from minting 1M, ship with a smaller demo balance (e.g., 10k) and note in CHANGELOG.
