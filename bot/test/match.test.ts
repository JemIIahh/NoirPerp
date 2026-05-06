import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  pickCandidatePair,
  runMatchTick,
  pairKey,
  BACKOFF_BLOCKS,
  type PairOrderRef,
  type RecentlyFailed,
} from "../src/watchers/match.js";
import { TrackedSet } from "../src/state.js";

function makeLogger() {
  return {
    info:  vi.fn(),
    error: vi.fn(),
    warn:  vi.fn(),
    debug: vi.fn(),
  };
}

// Mocks the slim subset of an ethers Contract used by runMatchTick:
//   - submitMatchPair(buyId, sellId) → { wait() }
//   - runner.provider.getBlockNumber() → number
function makeDarkRW(currentBlock = 100) {
  const submitMatchPair = vi.fn();
  const getBlockNumber = vi.fn().mockResolvedValue(currentBlock);
  return {
    submitMatchPair,
    getBlockNumber,
    runner: { provider: { getBlockNumber } },
  };
}

const ALICE   = "0xAaaA1111111111111111111111111111111111aA";
const BOB     = "0xBbbB2222222222222222222222222222222222bB";
const CHARLIE = "0xCccC3333333333333333333333333333333333cC";

const longBuy  = (id: bigint, owner: string, marketId = 2): PairOrderRef =>
  ({ orderId: id, owner, marketId, isLong: true });
const shortSell = (id: bigint, owner: string, marketId = 2): PairOrderRef =>
  ({ orderId: id, owner, marketId, isLong: false });

describe("match watcher — pickCandidatePair", () => {
  it("returns a viable cross-side, distinct-owner pair when one exists", async () => {
    const tracked = [longBuy(1n, ALICE), shortSell(2n, BOB)];
    const recentlyFailed: RecentlyFailed = new Map();
    const pick = pickCandidatePair(tracked, recentlyFailed, 100n);
    expect(pick).not.toBeUndefined();
    expect(pick!.buy.orderId).toBe(1n);
    expect(pick!.sell.orderId).toBe(2n);
  });

  it("rejects same-side, same-owner, and cross-market pairs (correctness)", async () => {
    // same-side only (two longs)
    let pick = pickCandidatePair(
      [longBuy(1n, ALICE), longBuy(2n, BOB)],
      new Map(),
      100n,
    );
    expect(pick).toBeUndefined();

    // same-owner only
    pick = pickCandidatePair(
      [longBuy(1n, ALICE), shortSell(2n, ALICE)],
      new Map(),
      100n,
    );
    expect(pick).toBeUndefined();

    // cross-market only (BTC=1 vs ETH=2)
    pick = pickCandidatePair(
      [longBuy(1n, ALICE, 1), shortSell(2n, BOB, 2)],
      new Map(),
      100n,
    );
    expect(pick).toBeUndefined();

    // multi-market: two viable pairs in different markets — picks lowest-sum first
    pick = pickCandidatePair(
      [
        longBuy(10n, ALICE, 1), shortSell(11n, BOB, 1),  // BTC pair, sum 21
        longBuy(20n, ALICE, 2), shortSell(21n, BOB, 2),  // ETH pair, sum 41
      ],
      new Map(),
      100n,
    );
    expect(pick).not.toBeUndefined();
    expect(pick!.buy.orderId).toBe(10n);
    expect(pick!.sell.orderId).toBe(11n);
  });

  it("skips pairs in the recentlyFailed back-off window and falls through to the next viable pair", async () => {
    // One buy from alice, two sells (from bob + charlie). With pair (1,2) in
    // back-off, the only viable fall-through is (1,3). Avoids sum-tie ambiguity
    // that arises when multiple buys × multiple sells produce equal-sum pairs.
    const tracked = [longBuy(1n, ALICE), shortSell(2n, BOB), shortSell(3n, CHARLIE)];
    const recentlyFailed: RecentlyFailed = new Map();
    recentlyFailed.set(pairKey(1n, 2n), 95n);

    // Within back-off window (100 - 95 = 5 < BACKOFF_BLOCKS=10) → skip (1,2), pick (1,3)
    let pick = pickCandidatePair(tracked, recentlyFailed, 100n);
    expect(pick).not.toBeUndefined();
    expect(pick!.buy.orderId).toBe(1n);
    expect(pick!.sell.orderId).toBe(3n);

    // Past back-off window → (1,2) eligible again, FIFO picks lower-sum pair
    pick = pickCandidatePair(tracked, recentlyFailed, 95n + BACKOFF_BLOCKS);
    expect(pick).not.toBeUndefined();
    expect(pick!.sell.orderId).toBe(2n);
  });
});

describe("match watcher — runMatchTick", () => {
  let darkRW: ReturnType<typeof makeDarkRW>;
  let logger: ReturnType<typeof makeLogger>;
  let tracked: TrackedSet<PairOrderRef>;
  let recentlyFailed: RecentlyFailed;

  beforeEach(() => {
    darkRW = makeDarkRW(100);
    darkRW.submitMatchPair.mockResolvedValue({ wait: vi.fn().mockResolvedValue(undefined) });
    logger = makeLogger();
    tracked = new TrackedSet<PairOrderRef>();
    recentlyFailed = new Map();
  });

  it("calls submitMatchPair exactly once per tick when a viable pair exists (MAX_PAIRS_PER_TICK = 1)", async () => {
    // Three viable pairs in the same market — would all match if not capped.
    tracked.add(longBuy(1n, ALICE));
    tracked.add(longBuy(3n, ALICE));
    tracked.add(longBuy(5n, ALICE));
    tracked.add(shortSell(2n, BOB));
    tracked.add(shortSell(4n, BOB));
    tracked.add(shortSell(6n, BOB));

    await runMatchTick(darkRW as any, tracked, recentlyFailed, logger as any);

    expect(darkRW.submitMatchPair).toHaveBeenCalledTimes(1);
    // FIFO: oldest pair (1,2) wins (lowest orderId-sum)
    expect(darkRW.submitMatchPair).toHaveBeenCalledWith(1n, 2n);
    expect(recentlyFailed.size).toBe(0);  // success → no back-off
  });

  it("records back-off and logs error when submitMatchPair reverts", async () => {
    tracked.add(longBuy(1n, ALICE));
    tracked.add(shortSell(2n, BOB));
    darkRW.submitMatchPair.mockRejectedValueOnce(new Error("PairOrdersSameSide"));

    await runMatchTick(darkRW as any, tracked, recentlyFailed, logger as any);

    expect(darkRW.submitMatchPair).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalled();
    expect(recentlyFailed.get(pairKey(1n, 2n))).toBe(100n);  // back-off recorded at current block
  });

  it("does NOT record back-off when submitMatchPair reverts with OraclePriceStale (transient on Sepolia)", async () => {
    tracked.add(longBuy(1n, ALICE));
    tracked.add(shortSell(2n, BOB));
    // ethers v6 attaches the revert selector as `err.data` on CALL_EXCEPTION.
    // 0x08b9f95b = keccak256("OraclePriceStale()")[:4] — verified live 2026-05-05.
    const stale = Object.assign(new Error("execution reverted"), { data: "0x08b9f95b" });
    darkRW.submitMatchPair.mockRejectedValueOnce(stale);

    await runMatchTick(darkRW as any, tracked, recentlyFailed, logger as any);

    expect(darkRW.submitMatchPair).toHaveBeenCalledTimes(1);
    expect(recentlyFailed.size).toBe(0);  // transient → no back-off, will retry next tick
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("residual order re-enters the candidate pool and gets matched on the next tick", async () => {
    // Initial: large buy (id 1) + small sell (id 2) → pair (1,2)
    tracked.add(longBuy(1n, ALICE));
    tracked.add(shortSell(2n, BOB));

    await runMatchTick(darkRW as any, tracked, recentlyFailed, logger as any);
    expect(darkRW.submitMatchPair).toHaveBeenLastCalledWith(1n, 2n);

    // Simulate the contract: the small sell fully consumed → OrderClosed
    // (handler removes id 2). The buy survives with a residual; it stays
    // tracked. A fresh sell from charlie (id 3) joins the pool.
    // (TrackedSet uses Set object-identity — must remove the actual stored ref.)
    const sellRef = tracked.list().find((r) => r.orderId === 2n)!;
    tracked.remove(sellRef);
    tracked.add(shortSell(3n, CHARLIE));

    // Next tick — bot finds the residual buy + new sell.
    await runMatchTick(darkRW as any, tracked, recentlyFailed, logger as any);
    expect(darkRW.submitMatchPair).toHaveBeenLastCalledWith(1n, 3n);
    expect(darkRW.submitMatchPair).toHaveBeenCalledTimes(2);
  });

  it("does nothing when no viable pair exists (empty pool, single-side pool, or all-back-off'd)", async () => {
    // (a) empty pool
    await runMatchTick(darkRW as any, tracked, recentlyFailed, logger as any);
    expect(darkRW.submitMatchPair).not.toHaveBeenCalled();

    // (b) only longs (no opposing side)
    tracked.add(longBuy(1n, ALICE));
    tracked.add(longBuy(2n, BOB));
    await runMatchTick(darkRW as any, tracked, recentlyFailed, logger as any);
    expect(darkRW.submitMatchPair).not.toHaveBeenCalled();

    // (c) one viable pair, all back-off'd
    tracked.add(shortSell(3n, CHARLIE));
    recentlyFailed.set(pairKey(1n, 3n), 100n);
    recentlyFailed.set(pairKey(2n, 3n), 100n);
    await runMatchTick(darkRW as any, tracked, recentlyFailed, logger as any);
    expect(darkRW.submitMatchPair).not.toHaveBeenCalled();
  });
});
