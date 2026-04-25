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
});
