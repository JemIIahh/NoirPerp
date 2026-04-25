import type { Contract } from "ethers";
import type { Logger } from "pino";
import type { TrackedSet } from "../state.js";

/**
 * Subscribe to on-chain events that maintain the tracked limit-order set.
 *
 * - limitRO "OrderPlaced"    → add orderId to tracked (order is live)
 * - limitRO "Triggered"      → remove orderId from tracked (order executed)
 * - limitRO "TriggerNotMet"  → keep in tracked (order survived this check;
 *                               bot keeps probing until triggered or cancelled)
 * - limitRO "OrderCancelled" → remove orderId from tracked (order is gone)
 *
 * Returns an unsubscribe function that removes all listeners.
 */
export function subscribeTrigger(
  limitRO: Contract,
  tracked: TrackedSet<bigint>,
  logger: Logger,
): () => void {
  const onOrderPlaced = (orderId: bigint, owner: string, orderType: number, marketId: number) => {
    logger.info({ orderId: orderId.toString(), owner, orderType, marketId }, "OrderPlaced — tracking");
    tracked.add(orderId);
  };

  const onTriggered = (orderId: bigint, user: string) => {
    logger.info({ orderId: orderId.toString(), user }, "Triggered — removing from tracked");
    tracked.remove(orderId);
  };

  const onTriggerNotMet = (orderId: bigint) => {
    // Order survived this check — keep it tracked, bot keeps probing
    logger.info({ orderId: orderId.toString() }, "kept");
  };

  const onOrderCancelled = (orderId: bigint, owner: string) => {
    logger.info({ orderId: orderId.toString(), owner }, "OrderCancelled — removing from tracked");
    tracked.remove(orderId);
  };

  limitRO.on("OrderPlaced", onOrderPlaced);
  limitRO.on("Triggered", onTriggered);
  limitRO.on("TriggerNotMet", onTriggerNotMet);
  limitRO.on("OrderCancelled", onOrderCancelled);

  return () => {
    limitRO.off("OrderPlaced", onOrderPlaced);
    limitRO.off("Triggered", onTriggered);
    limitRO.off("TriggerNotMet", onTriggerNotMet);
    limitRO.off("OrderCancelled", onOrderCancelled);
  };
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
