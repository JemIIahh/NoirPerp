import { Contract } from "ethers";
import { MARKETS, mockPrice } from "./chainlink.js";

export type Logger = {
  info: (msg: any, ...args: any[]) => void;
  error: (msg: any, ...args: any[]) => void;
};

/**
 * Price source. Sync (mockPrice) or async (real Chainlink read) — both
 * work because submitTick awaits whatever it returns.
 */
export type PriceFn = (marketId: number) => bigint | Promise<bigint>;

/**
 * One tick: for each market, fetch a price and submit from both relayers.
 * Each individual submission failure is logged but does not abort the tick.
 * Relayer B uses a +1 timestamp to satisfy Oracle.sol's "different submission"
 * rule which requires distinct (relayer, timestamp) pairs.
 */
export async function submitTick(
  oracleA: Contract,
  oracleB: Contract,
  logger: Logger,
  priceFn: PriceFn = mockPrice,
): Promise<void> {
  const t = Math.floor(Date.now() / 1000);
  for (const market of MARKETS) {
    const price = await priceFn(market.id);
    try {
      const tx = await oracleA.submitPrice(market.id, price, t);
      await tx.wait();
      logger.info({ marketId: market.id, market: market.name, price: price.toString(), relayer: "A" }, "submitted");
    } catch (err) {
      logger.error({ marketId: market.id, relayer: "A", err: (err as Error).message }, "submit failed");
    }
    try {
      const tx = await oracleB.submitPrice(market.id, price, t + 1);
      await tx.wait();
      logger.info({ marketId: market.id, market: market.name, price: price.toString(), relayer: "B" }, "submitted");
    } catch (err) {
      logger.error({ marketId: market.id, relayer: "B", err: (err as Error).message }, "submit failed");
    }
  }
}
