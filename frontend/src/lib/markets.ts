export type Market = {
  id: number;
  symbol: string;
  name: string;
  decimals: number;
  base: bigint;
  // Hidden from selectors / tickers when true, but kept in MARKETS so
  // historical position lookups via marketById still resolve.
  disabled?: boolean;
};

export const MARKETS: Market[] = [
  { id: 1, symbol: "BTC", name: "Bitcoin",  decimals: 8,  base: 60_000n },
  { id: 2, symbol: "ETH", name: "Ethereum", decimals: 18, base: 3_000n  },
  // SOL/USD: no Chainlink AggregatorV3 on Sepolia; not tradeable on testnet.
  { id: 3, symbol: "SOL", name: "Solana",   decimals: 9,  base: 150n,    disabled: true },
];

export const TRADEABLE_MARKETS: Market[] = MARKETS.filter((m) => !m.disabled);

export function marketById(id: number): Market | undefined {
  return MARKETS.find((m) => m.id === id);
}
