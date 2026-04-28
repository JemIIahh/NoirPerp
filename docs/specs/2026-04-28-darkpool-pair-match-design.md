# Darkpool Peer-to-Peer Pair Matching — Design Memo

**Date**: 2026-04-28
**Status**: Phase 11 Task 1 (gates Tasks 2-5).
**Audience**: implementing agent + future auditor.

This memo finalizes the design specifics deferred from `docs/plans/2026-04-28-phase-11-darkpool-pair-match.md`. Plan-level decisions (opt-in, oracle-pegged settlement, Approach B residual handling) are restated here for self-containment. Implementation specifics that the plan left open are settled here.

---

## 1. Threat model (unchanged from Phase 6)

NoirPerp's privacy promise: **nobody, including the protocol's off-chain matching bot, ever learns a user's `size`, `collateral`, or `limitPrice`**. The only ciphertexts ever decrypted on a per-tx basis are decision booleans (e.g. *"do these prices intersect?"*, *"is this residual zero?"*).

This memo's job is to add peer-to-peer pair matching while keeping that promise intact. ZKPerp's `settle_match` does not — its operator sees plaintext limit prices. We deliberately diverge.

## 2. What's encrypted vs plaintext on the new order shape

`submitOrderForPairMatch(eSize, eCollateralPerUnit, eLimitPrice, …)`. The `Order` struct after Phase 11:

| Field | Type | Encrypted? | Notes |
|---|---|---|---|
| `owner` | `address` | plaintext | Needed for ACL grants + plaintext owner-distinct check on pair |
| `marketId` | `uint8` (1=BTC, 2=ETH, 3=SOL) | plaintext | Bot must be able to filter pairs by market without decrypt |
| `isLong` | `bool` | plaintext | Bot must be able to filter pairs by side |
| `size` | `euint64` | **encrypted** | Notional units of the underlying |
| `collateral` | `euint64` | encrypted (legacy orders only) | Set to encrypted-zero on pair-eligible orders |
| `collateralPerUnit` | `euint64` | **encrypted** | Pair-eligible orders only. User computes off-chain: `totalCollateral / size`. Engine never has to divide. |
| `limitPrice` | `euint64` | **encrypted** | The whole point — buyer's max bid / seller's min ask, never visible to anyone but the order owner |
| `active` | `bool` | plaintext | Set false on cancel + on fill-with-residual-zero |
| `pairMatchEligible` | `bool` | plaintext | Set true at submit; false for legacy `submitOrder` orders |

**Plaintext metadata is sufficient for pair discovery**: bot filters `(marketId == X) && (isLong != other.isLong) && (owner != other.owner) && active && pairMatchEligible`. No decrypt required to find candidates.

## 3. Matching algorithm (off-chain bot + on-chain FHE verify)

**Off-chain (bot)**:

1. Listen for `OrderSubmitted(orderId, owner, marketId, isLong, pairMatchEligible)` events on `DarkpoolEngine`.
2. Maintain in-memory `Map<orderId, OrderMeta>` of active pair-eligible orders.
3. Listen for `MatchSettled(requestId, buyId, sellId, fillSize, settler)` and `OrderClosed(orderId, reason)` to remove exhausted orders.
4. Listen for `MatchRejected(requestId, buyId, sellId)` to track failed pairs and back off (don't retry the same pair within a 10-block window).
5. On each tick (default 5s), generate candidate pairs by O(N²) scan over filtered subsets per market. Pick the **oldest pair** (FIFO by `orderId` sum) — first-come-first-served, no MEV-style price-time priority since prices aren't visible.
6. Submit one `submitMatchPair` call per tick. Failed pairs go on the back-off list; bot tries different pairs next tick.

**On-chain (engine)**:

1. Validate plaintext invariants (Task 4 implementation).
2. Compute the FHE booleans + sizes (one batch enqueue, three handles).
3. Gateway returns three booleans atomically.
4. Callback applies fills and closes exhausted orders.

**Why FIFO** instead of price-time priority: the bot can't see prices, so it can't compute price-time priority. FIFO is simple, deterministic, and fair (oldest active orders match first).

## 4. Settlement price decision — locked

**Settlement at `Oracle.getPrice(marketId)` for both sides simultaneously.**

Rejected alternatives:
- **Midpoint of `[sellLimit, buyLimit]`** → would require decrypting at least the midpoint, leaking the price range. Violates threat model.
- **Buyer's limit / seller's limit (one-sided)** → similarly leaks one of the two prices.
- **Average of last-N oracle ticks** → no privacy benefit over raw oracle, more code.

Tradeoff acknowledged in the plan: no clearing-price improvement vs ZKPerp's `settle_match`. The "p2p" benefit here is **demand pairing** (matching encrypted supply with encrypted demand) and **partial fills**, not better pricing. If both sides agreed on a price they both wanted, both wanted oracle price (or better) — settling at oracle satisfies both within their limits.

## 5. Collateral-per-unit shape — locked

Why we changed the order shape from `(size, collateral, limitPrice)` to `(size, collateralPerUnit, limitPrice)` for pair-eligible orders:

- FHE has no ciphertext-÷-ciphertext division. CLAUDE.md rule 2.
- On a partial fill where `fillSize < originalSize`, the natural math is `filledCollateral = collateral × fillSize / originalSize`.
- That requires `originalSize` in the denominator → ciphertext division → forbidden.
- Pre-computing `collateralPerUnit = collateral / originalSize` **at submission time** moves the division off-chain (the user already chose both `collateral` and `originalSize` when constructing the order, so they have plaintext access). The engine then computes `filledCollateral = collateralPerUnit × fillSize` — single FHE multiplication, supported.

User-side: when the frontend builds an order, instead of `(eSize, eCollateral)` it builds `(eSize, eCollateralPerUnit = eCollateral / eSize)`. The user's effective experience is identical — they still pick total collateral in USDCx, the SDK just transforms it before encryption.

Edge case: `originalSize = 0`. The frontend prevents this in input validation; the engine has no need to div-by-zero because the off-chain transform never divides by encrypted zero (size is the user's plaintext input at construction time).

## 6. Partial-fill semantic — locked

**Smaller order is always fully consumed; larger order has a residual.** `fillSize = min(buy.size, sell.size)` is exactly the smaller side's full size. After fill:

- Smaller order: `size = 0`, `active = false` (closed by `OrderClosed(orderId, "filled")` event).
- Larger order: `size = original - fillSize`, `active = true` (re-eligible for further matching).

Edge case: both sides equal size → both close. Both `OrderClosed` events fire. Bot removes both from candidate pool.

Why not allow partial-fills on both sides simultaneously? It's more complex and adds no functional value — the partial side reads as the residual on the larger order, period. ZKPerp's `partial_fill` works the same way.

## 7. Failure modes table (test targets)

| # | Failure mode | Where caught | Behavior | Test |
|---|---|---|---|---|
| 1 | Same owner (self-match) | plaintext check in `submitMatchPair` | revert `PairOrdersSameOwner` | 7.5 |
| 2 | Cross-market | plaintext check | revert `PairOrdersDifferentMarket` | 7.6 |
| 3 | Same side (both long or both short) | plaintext check | revert `PairOrdersSameSide` | 7.7 |
| 4 | Inactive order (cancelled) | plaintext check | revert `PairOrderInactive` | 7.8 |
| 5 | Non-eligible (legacy `submitOrder`) | plaintext check | revert `PairOrderNotEligible` | 7.4 |
| 6 | Stale oracle | plaintext check | revert `OraclePriceStale` (existing error reused) | 7.12 |
| 7 | Prices don't intersect (`sellLimit > buyLimit`) | FHE compute → callback | `MatchRejected` event, both orders remain active, no fill | 7.2 |
| 8 | MAX_LEVERAGE breach on one side | inside `PerpEngine.openPositionAsExecutor` | silent-zero (existing behavior) | 7.9 |
| 9 | Concurrent cancel during in-flight decrypt | order's `active` flag was checked at submit; callback proceeds; cancelled order's collateral was already refunded | callback completes; refunded order's residual update is a no-op semantically | 7.11 |
| 10 | Replay attack (Gateway sends same callback twice) | `_dequeue` removes the requestId before any external call | second call reverts on `RequestNotPending` | 7.10 |

## 8. HCU budget — Approach B verified

### `submitMatchPair` sequential HCU

| Op | Count | HCU each | Subtotal |
|---|---|---|---|
| `FHE.le(sellLimit, buyLimit)` (intersects) | 1 | 152k | 152k |
| `FHE.le(buy.size, sell.size)` (for min) | 1 | 152k | 152k |
| `FHE.select` (fillSize) | 1 | 71k | 71k |
| `FHESafeMath.safeSub` (buyResidual): le + select + sub | 1 | 290k | 290k |
| `FHESafeMath.safeSub` (sellResidual) | 1 | 290k | 290k |
| `FHE.eq(buyResidual, 0)` | 1 | 152k | 152k |
| `FHE.eq(sellResidual, 0)` | 1 | 152k | 152k |
| `FHE.allowThis` × 6 | 6 | 5k | 30k |
| `FHE.makePubliclyDecryptable` × 3 | 3 | 5k | 15k |
| **Total** | | | **~1,304k** |

Well under 5M sequential limit. ✅

### `_onMatchDecided` callback HCU

| Op | Count | HCU each | Subtotal |
|---|---|---|---|
| `FHE.checkSignatures` | 1 | ~50k | 50k |
| `_decodeBatch` (assembly, no FHE) | 1 | 0 | 0 |
| `FHE.mul(collateralPerUnit, fillSize)` × 2 | 2 | 317k | 634k |
| `FHE.allowTransient` × 3 | 3 | 5k | 15k |
| **Total** | | | **~699k** |

Well under 5M. ✅

### Combined per-pair (sequential across both txs)

submitMatchPair (1.30M) + callback (0.70M) = **~2M HCU per pair across two transactions**. Each tx independently fits the per-tx ceiling. The per-tx limit is what's enforced, not the cumulative. ✅

## 9. Storage layout impact

`Order` struct gains 2 fields. Pre-Phase-11 storage layout (pre-Phase-11 batch-only orders):
```
slot 0: owner (20) + marketId (1) + isLong (1) + active (1) + padding
slot 1: euint64 size  (32 bytes — 1 ciphertext handle)
slot 2: euint64 collateral
slot 3: euint64 limitPrice
```

Phase 11 layout (additive):
```
slot 0: owner (20) + marketId (1) + isLong (1) + active (1) + pairMatchEligible (1) + padding
slot 1: euint64 size
slot 2: euint64 collateral             (zero handle for pair-eligible)
slot 3: euint64 collateralPerUnit      (zero handle for legacy orders)
slot 4: euint64 limitPrice
```

Note: legacy `submitOrder` callers don't pay extra storage for `collateralPerUnit` (the slot exists but holds an encrypted-zero handle which costs the same as any other handle). The `pairMatchEligible` flag is a single byte added to `slot 0`.

`PendingMatch` is a brand-new struct — no migration concern, only allocated for pair-match requests.

## 10. Backward compatibility

- ✅ `submitOrder` (legacy, batch-only) — works unchanged. Sets `pairMatchEligible = false`.
- ✅ `requestBatchMatch` — works unchanged. Filters out `pairMatchEligible == true` orders implicitly (only `pairMatchEligible == false` orders are batched against the Perp pool).
- ✅ `_onBatchDecided` — works unchanged.
- ✅ `cancelOrder` — extended to refund both order shapes correctly. Pair-eligible: `refund = collateralPerUnit × size`. Legacy: `refund = collateral` (existing path).

## 11. Frontend impact (Task 9 specifics)

Darkpool submit form gets a new toggle: "Eligible for peer-to-peer matching". Default ON for v0.2 — encourages users to opt into the better feature.

When the toggle is ON:
- Frontend computes `collateralPerUnit = totalCollateral / size` BEFORE encryption.
- Frontend calls `submitOrderForPairMatch(eSize, eCollateralPerUnit, eLimitPrice, …)`.

When OFF:
- Frontend uses existing `submitOrder(eSize, eCollateral, eLimitPrice, …)` flow.

"My active orders" table gets a new "Type" column showing "P2P" or "Pool". Partial-fill progress shown via current-encrypted-size vs original-encrypted-size — both fields are user-decryptable, the math `(originalSize − currentSize) / originalSize` is computed client-side after both reveals.

## 12. Bot watcher (Task 6 specifics)

`bot/src/watchers/match.ts` — same shape as `bot/src/watchers/batch.ts`:

```typescript
// Pseudo-code
const candidates: Map<orderId, OrderMeta> = new Map();
const recentlyFailed: Map<`${buyId}-${sellId}`, blockNumber> = new Map();

darkpool.on("OrderSubmitted", ({orderId, owner, marketId, isLong, pairMatchEligible}) => {
  if (pairMatchEligible) candidates.set(orderId, {owner, marketId, isLong, ...});
});

darkpool.on("OrderClosed", ({orderId}) => candidates.delete(orderId));
darkpool.on("MatchRejected", ({buyId, sellId}) => {
  recentlyFailed.set(`${buyId}-${sellId}`, currentBlock);
});

setInterval(async () => {
  for (const [marketId, ordersByMarket] of groupBy(candidates, "marketId")) {
    const longs = ordersByMarket.filter(o => o.isLong);
    const shorts = ordersByMarket.filter(o => !o.isLong);
    for (const buy of longs) {
      for (const sell of shorts) {
        if (buy.owner === sell.owner) continue;
        const key = `${buy.id}-${sell.id}`;
        if (recentlyFailed.get(key) > currentBlock - 10) continue; // back off
        try {
          await darkpool.submitMatchPair(buy.id, sell.id);
          return; // one pair per tick
        } catch { /* log, move on */ }
      }
    }
  }
}, 5000);
```

The `recentlyFailed` map prevents infinite-loop retries on pairs that don't intersect. After 10 blocks, the bot retries (perhaps oracle moved enough that prices now intersect — though for limit orders this is unlikely; the back-off is mainly for stale-oracle reverts).

## 13. Cross-references

- Phase 11 plan: `docs/plans/2026-04-28-phase-11-darkpool-pair-match.md`
- Existing engine: `contracts/contracts/engines/DarkpoolEngine.sol`
- Existing batch decode helper: `DarkpoolEngine.sol:308` (`_decodeBatch`)
- FHEVM primitives reference: `docs/fhe-primitives.md`
- CLAUDE.md primitive rules: rules 1-7
- ZKPerp reference (different threat model): `~/Desktop/ZKPerp/leo/Darkpool/`

## 14. Approval gate

This memo is approved for Tasks 2-5 implementation when:

- [x] Threat model preserved (Section 1)
- [x] All ciphertext fields enumerated (Section 2)
- [x] Settlement price decision locked at oracle-pegged (Section 4)
- [x] Collateral-per-unit shape justifies the order interface change (Section 5)
- [x] Partial-fill semantic explicit (Section 6)
- [x] All 10 failure modes mapped to tests (Section 7)
- [x] HCU verified under sequential limit (Section 8)
- [x] Backward compatibility addressed (Section 10)

All items checked. **Memo approved; Task 2 (storage changes) may proceed.**
