/**
 * Price source for the oracle relayer.
 *
 * Two modes:
 *   - mockPrice():    deterministic synthetic price drifting ±2% around
 *                     a baseline. Used for local Hardhat tests + as a
 *                     fallback when no Chainlink feed exists for a
 *                     given (chain, market) pair (e.g., SOL on Sepolia).
 *   - realPrice():    reads the latest answer from a Chainlink
 *                     AggregatorV3 feed on the connected chain and
 *                     scales it to whole dollars (Oracle.sol stores
 *                     price as uint64 with 0 decimals).
 *
 * The relayer's `submitTick()` accepts a `PriceFn = (marketId) => bigint`
 * — `index.ts` chooses which factory to wire based on `USE_MOCK_PRICES`.
 */

import { Contract, JsonRpcProvider } from "ethers";

export type Market = { id: number; name: string; basePrice: bigint };

export const MARKETS: Market[] = [
  { id: 1, name: "BTC/USD", basePrice: 60_000n },
  { id: 2, name: "ETH/USD", basePrice: 3_000n },
  { id: 3, name: "SOL/USD", basePrice: 150n },
];

// ─── Synthetic mock price ─────────────────────────────────────────────

/**
 * Deterministic synthetic price. seed=undefined → uses Date.now()/1000s
 * which produces a slow drift. Tests pass an explicit seed for determinism.
 */
export function mockPrice(marketId: number, seed?: number): bigint {
  const market = MARKETS.find((m) => m.id === marketId);
  if (!market) throw new Error(`unknown marketId: ${marketId}`);
  const t = seed ?? Math.floor(Date.now() / 1000);
  // Drift by ±2% based on a sin-style cycle
  const drift = (((t + marketId * 1000) % 200) - 100) / 100; // -1.0..+1.0
  const adjusted = Number(market.basePrice) * (1 + drift * 0.02);
  return BigInt(Math.round(adjusted));
}

// ─── Real Chainlink AggregatorV3 reader ───────────────────────────────

const AGGREGATOR_V3_ABI = [
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() view returns (uint8)",
];

/**
 * Per-chain Chainlink feed addresses. Source: docs.chain.link/data-feeds.
 * Sepolia has BTC/USD + ETH/USD; SOL/USD is NOT available (Solana feeds
 * are Solana-native). For markets without a feed on the active chain,
 * realPrice falls back to mockPrice with a one-time warning.
 */
export const CHAINLINK_FEEDS: Record<number, Record<number, string>> = {
  // Sepolia (chainId 11155111)
  11155111: {
    1: "0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43", // BTC/USD
    2: "0x694AA1769357215DE4FAC081bf1f309aDC325306", // ETH/USD
    // 3 (SOL/USD): no Sepolia feed; falls back to mock
  },
  // Ethereum mainnet (1) — for future production use
  1: {
    1: "0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c", // BTC/USD
    2: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419", // ETH/USD
    3: "0x4ffC43a60e009B551865A93d232E33Fce9f01507", // SOL/USD
  },
};

type CachedFeed = { aggregator: Contract; decimals: bigint };
const feedCache = new Map<string, CachedFeed>();

async function getFeed(provider: JsonRpcProvider, address: string): Promise<CachedFeed> {
  const cached = feedCache.get(address);
  if (cached) return cached;
  const aggregator = new Contract(address, AGGREGATOR_V3_ABI, provider);
  const decimals: bigint = await aggregator.decimals();
  const cf: CachedFeed = { aggregator, decimals };
  feedCache.set(address, cf);
  return cf;
}

const warned = new Set<string>();
function warnOnce(key: string, msg: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  // eslint-disable-next-line no-console
  console.warn(`[chainlink] ${msg}`);
}

/**
 * Build a PriceFn closure that reads from Chainlink feeds for the
 * specified chain. Falls back to mockPrice() for markets without a
 * feed on that chain (logs once per market).
 *
 * Caller controls staleness — Chainlink's own `updatedAt` could be old
 * if Chainlink itself is delayed; we don't enforce a check here because
 * Sepolia testnet feeds update less frequently than mainnet (no SLA).
 */
export function realPriceFactory(
  provider: JsonRpcProvider,
  chainId: number,
): (marketId: number) => Promise<bigint> {
  const feeds = CHAINLINK_FEEDS[chainId] ?? {};
  return async (marketId: number) => {
    const feed = feeds[marketId];
    if (!feed) {
      warnOnce(
        `${chainId}-${marketId}`,
        `no Chainlink feed for market ${marketId} on chain ${chainId} — falling back to mockPrice`,
      );
      return mockPrice(marketId);
    }
    try {
      const { aggregator, decimals } = await getFeed(provider, feed);
      const [, answer]: [bigint, bigint, bigint, bigint, bigint] =
        await aggregator.latestRoundData();
      // Scale to whole dollars: Oracle.sol's uint64 holds dollars-no-decimals.
      const scaled = answer / 10n ** decimals;
      if (scaled <= 0n) {
        warnOnce(
          `${chainId}-${marketId}-zero`,
          `Chainlink feed ${feed} returned non-positive answer ${answer} — falling back to mockPrice for this tick`,
        );
        return mockPrice(marketId);
      }
      return scaled;
    } catch (err) {
      warnOnce(
        `${chainId}-${marketId}-err`,
        `Chainlink read failed for feed ${feed}: ${(err as Error).message} — falling back to mockPrice`,
      );
      return mockPrice(marketId);
    }
  };
}
