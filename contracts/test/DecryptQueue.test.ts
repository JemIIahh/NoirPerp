import { expect } from "chai";
import * as hre from "hardhat";
import type { DecryptQueueConsumer } from "../typechain-types";

describe("DecryptQueue", () => {
  let queue: DecryptQueueConsumer;
  let owner: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let other: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];

  beforeEach(async () => {
    [owner, other] = await hre.ethers.getSigners();
    const Factory = await hre.ethers.getContractFactory("DecryptQueueConsumer");
    queue = (await Factory.deploy()) as unknown as DecryptQueueConsumer;
    await queue.waitForDeployment();
  });

  describe("enqueue + pendingInfo", () => {
    it("stores the pending decrypt info", async () => {
      const reqId = 42n;
      const ctxId = 100n;
      const ctx = "0xdeadbeef";
      await (await queue.enqueue(reqId, owner.address, ctxId, ctx)).wait();

      const info = await queue.pendingInfo(reqId);
      expect(info.caller).to.equal(owner.address);
      expect(info.contextId).to.equal(ctxId);
      expect(info.context).to.equal(ctx);
      expect(info.requestedAt).to.be.gt(0);
    });

    it("emits DecryptEnqueued event", async () => {
      const reqId = 1n;
      await expect(queue.enqueue(reqId, owner.address, 5n, "0x"))
        .to.emit(queue, "DecryptEnqueued")
        .withArgs(reqId, owner.address, 5n);
    });

    it("isPending returns true after enqueue", async () => {
      await (await queue.enqueue(7n, owner.address, 0n, "0x")).wait();
      expect(await queue.isPending(7n)).to.equal(true);
    });

    it("isPending returns false for unknown id", async () => {
      expect(await queue.isPending(999n)).to.equal(false);
    });
  });

  describe("dequeue (replay guard)", () => {
    it("returns the stored info and deletes the entry", async () => {
      await (await queue.enqueue(10n, owner.address, 50n, "0xabcd")).wait();
      await (await queue.dequeueAndRecord(10n)).wait();

      const captured = await queue.lastDequeued();
      expect(captured.caller).to.equal(owner.address);
      expect(captured.contextId).to.equal(50n);
      expect(captured.context).to.equal("0xabcd");

      // After dequeue, entry must be gone
      expect(await queue.isPending(10n)).to.equal(false);
    });

    it("emits DecryptDequeued event", async () => {
      await (await queue.enqueue(3n, owner.address, 0n, "0x")).wait();
      await expect(queue.dequeueAndRecord(3n))
        .to.emit(queue, "DecryptDequeued")
        .withArgs(3n);
    });

    it("reverts when dequeueing an unknown id (replay guard)", async () => {
      await expect(queue.dequeueAndRecord(999n))
        .to.be.revertedWithCustomError(queue, "DecryptNotPending");
    });

    it("reverts when dequeueing the same id twice (replay guard)", async () => {
      await (await queue.enqueue(5n, owner.address, 0n, "0x")).wait();
      await (await queue.dequeueAndRecord(5n)).wait();
      await expect(queue.dequeueAndRecord(5n))
        .to.be.revertedWithCustomError(queue, "DecryptNotPending");
    });
  });

  describe("cleanupStale", () => {
    it("removes entries older than DECRYPT_TIMEOUT", async () => {
      await (await queue.enqueue(1n, owner.address, 0n, "0x")).wait();

      // Fast-forward past timeout (10 minutes)
      await hre.ethers.provider.send("evm_increaseTime", [601]);
      await hre.ethers.provider.send("evm_mine", []);

      await (await queue.cleanupStale([1n])).wait();
      expect(await queue.isPending(1n)).to.equal(false);
    });

    it("reverts on non-stale entry (too fresh)", async () => {
      await (await queue.enqueue(2n, owner.address, 0n, "0x")).wait();
      await expect(queue.cleanupStale([2n]))
        .to.be.revertedWithCustomError(queue, "DecryptNotStale");
    });

    it("reverts on unknown id", async () => {
      await expect(queue.cleanupStale([999n]))
        .to.be.revertedWithCustomError(queue, "DecryptNotPending");
    });

    it("emits DecryptCleaned event for each cleaned entry", async () => {
      await (await queue.enqueue(8n, owner.address, 0n, "0x")).wait();
      await (await queue.enqueue(9n, owner.address, 0n, "0x")).wait();

      await hre.ethers.provider.send("evm_increaseTime", [601]);
      await hre.ethers.provider.send("evm_mine", []);

      await expect(queue.cleanupStale([8n, 9n]))
        .to.emit(queue, "DecryptCleaned").withArgs(8n)
        .and.to.emit(queue, "DecryptCleaned").withArgs(9n);
    });

    it("can be called by anyone (non-caller account)", async () => {
      await (await queue.enqueue(4n, owner.address, 0n, "0x")).wait();

      await hre.ethers.provider.send("evm_increaseTime", [601]);
      await hre.ethers.provider.send("evm_mine", []);

      await (await queue.connect(other).cleanupStale([4n])).wait();
      expect(await queue.isPending(4n)).to.equal(false);
    });
  });
});
