# NoirPerp Frontend

React + Vite SPA for the NoirPerp privacy-preserving perpetuals DEX on Zama FHEVM.

## Stack
- Vite 5 + React 18 + TypeScript (strict)
- wagmi 2 + viem 2 + RainbowKit 2 (wallet)
- @zama-fhe/relayer-sdk 0.4.1 (FHE encrypt/decrypt — EXACT pin)
- Tailwind CSS 3 + React Router 6 + TanStack Query 5

## Pages
- `/` — landing
- `/trade` — open / close perp positions (FHE-encrypted size + collateral)
- `/liquidity` — AMM add liquidity / request withdraw
- `/darkpool` — submit / cancel encrypted batch limit orders
- `/portfolio` — wallet + vault balance, position list, LP shares (encrypted-reveal)
- `/compliance` — KYC allowlist status + Merkle proof from backend

## Local development

### Prereqs
- Node 20+
- A wallet (MetaMask) with the Hardhat dev mnemonic imported

### One-time setup
```bash
cd frontend
npm install
cp .env.example .env   # defaults work for local hardhat
```

### Bring up the local stack

You need 3 services running simultaneously. Open 3 terminals, all rooted at `/Users/ram/Desktop/NoirPerp`:

**Terminal 1 — Hardhat node + deploy:**
```bash
cd contracts
npx hardhat node                    # leaves it running on :8545
# (in another shell) deploy:
npx hardhat run scripts/deploy-local.ts --network localhost
# this writes contracts/deployments/local.json — frontend reads it at build time
```

**Terminal 2 — compliance-backend:**
```bash
cd compliance-backend
npm run build && npm start          # listens on :4001
# allowlist starts empty — add an address:
curl -X POST http://localhost:4001/admin/add \
  -H "Content-Type: application/json" \
  -H "x-api-key: local-dev-secret-CHANGE-IN-PROD" \
  -d '{"address":"0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"}'
```

**Terminal 3 — frontend dev server:**
```bash
cd frontend
npm run dev                         # opens :5173
```

### Optional services
- `oracle-relayer` — pushes prices every 30s. Without it, `Oracle.getPrice` will return `fresh=false` and openPosition will revert.
  ```bash
  cd oracle-relayer && npm run build && npm start
  ```
- `bot` — drives liquidations / triggers / batch matches. Not needed for the open-close demo, but required for limit-order execution + dark-pool batch settlement.
  ```bash
  cd bot && npm run build && npm start
  ```

## Demo flow (click-through)

With the stack running, open `http://127.0.0.1:5173`:

1. **Connect wallet.** Use Hardhat account #0 (admin):
   - RPC: `http://127.0.0.1:8545`
   - Chain ID: `31337`
   - Private key: `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`

2. **Compliance page** → should show "Allowlisted" (after the `curl` POST above).

3. **Trade page** → Market: ETH, Side: Long, Size: `10`, Collateral: `1000` → click "Open position". Sign in MetaMask. After confirmation, the position appears in "My positions" on the right.

4. **Portfolio page** → see the new position. Click "Reveal" on `Size`/`Entry`/`Collateral` to userDecrypt each handle.

5. **Trade page → Close** the position. Sign in MetaMask. Position disappears.

6. **Liquidity page** → Add liquidity 100 → confirm → totalShares increases.

7. **Darkpool page** → Submit a dark order (e.g., size=5, collateral=500, limitPrice=2900) → appears in "My active orders" → Cancel it → disappears.

## Local-mode caveat

The frontend's local mode (`VITE_DEPLOYMENT_NETWORK=local`) uses a **mock relayer SDK** that returns `0n` for every `userDecrypt` call. This is intentional — the FHEVM mock plugin is in-process to Hardhat's runtime; a stand-alone browser process can't access it.

What this means in practice:
- ✅ All UI flows work (forms, transactions, position enumeration, reveal-buttons render)
- ✅ Encrypted inputs (`createEncryptedInput().add64().encrypt()`) produce mock `(handle, proof)` pairs that the FHEVM mock contracts accept
- ❌ `userDecrypt` always returns `0n` — you can't actually see your real plaintexts

**The full FHE round-trip (real encrypt → on-chain compute → real decrypt) only works on Sepolia** (Phase 9), where the relayer SDK's lazy-loaded production path activates.

## Sepolia (Phase 9)

When Phase 9 deploys to Sepolia, set:
```
VITE_DEPLOYMENT_NETWORK=sepolia
VITE_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/<key>
VITE_CHAIN_ID=11155111
VITE_WC_PROJECT_ID=<walletconnect project id>
```

`getRelayerInstance` will lazy-import `@zama-fhe/relayer-sdk/web` and call the real `createInstance(...)`. `userDecrypt` will perform a real KMS round-trip.

Build + deploy:
```bash
npm run build
# → dist/ contains the static SPA, deploy to Vercel / Cloudflare / etc.
```

## Troubleshooting

- **MetaMask "wrong chain"** — add Hardhat manually: chainId 31337, RPC `http://127.0.0.1:8545`.
- **CORS error from compliance-backend** — backend doesn't set CORS by default. Add `app.use((_req, res, next) => { res.header("Access-Control-Allow-Origin", "*"); next(); })` near the top of `compliance-backend/src/server.ts`.
- **`Oracle price stale` revert** — `oracle-relayer` isn't running, so prices are stale. Either start the relayer or run two `Oracle.submitPrice` calls manually from two different relayer signers.
- **Build fails: "Cannot find module @deployments/local.json"** — `contracts/deployments/local.json` doesn't exist yet. Run the deploy step in Terminal 1.
- **Position list always empty** — `usePositions` filters by `owner.toLowerCase()`. If your wallet's checksum case differs from the on-chain address, check the contract returns the address as lowercase; otherwise normalize both sides.
