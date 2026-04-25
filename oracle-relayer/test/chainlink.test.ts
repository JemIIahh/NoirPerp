import { describe, it, expect } from "vitest";
import { mockPrice, MARKETS } from "../src/chainlink.js";

describe("chainlink — mock price source", () => {
  it("returns a positive integer price for each market", () => {
    for (const m of MARKETS) {
      const p = mockPrice(m.id);
      expect(p).toBeGreaterThan(0n);
      expect(typeof p).toBe("bigint");
    }
  });

  it("returns deterministic prices given a seed", () => {
    const a = mockPrice(MARKETS[0].id, 42);
    const b = mockPrice(MARKETS[0].id, 42);
    expect(a).toEqual(b);
  });

  it("varies across markets", () => {
    const btc = mockPrice(MARKETS[0].id, 1);
    const eth = mockPrice(MARKETS[1].id, 1);
    const sol = mockPrice(MARKETS[2].id, 1);
    expect(btc).not.toEqual(eth);
    expect(eth).not.toEqual(sol);
  });
});
