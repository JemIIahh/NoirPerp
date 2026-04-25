import { describe, it, expect, vi, beforeEach } from "vitest";
import { TrackedSet } from "../src/state.js";
import { runLiquidationTick } from "../src/watchers/liquidation.js";

// Minimal mock of pino logger
function makeLogger() {
  return {
    info:  vi.fn(),
    error: vi.fn(),
    warn:  vi.fn(),
    debug: vi.fn(),
  };
}

// Minimal mock of perpRW contract (write-side)
function makePerpRW() {
  return {
    requestLiquidation: vi.fn(),
  };
}

describe("runLiquidationTick", () => {
  let tracked: TrackedSet<bigint>;
  let perpRW: ReturnType<typeof makePerpRW>;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    tracked = new TrackedSet<bigint>();
    perpRW  = makePerpRW();
    logger  = makeLogger();
  });

  it("calls requestLiquidation for each tracked positionId", async () => {
    tracked.add(1n);
    tracked.add(2n);
    tracked.add(3n);

    // Simulate tx.wait() resolving
    const mockWait = vi.fn().mockResolvedValue(undefined);
    perpRW.requestLiquidation.mockResolvedValue({ wait: mockWait });

    await runLiquidationTick(perpRW as any, tracked, logger as any);

    expect(perpRW.requestLiquidation).toHaveBeenCalledTimes(3);
    expect(perpRW.requestLiquidation).toHaveBeenCalledWith(1n);
    expect(perpRW.requestLiquidation).toHaveBeenCalledWith(2n);
    expect(perpRW.requestLiquidation).toHaveBeenCalledWith(3n);
    expect(mockWait).toHaveBeenCalledTimes(3);
  });

  it("does nothing when tracked is empty", async () => {
    await runLiquidationTick(perpRW as any, tracked, logger as any);

    expect(perpRW.requestLiquidation).not.toHaveBeenCalled();
  });

  it("logs and continues on individual failure", async () => {
    tracked.add(10n);
    tracked.add(20n);

    const mockWait = vi.fn().mockResolvedValue(undefined);

    // First call rejects; second succeeds
    perpRW.requestLiquidation
      .mockRejectedValueOnce(new Error("revert: not underwater"))
      .mockResolvedValueOnce({ wait: mockWait });

    await runLiquidationTick(perpRW as any, tracked, logger as any);

    // Both positions were attempted
    expect(perpRW.requestLiquidation).toHaveBeenCalledTimes(2);
    // Error was logged for the failing call
    expect(logger.error).toHaveBeenCalledTimes(1);
    // Second call still went through (wait was called once)
    expect(mockWait).toHaveBeenCalledTimes(1);
  });
});
