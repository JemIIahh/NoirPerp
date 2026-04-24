import { expect } from "chai";
import * as hre from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import type { FHESafeMathHarness } from "../typechain-types";

describe("FHESafeMath", () => {
  let harness: FHESafeMathHarness;
  let owner: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];

  const MAX_U64 = (1n << 64n) - 1n;

  beforeEach(async () => {
    [owner] = await hre.ethers.getSigners();
    const Harness = await hre.ethers.getContractFactory("FHESafeMathHarness");
    harness = (await Harness.deploy()) as unknown as FHESafeMathHarness;
    await harness.waitForDeployment();
  });

  async function decryptLast(): Promise<bigint> {
    const handle = await harness.lastResult();
    return hre.fhevm.userDecryptEuint(
      FhevmType.euint64,
      handle,
      await harness.getAddress(),
      owner,
    );
  }

  describe("safeSub", () => {
    it("returns a - b when a > b", async () => {
      await (await harness.runSafeSub(100n, 40n)).wait();
      expect(await decryptLast()).to.equal(60n);
    });

    it("returns a - b when a == b (zero)", async () => {
      await (await harness.runSafeSub(100n, 100n)).wait();
      expect(await decryptLast()).to.equal(0n);
    });

    it("returns 0 when b > a (no wraparound)", async () => {
      await (await harness.runSafeSub(40n, 100n)).wait();
      expect(await decryptLast()).to.equal(0n);
    });

    it("handles max uint64 correctly", async () => {
      await (await harness.runSafeSub(MAX_U64, 1n)).wait();
      expect(await decryptLast()).to.equal(MAX_U64 - 1n);
    });

    it("returns 0 when b == max and a == 0", async () => {
      await (await harness.runSafeSub(0n, MAX_U64)).wait();
      expect(await decryptLast()).to.equal(0n);
    });
  });

  describe("safeAdd", () => {
    it("returns a + b when no overflow", async () => {
      await (await harness.runSafeAdd(100n, 40n)).wait();
      expect(await decryptLast()).to.equal(140n);
    });

    it("returns max uint64 on overflow (saturates)", async () => {
      await (await harness.runSafeAdd(MAX_U64, 1n)).wait();
      expect(await decryptLast()).to.equal(MAX_U64);
    });

    it("returns max uint64 when both operands are max", async () => {
      await (await harness.runSafeAdd(MAX_U64, MAX_U64)).wait();
      expect(await decryptLast()).to.equal(MAX_U64);
    });

    it("returns 0 when both operands are 0", async () => {
      await (await harness.runSafeAdd(0n, 0n)).wait();
      expect(await decryptLast()).to.equal(0n);
    });

    it("returns a when b is 0", async () => {
      await (await harness.runSafeAdd(12345n, 0n)).wait();
      expect(await decryptLast()).to.equal(12345n);
    });
  });

  describe("absDiff", () => {
    it("returns a - b when a > b", async () => {
      await (await harness.runAbsDiff(100n, 40n)).wait();
      expect(await decryptLast()).to.equal(60n);
    });

    it("returns b - a when b > a", async () => {
      await (await harness.runAbsDiff(40n, 100n)).wait();
      expect(await decryptLast()).to.equal(60n);
    });

    it("returns 0 when a == b", async () => {
      await (await harness.runAbsDiff(100n, 100n)).wait();
      expect(await decryptLast()).to.equal(0n);
    });

    it("handles max uint64 vs 0", async () => {
      await (await harness.runAbsDiff(MAX_U64, 0n)).wait();
      expect(await decryptLast()).to.equal(MAX_U64);
    });
  });

  describe("safeMul", () => {
    const THRESHOLD = 1n << 32n;

    it("returns a * b when both fit in 2^32", async () => {
      await (await harness.runSafeMul(1000n, 2000n)).wait();
      expect(await decryptLast()).to.equal(2_000_000n);
    });

    it("returns 0 when a is 0", async () => {
      await (await harness.runSafeMul(0n, 12345n)).wait();
      expect(await decryptLast()).to.equal(0n);
    });

    it("returns 0 when b is 0", async () => {
      await (await harness.runSafeMul(12345n, 0n)).wait();
      expect(await decryptLast()).to.equal(0n);
    });

    it("saturates at MAX_U64 when a >= 2^32", async () => {
      await (await harness.runSafeMul(THRESHOLD, 1n)).wait();
      expect(await decryptLast()).to.equal(MAX_U64);
    });

    it("saturates at MAX_U64 when b >= 2^32", async () => {
      await (await harness.runSafeMul(1n, THRESHOLD)).wait();
      expect(await decryptLast()).to.equal(MAX_U64);
    });

    it("allows max safe product: (2^32 - 1) * (2^32 - 1)", async () => {
      const maxFit = THRESHOLD - 1n;
      await (await harness.runSafeMul(maxFit, maxFit)).wait();
      expect(await decryptLast()).to.equal(maxFit * maxFit);
    });

    it("saturates on clearly overflowing inputs (both large)", async () => {
      await (await harness.runSafeMul(MAX_U64, MAX_U64)).wait();
      expect(await decryptLast()).to.equal(MAX_U64);
    });
  });
});
