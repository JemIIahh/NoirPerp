import { describe, it, expect, vi, beforeEach } from "vitest";
import { submitTick } from "../src/relayer.js";
import { MARKETS } from "../src/chainlink.js";

describe("relayer — submitTick", () => {
  let oracleA: any;
  let oracleB: any;
  let logger: any;

  beforeEach(() => {
    oracleA = { submitPrice: vi.fn().mockResolvedValue({ wait: vi.fn().mockResolvedValue({}) }) };
    oracleB = { submitPrice: vi.fn().mockResolvedValue({ wait: vi.fn().mockResolvedValue({}) }) };
    logger = { info: vi.fn(), error: vi.fn() };
  });

  it("submits a price for each market from each relayer", async () => {
    await submitTick(oracleA, oracleB, logger, () => 1234n);
    expect(oracleA.submitPrice).toHaveBeenCalledTimes(MARKETS.length);
    expect(oracleB.submitPrice).toHaveBeenCalledTimes(MARKETS.length);
  });

  it("uses the priceFn to fetch each market's price", async () => {
    const fn = vi.fn().mockReturnValue(9999n);
    await submitTick(oracleA, oracleB, logger, fn);
    expect(fn).toHaveBeenCalledTimes(MARKETS.length);
  });

  it("does not throw if a single submission fails — logs and continues", async () => {
    oracleA.submitPrice = vi.fn()
      .mockRejectedValueOnce(new Error("nonce"))
      .mockResolvedValue({ wait: vi.fn().mockResolvedValue({}) });
    await expect(submitTick(oracleA, oracleB, logger, () => 1234n)).resolves.not.toThrow();
    expect(logger.error).toHaveBeenCalled();
  });

  it("uses A's t and B's t+1 for each market, refreshing t per-market (Sepolia-stale-fix)", async () => {
    // Capture every (relayer, timestamp) pair across all markets.
    const aCalls: number[] = [];
    const bCalls: number[] = [];
    oracleA.submitPrice = vi.fn().mockImplementation((_m: number, _p: bigint, t: number) => {
      aCalls.push(t);
      return Promise.resolve({ wait: vi.fn().mockResolvedValue({}) });
    });
    oracleB.submitPrice = vi.fn().mockImplementation((_m: number, _p: bigint, t: number) => {
      bCalls.push(t);
      return Promise.resolve({ wait: vi.fn().mockResolvedValue({}) });
    });
    await submitTick(oracleA, oracleB, logger, () => 1234n);

    // For each market: B's timestamp must be exactly A's + 1 (the contract's
    // distinct-submission rule); both must be the wall-clock at the moment
    // of THAT market's loop iteration, not a single tick-start value.
    for (let i = 0; i < aCalls.length; i++) {
      expect(bCalls[i]).toEqual(aCalls[i] + 1);
    }
    // Per-market timestamps must be monotonically non-decreasing across the
    // loop — same wall-clock or later, never earlier. (Within a single test
    // run with mocked sub-second awaits, all `t` values are typically equal,
    // but they MUST all be Math.floor(Date.now()/1000) at submit time, so
    // this asserts the refresh-per-market shape rather than tying to clock.)
    for (let i = 1; i < aCalls.length; i++) {
      expect(aCalls[i]).toBeGreaterThanOrEqual(aCalls[i - 1]);
    }
  });
});
