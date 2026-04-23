# NoirPerp — Design Spec

**Status**: Approved by CTO (Ram), 2026-04-24
**Target**: Zama Developer Program — Mainnet Season 2, Builder Track
**Submission deadline**: 2026-05-10, 23:59 AOE
**Deployment target**: Ethereum Sepolia testnet
**Repo**: `/Users/ram/Desktop/NoirPerp/`

---

## 1. Executive summary

NoirPerp is a privacy-preserving perpetual-futures DEX built on Zama's FHEVM. Position size, collateral, entry price, PnL, leverage, and order details remain encrypted end-to-end. All sensitive state transitions are computed on ciphertexts using Fully Homomorphic Encryption; only final decision bits (e.g., *"should this position be liquidated?"*) are decrypted, via Zama's Gateway KMS.

It is a ground-up rewrite of **ZKPerp** (originally built on Aleo using zero-knowledge records) adapted to FHEVM's fundamentally different primitive model. The rewrite is not a syntactic port — Aleo's encrypted-record paradigm has no direct FHEVM analog, so the state model, commitment scheme, orchestrator trust model, and execution flow have all been redesigned.

### What we build
- 6 smart-contract modules (1 vault + 4 engines + 2 services) on Sepolia FHEVM v0.12.1
- 3-relayer Chainlink price oracle with 2-of-3 quorum
- Off-chain liveness bot (liquidator + TP/SL + match trigger)
- Merkle-tree compliance allowlist backend
- React + Vite frontend (5 pages) using `@zama-fhe/relayer-sdk`

### Key improvements over ZKPerp (Aleo)
1. **Removes trusted-orchestrator PnL aggregation** — engines compute margin on ciphertexts; orchestrator is reduced to a liveness provider that can only *point* the contract at a position, never lie about its state.
2. **No more v21 variable-ceiling problem** — FHEVM has no Aleo-style per-program variable cap.
3. **No record-accumulation UI slowdown** — ciphertexts live in contract storage, not user wallet records.
4. **Simplified commitment model** — FHEVM's encrypted storage eliminates the BHP256 `position_commit` hash scheme ZKPerp needed for Aleo `finalize` leakage protection.

---

## 2. Scope

### In scope (Phase 0 – Phase 10)
- Smart contracts: `NoirVault`, 4 engines (`Perp`, `AMM`, `Darkpool`, `Limit`), 2 services (`Oracle`, `Compliance`), 4 shared libs
- 3 markets: BTC/USD, ETH/USD, SOL/USD
- Off-chain: orchestrator bot, 3-relayer oracle quorum, compliance Merkle backend
- Frontend: Trade, Liquidity, Darkpool, Portfolio, Compliance pages
- Testnet deployment on Sepolia
- Documentation, 3-minute real-person pitch video, program submission

### Out of scope (deferred to post-submission)
- Ethereum mainnet deployment
- Formal verification (informal audit + Slither + Mythril only)
- Cross-chain bridges
- Social recovery / key management UI
- More than 3 markets
- Advanced order types beyond TP/SL/limit (OCO, trailing stops)
- Governance token / DAO

---

## 3. Architectural approach

**Pattern**: Layered Vault + Engines (Approach 3)

The vault owns all ciphertext state. Engines are stateless logic contracts that request transient ACL permits (`FHE.allowTransient`, EIP-1153 transient storage) from the vault, compute new state entirely in FHE, and write results back through the vault's authorized-engine mutator interface.

### Diagram

```
┌──────────────────────────────────────────────────────────────┐
│                    NoirVault.sol                             │
│                (sole owner of ciphertext state)              │
│                                                              │
│  mapping(address => euint64)       usdcxBalance              │
│  mapping(uint256 => Position)      positions                 │
│  mapping(uint256 => Order)         orders                    │
│  mapping(uint256 => LPPosition)    lpPositions               │
│  mapping(address => bool)          authorizedEngines         │
│                                                              │
│  grantTransient(engine, ct[])     → chain allowTransient     │
│  writePosition(id, Position)       only authorized engines   │
│  closePosition(id)                 only authorized engines   │
│  adjustBalance(user, delta, ±)     only authorized engines   │
│  pause() / unpause()               multisig (OZ Pausable)    │
└──────┬────────────┬────────────┬──────────────┬──────────────┘
       │            │            │              │
       │ allowTransient (single tx, EIP-1153, free)
       │            │            │              │
 ┌─────▼─────┐┌─────▼─────┐┌─────▼──────┐┌──────▼─────┐
 │PerpEngine ││AMMEngine  ││DarkpoolEng.││LimitEngine │
 │open       ││mintPos    ││submitOrder ││placeLimit  │
 │close (sync)│burnPos    ││reqBatchMat.││reqTrigger  │
 │reqLiq     ││swap       ││_onMatch... ││_onTrig...  │
 │_onLiq...  ││           ││            ││            │
 └─────┬─────┘└───────────┘└────────────┘└────────────┘
       │                                        │
       │        (services — public, stateless)  │
       │                                        │
  ┌────▼────────┐                        ┌──────▼─────────┐
  │ Oracle.sol  │                        │ Compliance.sol │
  │ 2-of-3 CL   │                        │ Merkle proof   │
  │ price feed  │                        │ KYC allowlist  │
  └─────────────┘                        └────────────────┘

  lib/  (stateless, reusable)
   ├── FHESafeMath.sol   select-guarded add/sub (prevents silent underflow)
   ├── MarginMath.sol    multiplication-only margin / PnL formulas
   ├── TickMath.sol      UniV3-style ticks for AMM
   └── DecryptQueue.sol  async callback state machine + replay guard
```

### Trust model (Model D — orchestrator as liveness provider)

- **Vault holds all ciphertext state.** No engine, bot, or admin holds user funds.
- **Engines compute in FHE.** Margin checks, PnL, matching clears — all evaluated on ciphertexts. No off-chain decryption of user state.
- **Orchestrator (off-chain bot)** is a *liveness provider*: it calls `requestLiquidation(positionId)` or `requestTrigger(orderId)`. The engine then evaluates the condition on ciphertexts and requests Gateway decryption of the *result bit only*. Bot cannot fake a price or fabricate a position — it can only choose *which* position to point the contract at (or choose not to).
- **Gateway KMS** decrypts only final decision bits (`ebool`) or user-side payouts. User-side decryption (e.g., "show me my balance") uses Relayer SDK's `userDecrypt`, which requires the user's own signature.
- **Admin functions** (engine registration, oracle relayer rotation, compliance root updates) gated by Safe multi-sig (2-of-3 on Sepolia).

### Three architectural invariants

1. **No engine ever holds ciphertext user state longer than one transaction.** All engine-side permits are `allowTransient` (tx-scoped, auto-cleared via EIP-1153 transient storage).
2. **Every FHE op that consumes an oracle price uses an Oracle-signed, freshness-checked ciphertext.** Engines `require(oracle.isFresh(marketId))` before any price-dependent math.
3. **Admin functions are multisig-gated.** No single key can pause contracts, change compliance root, or deregister engines.

---

## 4. Component specification

### 4.1 `NoirVault.sol`

**Purpose**: Sole owner of ciphertext state. No funds ever leave the vault except through authorized-engine-invoked mutations.

**State**:
- `mapping(address user => euint64) usdcxBalance` — encrypted USDCx (ERC-7984) balances
- `mapping(uint256 positionId => Position) positions`
  - `Position { euint64 size; euint64 entryPrice; euint64 collateral; bool isLong; uint8 marketId; address owner; bool active; }`
- `mapping(uint256 orderId => Order) orders` — used by Darkpool + Limit engines
- `mapping(uint256 lpId => LPPosition) lpPositions` — AMM LP positions
- `mapping(address engine => bool) authorizedEngines`
- `uint256 nextPositionId; uint256 nextOrderId; uint256 nextLpId;`
- OZ `Pausable` state

**External functions**:
- `registerEngine(address engine)` — multisig-gated admin
- `deregisterEngine(address engine)` — multisig-gated
- `grantTransient(address engine, euint64[] calldata cts)` — called by engines at tx entry to chain `FHE.allowTransient` across vault + engine
- `writePosition(uint256 id, Position memory p)` — `onlyAuthorizedEngine`
- `closePosition(uint256 id)` — `onlyAuthorizedEngine`; sets `active=false`
- `adjustBalance(address user, euint64 delta, bool isCredit)` — `onlyAuthorizedEngine`; invariant: sum of encrypted balances must equal vault's cUSDC holdings (enforced via invariant test harness)
- `pause()` / `unpause()` — multisig
- View: `getPosition(uint256 id)`, `getBalance(address user)`

**Dependencies**: `@openzeppelin/confidential-contracts@0.4.0` (ERC-7984 interface), `@fhevm/solidity@^0.11.1`, `SepoliaConfig`, OZ `Pausable`, OZ `AccessControl` or `Ownable2Step`.

### 4.2 `PerpEngine.sol`

**Purpose**: Perpetual positions — open, close, liquidate.

**Config (immutable or governable)**:
- `uint64 MAX_LEVERAGE = 20` (20×)
- `uint64 MAINTENANCE_MARGIN_BPS = 500` (5%)
- `uint64 LIQUIDATOR_FEE_BPS = 50` (0.5%)

**Functions**:
- `openPosition(externalEuint64 eSize, bytes inputProof1, externalEuint64 eCollateral, bytes inputProof2, bool isLong, uint8 marketId, bytes32[] calldata complianceProof) → uint256 positionId` — **synchronous**; uses `FHE.select` to silently zero-out if margin insufficient
- `closePosition(uint256 positionId) → void` — **synchronous**; computes encrypted PnL via multiplication-only formulas, transfers payout via ERC-7984
- `requestLiquidation(uint256 positionId) → uint256 requestId` — **async**; bot-called; pays Gateway decrypt fee in $ZAMA
- `_onLiquidationDecided(uint256 requestId, bytes cleartexts, bytes decryptionProof)` — KMS callback; executes liquidation if `ebool` decrypts to true

**Dependencies**: `NoirVault`, `Oracle`, `Compliance`, `lib/FHESafeMath`, `lib/MarginMath`, `lib/DecryptQueue`.

### 4.3 `AMMEngine.sol`

**Purpose**: UniV3-style concentrated-liquidity AMM for USDCx/WETH pair. LP positions provide collateral reserves for perp liquidations + earn swap fees.

**Functions**:
- `mintPosition(int24 tickLower, int24 tickUpper, externalEuint64 eAmount0, bytes proof0, externalEuint64 eAmount1, bytes proof1) → uint256 lpId`
- `burnPosition(uint256 lpId) → void` — synchronous; computes encrypted payouts
- `swap(bool zeroForOne, externalEuint64 eAmountIn, bytes proof) → void` — synchronous; updates reserves in FHE
- View: `getPoolState()` → public reserves snapshot (decrypt-on-request for display only)

**Dependencies**: `NoirVault`, `lib/TickMath`, `lib/FHESafeMath`.

### 4.4 `DarkpoolEngine.sol`

**Purpose**: Batch-auction dark pool for large orders. Orders accumulate encrypted; clear at uniform price; individual order sizes/limits never visible on-chain.

**Functions**:
- `submitOrder(externalEuint64 eSize, bytes proof1, externalEuint64 eLimit, bytes proof2, bool isBuy) → uint256 orderId`
- `requestBatchMatch(uint256[] calldata orderIds) → uint256 requestId` — async; settler-called
- `_onMatchDecided(uint256 requestId, bytes cleartexts, bytes decryptionProof)` — callback; clears matched orders at uniform price
- `cancelOrder(uint256 orderId) → void` — synchronous; refunds locked collateral

**Dependencies**: `NoirVault`, `Oracle`, `lib/FHESafeMath`, `lib/DecryptQueue`.

### 4.5 `LimitEngine.sol`

**Purpose**: Take-profit, stop-loss, and resting-limit orders. Bot-triggered when oracle price crosses encrypted trigger.

**Functions**:
- `placeLimit(externalEuint64 eTrigger, bytes proof1, externalEuint64 eSize, bytes proof2, uint8 orderType, bool isLong, uint8 marketId) → uint256 orderId`
  - `orderType`: 1=TP, 2=SL, 3=Limit
- `requestTrigger(uint256 orderId) → uint256 requestId` — async; bot-called
- `_onTriggerDecided(uint256 requestId, bytes cleartexts, bytes decryptionProof)` — callback; if true, invokes `PerpEngine.openPosition` internally
- `cancelLimit(uint256 orderId) → void`

**Dependencies**: `NoirVault`, `Oracle`, `PerpEngine` (internal call on trigger execution), `lib/DecryptQueue`.

### 4.6 `Oracle.sol`

**Purpose**: 2-of-3 Chainlink relayer consensus. Public price + on-demand trivial encryption for FHE comparisons.

**State**:
- `mapping(uint8 marketId => PriceData) prices` — `PriceData { uint64 price; uint64 timestamp; uint8 confirmations; uint64 pendingPrice; address pendingRelayer; }`
- `address[3] relayers`
- `uint256 public stalenessSeconds = 90`

**Functions**:
- `submitPrice(uint8 marketId, uint64 price, uint64 timestamp, bytes calldata sig)` — relayer-only; requires 2nd confirmation from a different relayer within a window before commit
- `getPrice(uint8 marketId) → (uint64 price, bool fresh)` — public view
- `getEncryptedPrice(uint8 marketId) → euint64` — trivial encrypt of latest fresh price via `FHE.asEuint64` (32 HCU, effectively free)
- Admin (multisig): `rotateRelayer(uint8 idx, address newRelayer)`, `setStalenessSeconds(uint256)`

### 4.7 `Compliance.sol`

**Purpose**: Merkle-tree KYC allowlist (OFAC / region blocking). Binary on-chain gate; heavy lifting off-chain.

**State**:
- `bytes32 merkleRoot`
- `uint256 rootUpdatedAt`
- `mapping(address user => bool) revoked`

**Functions**:
- `updateRoot(bytes32 newRoot)` — multisig
- `verify(address user, bytes32[] calldata proof) → bool` — view; checks proof + not revoked
- `revoke(address user)` — multisig
- `unrevoke(address user)` — multisig

### 4.8 Shared libs

- **`lib/FHESafeMath.sol`** — `safeSub(euint64 a, euint64 b)` returns `FHE.select(FHE.le(b, a), FHE.sub(a, b), FHE.asEuint64(0))`. Same pattern for `safeAdd`. Also `absDiff(euint64 a, euint64 b)` returns the larger-minus-smaller via `FHE.select(FHE.ge(a, b), FHE.sub(a, b), FHE.sub(b, a))`. Prevents silent underflow (per OZ FHEVM security guide).
- **`lib/MarginMath.sol`** — all margin/PnL formulas in multiplication-only form:
  - Margin check: `collateral × MAX_LEVERAGE >= size × price` (instead of `collateral / (size × price) >= 1/MAX_LEVERAGE`)
  - PnL long: `pnl = size × (currentPrice - entryPrice)`
  - PnL short: `pnl = size × (entryPrice - currentPrice)`
  - Notional: `notional = size × entryPrice`
  - Liquidation condition: `unrealizedLoss × BPS_DIVISOR >= collateral × MAINT_BPS` (mult-only)
- **`lib/TickMath.sol`** — ported from UniV3 (MIT-licensed, public domain math). Pure functions, no FHE.
- **`lib/DecryptQueue.sol`** — shared async-decrypt state machine:
  - `struct PendingDecrypt { address caller; uint256 contextId; bytes context; uint64 requestedAt; }`
  - `enqueue(uint256 reqId, ...)`, `dequeue(uint256 reqId)` (deletes entry BEFORE callback runs external calls — replay guard)
  - `timeoutWindow = 10 minutes`; stale entries can be garbage-collected by anyone

---

## 5. Data flows

### 5.1 Flow A — Open Position (synchronous)

1. User encrypts `size` + `collateral` client-side via `@zama-fhe/relayer-sdk`. Returns `externalEuint64 + bytes inputProof`.
2. User calls `PerpEngine.openPosition(...)`.
3. Engine:
   a. `FHE.fromExternal(eSize, proof1)` + same for `eCollateral` — imports with ZK proof of knowledge.
   b. `require(FHE.isSenderAllowed(eSize))` + same for `eCollateral` — inference-attack guard.
   c. `require(compliance.verify(msg.sender, complianceProof))`.
   d. `(uint64 price, bool fresh) = oracle.getPrice(marketId); require(fresh);`
   e. `euint64 ePrice = oracle.getEncryptedPrice(marketId)` — trivial encrypt.
   f. `ebool marginOK = FHE.ge(FHE.mul(eCollateral, MAX_LEVERAGE), FHE.mul(eSize, ePrice))`
   g. `euint64 effectiveCollateral = FHE.select(marginOK, eCollateral, FHE.asEuint64(0))`
   h. `euint64 effectiveSize = FHE.select(marginOK, eSize, FHE.asEuint64(0))`
   i. `cUSDC.confidentialTransferFrom(msg.sender, address(vault), effectiveCollateral)` — ERC-7984.
   j. `vault.writePosition(newId, Position{...effectiveSize, ePrice, effectiveCollateral, isLong, marketId, msg.sender, active:true})`.
   k. Emit `PositionOpened(positionId, owner)`.
4. User learns outcome by `FHE.userDecrypt` on their own position client-side (Relayer SDK, sub-second).

**UX**: single tx confirmation (~15s on Sepolia). If margin insufficient, encrypted state silently zeros out — user sees "position = 0" on decrypt, balance unchanged.

### 5.2 Flow B — Liquidation (asynchronous, 2-phase)

1. Bot monitors oracle prices. On significant adverse move (configurable threshold, e.g., 3%+), calls `PerpEngine.requestLiquidation(positionId)` with $ZAMA fee.
2. Engine:
   a. Loads `Position p` from vault.
   b. `euint64 notional = FHE.mul(p.size, p.entryPrice)`
   c. `euint64 currentValue = FHE.mul(p.size, ePrice)`
   d. `ebool inLoss = p.isLong ? FHE.lt(currentValue, notional) : FHE.gt(currentValue, notional)`
   e. `euint64 unrealizedLoss = FHE.select(inLoss, FHESafeMath.absDiff(currentValue, notional), FHE.asEuint64(0))`
   f. `ebool underwater = FHE.ge(FHE.mul(unrealizedLoss, BPS_DIVISOR), FHE.mul(p.collateral, MAINT_BPS))`
   g. `uint256 reqId = FHE.requestDecryption([FHE.toBytes32(underwater)], this._onLiquidationDecided.selector)` — payable.
   h. `DecryptQueue.enqueue(reqId, {caller: msg.sender, positionId, requestedAt: block.timestamp})`.
3. KMS fulfills in 15-60s. Callback `_onLiquidationDecided(reqId, cleartexts, proof)`:
   a. `FHE.checkSignatures(reqId, cleartexts, proof)` — verify authenticity.
   b. `bool shouldLiq = abi.decode(cleartexts, (bool))`
   c. `PendingDecrypt memory ctx = DecryptQueue.dequeue(reqId)` — **replay guard before external calls**.
   d. If `shouldLiq`:
      - `vault.closePosition(ctx.positionId)` — marks inactive.
      - Transfer collateral + small liquidation fee from position to LP pool; liquidator keeper receives `LIQUIDATOR_FEE_BPS` of collateral.
      - Emit `Liquidated(positionId, keeper)`.
   e. Else:
      - Emit `LiquidationChecked(positionId)` — no-op; keeper consumed gas + fee, must pick better signal next time.

### 5.3 Flow C — Close Position (synchronous)

1. User calls `PerpEngine.closePosition(positionId)`.
2. Engine:
   a. Loads position; `require(p.owner == msg.sender && p.active)`.
   b. `euint64 ePrice = oracle.getEncryptedPrice(p.marketId)`.
   c. Compute encrypted profit + loss branches separately (multiplication-only, both ≥ 0):
      - For long: `isProfit = FHE.ge(ePrice, p.entryPrice)`; `priceUp = FHESafeMath.safeSub(ePrice, p.entryPrice)`; `priceDown = FHESafeMath.safeSub(p.entryPrice, ePrice)`.
      - For short: inverted (`isProfit = FHE.le(ePrice, p.entryPrice)`; branches flipped).
      - `euint64 eProfit = FHE.select(isProfit, FHE.mul(p.size, priceUp), FHE.asEuint64(0))`
      - `euint64 eLoss   = FHE.select(isProfit, FHE.asEuint64(0), FHE.mul(p.size, priceDown))`
   d. `euint64 ePayout = FHESafeMath.safeAdd(FHESafeMath.safeSub(p.collateral, eLoss), eProfit)` — loss subtracted from collateral first (floored at 0 via safeSub), then profit added. Negative PnL that exceeds collateral results in 0 payout.
   e. `vault.closePosition(positionId)`.
   f. `cUSDC.confidentialTransfer(msg.sender, ePayout)` from vault.
3. User calls `FHE.userDecrypt` on their updated balance client-side → sees realized amount.

### 5.4 Flow D — Oracle price update

1. 3 relayers independently read Chainlink feeds:
   - BTC/USD: `0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c` (Ethereum mainnet Chainlink)
   - ETH/USD: `0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419` (Ethereum mainnet)
   - SOL/USD: `0x24ceA4b8ce57cdA5058b924B9B9987992450590c` (Arbitrum mainnet)
2. Each relayer signs `(marketId, price, timestamp)` with their allowlisted secp256k1 key, submits `Oracle.submitPrice(...)` on Sepolia.
3. Contract logic: first submission stored as `pending`. Second submission from a *different* relayer within `stalenessSeconds` and within a price-deviation tolerance (e.g., ≤0.5%) commits the price; `confirmations = 2`. Third submission (if different relayer) bumps to `confirmations = 3`.
4. `getPrice` returns `fresh=true` iff `confirmations >= 2 && block.timestamp - timestamp <= stalenessSeconds`.

### 5.5 Flow E — Compliance onboarding

1. User submits KYC via off-chain compliance-backend (identity provider TBD — Sumsub, Persona, or similar stub for testnet).
2. Admin (multisig) approves, adds address to Merkle tree off-chain.
3. Backend rebuilds Merkle tree, publishes new root; admin calls `Compliance.updateRoot(newRoot)` via multisig.
4. User pulls their Merkle proof from backend API.
5. On `PerpEngine.openPosition`, user includes proof; `Compliance.verify(user, proof)` gates access.

---

## 6. Error handling & safety

| Risk | Mitigation | Enforcement |
|---|---|---|
| Silent FHE underflow | `FHESafeMath.safeSub` + `safeAdd` | Lint rule: no raw `FHE.sub` outside lib |
| Inference attack via malicious engine | `require(FHE.isSenderAllowed(ct))` at every engine entry | `_guardInputs(ct[])` helper enforced in every public engine function |
| ACL leak via persistent `allow` | Only `allowTransient` in engine paths; persistent `allow` only inside vault for its own state | Security checklist item; Slither custom rule |
| Decrypt callback replay | `DecryptQueue.dequeue(reqId)` called **before** any external call in callback | Documented pattern in `lib/DecryptQueue`; reviewed in every callback |
| Stale oracle price | `Oracle.getPrice` returns `(price, fresh)`; engines `require(fresh)` | Manual audit + invariant test |
| Reorg pre-finality disclosure | 3-block confirmation delay before liquidation callback acts on decrypted result | Configurable in `DecryptQueue` |
| Engine upgrade race | Multisig `deregisterEngine` revokes all future `grantTransient`; in-flight txs complete under old engine | Upgrade procedure documented in `docs/runbooks/` |
| Emergency | `NoirVault.emergencyPause()` cascades to all engines via `vault.paused()` check | OZ `Pausable` on every engine mutation |
| Compliance root stale | `Compliance.updateRoot` tracks `rootUpdatedAt`; UI warns if >7 days | Frontend check |
| ERC-7984 silent-zero transfer | Post-transfer, verify encrypted delta via `FHE.select`; reject position if delta == 0 | In every transfer path |
| Unchecked HCU budget | Per-function HCU budget documented; CI benchmark enforces ≤5M sequential / 20M global | CI step in Phase 9 |
| User loses key | **Not mitigated** — FHE state is not recoverable | UI surfaces warning on first deposit |

---

## 7. Testing strategy

**Layers**:
1. **Unit tests** (Hardhat + FHEVM mock): every public function, every branch. Mock FHEVM auto-fulfills decrypt callbacks. Target ≥90% coverage per engine.
2. **Integration tests** (Hardhat + `--network sepolia`): end-to-end happy paths per flow (open→close, open→liquidate, LP mint→swap→burn, darkpool submit→match).
3. **Invariant tests** (Foundry): property-based —
   - Invariant 1: `sum of encrypted usdcxBalance == vault's cUSDC holdings` (verified via test-env `publicDecrypt`)
   - Invariant 2: `no position has collateral == 0 && active == true`
   - Invariant 3: `liquidation only fires when decrypt returns true`
   - Invariant 4: `cancelled orders refund exactly the locked amount`
4. **Fuzz tests** (Foundry): random encrypted inputs, random sequences of open/close/liquidate.
5. **HCU benchmarking**: per-op HCU measured in CI; regression >10% fails build.
6. **Security analyzers**: Slither on every PR, Mythril weekly, manual OZ FHEVM Security Guide walkthrough before each phase sign-off.
7. **Live Sepolia soak**: post-Phase-3 deploy; bot + oracle run continuously; metrics dashboard.

**Out of scope**: mainnet fork, formal verification.

---

## 8. Repo layout

```
/Users/ram/Desktop/NoirPerp/
├── README.md                    # product + usage + setup
├── CLAUDE.md                    # PINNED RULES for agents editing this repo
├── CHANGELOG.md                 # every change logged BEFORE commit
├── PROGRESS.md                  # phase checklist — agent writes ✅ on completion
├── .claude/settings.local.json  # permission allowlist
├── contracts/
│   ├── NoirVault.sol
│   ├── engines/{Perp,AMM,Darkpool,Limit}Engine.sol
│   ├── services/{Oracle,Compliance}.sol
│   ├── lib/{FHESafeMath,MarginMath,TickMath,DecryptQueue}.sol
│   ├── test/
│   ├── scripts/{deploy-sepolia,verify}.ts
│   ├── hardhat.config.ts, foundry.toml, package.json
├── frontend/                    # React + Vite + wagmi + @zama-fhe/relayer-sdk
│   └── src/pages/{Trade,Liquidity,Darkpool,Portfolio,Compliance}.tsx
├── bot/                         # orchestrator (liquidator + TP/SL + match trigger)
├── oracle-relayer/              # 3-relayer Chainlink quorum service
├── compliance-backend/          # Merkle allowlist API
├── docs/
│   ├── specs/2026-04-24-noirperp-design.md     # THIS DOCUMENT
│   ├── plans/2026-04-24-noirperp-implementation.md
│   ├── architecture.md
│   ├── fhe-primitives.md        # LIVING DOC: FHEVM ops, HCU costs, version pins
│   └── security-checklist.md    # OZ FHEVM guide applied to NoirPerp
├── assets/
└── render.yaml                  # bot + oracle deploy config
```

---

## 9. Anti-hallucination guardrails

### Pillar 1 — `CLAUDE.md` (pinned rules that load every session)

- FHEVM API namespace is `FHE.*` — never `TFHE.*` (deprecated since v0.9)
- Token standard is ERC-7984 via `@openzeppelin/confidential-contracts@0.4.0` — never `ConfidentialERC20`
- `FHE.div(euint64, euint64)` does not exist — formulate all ratio checks as multiplications
- Every engine entry requires `FHE.isSenderAllowed(ct)` guard
- All decryption callbacks must `DecryptQueue.dequeue(reqId)` BEFORE external calls
- Changes require a `CHANGELOG.md` entry BEFORE commit
- Phase complete = `PROGRESS.md` ✅ + tests green + CHANGELOG entry
- Never change FHE primitive assumptions without re-verifying `docs/fhe-primitives.md`

### Pillar 2 — `docs/fhe-primitives.md` (living source of truth)

- FHEVM v0.12.1 ops table with HCU costs (copied from verified docs recon)
- Pinned package versions: `@fhevm/solidity@^0.11.1`, `@fhevm/hardhat-plugin@^0.4.2`, `@zama-fhe/relayer-sdk@^0.4.2`, `@openzeppelin/confidential-contracts@0.4.0`
- Sepolia KMS address, coprocessor address, HCU limit contract address
- Re-verified by an agent before any major design change
- Any agent tempted to "assume" a primitive MUST read this first

### Pillar 3 — `CHANGELOG.md` (Predictoor pattern)

Every change entry includes:
- What broke or needed adding
- Root cause
- What was tried
- What fixed it
- Files changed

Purpose: prevent re-fixing already-fixed bugs; prevent re-visiting solved design decisions.

### Pillar 4 — `.claude/settings.local.json` (BlindPay pattern)

Permission allowlist for Claude Code:
- Bash: `npm run *`, `npx hardhat *`, `forge *`, `git add/commit/push`, `mkdir -p *`
- WebFetch: `docs.zama.org`, `community.zama.org`, `docs.openzeppelin.com`, `github.com/zama-ai`, `github.com/OpenZeppelin`
- Blocks arbitrary destructive commands by default

---

## 10. Phase roadmap (checkbox-tracked, no day counts)

- [ ] **Phase 0 — Scaffolding & guardrails**
  - Repo init, git setup
  - `CLAUDE.md`, `CHANGELOG.md`, `PROGRESS.md`, `docs/fhe-primitives.md`, `.claude/settings.local.json`
  - Hardhat + FHEVM plugin + Foundry skeleton
  - Package installs, basic config, smoke test of `FHE.asEuint64` on local FHEVM mock
- [ ] **Phase 1 — Shared libs**
  - `FHESafeMath.sol` + tests
  - `MarginMath.sol` + tests
  - `TickMath.sol` + tests
  - `DecryptQueue.sol` + tests
  - *(Gates all engine work.)*
- [ ] **Phase 2 — Vault + services**
  - `NoirVault.sol` + tests
  - `Oracle.sol` + tests (2-of-3 quorum)
  - `Compliance.sol` + tests (Merkle proof)
  - Deploy to local FHEVM mock + Sepolia dry run
- [ ] **Phase 3 — PerpEngine**
  - Open/close/liquidate for 3 markets (BTC/ETH/SOL)
  - Unit + integration tests
  - Sepolia deploy; bot-triggered liquidation end-to-end
- [ ] **Phase 4 — AMMEngine**
  - Mint/burn/swap with UniV3 ticks
  - Tests + Sepolia deploy
- [ ] **Phase 5 — LimitEngine**
  - TP/SL/limit order placement + bot-triggered execution
  - Tests + Sepolia deploy
- [ ] **Phase 6 — DarkpoolEngine**
  - Batch auction + uniform clearing price
  - Tests + Sepolia deploy
- [ ] **Phase 7 — Off-chain services**
  - Orchestrator bot (liquidator, trigger, match)
  - 3-relayer oracle service
  - Compliance-backend (Merkle API)
  - Render deploy
- [ ] **Phase 8 — Frontend**
  - 5 pages (Trade, Liquidity, Darkpool, Portfolio, Compliance)
  - Wagmi + Zama Relayer SDK integration
  - Vercel deploy
- [ ] **Phase 9 — Integration + audit**
  - Full-flow E2E on Sepolia
  - Slither + Mythril + OZ security checklist walk
  - Invariant + fuzz test runs
  - HCU regression checks
- [ ] **Phase 10 — Docs + video + submission**
  - README polish
  - 3-minute real-person pitch video (no AI voice per program rules)
  - Program submission form

**Rule**: Phase N+1 begins only when Phase N is checked ✅ in `PROGRESS.md`, all tests pass, and `CHANGELOG.md` has the completion entry.

---

## 11. Open questions / deferred decisions

1. **Identity provider for compliance** — Sumsub, Persona, or stub for testnet? *Recommend stub for submission; real provider post-submission.*
2. **Liquidator incentive source** — LP pool or protocol reserve? *Recommend LP pool (flows out of liquidated collateral, no protocol reserve needed for testnet).*
3. **Darkpool settlement price source** — mid-quote from oracle, or VWAP of submitted orders? *Recommend mid-quote oracle for simplicity.*
4. **Funding rate** — Phase 3 scope or deferred? *Recommend deferred; document as v2. Perp without funding is acceptable for a testnet demo.*
5. **Multi-collateral** — stick with cUSDC only, or add WETH? *Recommend cUSDC only for v1.*

---

## 12. References

- [Zama Protocol docs](https://docs.zama.org/protocol)
- [FHEVM GitHub](https://github.com/zama-ai/fhevm) — v0.12.1 (Apr 14, 2026)
- [OpenZeppelin Confidential Contracts](https://github.com/OpenZeppelin/openzeppelin-confidential-contracts) — v0.4.0
- [OpenZeppelin FHEVM Security Guide](https://www.openzeppelin.com/news/a-developers-guide-to-fhevm-security)
- [Zama Developer Program — Builder Track](https://www.zama.org/developer-hub#developer-program)
- ZKPerp (Aleo) — original implementation at `/Users/ram/Desktop/ZKPerp/`
- BlindPay — FHEVM reference project at `/Users/ram/Desktop/BlindPay/` (doc patterns + stack reference)

---

**End of design spec.** Next: `writing-plans` skill produces the numbered implementation plan from this document.
