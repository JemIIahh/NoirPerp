import type { Contract } from "ethers";
import type { Logger } from "pino";
import type { TrackedSet } from "../state.js";

/**
 * Phase 11 — peer-to-peer pair-match watcher.
 *
 * Maintains an in-memory set of active pair-eligible dark orders, keyed by
 * orderId, with the plaintext metadata (owner, marketId, isLong) needed for
 * candidate-pair generation. Submits one `submitMatchPair` per tick to avoid
 * HCU contention. Pairs that revert (no-intersect, stale oracle, etc.) are
 * recorded in a back-off map so the bot doesn't tightloop on them.
 *
 * The bot can never see prices — pair selection uses plaintext metadata
 * only (per design memo `docs/specs/2026-04-28-darkpool-pair-match-design.md`
 * §3). FIFO by orderId-sum is the tiebreaker in absence of price-time
 * priority.
 */

export const MAX_PAIRS_PER_TICK = 1;
export const BACKOFF_BLOCKS = 10n;

export type PairOrderRef = {
  orderId: bigint;
  owner: string;
  marketId: number;
  isLong: boolean;
};

export type RecentlyFailed = Map<string, bigint>;

export function pairKey(buyId: bigint, sellId: bigint): string {
  return `${buyId.toString()}-${sellId.toString()}`;
}

async function currentBlock(c: Contract): Promise<bigint> {
  const provider = (c.runner as { provider?: { getBlockNumber: () => Promise<number> } } | null)?.provider;
  if (!provider) return 0n;
  const n = await provider.getBlockNumber();
  return BigInt(n);
}

export function subscribeMatch(
  darkRO: Contract,
  tracked: TrackedSet<PairOrderRef>,
  recentlyFailed: RecentlyFailed,
  logger: Logger,
): () => void {
  const onSubmittedForPair = (
    orderId: bigint, owner: string, marketId: number, isLong: boolean,
  ) => {
    tracked.add({
      orderId,
      owner,
      marketId: Number(marketId),
      isLong: Boolean(isLong),
    });
    logger.info(
      { orderId: orderId.toString(), marketId: Number(marketId), isLong: Boolean(isLong) },
      "tracked pair-eligible dark order",
    );
  };

  const removeById = (oid: bigint, reason: string) => {
    for (const ref of tracked.list()) {
      if (ref.orderId === oid) {
        tracked.remove(ref);
        logger.info({ orderId: oid.toString(), reason }, "untracked pair order");
      }
    }
  };

  const onClosed = (orderId: bigint, _reason: string) => removeById(orderId, "closed");
  const onCancelled = (orderId: bigint, _owner: string) => removeById(orderId, "cancelled");

  const onRejected = async (requestId: bigint, buyId: bigint, sellId: bigint) => {
    const block = await currentBlock(darkRO);
    recentlyFailed.set(pairKey(buyId, sellId), block);
    logger.info(
      { requestId: requestId.toString(), buyId: buyId.toString(), sellId: sellId.toString() },
      "pair rejected — back-off recorded",
    );
  };

  const onAborted = (
    requestId: bigint, buyId: bigint, sellId: bigint, reason: string,
  ) => {
    // The cancelled side was already removed via OrderCancelled, so the
    // pair can't reform — no need to record back-off. Just log for visibility.
    logger.info(
      {
        requestId: requestId.toString(),
        buyId: buyId.toString(),
        sellId: sellId.toString(),
        reason,
      },
      "pair aborted",
    );
  };

  darkRO.on("OrderSubmittedForPair", onSubmittedForPair);
  darkRO.on("OrderClosed", onClosed);
  darkRO.on("OrderCancelled", onCancelled);
  darkRO.on("MatchRejected", onRejected);
  darkRO.on("MatchAborted", onAborted);

  return () => {
    darkRO.off("OrderSubmittedForPair", onSubmittedForPair);
    darkRO.off("OrderClosed", onClosed);
    darkRO.off("OrderCancelled", onCancelled);
    darkRO.off("MatchRejected", onRejected);
    darkRO.off("MatchAborted", onAborted);
  };
}

/**
 * Pick the first viable pair from tracked, skipping recently-failed pairs
 * within `BACKOFF_BLOCKS`. Returns undefined if no candidate exists.
 *
 * Viability:
 *   - same market
 *   - opposite sides (long ↔ short)
 *   - distinct owners (no self-match — engine reverts PairOrdersSameOwner)
 *   - not in recentlyFailed within BACKOFF_BLOCKS
 *
 * Tiebreaker: FIFO by orderId-sum (deterministic; oldest pair wins).
 */
export function pickCandidatePair(
  tracked: PairOrderRef[],
  recentlyFailed: RecentlyFailed,
  currentBlk: bigint,
): { buy: PairOrderRef; sell: PairOrderRef } | undefined {
  const byMarket = new Map<number, PairOrderRef[]>();
  for (const o of tracked) {
    const bucket = byMarket.get(o.marketId) ?? [];
    bucket.push(o);
    byMarket.set(o.marketId, bucket);
  }

  const candidates: { buy: PairOrderRef; sell: PairOrderRef; sum: bigint }[] = [];
  for (const [, refs] of byMarket) {
    const longs = refs.filter((r) => r.isLong);
    const shorts = refs.filter((r) => !r.isLong);
    for (const buy of longs) {
      for (const sell of shorts) {
        if (buy.owner.toLowerCase() === sell.owner.toLowerCase()) continue;
        const key = pairKey(buy.orderId, sell.orderId);
        const failedAt = recentlyFailed.get(key);
        if (failedAt !== undefined && currentBlk - failedAt < BACKOFF_BLOCKS) continue;
        candidates.push({ buy, sell, sum: buy.orderId + sell.orderId });
      }
    }
  }

  if (candidates.length === 0) return undefined;
  candidates.sort((a, b) => (a.sum < b.sum ? -1 : a.sum > b.sum ? 1 : 0));
  const pick = candidates[0];
  return { buy: pick.buy, sell: pick.sell };
}

/**
 * Submit one viable pair per tick. On revert, record back-off so the same
 * pair won't be retried within BACKOFF_BLOCKS.
 */
export async function runMatchTick(
  darkRW: Contract,
  tracked: TrackedSet<PairOrderRef>,
  recentlyFailed: RecentlyFailed,
  logger: Logger,
): Promise<void> {
  const block = await currentBlock(darkRW);
  const pick = pickCandidatePair(tracked.list(), recentlyFailed, block);
  if (!pick) return;

  const { buy, sell } = pick;
  try {
    const tx = await (darkRW as any).submitMatchPair(buy.orderId, sell.orderId);
    await tx.wait();
    logger.info(
      { buyId: buy.orderId.toString(), sellId: sell.orderId.toString(), marketId: buy.marketId },
      "submitMatchPair sent",
    );
  } catch (err) {
    recentlyFailed.set(pairKey(buy.orderId, sell.orderId), block);
    logger.error(
      {
        buyId: buy.orderId.toString(),
        sellId: sell.orderId.toString(),
        err: (err as Error).message,
      },
      "submitMatchPair failed — back-off recorded",
    );
  }
}
