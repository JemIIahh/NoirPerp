import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleSingleDecrypt, handleBatchDecrypt } from "../src/watchers/decrypt-relay.js";

describe("decrypt-relay", () => {
  let logger: any;
  let engine: any;
  let publicDecrypt: any;

  beforeEach(() => {
    logger = { info: vi.fn(), error: vi.fn() };
    engine = {
      _onLiquidationDecided: vi.fn().mockResolvedValue({ wait: vi.fn().mockResolvedValue({}) }),
      _onBatchDecided: vi.fn().mockResolvedValue({ wait: vi.fn().mockResolvedValue({}) }),
    };
    publicDecrypt = vi.fn().mockResolvedValue({
      abiEncodedClearValues: "0xabc",
      decryptionProof: "0xdef",
    });
  });

  it("single-handle: pulls publicDecrypt then calls _onXDecided with [handle]", async () => {
    const handle = "0x" + "1".repeat(64);
    await handleSingleDecrypt(
      { engine, callbackName: "_onLiquidationDecided", requestId: 7n, handle, publicDecrypt, logger },
    );
    expect(publicDecrypt).toHaveBeenCalledWith([handle]);
    expect(engine._onLiquidationDecided).toHaveBeenCalledWith(7n, [handle], "0xabc", "0xdef");
  });

  it("batch: pulls publicDecrypt with all handles then calls _onBatchDecided", async () => {
    const handles = ["0x" + "1".repeat(64), "0x" + "2".repeat(64)];
    await handleBatchDecrypt(
      { engine, requestId: 7n, handles, publicDecrypt, logger },
    );
    expect(publicDecrypt).toHaveBeenCalledWith(handles);
    expect(engine._onBatchDecided).toHaveBeenCalledWith(7n, handles, "0xabc", "0xdef");
  });

  it("single: logs and rethrows on publicDecrypt failure", async () => {
    publicDecrypt = vi.fn().mockRejectedValue(new Error("kms 503"));
    await expect(handleSingleDecrypt({
      engine, callbackName: "_onLiquidationDecided", requestId: 7n,
      handle: "0x" + "1".repeat(64), publicDecrypt, logger,
    })).rejects.toThrow();
    expect(logger.error).toHaveBeenCalled();
  });
});
