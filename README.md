# NoirPerp

> Privacy-preserving perpetual-futures DEX on **Ethereum Sepolia testnet**, powered by Zama's FHEVM. Position size, collateral, entry price, PnL, and dark-pool orders are all encrypted end-to-end. The chain stores ciphertexts; only the decision bit "should this position liquidate?" is decrypted via Zama's KMS.

**Status**: ✅ deployed + audited on Sepolia (Phase 9). Source-verified on Etherscan.

---

## Live on Sepolia

Network: chainId **11155111**

| Contract | Address |
|---|---|
| NoirVault | [`0x80c9…9E08`](https://sepolia.etherscan.io/address/0x80c9EDF6aE02FC7574C4650271E18AE6038E9E08#code) |
| PerpEngine | [`0x3eE7…2678`](https://sepolia.etherscan.io/address/0x3eE74fd082078B6aEEE3aA082606b12332Fd2678#code) |
| AMMEngine | [`0xE8B4…2B99`](https://sepolia.etherscan.io/address/0xE8B4fa802B7169a8c4972DeA2C6fc1503e3E2B99#code) |
| LimitEngine | [`0xdd4D…FE79`](https://sepolia.etherscan.io/address/0xdd4Dce185C7fb44ad60744ebb65951580EA8FE79#code) |
| DarkpoolEngine | [`0x2031…bD3d`](https://sepolia.etherscan.io/address/0x2031EF7D423bfF2FCa89C335919b11421317bD3d#code) |
| Oracle | [`0xc6fC…c3C0`](https://sepolia.etherscan.io/address/0xc6fC99BBBF12689831558c7B315bd9b5EdcBc3C0#code) |
| Compliance | [`0x8cEc…5E40`](https://sepolia.etherscan.io/address/0x8cEc42F9Bd9D464dB7f9DF15C8A4ceecADE25E40#code) |
| cUSDCMock (Zama) | [`0x7c5B…3639`](https://sepolia.etherscan.io/address/0x7c5BF43B851c1dff1a4feE8dB225b87f2C223639#code) |

Full deploy artifact: [`contracts/deployments/sepolia.json`](contracts/deployments/sepolia.json).

---

## I want to use it

→ **[`docs/USER_GUIDE.md`](docs/USER_GUIDE.md)** — quick start, wallet setup, getting cUSDCMock, walkthroughs of every page, common workflows, FAQ, glossary.

10 minutes from zero to your first encrypted long position.

---

## I want to develop on it

```bash
git clone <repo>
cd contracts
cp .env.example .env             # leave PRIVATE_KEY blank unless deploying
npm install
npx hardhat compile
npx hardhat test                 # 288 contracts tests should pass
```

Off-chain services:

```bash
cd compliance-backend && npm install && npm test    # 14 tests
cd oracle-relayer    && npm install && npm test    #  6 tests
cd bot               && npm install && npm test    # 18 tests
cd frontend          && npm install && npm run lint && npm run build
```

326 tests total green as of commit `006a485`.

For local end-to-end demo (5 terminals + MetaMask on Hardhat localhost) see `docs/USER_GUIDE.md` § "Running the frontend → Against local Hardhat".

---

## Architecture

Layered Vault + Engines pattern:

- **`NoirVault`** owns all ciphertext state (encrypted balances, positions). Persistent FHE.allow() grants live here, only to user addresses for state they own.
- **Engines** (`PerpEngine`, `AMMEngine`, `LimitEngine`, `DarkpoolEngine`) are stateless processors. They request transient ACL permits from the Vault, compute new state in FHE, and write results back.
- **Services** (`Oracle`, `Compliance`) are read-only dependencies. Oracle uses 2-of-3 relayer quorum + 90s staleness + 50bps deviation guard. Compliance is a Merkle allowlist gated by `verify(addr, proof) → bool`.
- **Off-chain services**: `oracle-relayer` (pushes prices every 30s), `compliance-backend` (Merkle proof API), `bot` (4 watchers: liquidation / trigger / batch / decrypt-relay).

Async state transitions (liquidation, withdraw, trigger, batch match) are two-transaction:
1. **sync tx**: validate, mark ebool publicly decryptable, enqueue `PendingDecrypt`, emit handle list
2. **async callback**: bot relays Zama's signed decryption result; engine calls `FHE.checkSignatures(...) → _dequeue → external work`

This is the canonical FHEVM v0.11.1 pattern. Full design: [`docs/specs/2026-04-24-noirperp-design.md`](docs/specs/2026-04-24-noirperp-design.md).

---

## Repo layout

```
contracts/             Hardhat workspace — Solidity 0.8.27 + FHEVM v0.11.1
  contracts/
    NoirVault.sol           ciphertext-state owner
    engines/                Perp / AMM / Limit / Darkpool
    services/               Oracle / Compliance
    lib/                    FHESafeMath / DecryptQueue / MarginMath / TickMath
  scripts/
    deploy-local.ts         Hardhat localhost deploy
    deploy-sepolia.ts       Sepolia deploy (used for the live deployment)
    setup-demo.ts           local demo seed
    setup-sepolia.ts        Sepolia bring-up (relayers + cUSDCMock + prices)
    sync-compliance-root.ts pushes Merkle root on-chain (network-aware)
    oracle-verify-args.js   constructor-args helper for Etherscan verify
  deployments/
    local.json              hardhat localhost addresses
    sepolia.json            ⭐ live Sepolia addresses
  test/                     288 unit + integration tests

frontend/              Vite 5 + React 18 + wagmi 2 + RainbowKit + Zama Relayer SDK 0.4.1
bot/                   Liveness + decrypt-relay orchestrator (Phase 7)
oracle-relayer/        2-of-3 price quorum service (Phase 7)
compliance-backend/    Express Merkle proof API (Phase 7)
                       + Dockerfile + render.yaml for public hosting

docs/
  USER_GUIDE.md             ⭐ how to use NoirPerp end-to-end
  specs/                    design specs (canonical source of truth)
  plans/                    per-phase implementation plans (0 → 9)
  fhe-primitives.md         verified FHEVM v0.11.1 primitives reference
  security-checklist.md     OZ FHEVM checklist
  audit/
    2026-04-27-tier-2-signoff.md         per-contract Phase 9 sign-off
    2026-04-27-oz-fhevm-checklist.md     manual security review
    2026-04-27-hcu-benchmarks.md         compute-budget analysis
    2026-04-27-slither-report.md         tooling deferral
    2026-04-27-invariant-runs.md         Foundry deferral

PROGRESS.md           phase tracker — 9 of 10 phases shipped
CHANGELOG.md          full change history (entry per commit)
CLAUDE.md             pinned engineering rules for contributors
```

---

## Tier 2 audit summary

7/7 contracts **PASS** or **PASS-with-deviations**. Zero NEEDS-FIX or CRITICAL findings.

| Audit gate | Status |
|---|---|
| 326 tests passing (288 contracts + 38 off-chain) | ✅ |
| HCU budgets (5M sequential / 20M global per tx) | ✅ — heaviest 4.89M at dark-pool batch N=10 |
| OZ FHEVM security checklist (manual review) | ✅ — 17 sender-allowed guards, no banned primitives |
| Etherscan verification | ✅ all 7 contracts |
| Slither / Mythril / Foundry static analysis | 📋 deferred — FHEVM-tooling compatibility (documented) |

Full pack: [`docs/audit/`](docs/audit/).

---

## Status & roadmap

| Phase | What | Status |
|---|---|---|
| 0–7 | Scaffolding + libs + vault/services + 4 engines + off-chain | ✅ ticked |
| 8 | Frontend (6 pages, FHE encrypt + reveal) | ✅ ticked |
| **9** | **Sepolia deploy + Tier 2 audit** | 🟡 deploy + audit done; live frontend hosting pending |
| 10 | Docs + demo video + submission | not started |

See [`PROGRESS.md`](PROGRESS.md) for current state and acceptance criteria.

---

## Contributing

Pinned rules in [`CLAUDE.md`](CLAUDE.md). Highlights:

- FHEVM API is `FHE.*`, never `TFHE.*` (deprecated)
- `FHE.div(euint64, euint64)` doesn't exist — reformulate ratios as multiplications
- `FHE.add` / `FHE.sub` outside `lib/FHESafeMath.sol` are banned (raw arithmetic wraps silently)
- Every external ciphertext entry requires `FHE.isSenderAllowed(ct)` guard
- `CHANGELOG.md` entry **before** every commit; `PROGRESS.md` tick gated on full acceptance criteria

---

## License

MIT.

## Provenance

Ground-up rewrite of [ZKPerp](https://github.com/) (originally on Aleo) for the Zama FHEVM stack. Built across phases 0–9, ~3 weeks elapsed, ~80 commits. See `CHANGELOG.md` for the receipts.
