# NoirPerp — User Guide

A walkthrough for **using** NoirPerp on Ethereum Sepolia testnet. If you're trying to develop on top of NoirPerp instead, see `docs/specs/` and `docs/plans/` for the design + implementation details.

> **TL;DR** — NoirPerp is a perpetual-futures DEX where every position, balance, and order is encrypted end-to-end using Zama's FHE on Ethereum. You can trade BTC, ETH, and SOL perps with up to 10× leverage; nobody (not even the protocol) sees your numbers.

---

## What makes NoirPerp different

In a regular DEX (dYdX, GMX, Hyperliquid), every position size, every liquidation price, every dark-pool order is public on-chain — anyone can see what you hold and front-run you. NoirPerp encrypts these primitives:

| Field | Regular DEX | NoirPerp |
|---|---|---|
| Position size | public `uint256` | encrypted `euint64` (FHE ciphertext) |
| Collateral amount | public | encrypted |
| Entry price | public | encrypted |
| PnL on close | public | encrypted; only the user can decrypt |
| Dark-pool order book | public | every order is a ciphertext; matching happens on encrypted state |
| Liquidation trigger | public margin math | encrypted margin math; only the boolean "underwater?" is decrypted via Zama's KMS |
| Vault deposits | public ERC20 transfer | confidential ERC-7984 transfer (`cUSDCMock`) |

The chain stores only ciphertexts. The protocol's engines compute on ciphertexts. Only **decision bits** (e.g., *"should this position be liquidated?"*) are decrypted via Zama's Gateway KMS, never the underlying values.

---

## Where NoirPerp is live

**Network**: Ethereum Sepolia testnet (chainId `11155111`)

| Contract | Address | Etherscan |
|---|---|---|
| NoirVault | `0x80c9EDF6aE02FC7574C4650271E18AE6038E9E08` | [view](https://sepolia.etherscan.io/address/0x80c9EDF6aE02FC7574C4650271E18AE6038E9E08#code) |
| PerpEngine | `0x3eE74fd082078B6aEEE3aA082606b12332Fd2678` | [view](https://sepolia.etherscan.io/address/0x3eE74fd082078B6aEEE3aA082606b12332Fd2678#code) |
| AMMEngine | `0xE8B4fa802B7169a8c4972DeA2C6fc1503e3E2B99` | [view](https://sepolia.etherscan.io/address/0xE8B4fa802B7169a8c4972DeA2C6fc1503e3E2B99#code) |
| LimitEngine | `0xdd4Dce185C7fb44ad60744ebb65951580EA8FE79` | [view](https://sepolia.etherscan.io/address/0xdd4Dce185C7fb44ad60744ebb65951580EA8FE79#code) |
| DarkpoolEngine | `0x2031EF7D423bfF2FCa89C335919b11421317bD3d` | [view](https://sepolia.etherscan.io/address/0x2031EF7D423bfF2FCa89C335919b11421317bD3d#code) |
| Oracle | `0xc6fC99BBBF12689831558c7B315bd9b5EdcBc3C0` | [view](https://sepolia.etherscan.io/address/0xc6fC99BBBF12689831558c7B315bd9b5EdcBc3C0#code) |
| Compliance | `0x8cEc42F9Bd9D464dB7f9DF15C8A4ceecADE25E40` | [view](https://sepolia.etherscan.io/address/0x8cEc42F9Bd9D464dB7f9DF15C8A4ceecADE25E40#code) |
| cUSDCMock (Zama) | `0x7c5BF43B851c1dff1a4feE8dB225b87f2C223639` | [view](https://sepolia.etherscan.io/address/0x7c5BF43B851c1dff1a4feE8dB225b87f2C223639#code) |
| underlying USDC mock | `0x9b5Cd13b8eFbB58Dc25A05CF411D8056058aDFfF` | [view](https://sepolia.etherscan.io/address/0x9b5Cd13b8eFbB58Dc25A05CF411D8056058aDFfF#code) |

All seven NoirPerp contracts are **source-verified** — click any link and you can read the full Solidity. The cUSDCMock is Zama's pre-deployed canonical confidential USDC on Sepolia (we did not redeploy our own).

---

## Quick start — your first trade in 10 minutes

### 1. Wallet setup (~2 min)

You need any standard Ethereum wallet. **MetaMask** and **OKX Wallet** are confirmed working; Rainbow, Coinbase Wallet, and any injected wallet should also work.

1. Add Sepolia to your wallet (most wallets have it pre-installed; if not, network params are below).
2. Switch to Sepolia.
3. Fund the wallet with **~0.05 Sepolia ETH** for gas. Free faucet: [alchemy.com/faucets/ethereum-sepolia](https://www.alchemy.com/faucets/ethereum-sepolia).

| Sepolia network params | Value |
|---|---|
| Network name | `Sepolia` (or "Ethereum Sepolia") |
| RPC URL | `https://ethereum-sepolia-rpc.publicnode.com` |
| Chain ID | `11155111` |
| Currency symbol | `ETH` |
| Block explorer | `https://sepolia.etherscan.io` |

### 2. Get test cUSDCMock (~1 min)

NoirPerp's collateral is **cUSDCMock** — Zama's confidential USDC mock at `0x7c5BF43B851c1dff1a4feE8dB225b87f2C223639`. To get some:

**Path A** — Mint underlying + wrap (if you're comfortable with Etherscan):

1. Go to [the underlying USDC mock on Etherscan](https://sepolia.etherscan.io/address/0x9b5Cd13b8eFbB58Dc25A05CF411D8056058aDFfF#writeContract).
2. Connect your wallet → click **`mint`** → enter your address as `to` and `1000000000000` as `amount` (1M USDC at 6 decimals) → submit.
3. Approve cUSDCMock to spend it: same page → **`approve`** → spender `0x7c5BF43B851c1dff1a4feE8dB225b87f2C223639`, amount `1000000000000` → submit.
4. Wrap into confidential balance: go to [cUSDCMock on Etherscan](https://sepolia.etherscan.io/address/0x7c5BF43B851c1dff1a4feE8dB225b87f2C223639#writeProxyContract) → **`wrap`** → `to` = your address, `amount` = `1000000000000` → submit.

**Path B** — Use the admin wallet (if you're the deployer): the deployer key already has 1,000,000 cUSDCMock from `setup-sepolia.ts`. Skip step 2, your balance is already there.

### 3. Get on the KYC allowlist (~5 min the first time)

NoirPerp uses a Merkle-tree allowlist for KYC. Until it's a real KYC provider, the allowlist is admin-curated. For Sepolia testnet:

- Admin (`0x87E69cA0…`) and one secondary address are pre-allowlisted.
- If you're not on the list, ping the admin to add your address (off-chain step). Once added, the new merkle root is pushed on-chain.

Visit `/compliance` in the frontend to confirm your address shows **Allowlisted ✓** before trying to trade.

### 4. Open your first encrypted position (~2 min)

Visit the NoirPerp frontend (link wherever the team has hosted it; or run locally — see "Running the frontend" below).

1. Click **Connect Wallet**, pick your wallet.
2. Confirm the network is Sepolia. If the connect button says "Wrong network" in red, click it → switch to Sepolia.
3. Go to **Trade** → pick a market (BTC, ETH, or SOL).
4. Pick a side (Long or Short).
5. Enter **Size** (e.g., `10`) and **Collateral** (e.g., `1000`). These get encrypted in your browser before being sent on-chain — neither the chain nor any node operator ever sees the plaintext values.
6. Click **Open Position**. Sign the FHE-input-proof transaction in your wallet.
7. Wait ~12 seconds for Sepolia to mine the block.

Your position is now live as a ciphertext on-chain.

### 5. Verify your position (~1 min)

Go to **Portfolio**:
- **Vault balance** → click **Reveal**: triggers a `userDecrypt` round-trip with Zama's KMS. After ~5–15 seconds, you see your actual cUSDCMock balance in cleartext (only YOU can decrypt — the chain still only stores ciphertext).
- **Position size / entry / collateral** → same: each field is a ciphertext on-chain that only you can decrypt to plaintext via the Zama relayer SDK.

If the reveal returns `0` instead of your value, you're probably running against the local Hardhat mock instead of Sepolia. See "Local mock vs Sepolia" below.

---

## The 6 frontend pages

### `/` — Landing

Brand page with the spinning globe + crypto satellites. Click **Open trading** to enter the app, **Check allowlist** to verify KYC.

### `/compliance` — KYC allowlist

Shows whether your address is on the on-chain Merkle allowlist. If yes, displays your Merkle proof (this proof is what the engines verify when you submit a trade — it proves you're on the list without revealing other addresses).

If you're **not allowlisted**, contact the admin to be added. Status updates as the merkle root is rotated.

### `/trade` — Open / close perpetual positions

The core flow.

**Opening**:
- Side: Long (price up = profit) or Short (price down = profit)
- Market: BTC, ETH, or SOL
- Size: contract size (e.g., `0.1` ETH)
- Collateral: cUSDCMock backing the position (e.g., `100`)
- Leverage: implicit, derived from `size × oracle_price ÷ collateral`. Engine enforces max leverage and reverts on under-collateralized positions (silent-zero pattern).

When you click **Open**, the relayer SDK encrypts `size` and `collateral` in your browser, produces an FHE input proof, and submits `PerpEngine.openPosition(handle, proof, marketId, side, complianceProof)`. The engine verifies your KYC proof on-chain, computes margin health on encrypted state, and writes the new ciphertext position to NoirVault.

**Closing**:
- Click a position from "My positions" (right panel).
- Click **Close**. Engine computes encrypted PnL, debits/credits encrypted balance.

**What you actually see on-chain**: position ciphertext handles. Anyone querying Etherscan sees opaque encrypted blobs — nothing about your size, entry, or PnL.

### `/liquidity` — AMM liquidity

The AMM acts as the counterparty for all perp trades.

**Add liquidity** (synchronous):
- Enter an amount of cUSDCMock to deposit
- Click **Add**
- AMM mints encrypted shares to you proportional to your contribution
- Shares are stored as ciphertexts in `AMMEngine._userShares[you]`

**Withdraw liquidity** (asynchronous, two-tx):
- Click **Reveal** on your share balance to know your exact share count.
- Enter the share count to withdraw → click **Request Withdraw**
- This is the first transaction. It enqueues a Gateway decryption request.
- Wait for the bot's `decrypt-relay` watcher to push the cleartext callback (~30–60s on testnet).
- Your cUSDCMock is credited back to your vault balance.

### `/darkpool` — Encrypted batch orders

Submit limit orders where size, collateral, and limit price are all encrypted. The keeper bot collects orders into batches, requests a single Gateway decryption to determine which fill at the current oracle price, and settles them atomically through the PerpEngine executor pattern.

**Submit**:
- Side, market, size, collateral, limit price → encrypt → submit.
- Order joins the dark queue; nobody (including other traders) sees your limit price.

**Cancel**:
- Click your order in "My active orders" → click Cancel.
- Encrypted collateral refunds back to your vault balance.

**Limitations** (intentional, documented):
- No volume matching (orders fill all-or-nothing at oracle price)
- No partial fills
- Keeper caps batch size at 10 to stay within Zama's 5M HCU limit per tx

### `/portfolio` — Encrypted state inspector

Three sections, all with encrypted-by-default values + reveal buttons:

1. **Wallet / vault / AMM balances**: cleartext for wallet balance (it's a regular plaintext ERC20), encrypted for vault + AMM (require user-decrypt).
2. **Open positions**: list of perp positions with size / entry price / collateral as ciphertexts. Click Reveal on each field individually.
3. **Active limit + dark orders**: your queued orders.

Each "Reveal" button kicks off a Zama KMS decrypt round-trip — only you can decrypt your own ciphertexts because they were granted to your address via `FHE.allow()` at submission time.

---

## Common workflows

### "I want to long ETH with 10× leverage"

1. Make sure you have ≥ 1000 cUSDCMock in vault and ≥ 0.01 Sepolia ETH for gas.
2. Trade page → ETH → Long → Size `1.0` (1 ETH worth at $3000) → Collateral `300` (gives you ~10× leverage on 0.1 ETH; engine math is `notional/collateral`).
3. Open. Wait for confirmation.
4. If ETH price moves up, your encrypted PnL accumulates. To see it, close the position — the engine credits the new balance, you reveal it.

### "I want to provide liquidity and earn from trader losses"

1. Liquidity page → Add → enter cUSDCMock amount → submit.
2. Reveal your share balance to confirm.
3. The AMM accumulates encrypted forfeits whenever a perp position is liquidated (the position's collateral flows into the AMM's encrypted reserve). LP shares represent claim on this growing pot.
4. To exit: Liquidity → Reveal share balance → Request Withdraw → wait ~60s for bot callback → balance credited back.

### "I want to submit a hidden buy order at a specific price"

1. Darkpool page → Submit → Long → ETH → size `0.5`, collateral `150`, **limit price `2900`** → encrypt → submit.
2. Order sits encrypted in the dark queue. Nobody — not the keeper, not the chain, not other traders — knows your $2900 trigger.
3. When the keeper batches matches and the oracle price hits or crosses $2900, your order fills via the PerpEngine executor. New position appears in your portfolio.
4. To cancel before fill: Darkpool → click your order → Cancel. Encrypted collateral refunds.

### "I want to verify the protocol works as advertised"

Visit Etherscan via the contract links table above. Each contract has its source code in the **Code** tab. The cryptographic claims you can verify visually:

- `PerpEngine.openPosition` calls only FHE primitives on user inputs — no plaintext logging.
- `NoirVault._balances` is `mapping(address => euint64)` — encrypted.
- `_onLiquidationDecided` only runs after `FHE.checkSignatures(...)` validates Zama's KMS proof.
- All `FHE.allow()` calls grant access to the user's own address — no engine ever holds persistent decrypt rights to user data.

For deeper verification, run the test suite: `cd contracts && npm test` (288 tests passing as of commit `006a485`).

---

## Running the frontend

If the team hasn't deployed a public frontend URL, run the frontend yourself locally — it'll talk to the live Sepolia contracts.

### Against Sepolia (the real deployment)

```bash
cd frontend
cp .env.example .env
```

Edit `frontend/.env`:

```
VITE_DEPLOYMENT_NETWORK=sepolia
VITE_CHAIN_ID=11155111
VITE_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
VITE_COMPLIANCE_API_URL=http://127.0.0.1:4001
```

Start the compliance backend (provides Merkle proofs):

```bash
cd compliance-backend
npm install && npm start
```

Start the frontend:

```bash
cd frontend
npm install && npm run dev
```

Visit http://127.0.0.1:5173. Connect your wallet on Sepolia.

### Against local Hardhat (development mode)

For development iteration without spending Sepolia ETH:

```bash
# Terminal 1
cd contracts && npx hardhat node

# Terminal 2 — deploy + seed
cd contracts
npx hardhat run scripts/deploy-local.ts --network localhost
npx hardhat run scripts/setup-demo.ts --network localhost

# Terminal 3 — compliance backend
cd compliance-backend && npm start

# Terminal 4 — oracle relayer (so prices stay fresh)
cd oracle-relayer && npm start

# Terminal 5 — frontend (with .env set to local mode)
cd frontend && npm run dev
```

Switch your wallet to Hardhat (chainId 31337, RPC http://127.0.0.1:8545). Import Hardhat #0 (`0xac0974…ff80`) for admin / allowlisted access.

**Local-mode caveat**: `userDecrypt` returns `0n` against the in-process FHEVM mock. Form submission, transactions, position enumeration all work; the **Reveal** buttons show 0 because the FHE mock can't roundtrip through Zama's real KMS. To see actual plaintexts on reveal, switch to Sepolia mode.

---

## FAQ / troubleshooting

### "Wrong network" pill in the header

Your wallet is on a network other than Sepolia. Click the red pill → switch to Sepolia. Or open your wallet's network selector and switch manually.

### `/compliance` shows "Not allowlisted"

You're not on the on-chain Merkle allowlist yet. Contact the admin (deployer wallet) to be added. The allowlist is rotated on-chain after each addition.

### "Oracle price stale" revert when opening a position

The oracle relayer hasn't pushed a fresh price within the staleness window (90s). Either:
- The relayer service is down — restart it, or wait for it to recover.
- You're on local Hardhat without the relayer running — start it (`cd oracle-relayer && npm start`).

### "Insufficient balance" on deposit

Your wallet doesn't hold enough cUSDCMock. See "Get test cUSDCMock" above.

### Reveal shows `0` instead of my actual value

You're running against the local FHEVM mock. Reveal works only on Sepolia (real Zama KMS). Flip `VITE_DEPLOYMENT_NETWORK=sepolia` and reload.

### Connect Wallet shows the wrong wallet (MetaMask instead of OKX, etc.)

When multiple wallet extensions are installed, they fight over `window.ethereum`. The connect modal lists each extension as a separate option — pick the one you want. If your wallet doesn't appear, set it as the "default wallet" in its own settings (e.g., OKX → Settings → Wallet → Default Wallet → on).

### My encrypted balance shows but reveal hangs

`userDecrypt` requires the Zama relayer SDK to fetch a KMS proof. On a slow network this can take 10–30 seconds. If it hangs longer than 60s, refresh the page — the SDK occasionally needs a clean reinit on first decrypt of the session.

### A transaction reverts with "NotAuthorizedEngine"

You're trying to call a function that only registered engines can call (e.g., `NoirVault.adjustBalance`). User-facing flows never trigger this — if you see it, something is calling the contract through the wrong path.

---

## Architecture deep dive

For builders who want to understand the protocol mechanics:

- **Design spec**: `docs/specs/2026-04-24-noirperp-design.md`
- **FHE primitives reference**: `docs/fhe-primitives.md`
- **Per-phase implementation plans**: `docs/plans/2026-04-2X-phase-N-*.md` (one per phase, 0–9)
- **Tier 2 audit pack**: `docs/audit/2026-04-27-*.md` (HCU benchmarks, OZ FHEVM checklist, per-contract sign-off)
- **Phase tracker**: `PROGRESS.md`
- **Change history**: `CHANGELOG.md`

---

## Glossary

| Term | Meaning |
|---|---|
| **FHEVM** | Fully Homomorphic Encryption Virtual Machine — Zama's stack of EVM precompiles that run computations on encrypted values without decrypting them. |
| **Ciphertext** / `euint64` | An encrypted 64-bit unsigned integer. Looks like `0x...` (32-byte handle) on-chain, opaque to anyone without the decryption key. |
| **KMS / Gateway** | Zama's off-chain Key Management Service that performs decryptions when contracts request them, and signs the cleartext result so the contract can verify it. |
| **`userDecrypt`** | Frontend SDK call that asks Zama's KMS to decrypt a ciphertext for the connected wallet. Only works for ciphertexts the user has been granted access to via `FHE.allow()`. |
| **`FHE.allow()`** | On-chain call that grants persistent decrypt access to a specific address for a specific ciphertext handle. NoirPerp grants only to user addresses for state they own. |
| **`FHE.isSenderAllowed()`** | Engine-side guard verifying that the caller has been granted access to a ciphertext before processing it. Defense against inference attacks. |
| **`FHESafeMath`** | NoirPerp's library wrapping `FHE.add` / `FHE.sub` with saturation. Raw FHE arithmetic wraps silently on underflow; the lib reverts or saturates. |
| **HCU** (Homomorphic Compute Units) | Zama's resource budget. 5M sequential, 20M global per tx. Heavy paths like `requestBatchMatch` at N=10 use ~4.89M. |
| **cUSDCMock** | Zama's pre-deployed confidential USDC mock on Sepolia (`0x7c5B…3639`). Wraps a regular ERC20 mock into an ERC-7984 confidential balance. |
| **Async-decrypt callback** | The two-transaction pattern for liquidations / dark-pool matches / async withdraws: tx 1 emits a decrypt request; tx 2 (signed by Zama's KMS, relayed by the bot) carries the cleartext callback. |
| **Keeper / bot** | Off-chain Node service running 4 watchers (liquidation, trigger, batch, decrypt-relay) that pushes async state forward. |
| **Relayer (oracle)** | One of 3 EOAs registered in the Oracle. 2-of-3 quorum required to commit a price update. |
| **Relayer (Zama)** | Distinct from oracle relayers — Zama's off-chain service that signs decryption proofs from the KMS. Confusing naming, sorry. |
| **Allowlist** | Merkle-tree of KYC-approved addresses. Root stored on-chain (`Compliance.merkleRoot()`); proofs served by `compliance-backend`. |
| **Forfeit** | When a position is liquidated, its collateral flows into the AMM's encrypted reserve as a "forfeit" — LPs eventually claim it via withdraw. |

---

## License

MIT. See `LICENSE` (when added).

## Where this came from

NoirPerp is a ground-up rewrite of ZKPerp (originally on Aleo) for the Zama FHEVM stack. The full design + history is in `docs/specs/2026-04-24-noirperp-design.md`, with phase-by-phase implementation plans alongside.

For questions / issues: file an issue on the repo, or reach out to the admin (`0x87E69cA0…2266`) on-chain via a confidential message wrapper of your choice.
