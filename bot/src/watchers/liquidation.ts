import type { Contract } from "ethers";
import type { Logger } from "pino";
import type { TrackedSet } from "../state.js";

/**
 * Subscribe to on-chain events that maintain the tracked liquidation set.
 *
 * - vaultRO "PositionOpened" → add positionId to tracked (position is live)
 * - perpRO  "Liquidated"     → remove positionId from tracked (position is gone)
 * - perpRO  "LiquidationChecked" → keep in tracked (position survived the check;
 *                                   bot continues probing until actually liquidated)
 *
 * Returns an unsubscribe function that removes all listeners.
 */
export function subscribeLiquidation(
  vaultRO: Contract,
  perpRO: Contract,
  tracked: TrackedSet<bigint>,
  logger: Logger,
): () => void {
  const onPositionOpened = (positionId: bigint, owner: string, marketId: number) => {
    logger.info({ positionId: positionId.toString(), owner, marketId }, "PositionOpened — tracking");
    tracked.add(positionId);
  };

  const onLiquidated = (positionId: bigint, keeper: string) => {
    logger.info({ positionId: positionId.toString(), keeper }, "Liquidated — removing from tracked");
    tracked.remove(positionId);
  };

  const onLiquidationChecked = (positionId: bigint) => {
    // Position survived this check — keep it tracked, bot keeps probing
    logger.info({ positionId: positionId.toString() }, "kept");
  };

  vaultRO.on("PositionOpened", onPositionOpened);
  perpRO.on("Liquidated", onLiquidated);
  perpRO.on("LiquidationChecked", onLiquidationChecked);

  return () => {
    vaultRO.off("PositionOpened", onPositionOpened);
    perpRO.off("Liquidated", onLiquidated);
    perpRO.off("LiquidationChecked", onLiquidationChecked);
  };
}

/**
 * Single tick of the liquidation bot: attempt to liquidate every tracked position.
 * Per-position errors are caught, logged, and execution continues to the next position.
 */
export async function runLiquidationTick(
  perpRW: Contract,
  tracked: TrackedSet<bigint>,
  logger: Logger,
): Promise<void> {
  const positions = tracked.list();
  for (const positionId of positions) {
    try {
      const tx = await perpRW.requestLiquidation(positionId);
      await tx.wait();
      logger.info({ positionId: positionId.toString() }, "requestLiquidation submitted");
    } catch (err) {
      logger.error({ positionId: positionId.toString(), err }, "requestLiquidation failed — continuing");
    }
  }
}
