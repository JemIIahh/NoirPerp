import type { Contract } from "ethers";
import type { Logger } from "pino";
import type { TrackedSet } from "../state.js";

export const MAX_BATCH_SIZE = 10; // per Phase 6 HCU audit — 5M sequential cap

export type DarkOrderRef = { orderId: bigint; marketId: number };

/**
 * Poll DarkpoolEngine events that maintain the legacy (batch-vs-pool) dark
 * order set. HTTP-based replacement for the earlier WS subscription.
 *
 * - darkRO "OrderSubmitted" → add (orderId, marketId)
 * - darkRO "BatchSettled"   → remove all refs whose orderId is in the settled list
 * - darkRO "OrderCancelled" → remove ref by orderId
 */
export async function pollBatchEvents(
  darkRO: Contract,
  fromBlock: number,
  toBlock: number,
  tracked: TrackedSet<DarkOrderRef>,
  logger: Logger,
): Promise<void> {
  const [submitted, settled, cancelled] = await Promise.all([
    darkRO.queryFilter("OrderSubmitted", fromBlock, toBlock),
    darkRO.queryFilter("BatchSettled", fromBlock, toBlock),
    darkRO.queryFilter("OrderCancelled", fromBlock, toBlock),
  ]);

  for (const ev of submitted) {
    const a = (ev as any).args;
    const orderId = a.orderId as bigint;
    // De-dupe across re-polled ranges: object T compares by reference, so
    // skip if any tracked entry already has this orderId.
    if (tracked.list().some((r) => r.orderId === orderId)) continue;
    tracked.add({ orderId, marketId: Number(a.marketId) });
    logger.info({ orderId: orderId.toString(), marketId: Number(a.marketId) }, "tracked dark order");
  }
  for (const ev of settled) {
    const orderIds = (ev as any).args.orderIds as bigint[];
    for (const oid of orderIds) {
      for (const ref of tracked.list()) {
        if (ref.orderId === oid) tracked.remove(ref);
      }
    }
  }
  for (const ev of cancelled) {
    const oid = (ev as any).args.orderId as bigint;
    for (const ref of tracked.list()) {
      if (ref.orderId === oid) tracked.remove(ref);
    }
    logger.info({ orderId: oid.toString() }, "untracked: cancelled");
  }
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
