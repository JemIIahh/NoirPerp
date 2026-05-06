import type { Contract } from "ethers";
import type { Logger } from "pino";
import type { TrackedSet } from "../state.js";

/**
 * Poll on-chain events that maintain the tracked liquidation set, using
 * HTTP `queryFilter` against the (fromBlock, toBlock] range. Replaces the
 * earlier WS-based `subscribeLiquidation`, which suffered silent connection
 * drops on publicnode. TrackedSet is idempotent on bigint primitives, so
 * if the same range is re-polled (e.g. after a transient failure), state
 * stays correct.
 *
 * - vaultRO "PositionOpened" → add positionId
 * - vaultRO "PositionClosed" → remove positionId
 * - perpRO  "Liquidated"     → remove positionId
 * - perpRO  "LiquidationChecked" → log only (position survived; bot keeps probing)
 */
export async function pollLiquidationEvents(
  vaultRO: Contract,
  perpRO: Contract,
  fromBlock: number,
  toBlock: number,
  tracked: TrackedSet<bigint>,
  logger: Logger,
): Promise<void> {
  const [opened, closed, liquidated, checked] = await Promise.all([
    vaultRO.queryFilter("PositionOpened", fromBlock, toBlock),
    vaultRO.queryFilter("PositionClosed", fromBlock, toBlock),
    perpRO.queryFilter("Liquidated", fromBlock, toBlock),
    perpRO.queryFilter("LiquidationChecked", fromBlock, toBlock),
  ]);

  for (const ev of opened) {
    const a = (ev as any).args;
    const positionId = a.positionId as bigint;
    tracked.add(positionId);
    logger.info(
      { positionId: positionId.toString(), owner: a.owner, marketId: Number(a.marketId) },
      "PositionOpened — tracking",
    );
  }
  for (const ev of closed) {
    const positionId = (ev as any).args.positionId as bigint;
    tracked.remove(positionId);
  }
  for (const ev of liquidated) {
    const positionId = (ev as any).args.positionId as bigint;
    tracked.remove(positionId);
    logger.info({ positionId: positionId.toString() }, "Liquidated — removing from tracked");
  }
  for (const ev of checked) {
    logger.info({ positionId: ((ev as any).args.positionId as bigint).toString() }, "kept");
  }
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
