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
 *
 * Two corrections from the original implementation (made 2026-05-07 after
 * watching ETH oracle stuck stale for ~5min on Sepolia):
 *
 * 1. The timestamp `t` MUST be refreshed per-market, not captured once
 *    at tick start. With 3 markets × 2 relayers × ~14s/tx confirmation,
 *    a per-tick `t` drifts ~50–80s behind `block.timestamp` by the time
 *    the later txs mine. The contract's `block.timestamp > pendingTimestamp
 *    + stalenessSeconds(90)` check then fires when the second relayer
 *    tries to commit against the first relayer's already-stale pending,
 *    producing PendingStale reverts even though both relayers submit on
 *    schedule. Refreshing `t` per-market keeps each pair's submitted
 *    timestamp close to the chain's current block.timestamp at mine time.
 *
 * 2. A and B's submissions for the same market are now sent in parallel
 *    (Promise.all). They use different wallets, so there's no nonce
 *    conflict. Halves wall-clock per market from ~28s → ~14s; total tick
 *    duration drops from ~84s → ~42s and ETH stays committed for a much
 *    larger fraction of each cycle.
 *
 * Relayer B still uses a +1 timestamp so the (relayer, timestamp) pair
 * is distinct from A's, satisfying Oracle.sol's "different submission"
 * requirement for the commit-path.
 */
export async function submitTick(
  oracleA: Contract,
  oracleB: Contract,
  logger: Logger,
  priceFn: PriceFn = mockPrice,
): Promise<void> {
  for (const market of MARKETS) {
    const price = await priceFn(market.id);
    const t = Math.floor(Date.now() / 1000);
    const submitFrom = async (oracle: Contract, ts: number, label: "A" | "B") => {
      try {
        const tx = await oracle.submitPrice(market.id, price, ts);
        await tx.wait();
        logger.info(
          { marketId: market.id, market: market.name, price: price.toString(), relayer: label },
          "submitted",
        );
      } catch (err) {
        logger.error(
          { marketId: market.id, relayer: label, err: (err as Error).message },
          "submit failed",
        );
      }
    };
    await Promise.all([
      submitFrom(oracleA, t, "A"),
      submitFrom(oracleB, t + 1, "B"),
    ]);
  }
}
