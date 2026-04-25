export type Market = { id: number; symbol: string; name: string; decimals: number; base: bigint };

export const MARKETS: Market[] = [
  { id: 1, symbol: "BTC", name: "Bitcoin",  decimals: 8,  base: 60_000n },
  { id: 2, symbol: "ETH", name: "Ethereum", decimals: 18, base: 3_000n  },
  { id: 3, symbol: "SOL", name: "Solana",   decimals: 9,  base: 150n    },
];

export function marketById(id: number): Market | undefined {
  return MARKETS.find((m) => m.id === id);
}
