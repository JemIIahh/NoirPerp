import { expect } from "chai";
import * as hre from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import type { MarginMathHarness } from "../typechain-types";

describe("MarginMath", () => {
  let harness: MarginMathHarness;
  let owner: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];

  beforeEach(async () => {
    [owner] = await hre.ethers.getSigners();
    const Factory = await hre.ethers.getContractFactory("MarginMathHarness");
    harness = (await Factory.deploy()) as unknown as MarginMathHarness;
    await harness.waitForDeployment();
  });

  async function decryptEuint(handle: string): Promise<bigint> {
    return hre.fhevm.userDecryptEuint(
      FhevmType.euint64,
      handle,
      await harness.getAddress(),
      owner,
    );
  }

  async function decryptEbool(handle: string): Promise<boolean> {
    return hre.fhevm.userDecryptEbool(
      handle,
      await harness.getAddress(),
      owner,
    );
  }

  describe("notional", () => {
    it("returns size * price", async () => {
      await (await harness.runNotional(10n, 2000n)).wait();
      const handle = await harness.lastEuint();
      expect(await decryptEuint(handle)).to.equal(20_000n);
    });

    it("returns 0 when size is 0", async () => {
      await (await harness.runNotional(0n, 2000n)).wait();
      expect(await decryptEuint(await harness.lastEuint())).to.equal(0n);
    });
  });

  describe("marginOK", () => {
    // 20x max leverage; collateral=100, notional=2000 → 100*20=2000, equal allowed
    it("true when collateral * maxLev == notional (boundary)", async () => {
      await (await harness.runMarginOK(100n, 2000n, 20n)).wait();
      expect(await decryptEbool(await harness.lastEbool())).to.equal(true);
    });

    it("true when collateral * maxLev > notional (comfortable margin)", async () => {
      await (await harness.runMarginOK(200n, 2000n, 20n)).wait();
      expect(await decryptEbool(await harness.lastEbool())).to.equal(true);
    });

    it("false when collateral * maxLev < notional (over-leveraged)", async () => {
      await (await harness.runMarginOK(50n, 2000n, 20n)).wait();
      expect(await decryptEbool(await harness.lastEbool())).to.equal(false);
    });

    it("true with 1x leverage and equal collateral", async () => {
      await (await harness.runMarginOK(1000n, 1000n, 1n)).wait();
      expect(await decryptEbool(await harness.lastEbool())).to.equal(true);
    });
  });

  describe("pnlLong", () => {
    it("pure profit when currentPrice > entryPrice", async () => {
      // size=2, entry=100, curr=150 → profit = 2*50 = 100, loss = 0
      await (await harness.runPnlLong(2n, 100n, 150n)).wait();
      expect(await decryptEuint(await harness.lastProfit())).to.equal(100n);
      expect(await decryptEuint(await harness.lastLoss())).to.equal(0n);
    });

    it("pure loss when currentPrice < entryPrice", async () => {
      // size=2, entry=100, curr=80 → profit = 0, loss = 2*20 = 40
      await (await harness.runPnlLong(2n, 100n, 80n)).wait();
      expect(await decryptEuint(await harness.lastProfit())).to.equal(0n);
      expect(await decryptEuint(await harness.lastLoss())).to.equal(40n);
    });

    it("both zero when currentPrice == entryPrice", async () => {
      await (await harness.runPnlLong(5n, 100n, 100n)).wait();
      expect(await decryptEuint(await harness.lastProfit())).to.equal(0n);
      expect(await decryptEuint(await harness.lastLoss())).to.equal(0n);
    });
  });

  describe("pnlShort", () => {
    it("pure profit when currentPrice < entryPrice", async () => {
      // size=2, entry=100, curr=80 → profit = 2*20 = 40, loss = 0
      await (await harness.runPnlShort(2n, 100n, 80n)).wait();
      expect(await decryptEuint(await harness.lastProfit())).to.equal(40n);
      expect(await decryptEuint(await harness.lastLoss())).to.equal(0n);
    });

    it("pure loss when currentPrice > entryPrice", async () => {
      // size=2, entry=100, curr=150 → profit = 0, loss = 2*50 = 100
      await (await harness.runPnlShort(2n, 100n, 150n)).wait();
      expect(await decryptEuint(await harness.lastProfit())).to.equal(0n);
      expect(await decryptEuint(await harness.lastLoss())).to.equal(100n);
    });

    it("both zero when currentPrice == entryPrice", async () => {
      await (await harness.runPnlShort(5n, 100n, 100n)).wait();
      expect(await decryptEuint(await harness.lastProfit())).to.equal(0n);
      expect(await decryptEuint(await harness.lastLoss())).to.equal(0n);
    });
  });

  describe("shouldLiquidate", () => {
    // BPS_DIVISOR = 10_000, maintBps = 500 (5%)
    // condition: loss * 10000 >= collateral * 500
    // equivalently: loss / collateral >= 5% (but no div used on ct)

    it("false when loss is zero", async () => {
      await (await harness.runShouldLiquidate(1000n, 0n, 500n)).wait();
      expect(await decryptEbool(await harness.lastEbool())).to.equal(false);
    });

    it("false when loss is under maintenance threshold", async () => {
      // loss = 40, collateral = 1000, maintBps = 500
      // 40 * 10000 = 400_000 ; 1000 * 500 = 500_000 ; 400k < 500k → false
      await (await harness.runShouldLiquidate(1000n, 40n, 500n)).wait();
      expect(await decryptEbool(await harness.lastEbool())).to.equal(false);
    });

    it("true at boundary (loss * BPS == collateral * maintBps)", async () => {
      // loss = 50, collateral = 1000, maintBps = 500
      // 50 * 10000 = 500_000 ; 1000 * 500 = 500_000 → equal → true (>=)
      await (await harness.runShouldLiquidate(1000n, 50n, 500n)).wait();
      expect(await decryptEbool(await harness.lastEbool())).to.equal(true);
    });

    it("true when loss exceeds maintenance threshold", async () => {
      // loss = 100, collateral = 1000, maintBps = 500
      // 100 * 10000 = 1_000_000 ; 1000 * 500 = 500_000 → true
      await (await harness.runShouldLiquidate(1000n, 100n, 500n)).wait();
      expect(await decryptEbool(await harness.lastEbool())).to.equal(true);
    });
  });
});
