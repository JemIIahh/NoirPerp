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
