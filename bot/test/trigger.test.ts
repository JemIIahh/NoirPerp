import { describe, it, expect, vi, beforeEach } from "vitest";
import { TrackedSet } from "../src/state.js";
import { runTriggerTick } from "../src/watchers/trigger.js";

// Minimal mock of pino logger
function makeLogger() {
  return {
    info:  vi.fn(),
    error: vi.fn(),
    warn:  vi.fn(),
    debug: vi.fn(),
  };
}

// Minimal mock of limitRW contract (write-side)
function makeLimitRW() {
  return {
    requestTrigger: vi.fn(),
  };
}

describe("runTriggerTick", () => {
  let tracked: TrackedSet<bigint>;
  let limitRW: ReturnType<typeof makeLimitRW>;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    tracked = new TrackedSet<bigint>();
    limitRW = makeLimitRW();
    logger  = makeLogger();
  });

  it("calls requestTrigger for each tracked orderId", async () => {
    tracked.add(1n);
    tracked.add(2n);
    tracked.add(3n);

    // Simulate tx.wait() resolving
    const mockWait = vi.fn().mockResolvedValue(undefined);
    limitRW.requestTrigger.mockResolvedValue({ wait: mockWait });

    await runTriggerTick(limitRW as any, tracked, logger as any);

    expect(limitRW.requestTrigger).toHaveBeenCalledTimes(3);
    expect(limitRW.requestTrigger).toHaveBeenCalledWith(1n);
    expect(limitRW.requestTrigger).toHaveBeenCalledWith(2n);
    expect(limitRW.requestTrigger).toHaveBeenCalledWith(3n);
    expect(mockWait).toHaveBeenCalledTimes(3);
  });

  it("does nothing when tracked is empty", async () => {
    await runTriggerTick(limitRW as any, tracked, logger as any);

    expect(limitRW.requestTrigger).not.toHaveBeenCalled();
  });

  it("logs and continues on individual failure", async () => {
    tracked.add(10n);
    tracked.add(20n);

    const mockWait = vi.fn().mockResolvedValue(undefined);

    // First call rejects; second succeeds
    limitRW.requestTrigger
      .mockRejectedValueOnce(new Error("revert: trigger not met"))
      .mockResolvedValueOnce({ wait: mockWait });

    await runTriggerTick(limitRW as any, tracked, logger as any);

    // Both orders were attempted
    expect(limitRW.requestTrigger).toHaveBeenCalledTimes(2);
    // Error was logged for the failing call
    expect(logger.error).toHaveBeenCalledTimes(1);
    // Second call still went through (wait was called once)
    expect(mockWait).toHaveBeenCalledTimes(1);
  });
});
