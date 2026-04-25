import type { Contract } from "ethers";
import type { Logger } from "pino";
import type { TrackedSet } from "../state.js";

export const MAX_BATCH_SIZE = 10; // per Phase 6 HCU audit — 5M sequential cap

export type DarkOrderRef = { orderId: bigint; marketId: number };

/**
 * Subscribe to DarkpoolEngine events that maintain the tracked dark-order set.
 *
 * - darkRO "OrderSubmitted" → add (orderId, marketId) ref to tracked
 * - darkRO "BatchSettled"   → remove all refs whose orderId appears in the event's orderIds array
 * - darkRO "OrderCancelled" → remove ref by orderId
 *
 * Returns an unsubscribe function that removes all listeners.
 */
export function subscribeBatch(
  darkRO: Contract,
  tracked: TrackedSet<DarkOrderRef>,
  logger: Logger,
): () => void {
  const onSubmitted = (orderId: bigint, _owner: string, marketId: number) => {
    tracked.add({ orderId, marketId: Number(marketId) });
    logger.info({ orderId: orderId.toString(), marketId: Number(marketId) }, "tracked dark order");
  };

  const onSettled = (_requestId: bigint, orderIds: bigint[], _shouldFires: bigint[]) => {
    for (const oid of orderIds) {
      for (const ref of tracked.list()) {
        if (ref.orderId === oid) tracked.remove(ref);
      }
    }
  };

  const onCancelled = (orderId: bigint, _owner: string) => {
    for (const ref of tracked.list()) {
      if (ref.orderId === orderId) tracked.remove(ref);
    }
    logger.info({ orderId: orderId.toString() }, "untracked: cancelled");
  };

  darkRO.on("OrderSubmitted", onSubmitted);
  darkRO.on("BatchSettled", onSettled);
  darkRO.on("OrderCancelled", onCancelled);

  return () => {
    darkRO.off("OrderSubmitted", onSubmitted);
    darkRO.off("BatchSettled", onSettled);
    darkRO.off("OrderCancelled", onCancelled);
  };
}

/**
 * Single tick of the batch matcher: group tracked dark orders by marketId,
 * chunk each group at MAX_BATCH_SIZE, and call requestBatchMatch per chunk.
 * Per-chunk errors are caught, logged, and execution continues to the next chunk.
 */
export async function runBatchTick(
  darkRW: Contract,
  tracked: TrackedSet<DarkOrderRef>,
  logger: Logger,
): Promise<void> {
  const groups = tracked.groupBy((ref) => ref.marketId);
  for (const [marketId, refs] of groups) {
    for (let i = 0; i < refs.length; i += MAX_BATCH_SIZE) {
      const chunk = refs.slice(i, i + MAX_BATCH_SIZE).map((r) => r.orderId);
      try {
        const tx = await darkRW.requestBatchMatch(chunk);
        await tx.wait();
        logger.info({ marketId, count: chunk.length }, "requestBatchMatch sent");
      } catch (err) {
        logger.error(
          { marketId, count: chunk.length, err: (err as Error).message },
          "requestBatchMatch failed — continuing",
        );
      }
    }
  }
}
