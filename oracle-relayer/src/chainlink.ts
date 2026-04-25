/**
 * Chainlink price source. Production targets AggregatorV3 contracts
 * on the chains documented in spec §5.4. For local dev we emit
 * synthetic prices that drift around realistic values so the bot's
 * liquidation/trigger logic exercises both directions.
 */
export type Market = { id: number; name: string; basePrice: bigint };

export const MARKETS: Market[] = [
  { id: 1, name: "BTC/USD", basePrice: 60_000n },
  { id: 2, name: "ETH/USD", basePrice: 3_000n },
  { id: 3, name: "SOL/USD", basePrice: 150n },
];

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
