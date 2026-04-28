# Phase 11 — Darkpool Peer-to-Peer Pair Matching

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add genuine **peer-to-peer pair matching with partial fills + residual regeneration** to `DarkpoolEngine`, while **preserving the privacy property** that nobody — including the off-chain matcher bot — ever learns user limit prices. This closes the most-cited feature gap vs ZKPerp without weakening NoirPerp's threat model (nobody, including us, sees prices).

**Why now:** Phase 6 shipped batch matching against the Perp pool at oracle price (no partial fills, no peer-to-peer pairing — documented Phase 6 deviation #2). The Phase 9 audit + ZKPerp comparison flagged this as the most material functional gap. Phase 9 is shipped (deploy + audit + docs); Phase 10 (video/submission) is a packaging phase with no contract work; Phase 11 is the right place for this engineering.

**Architecture / approach:**

- **New darkpool order shape**: orders now store **encrypted size + encrypted collateral-per-unit + encrypted limit price**. The user computes `collateralPerUnit = totalCollateral / size` off-chain at submission time (already available — they pick both numbers when they construct the order), so the engine never needs FHE ciphertext-division. On fill, the position's collateral is `collateralPerUnit × fillSize` (one FHE multiplication, supported).
- **New matching primitive**: `submitMatchPair(buyOrderId, sellOrderId)` — bot-callable, anyone can pay gas. Engine validates plaintext invariants (opposite sides, same market, distinct owners, both active), computes `intersects = (sellLimit ≤ buyLimit)` as an `ebool`, computes `fillSize = min(buy.size, sell.size)` in FHE, marks the `intersects` ebool publicly decryptable, enqueues a `PendingMatch`, emits a handle-list event.
- **Async resolution**: when Zama Gateway returns the cleartext for `intersects`, callback `_onMatchDecided`:
  - If `intersects = false`: dequeue, refund nothing, both orders stay active.
  - If `intersects = true`: dispatch two `openPositionAsExecutor` calls via PerpEngine — one long for the buyer, one short for the seller, both at the **current oracle price** for `fillSize` size with `collateralPerUnit × fillSize` collateral. Update both orders' `size` to their residuals (`originalSize - fillSize`). The smaller order is fully consumed (residual = 0) and marked closed; the larger order remains open for further matching.
- **Privacy property preserved**: the only ciphertext ever decrypted in this whole flow is the boolean `intersects`. Limit prices, sizes, collaterals, and per-unit collaterals stay encrypted on-chain forever. The matcher bot pairs orders by inspecting **plaintext metadata only** (market, side, ownership, activity status) — it has no decrypt rights to any ciphertext field.
- **Settlement price**: oracle midpoint, not clearing-price-improvement. We deliberately do NOT decrypt the limits to compute a midpoint between them — that would leak the price range. Settlement happens at `Oracle.getPrice(marketId)` for both sides simultaneously, identical to current `requestBatchMatch` semantics. Tradeoff: no price improvement vs ZKPerp, but stronger privacy and HCU-cheaper.
- **Backward compatibility**: existing `submitOrder` + `requestBatchMatch` flows continue to work unchanged. Pair matching is **opt-in** at order submission time — users pick `submitOrderForPairMatch` if they want their order to be eligible for p2p, or stick with the legacy `submitOrder` for batch-vs-pool. This avoids a forced migration and lets us ship without breaking Phase-6 callers.

**Tech stack:**

- Solidity 0.8.27 + FHEVM v0.11.1 (no new external deps)
- TypeScript bot watcher (mirrors existing `bot/src/watchers/batch.ts` shape)
- Hardhat + FHEVM mock for tests (existing infra)

**Reference docs:**

- Spec: `docs/specs/2026-04-24-noirperp-design.md` §4.7 (DarkpoolEngine), §11 (matching design)
- FHE primitives: `docs/fhe-primitives.md` §6 (external inputs), §7 (FHE.le/select), §8 (publicly-decryptable ebool flow)
- Current Darkpool batch path: `contracts/contracts/engines/DarkpoolEngine.sol`, especially `requestBatchMatch` (line 227) and `_onBatchDecided` for the existing async-decrypt + executor pattern
- ZKPerp's `settle_match` and `partial_fill` (in `~/Desktop/ZKPerp/leo/Darkpool/`) for reference on the residual-regeneration semantic — note ZKPerp reveals limits to operator; we don't.
- Phase 6 plan: `docs/plans/2026-04-25-phase-6-darkpool-engine.md` for the existing engine design

**Spec deviations carried in (from Phase 6 → still apply unless explicitly lifted):**

1. **No volume matching across multiple counterparties in a single tx.** Phase 11 only pairs 2 orders at a time. To fill a large buy against multiple smaller sells, multiple `submitMatchPair` calls are needed.
2. **No price improvement.** Settlement at oracle price, not at midpoint of `[sellLimit, buyLimit]`. Documented above.
3. **Settlement via `PerpEngine` executor.** Phase 5 carry-forward — same pattern as `_onBatchDecided`.

**Spec deviations introduced by Phase 11:**

1. **NEW order shape for pair-eligible orders.** `submitOrderForPairMatch` takes `(eSize, eCollateralPerUnit, eLimitPrice, ...)` instead of `(eSize, eCollateral, eLimitPrice, ...)`. Users computing the order off-chain divide their intended collateral by their intended size before encrypting. Documented in NatSpec on the new function + the USER_GUIDE.md.
2. **All-or-nothing on the smaller order; residual on the larger.** Partial fills are unidirectional — only the larger order can have a residual. The smaller order is fully consumed by construction (`fillSize = min(buy.size, sell.size)` is exactly the smaller side's full size).
3. **Self-match prevention is plaintext.** `require(buyOrder.owner != sellOrder.owner)` — both owners are plaintext metadata, so this is a normal Solidity check, not FHE. A user attempting to self-match (e.g., as a wash trade probe) will see a normal revert.

**Not in scope for Phase 11 (deliberately deferred):**

- **N-way matching** — pairing 3+ orders in a single decrypt. Possible with cleverer batching but multiplies HCU cost; revisit only if pair-by-pair throughput becomes a bottleneck.
- **Frontend "browse open dark orders" page.** Users still only see their OWN orders (per privacy model); the matcher's pair-discovery is bot-side.
- **Order-book depth metrics.** No public summary statistics; would leak aggregate state.
- **MEV protection / commit-reveal.** Out-of-scope; existing dark-pool already obscures intent via FHE.

---

## Task scope summary

| # | Task | Estimated | Blocking? |
|---|---|---|---|
| 1 | Phase 11 design memo: settle decisions on collateral-per-unit, oracle-pegged settlement, residual semantics, opt-in shape | 30 min | yes — gates 2+ |
| 2 | Update `Darkpool` storage: add `collateralPerUnit` field to `Order`, add `pairMatchEligible` flag | 30 min | yes |
| 3 | Implement `submitOrderForPairMatch` external function | 90 min | yes |
| 4 | Implement `submitMatchPair(uint256 buyId, uint256 sellId)` external function (FHE intersects + fillSize computation, enqueue) | 2 hr | yes |
| 5 | Implement `_onMatchDecided` callback (Gateway-signed bool resolution + dual `openPositionAsExecutor` calls + residual updates) | 2 hr | yes |
| 6 | Bot — new `match.ts` watcher: scan active pair-eligible orders, build candidate pairs by (market, opposite-side, distinct-owner), submit `submitMatchPair` calls, exponential backoff on failed pairs | 3 hr | not deploy-blocking but tick-blocking |
| 7 | Tests — `DarkpoolEngine.MatchPair.test.ts`: 12 cases (pair found + intersects, pair found + no-intersect, partial fill leaves residual, residual matches against next pair, self-match revert, cross-market revert, same-side revert, inactive-order revert, MAX_LEVERAGE enforced on fill, callback replay-guard, both orders simultaneously closing, oracle-stale revert) | 4 hr | yes |
| 8 | Tests — `Bot.MatchWatcher.test.ts`: 5 cases (candidate-pair generation correctness, `submitMatchPair` called when candidate exists, no-intersect failure handled gracefully, residual order re-enters candidate pool, MAX_BATCH respect) | 1 hr | yes |
| 9 | Frontend — Darkpool page updates: distinguish "pair-eligible" from "batch-only" orders in submit form, show partial-fill progress on user's active orders, residual-size display | 2 hr | not deploy-blocking |
| 10 | NatSpec on all new functions + spec deviation block at top of `DarkpoolEngine.sol` | 30 min | yes — Tier 1 audit gate |
| 11 | Tier 1 audit pass — spec compliance + code quality reviewer subagents | 1 hr | yes |
| 12 | CHANGELOG.md entry + PROGRESS.md update (add Phase 11 row, tick when complete) | 15 min | yes |

**Estimated total**: 16-18 hours of focused work. Realistically 1.5-2 weeks of calendar time accounting for context switches.

---

## Detailed task breakdown

### Task 1 — Design memo (gates 2+)

**Files:**
- Create: `docs/specs/2026-04-28-darkpool-pair-match-design.md`

Write a tight 1-page design doc capturing the architectural decisions. Sections:

- **Threat model** (preserved from Phase 6 — explicit re-statement)
- **What's encrypted vs plaintext** (table of every order field)
- **Matching algorithm** (off-chain bot pair-finding + on-chain FHE intersects + fillSize)
- **Settlement semantic** (oracle-pegged, no clearing-price improvement, why)
- **Collateral-per-unit model** (why this shape vs scaled-collateral on fill)
- **Residual semantic** (smaller-order-fully-consumed pattern)
- **Failure modes table** (no-intersect, self-match, cross-market, stale oracle, MAX_LEVERAGE breach on fill)
- **HCU budget** (~535k per pair: 1 FHE.le + 1 FHE.min via select + 2 safeSub for residuals)

- [ ] **Step 1**: Draft `docs/specs/2026-04-28-darkpool-pair-match-design.md` with the sections above.
- [ ] **Step 2**: Verification — read it back, ensure every Task 2-12 implementation decision is unambiguously specified.

### Task 2 — Storage + struct changes

**Files (modify):**
- `contracts/contracts/engines/DarkpoolEngine.sol`

The existing `Order` struct (around `DarkpoolEngine.sol:90`) needs a new `collateralPerUnit` ciphertext field for pair-eligible orders, plus a `pairMatchEligible` plaintext flag. Existing legacy orders keep `collateral` set, `collateralPerUnit` empty.

- [ ] **Step 1**: Add to the `Order` struct:
  ```solidity
  euint64 collateralPerUnit; // populated only for pair-match-eligible orders
  bool    pairMatchEligible; // true → use submitMatchPair; false → use requestBatchMatch
  ```
- [ ] **Step 2**: Add a new `PendingMatch` struct mirroring `PendingDecrypt` from `requestBatchMatch`:
  ```solidity
  struct PendingMatch {
      uint256 buyId;
      uint256 sellId;
      ebool   intersects;
      euint64 fillSize;
      euint64 buyResidualSize;
      euint64 sellResidualSize;
      address requester;
  }
  mapping(uint256 => PendingMatch) internal _pendingMatches; // requestId → match
  ```
- [ ] **Step 3**: New error types: `error PairOrdersSameOwner();`, `error PairOrdersSameSide();`, `error PairOrdersDifferentMarket();`, `error PairOrderNotEligible();`, `error PairOrderInactive();`.
- [ ] **Step 4**: Compile clean: `npx hardhat compile`.

### Task 3 — `submitOrderForPairMatch`

**Files (modify):**
- `contracts/contracts/engines/DarkpoolEngine.sol`

Mirrors existing `submitOrder` but takes `eCollateralPerUnit` instead of `eCollateral`, sets `pairMatchEligible = true`. Calculates total collateral on-the-fly for the escrow lock (`totalCollateral = collateralPerUnit × size`).

- [ ] **Step 1**: Implement `submitOrderForPairMatch`:
  ```solidity
  function submitOrderForPairMatch(
      uint8 marketId,
      bool isLong,
      externalEuint64 eSize,
      externalEuint64 eCollateralPerUnit,
      externalEuint64 eLimitPrice,
      bytes calldata sizeProof,
      bytes calldata collateralPerUnitProof,
      bytes calldata limitProof,
      ComplianceProof calldata kyc
  ) external whenNotPaused returns (uint256 orderId) {
      _verifyKyc(msg.sender, kyc);
      require(_marketValid(marketId), "DarkpoolEngine: invalid market");

      euint64 size              = FHE.fromExternal(eSize, sizeProof);
      euint64 collateralPerUnit = FHE.fromExternal(eCollateralPerUnit, collateralPerUnitProof);
      euint64 limitPrice        = FHE.fromExternal(eLimitPrice, limitProof);

      require(FHE.isSenderAllowed(size),              "FHE: size sender not allowed");
      require(FHE.isSenderAllowed(collateralPerUnit), "FHE: cpu sender not allowed");
      require(FHE.isSenderAllowed(limitPrice),        "FHE: limit sender not allowed");

      // Total collateral for escrow = collateralPerUnit × size.
      euint64 totalCollateral = FHE.mul(collateralPerUnit, size);

      // Lock collateral via vault adjustBalance (engine-side ACL grant).
      FHE.allowTransient(totalCollateral, address(vault));
      vault.adjustBalance(msg.sender, totalCollateral, false /*subtract*/);

      orderId = ++_nextOrderId;
      _orders[orderId] = Order({
          owner:               msg.sender,
          marketId:            marketId,
          isLong:              isLong,
          size:                size,
          collateral:          FHE.asEuint64(0),       // not used in this path
          collateralPerUnit:   collateralPerUnit,
          limitPrice:          limitPrice,
          active:              true,
          pairMatchEligible:   true
      });

      // Persistent ACL grants to owner so they can decrypt their own state.
      FHE.allow(size,              msg.sender);
      FHE.allow(collateralPerUnit, msg.sender);
      FHE.allow(limitPrice,        msg.sender);

      emit OrderSubmitted(orderId, msg.sender, marketId, isLong, true /*pairMatchEligible*/);
  }
  ```
- [ ] **Step 2**: Update the `OrderSubmitted` event signature to include the `pairMatchEligible` bool. Existing consumers can ignore.
- [ ] **Step 3**: Update `cancelOrder` to refund correctly for both order shapes — for pair-eligible orders, refund `collateralPerUnit × size` (which is what was locked); for legacy, refund `collateral` directly.
- [ ] **Step 4**: Compile clean.

### Task 4 — `submitMatchPair`

**Files (modify):**
- `contracts/contracts/engines/DarkpoolEngine.sol`

The pair-matching entry. Bot picks two orders, calls this. FHE math, async-decrypt setup.

- [ ] **Step 1**: Implement `submitMatchPair`:
  ```solidity
  /// @notice Anyone (typically the matcher bot) can call. The pair must be:
  ///   - both pair-eligible
  ///   - both active
  ///   - same market
  ///   - opposite sides (one long, one short)
  ///   - different owners (no self-match)
  /// FHE checks intersects (sellLimit ≤ buyLimit) and fillSize = min(sizes).
  /// Marks the intersects ebool publicly decryptable; resolution happens in
  /// _onMatchDecided after Gateway returns the cleartext.
  /// @dev SPEC DEVIATION (§5.2 "$ZAMA fee"): non-payable; see CHANGELOG
  ///      2026-04-26 "$ZAMA fee question" for rationale.
  function submitMatchPair(uint256 buyId, uint256 sellId) external whenNotPaused returns (uint256 requestId) {
      Order storage buyOrder  = _orders[buyId];
      Order storage sellOrder = _orders[sellId];

      // Plaintext invariants
      if (!buyOrder.active || !sellOrder.active)                       revert PairOrderInactive();
      if (!buyOrder.pairMatchEligible || !sellOrder.pairMatchEligible) revert PairOrderNotEligible();
      if (buyOrder.owner == sellOrder.owner)                           revert PairOrdersSameOwner();
      if (buyOrder.marketId != sellOrder.marketId)                     revert PairOrdersDifferentMarket();
      if (buyOrder.isLong == sellOrder.isLong)                         revert PairOrdersSameSide();
      if (!buyOrder.isLong)                                            revert PairOrdersSameSide();
      // (canonicalize: buy = long, sell = short — caller orders them)

      // Oracle freshness
      (uint64 oraclePrice, bool fresh) = oracle.getPrice(buyOrder.marketId);
      if (!fresh) revert OraclePriceStale();

      // FHE: compute intersects + fillSize + residuals
      ebool intersects = FHE.le(sellOrder.limitPrice, buyOrder.limitPrice);

      // fillSize = min(buy.size, sell.size). FHE has no min primitive — use le + select.
      ebool   buySmaller = FHE.le(buyOrder.size, sellOrder.size);
      euint64 fillSize   = FHE.select(buySmaller, buyOrder.size, sellOrder.size);

      // Residuals — SAFE subtraction (saturating).
      euint64 buyResidual  = FHESafeMath.safeSub(buyOrder.size,  fillSize);
      euint64 sellResidual = FHESafeMath.safeSub(sellOrder.size, fillSize);

      // Pre-compute residual-zero ebools. We bundle these into the SAME
      // Gateway decrypt as `intersects` (Approach B locked in design):
      // the Gateway returns 3 booleans in one round-trip, the callback
      // applies fills + closes exhausted orders atomically. No second
      // decrypt request needed; reuses the existing `_decodeBatch` helper
      // that already handles N-bool flat-tuple cleartexts (see
      // _onBatchDecided at line 308).
      ebool buyResidualZero  = FHE.eq(buyResidual,  FHE.asEuint64(0));
      ebool sellResidualZero = FHE.eq(sellResidual, FHE.asEuint64(0));

      // ACL grants: engine reads these in the callback.
      FHE.allowThis(intersects);
      FHE.allowThis(fillSize);
      FHE.allowThis(buyResidual);
      FHE.allowThis(sellResidual);
      FHE.allowThis(buyResidualZero);
      FHE.allowThis(sellResidualZero);

      // Mark all 3 booleans publicly decryptable.
      FHE.makePubliclyDecryptable(intersects);
      FHE.makePubliclyDecryptable(buyResidualZero);
      FHE.makePubliclyDecryptable(sellResidualZero);

      // Enqueue the pending match — the handle list passed to the Gateway
      // determines the cleartext order: [intersects, buyResidualZero,
      // sellResidualZero], decoded by index in the callback.
      requestId = uint256(keccak256(abi.encode(buyId, sellId, block.number, block.timestamp)));
      bytes32[] memory handles = new bytes32[](3);
      handles[0] = ebool.unwrap(intersects);
      handles[1] = ebool.unwrap(buyResidualZero);
      handles[2] = ebool.unwrap(sellResidualZero);
      _enqueueMulti(requestId, handles);  // new helper alongside _enqueue
      _pendingMatches[requestId] = PendingMatch({
          buyId:            buyId,
          sellId:           sellId,
          intersects:       intersects,
          fillSize:         fillSize,
          buyResidualSize:  buyResidual,
          sellResidualSize: sellResidual,
          buyResidualZero:  buyResidualZero,
          sellResidualZero: sellResidualZero,
          requester:        msg.sender
      });

      emit MatchProposed(requestId, buyId, sellId, msg.sender);
  }

  event MatchProposed(uint256 indexed requestId, uint256 indexed buyId, uint256 indexed sellId, address requester);
  ```

  Note: `PendingMatch` struct (Task 2) needs the two extra ebool fields
  `buyResidualZero` and `sellResidualZero`. The `_enqueueMulti` helper
  is a small extension of `DecryptQueue._enqueue` that accepts a handle
  list of length > 1 — if `DecryptQueue.sol` only supports single-handle
  enqueue, extend it (Task 2.5, ~10 lines).
- [ ] **Step 2**: Add the import / wiring for `FHESafeMath.safeSub` if not already imported into `DarkpoolEngine.sol`.
- [ ] **Step 3**: Compile clean.

### Task 5 — `_onMatchDecided` callback

**Files (modify):**
- `contracts/contracts/engines/DarkpoolEngine.sol`

- [ ] **Step 1**: Implement the canonical Gateway callback (Approach B —
      3-bool batched decrypt):
  ```solidity
  /// @notice Gateway callback for a pair-match decision. The Gateway
  ///         returns 3 booleans atomically: [intersects, buyResidualZero,
  ///         sellResidualZero]. This single decrypt is enough to settle
  ///         the match AND mark exhausted orders inactive.
  /// @dev Canonical pattern: checkSignatures → _dequeue → external work.
  ///      Reuses _decodeBatch (line 308) for the flat-tuple cleartext
  ///      encoding that the existing _onBatchDecided already validates
  ///      against the mock Gateway + production KMSVerifier.
  function _onMatchDecided(
      uint256 requestId,
      bytes32[] memory handlesList,
      bytes memory cleartexts,
      bytes memory decryptionProof
  ) external {
      FHE.checkSignatures(handlesList, cleartexts, decryptionProof);
      _dequeue(requestId);                       // replay guard
      PendingMatch memory m = _pendingMatches[requestId];
      delete _pendingMatches[requestId];

      // Decode 3 booleans: [intersects, buyResidualZero, sellResidualZero]
      uint256[] memory bits = _decodeBatch(cleartexts, 3);
      bool intersects       = bits[0] != 0;
      bool buyResidualZero  = bits[1] != 0;
      bool sellResidualZero = bits[2] != 0;

      if (!intersects) {
          emit MatchRejected(requestId, m.buyId, m.sellId);
          return;                                // both orders remain active
      }

      Order storage buyOrder  = _orders[m.buyId];
      Order storage sellOrder = _orders[m.sellId];

      (uint64 oraclePrice, bool fresh) = oracle.getPrice(buyOrder.marketId);
      if (!fresh) revert OraclePriceStale();

      // Per-side filled collateral = collateralPerUnit × fillSize.
      euint64 buyFilledColl  = FHE.mul(buyOrder.collateralPerUnit,  m.fillSize);
      euint64 sellFilledColl = FHE.mul(sellOrder.collateralPerUnit, m.fillSize);

      // ACL transient to PerpEngine for the executor calls.
      FHE.allowTransient(m.fillSize,    address(perp));
      FHE.allowTransient(buyFilledColl, address(perp));
      FHE.allowTransient(sellFilledColl, address(perp));

      // Open both positions at the same oracle price.
      perp.openPositionAsExecutor(buyOrder.owner,  buyOrder.marketId,  true,  m.fillSize, buyFilledColl,  oraclePrice);
      perp.openPositionAsExecutor(sellOrder.owner, sellOrder.marketId, false, m.fillSize, sellFilledColl, oraclePrice);

      // Update sizes to residuals; close fully-consumed orders atomically.
      buyOrder.size   = m.buyResidualSize;
      sellOrder.size  = m.sellResidualSize;
      if (buyResidualZero)  { buyOrder.active  = false; emit OrderClosed(m.buyId,  "filled"); }
      if (sellResidualZero) { sellOrder.active = false; emit OrderClosed(m.sellId, "filled"); }

      emit MatchSettled(requestId, m.buyId, m.sellId, m.fillSize, m.requester);
  }

  event MatchRejected (uint256 indexed requestId, uint256 indexed buyId, uint256 indexed sellId);
  event MatchSettled  (uint256 indexed requestId, uint256 indexed buyId, uint256 indexed sellId, euint64 fillSize, address indexed settler);
  event OrderClosed   (uint256 indexed orderId, string reason);
  ```

  ### (the original code-block continues below — this just replaces the
  ### single-bool decrypt portion with the 3-bool batched version)
  ### REMOVED: the older "we DON'T await another decrypt here" note —
  ### Approach B explicitly DOES batch everything into one decrypt.

- [ ] **Step 2**: Verify `PerpEngine.openPositionAsExecutor` accepts the `(owner, marketId, isLong, sizeCt, collateralCt, oraclePrice)` shape. If not, adjust the call (this is identical to how `_onBatchDecided` already calls it).
- [ ] **Step 3**: Compile clean.

### Task 6 — Bot match watcher

**Files (create):**
- `bot/src/watchers/match.ts`

Mirrors `bot/src/watchers/batch.ts` but for pair discovery. The bot maintains an in-memory list of `(orderId, owner, marketId, isLong, pairMatchEligible)` tuples by listening to `OrderSubmitted` events; on each tick, generates candidate pairs and calls `submitMatchPair`.

- [ ] **Step 1**: New file `bot/src/watchers/match.ts`:
  ```typescript
  import { Contract, JsonRpcProvider, Wallet } from "ethers";
  import type { Logger, BotState } from "../state.js";

  type DarkOrder = {
    id: bigint;
    owner: string;
    marketId: number;
    isLong: boolean;
    pairMatchEligible: boolean;
    active: boolean;
  };

  export async function startMatchWatcher(
    darkpool: Contract,
    signer: Wallet,
    logger: Logger,
    state: BotState,
  ): Promise<void> {
    // Load existing orders via OrderSubmitted event scan since deploy.
    // For each new OrderSubmitted: track it.
    // Every tick (5s): generate candidate pairs, submit, handle reverts gracefully.
    // ... (~80 lines mirroring batch.ts shape)
  }
  ```
- [ ] **Step 2**: Wire into `bot/src/index.ts` alongside the existing 4 watchers. Bot now has 5 watchers: liquidation, trigger, batch, decrypt-relay, match.
- [ ] **Step 3**: Add candidate-pair generation logic — naive O(N²) over active pair-eligible orders, filtered by `(market, opposite-side, distinct-owner)`. Submit one pair per tick to avoid HCU contention; if the pair fails (no-intersect), exponentially back off retrying that specific pair for ~10 minutes.
- [ ] **Step 4**: Add unit test stub `bot/test/match.test.ts` (Task 8 fills it in).

### Task 7 — Solidity tests

**Files (create):**
- `contracts/test/DarkpoolEngine.MatchPair.test.ts`

12 test cases as listed in the scope summary. Use the existing test harness (`fhevm-mock` from Hardhat plugin). Each `describe` block uses fresh deploy + setup via `loadFixture`.

- [ ] **Step 1**: Implement all 12 tests with explicit assertions. Pattern follows existing `DarkpoolEngine.BatchMatch.test.ts`.
- [ ] **Step 2**: Run `npx hardhat test --grep "MatchPair"` — all green.
- [ ] **Step 3**: Verify coverage on `DarkpoolEngine.sol`: `npx hardhat coverage` → ≥90% stmts on the new functions.

### Task 8 — Bot tests

**Files (create):**
- `bot/test/match.test.ts`

5 tests for the watcher: candidate-pair correctness, submission on candidate found, no-intersect graceful handling, residual order re-entry, MAX_BATCH discipline. Use vitest mocks for the ethers contracts.

- [ ] **Step 1**: Implement 5 tests.
- [ ] **Step 2**: `npm test` in `bot/` — green.

### Task 9 — Frontend updates

**Files (modify):**
- `frontend/src/pages/Darkpool.tsx`
- `frontend/src/hooks/useDarkOrders.ts`
- `frontend/src/lib/abis.ts`

- [ ] **Step 1**: Update `DARK_ABI` to include `submitOrderForPairMatch` + `MatchProposed` / `MatchSettled` / `MatchRejected` events.
- [ ] **Step 2**: Add a toggle on the Darkpool submit form: "Eligible for peer-to-peer matching" (default on for v0.2). When checked, the encryption flow encrypts `(size, collateralPerUnit = collateral / size, limitPrice)` and calls `submitOrderForPairMatch`. When unchecked, falls back to the existing `submitOrder`.
- [ ] **Step 3**: Update "My active orders" table to show partial-fill progress — query current encrypted size vs original size, indicate remaining quantity. Reveal button decrypts current size.
- [ ] **Step 4**: TypeScript clean: `npm run lint`.

### Task 10 — NatSpec

**Files (modify):**
- `contracts/contracts/engines/DarkpoolEngine.sol` (top-of-file deviation block + per-function comments)

- [ ] **Step 1**: Add a top-of-file `/// @dev SPEC DEVIATIONS:` block summarizing the 3 Phase-11 deviations introduced.
- [ ] **Step 2**: NatSpec on every new public function: purpose, params, threat-model preserved property, HCU estimate, links to design doc.

### Task 11 — Tier 1 audit

Two-reviewer pass before Phase 11 ticks:

- [ ] **Step 1**: Spawn the **spec-compliance reviewer** subagent: hand it the design doc + DarkpoolEngine.sol + tests, ask "did the implementation match the design? List discrepancies." Fix critical/important findings before proceeding.
- [ ] **Step 2**: Spawn the **code-quality reviewer** subagent: hand it the same plus FHE primitive rules from CLAUDE.md, ask "find real bugs and code-quality issues; ignore false positives from FHEVM-specific patterns." Fix critical/important.

### Task 12 — CHANGELOG + PROGRESS

**Files (modify):**
- `CHANGELOG.md` (new entry)
- `PROGRESS.md` (new Phase 11 row)

- [ ] **Step 1**: CHANGELOG entry: deployed addresses unchanged (this is a contract upgrade — old `DarkpoolEngine` stays live; new behavior is added in a redeploy or v2 contract). Document deviations introduced. Verification numbers (test count, coverage).
- [ ] **Step 2**: PROGRESS.md: add `[ ] Phase 11 — Darkpool peer-to-peer pair matching` row with completion criteria summary. Tick when all 12 tasks pass.

---

## Acceptance criteria (✅ tick conditions)

Per `PROGRESS.md`, Phase 11 ticks only when:

1. **All tasks 1–12** complete with tests green.
2. **All tests pass**: 326 (current) + ~17 new (12 Solidity MatchPair + 5 bot match) = ~343 total.
3. **Coverage**: ≥90% stmts/funcs/lines + ≥80% branches on the new DarkpoolEngine functions.
4. **Tier 1 audit**: both reviewers green; critical + important findings resolved.
5. **CHANGELOG.md** entry documenting what shipped + 3 new spec deviations.
6. **Branch merged** to `master` via fast-forward.
7. **Re-deploy on Sepolia** with the upgraded `DarkpoolEngine` (new addresses written to `deployments/sepolia.json`); verify on Etherscan.

Phase 12 (or whatever's next) does not start until Phase 11 is ticked.

---

## Pre-mainnet hardening (out-of-scope for Phase 11 tick)

- **N-way matching** for higher throughput once base pair-matching proves itself.
- **Fee accrual on matched volume** — flat percentage of fillSize × oraclePrice, encrypted credit to AMM forfeit pool.
- **Order expiry / TTL** — pair-eligible orders auto-cancel after N blocks if no match found.
- **MEV-resistant submission** — commit-reveal on the orderId pair so a malicious frontrunner can't observe `MatchProposed` and try to disrupt.

---

## Failure modes that should be caught by tests

1. **Self-match attempt**: Alice submits both buy and sell from her own address; bot tries to pair them; engine reverts `PairOrdersSameOwner`. ✅ Test 7.5.
2. **Cross-market**: bot pairs a BTC long with an ETH short. Engine reverts `PairOrdersDifferentMarket`. ✅ Test 7.6.
3. **Same-side**: bot pairs two longs (or two shorts). Engine reverts `PairOrdersSameSide`. ✅ Test 7.7.
4. **Inactive order**: one of the orders was already cancelled. Engine reverts `PairOrderInactive`. ✅ Test 7.8.
5. **Non-eligible order**: bot tries to pair a legacy `submitOrder` (batch-only) with a pair-eligible order. Engine reverts `PairOrderNotEligible`. ✅ Test 7.4.
6. **No intersect**: prices don't overlap (sellLimit > buyLimit). `_onMatchDecided` cleartext = false → both orders remain active, `MatchRejected` event emitted. ✅ Test 7.2.
7. **Partial fill correctness**: buy.size = 10, sell.size = 7. fillSize should be 7; buyResidual should be 3; sellResidual should be 0. ✅ Test 7.3.
8. **Residual rematches**: after partial fill, the residual buy.size = 3 should be eligible for a new pair (a smaller seller of size ≤ 3). ✅ Test 7.4.
9. **Stale oracle**: pair submitted but oracle price is stale → revert `OraclePriceStale`. ✅ Test 7.12.
10. **MAX_LEVERAGE breach on fill**: collateral × fillSize / oraclePrice produces a position above max leverage. The PerpEngine.openPositionAsExecutor's existing check should silent-zero the position (open a zero-size, zero-collateral position) — verify this matches expectations. ✅ Test 7.9.
11. **Replay**: Gateway sends the same `_onMatchDecided` callback twice. Second call should revert via `_dequeue`. ✅ Test 7.10.
12. **Concurrent close**: while `submitMatchPair` is in-flight (decrypt pending), one of the orders is cancelled. The pair should still resolve — the Order.active = false flag is checked at `submitMatchPair` time, but on callback we proceed regardless (the cancel'd order had its collateral refunded already; the residual update is a no-op on a closed order). Document this in the test. ✅ Test 7.11.

---

## Notes for the implementing agent

- **Keep the existing `requestBatchMatch` flow untouched.** Phase 11 is additive: new `submitOrderForPairMatch` + new `submitMatchPair` + new `_onMatchDecided`. The legacy `submitOrder` + `requestBatchMatch` + `_onBatchDecided` keep working for users who don't opt into pair-matching.
- **Do NOT add ciphertext/ciphertext division anywhere** — CLAUDE.md rule 2. The collateral-per-unit shape is specifically designed to avoid this.
- **Every external ciphertext input gets `FHE.isSenderAllowed`.** No exceptions. CLAUDE.md rule 4.
- **Use `FHESafeMath.safeSub` for residual computation.** Raw `FHE.sub` wraps silently. CLAUDE.md rule 3.
- **The callback ordering is `checkSignatures → _dequeue → external`.** CLAUDE.md rule 6.
- **HCU budget**: total compute per `submitMatchPair` is ~535k HCU sequential (1× FHE.le for intersects + 1× FHE.le + 1× FHE.select for min + 2× FHESafeMath.safeSub for residuals). Far under the 5M sequential limit. The callback adds 2× FHE.mul (~634k HCU total) which keeps under 5M. ✅
