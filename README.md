# NoirPerp

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Built on Zama FHEVM](https://img.shields.io/badge/Built%20on-Zama%20FHEVM%20v0.12-7e3af2)](https://docs.zama.ai/protocol)
[![Network: Sepolia](https://img.shields.io/badge/Network-Sepolia-3c3c3d)](https://sepolia.etherscan.io/)
[![Tests: 347 passing](https://img.shields.io/badge/tests-347%20passing-2ea44f)](#testing)
[![Audit: Tier 2 sign-off](https://img.shields.io/badge/audit-Tier%202%20%E2%9C%93-blue)](docs/audit/2026-04-27-tier-2-signoff.md)

> **A perpetual-futures DEX where your size, collateral, entry price, PnL, leverage, and dark-pool orders are all encrypted on-chain.** The chain holds ciphertexts; only the decision bit *"should this position liquidate?"* is decrypted, and that decryption is gated by Zama's KMS quorum.

NoirPerp is a privacy-preserving perp DEX on Ethereum Sepolia, powered by Zama's Fully Homomorphic Encryption Virtual Machine (FHEVM). It is a ground-up rewrite of [ZKPerp](https://github.com/) — originally built on Aleo's zero-knowledge records — adapted to FHEVM's fundamentally different primitive model. Position state lives as Zama ciphertexts, sensitive state transitions are computed under encryption, and only the final bits required for atomic settlement are decrypted via the Zama Gateway.

---

## Table of contents

1. [Why this exists](#why-this-exists)
2. [What's encrypted vs. what's public](#whats-encrypted-vs-whats-public)
3. [Features](#features)
4. [Live on Sepolia](#live-on-sepolia)
5. [Quick start](#quick-start)
6. [Architecture](#architecture)
7. [Repo layout](#repo-layout)
8. [Status & roadmap](#status--roadmap)
9. [Testing](#testing)
10. [Tier 2 audit summary](#tier-2-audit-summary)
11. [Threat model](#threat-model)
12. [For judges / reviewers](#for-judges--reviewers)
13. [Contributing](#contributing)
14. [License & provenance](#license--provenance)

---

## Why this exists

Perpetual-futures DEXes today fall into two categories:

- **Transparent** (GMX, dYdX, Hyperliquid). Every position size, leverage, liquidation price, and TP/SL is public. Whales get front-run, MEV bots harvest stops, and liquidations cascade because everyone can see them coming.
- **Off-chain "private"** (Centralized exchanges; some L2 darkpools). Privacy comes from trust in the operator, not cryptography.

NoirPerp uses **Fully Homomorphic Encryption** to compute on encrypted positions directly on-chain. Margin checks, PnL settlement, AMM swaps, dark-pool matches — all run over ciphertexts using Zama's FHEVM precompiles. Only the minimum decision bits are decrypted, through a 2-of-3 KMS quorum, never the underlying values.

This unlocks the previously-impossible sweet spot: **on-chain settlement guarantees + cryptographic privacy + no trusted operator**.

## What's encrypted vs. what's public

| Stays encrypted (only you can decrypt) | Stays public (on-chain by design) |
|---|---|
| Your USDCx vault balance | Which contract addresses you transact with |
| Your position size + leverage + collateral | Which market (BTC / ETH) you trade |
| Your liquidation price + entry price | Your wallet address (Ethereum is pseudonymous) |
| AMM pool shares (per-LP) | AMM pool totals (TVL, total shares) |
| Limit-order trigger conditions | The fact that *some* order exists |
| Dark-pool order size + price preference | The fact that you submitted a dark-pool order |
| KYC allowlist membership (proof-of-inclusion) | The Compliance Merkle root |

The chain reveals *that* you're trading, never *what* you're trading.

---

## Features

### 1. Trade — encrypted long/short positions
- BTC/USD and ETH/USD perpetual futures (SOL planned; no Sepolia Chainlink feed yet).
- Up to ≤25× leverage. Position size + collateral encrypted client-side, submitted as Zama ciphertexts with input proofs.
- Margin health checked on encrypted state every block. When health drops, an `ebool` decrypt request is queued; the bot relays Zama's signed decryption back to `_onLiquidationDecided`, which atomically liquidates if true.
- KYC proof verified on-chain via Merkle inclusion against the public `Compliance.merkleRoot()`.

### 2. AMM — confidential liquidity provision
- Single-pool concentrated USDCx-backed liquidity (Uniswap-style accounting).
- Per-LP shares are encrypted; pool totals are public for honest pricing.
- Async withdraw: deposit is sync, withdraw is two-tx (decrypt request + callback) so the AMM never reveals an LP's share when computing redemptions.

### 3. Limit & TP/SL orders
- Price-conditional orders (`triggerAbove(price)` / `triggerBelow(price)`).
- Trigger condition is a single `ebool` checked off-chain by the bot; on match, bot calls the engine which emits a `TriggerRequested` event that gets fulfilled via the standard decrypt-callback dance.
- Same KYC + margin-health gates as the manual `Trade` path.

### 4. Darkpool — encrypted P2P pair-matching (Phase 11)
- Submit a buy/sell order with an encrypted size + collateral-per-unit. Order ciphertexts are stored on-chain; the matchable interval is exposed only as a sealed `ebool` to the matcher bot.
- The bot identifies cross-eligible pairs (distinct owner, opposite side, same market), calls `submitMatchPair`, which emits a 3-bool `MatchProposed` event.
- Decrypt callback `_onMatchDecided` either fills both sides at the oracle price (atomically opening the two perp positions) or rejects with a guarded reason. Self-match attempts revert pre-encryption with `PairOrdersSameOwner`.
- One match per tick, 10-block backoff on failed pairs, FIFO queue by `orderId`-sum.

### 5. Compliance — Merkle KYC allowlist
- Off-chain backend (`compliance-backend/`) runs a Merkle tree over the allowlist; serves `/proof/{address}` and `/health` HTTP endpoints.
- On-chain `Compliance` contract verifies inclusion in `Compliance.verify(addr, proof)` — same library client + server, so cross-system root consistency is provable.
- Admin endpoint `POST /admin/add` (x-api-key gated) for adding new addresses; root is then synced on-chain via `sync-compliance-root.ts`.

### 6. Faucet — 1-click test USDCx
- `/faucet` page in the frontend wraps the canonical 3-tx ERC-7984 onboarding (mint underlying USDC → approve → wrap into encrypted USDCx) into a single button. Skips approve on repeat mints.
- Works against the Zama-deployed `cUSDCMock` and its underlying ERC20 mock — no token redeploys required by NoirPerp.

---

## Live on Sepolia

Network: **chainId 11155111**. All contracts source-verified on Etherscan.

| Contract | Address | Notes |
|---|---|---|
| **NoirVault** | [`0x80c9…9E08`](https://sepolia.etherscan.io/address/0x80c9EDF6aE02FC7574C4650271E18AE6038E9E08#code) | ciphertext-state owner |
| **PerpEngine** | [`0x3eE7…2678`](https://sepolia.etherscan.io/address/0x3eE74fd082078B6aEEE3aA082606b12332Fd2678#code) | open / close / liquidate |
| **AMMEngine** | [`0xE8B4…2B99`](https://sepolia.etherscan.io/address/0xE8B4fa802B7169a8c4972DeA2C6fc1503e3E2B99#code) | LP deposit / withdraw |
| **LimitEngine** | [`0xdd4D…FE79`](https://sepolia.etherscan.io/address/0xdd4Dce185C7fb44ad60744ebb65951580EA8FE79#code) | TP / SL / limit orders |
| **DarkpoolEngine v2** | [`0x1990…0F84`](https://sepolia.etherscan.io/address/0x199012e4A7Dd6D7d6B2C4bd49B31Cc9b5Fe80F84#code) | P2P pair-matching (Phase 11) |
| Oracle | [`0xc6fC…c3C0`](https://sepolia.etherscan.io/address/0xc6fC99BBBF12689831558c7B315bd9b5EdcBc3C0#code) | 2-of-3 Chainlink relayer quorum |
| Compliance | [`0x8cEc…5E40`](https://sepolia.etherscan.io/address/0x8cEc42F9Bd9D464dB7f9DF15C8A4ceecADE25E40#code) | Merkle KYC verifier |
| cUSDCMock | [`0x7c5B…3639`](https://sepolia.etherscan.io/address/0x7c5BF43B851c1dff1a4feE8dB225b87f2C223639#code) | Zama-deployed ERC-7984 confidential USDC |
| Underlying USDC mock | [`0x9b5C…dFfF`](https://sepolia.etherscan.io/address/0x9b5Cd13b8eFbB58Dc25A05CF411D8056058aDFfF) | open-mint ERC20 backing cUSDCMock |

A previous `DarkpoolEngine v1` lives at [`0x2031…bD3d`](https://sepolia.etherscan.io/address/0x2031EF7D423bfF2FCa89C335919b11421317bD3d) — still vault-authorized so any orders placed before the v2 redeploy can still be cancelled. Verified zero orders ever existed there at the time of redeploy.

Full deploy artifact: [`contracts/deployments/sepolia.json`](contracts/deployments/sepolia.json).

---

## Quick start

### I want to use it (5 minutes)

1. **Sepolia wallet**. Use MetaMask. Switch network to Sepolia (chainId `11155111`).
2. **Sepolia ETH for gas**. `~0.01 SEP` is plenty. Free faucets:
   - [sepoliafaucet.com](https://sepoliafaucet.com) (Alchemy)
   - [cloud.google.com/application/web3/faucet/ethereum/sepolia](https://cloud.google.com/application/web3/faucet/ethereum/sepolia) (Google)
3. **Run the frontend locally** (public hosting is Phase 10):
   ```bash
   git clone https://github.com/JemIIahh/NoirPerp.git
   cd NoirPerp/frontend
   npm install
   npm run dev
   ```
4. **Open** http://127.0.0.1:5173, connect your wallet.
5. **Get test USDCx** at the `/faucet` page → click "Mint 10,000 USDCx" → confirm 3 MetaMask popups (mint underlying → approve → wrap).
6. **Get on the KYC allowlist**. Send your wallet address to the admin (DM / open an issue). They'll add you via `POST /admin/add` and sync the on-chain Merkle root. Or if running fully locally, the admin key plus Hardhat #0 are pre-seeded.
7. **Trade.** `/trade` for perps, `/liquidity` for AMM, `/darkpool` for P2P pair-match. Full walkthrough in [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md).

### I want to develop on it

```bash
git clone https://github.com/JemIIahh/NoirPerp.git
cd NoirPerp

# Contracts
cd contracts
cp .env.example .env             # leave PRIVATE_KEY blank unless deploying
npm install
npx hardhat compile
npx hardhat test                 # 302 contract tests should pass

# Off-chain services (each in its own terminal for local dev)
cd compliance-backend && npm install && npm test    # 14 tests
cd oracle-relayer    && npm install && npm test    #  6 tests
cd bot               && npm install && npm test    # 25 tests (incl. Phase 11 watcher)
cd frontend          && npm install && npm run lint && npm run build
```

For a local end-to-end demo (5 terminals + MetaMask on Hardhat localhost) see [`frontend/README.md`](frontend/README.md) and [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md) → "Running the frontend → Against local Hardhat".

### I want to deploy my own

1. Fork, set `PRIVATE_KEY` and `SEPOLIA_RPC_URL` in `contracts/.env`.
2. `npx hardhat run scripts/deploy-sepolia.ts --network sepolia` — full bring-up (vault + 4 engines + 2 services + cUSDCMock approvals).
3. `npx hardhat run scripts/setup-sepolia.ts --network sepolia` — fund relayer wallets, register them on Oracle, mint + wrap initial USDCx supply.
4. `npx hardhat verify ...` for each contract (constructor args helper at `scripts/oracle-verify-args.js`).

---

## Architecture

```
                    ┌────────────────────────────────────────────────┐
                    │                  Frontend (Vite + React)        │
                    │   Trade · Liquidity · Darkpool · Compliance     │
                    │              · Portfolio · Faucet                │
                    └───────────┬───────────────────────┬─────────────┘
                                │                       │
                  Zama Relayer SDK                 wagmi + viem
                  (createInstance,                 (writes + reads)
                   encrypt, decrypt)                     │
                                │                       │
                                ▼                       ▼
                    ┌────────────────────────────────────────────────┐
                    │               Engines (stateless)               │
                    │  PerpEngine · AMMEngine · LimitEngine ·         │
                    │              DarkpoolEngine                     │
                    └───────┬─────────────┬───────────────┬───────────┘
                            │             │               │
                  transient ACL    sync settle      decrypt request
                            │             │               │
                            ▼             ▼               ▼
                    ┌────────────────────────────────────────────────┐
                    │             NoirVault (state owner)             │
                    │   ciphertext balances + persistent allow()      │
                    └───────────┬─────────────────────┬───────────────┘
                                │                     │
                          Oracle (2-of-3       Compliance (Merkle
                       Chainlink quorum)         KYC allowlist)
                                ▲                     ▲
                                │                     │
                    ┌──────────────────────┐  ┌─────────────────────┐
                    │  oracle-relayer (TS)  │  │ compliance-backend  │
                    │  pushes BTC/ETH every │  │   (Express, JSON)   │
                    │      30s             │  │   /proof/:addr      │
                    └──────────────────────┘  └─────────────────────┘

                    ┌────────────────────────────────────────────────┐
                    │           bot (5 watchers, 1 process)           │
                    │  liquidation · trigger · batch · match ·        │
                    │             decrypt-relay                       │
                    └────────────────────────────────────────────────┘
```

### Layered Vault + Engines pattern

- **`NoirVault`** owns *all* ciphertext state (encrypted balances, positions, AMM shares). Persistent `FHE.allow()` grants live here, and only to the user address that owns the underlying state. This is the one place sensitive state can be read.
- **Engines** are stateless processors. They request transient ACL permits from the Vault, compute new state in FHE, and write results back. Engines never persistently hold ciphertext — they're disclosure-oracle-safe by construction.
- **Services** (`Oracle`, `Compliance`) are read-only dependencies. Oracle uses 2-of-3 relayer quorum + 90-second staleness window + 50-bps deviation guard. Compliance is a Merkle allowlist gated by `verify(addr, proof) → bool`.
- **Off-chain services** are operational hot-paths: `oracle-relayer` (pushes prices every 30s), `compliance-backend` (Merkle proof API), `bot` (5 watchers). All written in TypeScript.

### Two-transaction async-decrypt pattern

Async state transitions (liquidation, AMM withdraw, limit trigger, batch match, P2P pair match) are split across two transactions:

1. **Sync tx**: validate plaintext invariants, mark the relevant `ebool` publicly decryptable, enqueue a `PendingDecrypt`, emit a handle list event.
2. **Async callback**: the bot relays Zama's signed decryption result. The engine calls `FHE.checkSignatures(reqId, cleartexts, proof)` first → `DecryptQueue.dequeue(reqId)` for replay protection → only then does any external work (settlement, refund, position open). This ordering is enforced everywhere; CLAUDE.md rule 6.

This pattern is the canonical FHEVM v0.12 idiom and exactly why the `bot` exists: it watches for decrypt-request events on each engine, fetches the cleartext from the Zama gateway, and submits the callback transaction. Without the bot, async paths stall.

Full design specification: [`docs/specs/2026-04-24-noirperp-design.md`](docs/specs/2026-04-24-noirperp-design.md) — 50+ pages, the canonical source of truth for every architectural choice.

---

## Repo layout

```
contracts/                 Hardhat workspace — Solidity 0.8.27 + FHEVM v0.12.1
  contracts/
    NoirVault.sol               ciphertext-state owner
    engines/
      PerpEngine.sol             open / close / liquidate
      AMMEngine.sol              LP deposit / withdraw
      LimitEngine.sol            TP / SL / limit
      DarkpoolEngine.sol         P2P pair-match (Phase 11)
    services/
      Oracle.sol                 2-of-3 Chainlink relayer quorum
      Compliance.sol             Merkle KYC verifier
    lib/
      FHESafeMath.sol            saturation-safe FHE add/sub
      DecryptQueue.sol           replay-guarded pending decrypts
      MarginMath.sol             margin-health math primitives
      TickMath.sol               UniV3 tick conversions
  scripts/
    deploy-local.ts              Hardhat localhost deploy
    deploy-sepolia.ts            Sepolia deploy (used for the live deployment)
    deploy-sepolia-darkpool-v2.ts  Phase 11 surgical DarkpoolEngine upgrade
    setup-demo.ts                local demo seed
    setup-sepolia.ts             Sepolia bring-up (relayers + cUSDCMock + prices)
    sync-compliance-root.ts      pushes Merkle root on-chain (network-aware)
    oracle-verify-args.js        constructor-args helper for Etherscan verify
  deployments/
    local.json                   Hardhat localhost addresses
    sepolia.json                 ⭐ live Sepolia addresses
  test/                          302 unit + integration tests

frontend/                   Vite 5 + React 18 + wagmi 2 + RainbowKit + Zama Relayer SDK 0.4.1
  src/
    pages/
      Home.tsx                   landing page with spinning globe
      Trade.tsx                  open / close / view perps
      Liquidity.tsx              AMM LP deposit / withdraw
      Darkpool.tsx               P2P pair-match + batch submit
      Limit.tsx                  TP / SL / limit orders
      Compliance.tsx             KYC status + Merkle proof viewer
      Portfolio.tsx              encrypted balances + positions
      Faucet.tsx                 1-click USDCx onboarding (new)
    lib/
      relayer.ts                 lazy-loaded Zama Relayer SDK
      abis.ts                    contract ABIs (parsed via viem)
      markets.ts                 BTC / ETH / SOL definitions
      deployment.ts              network-aware deployment loader

bot/                         Liveness + decrypt-relay orchestrator (Phase 7 + 11)
  src/
    watchers/
      liquidation.ts             health-check + LiquidationRequested
      trigger.ts                 TP / SL / limit triggers
      batch.ts                   dark-pool batch matcher
      match.ts                   Phase 11 P2P pair-match watcher
      decrypt-relay.ts           ebool callback fulfillment

oracle-relayer/             2-of-3 Chainlink price quorum service (Phase 7)
compliance-backend/         Express Merkle proof API (Phase 7)
                            + Dockerfile + render.yaml for public hosting

docs/
  USER_GUIDE.md               ⭐ how to use NoirPerp end-to-end
  specs/                      design specs (canonical source of truth)
  plans/                      per-phase implementation plans (0 → 11)
  fhe-primitives.md           verified FHEVM v0.12 primitives reference
  security-checklist.md       OZ FHEVM checklist applied here
  audit/                      Phase 9 sign-off pack (5 documents)

PROGRESS.md                 phase tracker — 11 of 12 phases shipped
CHANGELOG.md                full change history (entry per commit)
CLAUDE.md                   pinned engineering rules for contributors
```

---

## Status & roadmap

| Phase | What | Status |
|---|---|---|
| 0 | Scaffolding & guardrails | ✅ ticked |
| 1 | Shared libs (FHESafeMath / DecryptQueue / MarginMath / TickMath) | ✅ ticked |
| 2 | Vault + services (Oracle, Compliance) | ✅ ticked |
| 3 | PerpEngine | ✅ ticked |
| 4 | AMMEngine | ✅ ticked |
| 5 | LimitEngine | ✅ ticked |
| 6 | DarkpoolEngine v1 (batch matching) | ✅ ticked |
| 7 | Off-chain services (oracle-relayer / compliance-backend / bot) | ✅ ticked |
| 8 | Frontend (8 pages, FHE encrypt + reveal) | ✅ ticked |
| **9** | **Sepolia deploy + Tier 2 audit** | 🟡 deploy + audit done; live frontend hosting deferred to Phase 10 |
| 11 | Darkpool P2P pair-matching | ✅ ticked + redeployed on Sepolia (2026-05-04) |
| 10 | Docs + demo video + submission | 🟡 in flight |

See [`PROGRESS.md`](PROGRESS.md) for current state and acceptance criteria. Phases run gated: phase N+1 doesn't start until N is ticked, every tick requires green tests + audit + CHANGELOG entry.

---

## Testing

| Suite | Count | Stack |
|---|---|---|
| Contract unit + integration | **302** | Hardhat + FHEVM mock + Mocha + Chai |
| Bot watcher tests | **25** | Vitest (5 watchers × ~5 cases each) |
| Compliance backend | **14** | Vitest |
| Oracle relayer | **6** | Vitest |
| **Total** | **347** | All passing as of `f1ae12a` |

Coverage target per engine is ≥90% statements + ≥80% branches. Phase-9 measurement skipped because solidity-coverage is incompatible with FHEVM precompile injection — replacement signal is per-function unit tests (CLAUDE.md gate).

```bash
# Run everything
cd contracts && npx hardhat test
cd ../bot && npm test
cd ../compliance-backend && npm test
cd ../oracle-relayer && npm test
```

---

## Tier 2 audit summary

7/7 contracts **PASS** or **PASS-with-deviations**. Zero NEEDS-FIX or CRITICAL findings.

| Audit gate | Status |
|---|---|
| 347 tests passing (302 contracts + 25 bot + 14 compliance + 6 oracle-relayer) | ✅ |
| HCU budgets (5M sequential / 20M global per tx) | ✅ heaviest 4.89M at dark-pool batch N=10; Phase 11 `submitMatchPair` ~1.34M |
| OZ FHEVM security checklist (manual review) | ✅ 17 sender-allowed guards, no banned primitives |
| Etherscan verification | ✅ all 8 contracts (incl. Phase 11 v2) |
| Slither / Mythril / Foundry static analysis | 📋 deferred — FHEVM-tooling compatibility (documented) |
| Spec-compliance reviewer (Phase 11) | ✅ GREEN — 0 critical / 0 important / 2 minor |
| Code-quality reviewer (Phase 11) | ✅ GREEN-with-minor — 0 critical / 0 important / 4 minor (all fixed) |

Full audit pack: [`docs/audit/`](docs/audit/).

---

## Threat model

**Trust assumptions** (these are the things you have to trust for NoirPerp's privacy claims to hold):

1. **Zama's KMS quorum** is honest. The Sepolia testnet uses Zama's hosted Gateway. A KMS quorum compromise → all ciphertexts on the chain decryptable. (Same trust assumption as every FHEVM project today; mitigated by KMS being a multi-party threshold scheme.)
2. **Oracle relayers** don't collude. 2-of-3 quorum: any two relayers can commit a price, the third is a fault-tolerance margin. A 2-relayer collusion → price manipulation. We rotate keys periodically and the relayer set is on-chain visible.
3. **Compliance backend** signs honest Merkle proofs. The on-chain root is the single source of truth — backend serves proofs against it, contracts verify against it; no trust in the backend beyond Merkle inclusion. If the backend disappears, you can regenerate proofs from the public root + allowlist.
4. **Bot is live**. Async paths (liquidation, withdraw, match) stall without the bot fulfilling decrypt callbacks. Bot compromise → DoS, not a privacy break.

**What's NOT in the trust set**:

- Engine contracts. Engines hold no persistent state and only get transient ACL permits per call — even an exploited engine can't read past balances.
- The deployer/admin. Admin has `rotateRelayer`, `setStalenessSeconds`, `transferAdmin`, `setOperator` — operational surface only, no privileged access to ciphertexts.
- Other users. Standard EVM access control; you can't read another user's encrypted balance because the ACL grant on the ciphertext is `msg.sender`-scoped.
- The oracle staleness path. Stale prices → engines refuse to operate (`PriceNotFresh` revert), preventing settlement at obsolete prices.

**Open issues / non-goals** (honest):

- Sepolia is **testnet**. No real funds at stake; cUSDCMock is a free open-mint token. The privacy properties are mainnet-ready, the tokens are not.
- The match-watcher bot has **resilience handlers** for transient RPC failures but not a full HA / leader-election story. A single-bot deploy is the testnet posture; Phase 12+ would add redundancy.
- **MEV on the encrypted path**: an adversary can see *that* you submitted a dark-pool order even if not the size. We don't claim anonymity-set privacy, only value privacy.

---

## For judges / reviewers

If you have 5 minutes, look at:

1. **The design spec** — [`docs/specs/2026-04-24-noirperp-design.md`](docs/specs/2026-04-24-noirperp-design.md). This is the canonical "why these choices" document.
2. **`DarkpoolEngine.sol`** — the Phase 11 surface (`submitOrderForPairMatch`, `submitMatchPair`, `_onMatchDecided`). Three-bool batched decrypt + `collateralPerUnit × fillSize` math without ciphertext-÷-ciphertext, all under the 5M sequential HCU budget.
3. **The two Phase 11 audits** — [`CHANGELOG.md`](CHANGELOG.md) entry under `2026-04-28 Phase 11 — Tier 1 audit + tick`. Both reviewers green; documented findings.

If you have 20 minutes:

1. Run `cd contracts && npm test` — 302 contract tests should pass clean.
2. Read [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md) — full user walkthrough.
3. Skim [`CHANGELOG.md`](CHANGELOG.md) — reverse chronological. Every commit, with rationale, root causes for fixes, and what was tried.
4. Try the live frontend locally per the [Quick start](#quick-start) above.

If you have an hour: clone, run locally, place a P2P pair-match end-to-end (two browser windows, two MetaMask accounts), watch the bot logs settle the match.

---

## Contributing

Pinned engineering rules in [`CLAUDE.md`](CLAUDE.md). Highlights:

- FHEVM API is `FHE.*`, never `TFHE.*` (deprecated since v0.9).
- `FHE.div(euint64, euint64)` doesn't exist — reformulate ratios as multiplications (`a × MAX >= b × price`).
- Raw `FHE.add` / `FHE.sub` outside `lib/FHESafeMath.sol` are banned (silent wrap on underflow).
- Every external ciphertext entry requires `FHE.isSenderAllowed(ct)` guard.
- Engines use `allowTransient` only; persistent `allow()` lives inside the Vault.
- Decrypt callbacks must call `FHE.checkSignatures` → `_dequeue` → external work, in that order.
- HCU budget: 5M sequential / 20M global per tx.
- `CHANGELOG.md` entry **before** every commit; `PROGRESS.md` tick gated on full acceptance criteria.

Phase plans live in [`docs/plans/`](docs/plans/). Don't start Phase N+1 work until Phase N is ticked.

---

## License & provenance

**License**: [MIT](LICENSE).

**Provenance**: ground-up rewrite of [ZKPerp](https://github.com/) (originally on Aleo using zero-knowledge records) for the Zama FHEVM stack. The rewrite is not a syntactic port — Aleo's encrypted-record paradigm has no direct FHEVM analog, so the state model, commitment scheme, orchestrator trust model, and execution flow have all been redesigned. Built across phases 0 → 11, ~3 weeks elapsed, ~127 commits. See [`CHANGELOG.md`](CHANGELOG.md) for the receipts.

**Acknowledgments**:
- [Zama](https://www.zama.ai/) for FHEVM, the Relayer SDK, and the testnet KMS infrastructure.
- [OpenZeppelin Confidential Contracts](https://github.com/OpenZeppelin/openzeppelin-confidential-contracts) for ERC-7984 and the cUSDCMock pattern.
- [RainbowKit](https://www.rainbowkit.com/) and [wagmi](https://wagmi.sh/) for the wallet UX.
- [Hyperliquid](https://hyperliquid.xyz/), [GMX](https://gmx.io/), [dYdX](https://dydx.exchange/) — prior art, the inspiration for getting privacy right.

**Built for**: [Zama Developer Program — Mainnet Season 2, Builder Track](https://docs.zama.ai/protocol/developer-program). Submission deadline 2026-05-10 23:59 AOE.
