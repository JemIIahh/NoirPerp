import { describe, it, expect, vi, beforeEach } from "vitest";
import { runBatchTick, MAX_BATCH_SIZE } from "../src/watchers/batch.js";
import { TrackedSet } from "../src/state.js";

// Minimal mock of pino logger
function makeLogger() {
  return {
    info:  vi.fn(),
    error: vi.fn(),
    warn:  vi.fn(),
    debug: vi.fn(),
  };
}

// Minimal mock of darkRW contract (write-side)
function makeDarkRW() {
  return {
    requestBatchMatch: vi.fn(),
  };
}

describe("batch matcher — runBatchTick", () => {
  let darkRW: ReturnType<typeof makeDarkRW>;
  let logger: ReturnType<typeof makeLogger>;
  let tracked: TrackedSet<{ orderId: bigint; marketId: number }>;

  beforeEach(() => {
    darkRW = makeDarkRW();
    darkRW.requestBatchMatch.mockResolvedValue({ wait: vi.fn().mockResolvedValue(undefined) });
    logger  = makeLogger();
    tracked = new TrackedSet<{ orderId: bigint; marketId: number }>();
  });

  it("groups by marketId and sends one call per group", async () => {
    tracked.add({ orderId: 1n, marketId: 1 });
    tracked.add({ orderId: 2n, marketId: 2 });
    tracked.add({ orderId: 3n, marketId: 1 });

    await runBatchTick(darkRW as any, tracked, logger as any);

    // 2 distinct marketIds → 2 calls
    expect(darkRW.requestBatchMatch).toHaveBeenCalledTimes(2);
  });

  it("caps batch size at MAX_BATCH_SIZE", async () => {
    // Add MAX_BATCH_SIZE + 5 orders all in the same market
    for (let i = 0; i < MAX_BATCH_SIZE + 5; i++) {
      tracked.add({ orderId: BigInt(i), marketId: 1 });
    }

    await runBatchTick(darkRW as any, tracked, logger as any);

    // 15 items / 10 per batch = 2 calls (ceil(15/10) = 2)
    expect(darkRW.requestBatchMatch).toHaveBeenCalledTimes(2);
  });

  it("does nothing when tracked is empty", async () => {
    await runBatchTick(darkRW as any, tracked, logger as any);

    expect(darkRW.requestBatchMatch).not.toHaveBeenCalled();
  });

  it("logs and continues on per-batch failure", async () => {
    tracked.add({ orderId: 1n, marketId: 1 });
    tracked.add({ orderId: 2n, marketId: 2 });

    // First call (market 1) rejects; second (market 2) succeeds
    darkRW.requestBatchMatch
      .mockRejectedValueOnce(new Error("oracle stale"))
      .mockResolvedValueOnce({ wait: vi.fn().mockResolvedValue(undefined) });

    await runBatchTick(darkRW as any, tracked, logger as any);

    // Error logged for failing call
    expect(logger.error).toHaveBeenCalled();
    // Both market groups were still attempted
    expect(darkRW.requestBatchMatch).toHaveBeenCalledTimes(2);
  });
});
