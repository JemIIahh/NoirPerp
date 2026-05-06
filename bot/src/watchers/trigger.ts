import type { Contract } from "ethers";
import type { Logger } from "pino";
import type { TrackedSet } from "../state.js";

/**
 * Poll LimitEngine events that maintain the tracked limit-order set.
 * HTTP-based replacement for the earlier WS subscription.
 *
 * - limitRO "OrderPlaced"    → add orderId
 * - limitRO "Triggered"      → remove orderId
 * - limitRO "TriggerNotMet"  → log only (order survived; bot keeps probing)
 * - limitRO "OrderCancelled" → remove orderId
 */
export async function pollTriggerEvents(
  limitRO: Contract,
  fromBlock: number,
  toBlock: number,
  tracked: TrackedSet<bigint>,
  logger: Logger,
): Promise<void> {
  const [placed, triggered, notMet, cancelled] = await Promise.all([
    limitRO.queryFilter("OrderPlaced", fromBlock, toBlock),
    limitRO.queryFilter("Triggered", fromBlock, toBlock),
    limitRO.queryFilter("TriggerNotMet", fromBlock, toBlock),
    limitRO.queryFilter("OrderCancelled", fromBlock, toBlock),
  ]);

  for (const ev of placed) {
    const a = (ev as any).args;
    const orderId = a.orderId as bigint;
    tracked.add(orderId);
    logger.info(
      { orderId: orderId.toString(), owner: a.owner, orderType: Number(a.orderType), marketId: Number(a.marketId) },
      "OrderPlaced — tracking",
    );
  }
  for (const ev of triggered) {
    const orderId = (ev as any).args.orderId as bigint;
    tracked.remove(orderId);
    logger.info({ orderId: orderId.toString(), user: (ev as any).args.user }, "Triggered — removing from tracked");
  }
  for (const ev of notMet) {
    logger.info({ orderId: ((ev as any).args.orderId as bigint).toString() }, "kept");
  }
  for (const ev of cancelled) {
    const orderId = (ev as any).args.orderId as bigint;
    tracked.remove(orderId);
    logger.info({ orderId: orderId.toString(), owner: (ev as any).args.owner }, "OrderCancelled — removing from tracked");
  }
}

/**
 * Single tick of the trigger bot: attempt to trigger every tracked limit order.
 * Per-order errors are caught, logged, and execution continues to the next order.
 */
export async function runTriggerTick(
  limitRW: Contract,
  tracked: TrackedSet<bigint>,
  logger: Logger,
): Promise<void> {
  const orders = tracked.list();
  for (const orderId of orders) {
    try {
      const tx = await limitRW.requestTrigger(orderId);
      await tx.wait();
      logger.info({ orderId: orderId.toString() }, "requestTrigger submitted");
    } catch (err) {
      logger.error({ orderId: orderId.toString(), err }, "requestTrigger failed — continuing");
    }
  }
}
