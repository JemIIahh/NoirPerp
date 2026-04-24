import { expect } from "chai";
import * as hre from "hardhat";
import type { TickMathHarness } from "../typechain-types";

describe("TickMath", () => {
  let harness: TickMathHarness;

  const MIN_TICK = -887272;
  const MAX_TICK = 887272;
  const MIN_SQRT_RATIO = 4295128739n;
  const MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342n;

  beforeEach(async () => {
    const Harness = await hre.ethers.getContractFactory("TickMathHarness");
    harness = (await Harness.deploy()) as unknown as TickMathHarness;
    await harness.waitForDeployment();
  });

  describe("getSqrtRatioAtTick", () => {
    it("returns MIN_SQRT_RATIO at MIN_TICK", async () => {
      expect(await harness.getSqrtRatioAtTick(MIN_TICK)).to.equal(MIN_SQRT_RATIO);
    });

    it("returns MAX_SQRT_RATIO at MAX_TICK", async () => {
      expect(await harness.getSqrtRatioAtTick(MAX_TICK)).to.equal(MAX_SQRT_RATIO);
    });

    it("returns 2**96 at tick 0 (price = 1)", async () => {
      expect(await harness.getSqrtRatioAtTick(0)).to.equal(2n ** 96n);
    });

    it("is monotonically increasing", async () => {
      const a = await harness.getSqrtRatioAtTick(100);
      const b = await harness.getSqrtRatioAtTick(101);
      expect(b).to.be.gt(a);
    });

    it("handles negative ticks symmetrically", async () => {
      const pos = await harness.getSqrtRatioAtTick(1000);
      const neg = await harness.getSqrtRatioAtTick(-1000);
      // sqrtPrice(-tick) * sqrtPrice(+tick) == 2**192 (approximately)
      // Exact invariant: product equals 2^192 within rounding
      const product = pos * neg;
      const target = 2n ** 192n;
      // allow up to 2 ULP drift (uniV3 rounding)
      const diff = product > target ? product - target : target - product;
      expect(diff).to.be.lt(1n << 16n);
    });

    it("reverts on tick below MIN_TICK", async () => {
      await expect(harness.getSqrtRatioAtTick(MIN_TICK - 1)).to.be.reverted;
    });

    it("reverts on tick above MAX_TICK", async () => {
      await expect(harness.getSqrtRatioAtTick(MAX_TICK + 1)).to.be.reverted;
    });
  });

  describe("getTickAtSqrtRatio", () => {
    it("returns MIN_TICK at MIN_SQRT_RATIO", async () => {
      expect(await harness.getTickAtSqrtRatio(MIN_SQRT_RATIO)).to.equal(MIN_TICK);
    });

    it("returns MAX_TICK at MAX_SQRT_RATIO - 1 (MAX_SQRT is exclusive upper)", async () => {
      expect(
        await harness.getTickAtSqrtRatio(MAX_SQRT_RATIO - 1n),
      ).to.equal(MAX_TICK - 1);
    });

    it("round-trips at tick 0", async () => {
      const ratio = await harness.getSqrtRatioAtTick(0);
      expect(await harness.getTickAtSqrtRatio(ratio)).to.equal(0);
    });

    it("round-trips at tick 1000", async () => {
      const ratio = await harness.getSqrtRatioAtTick(1000);
      expect(await harness.getTickAtSqrtRatio(ratio)).to.equal(1000);
    });

    it("reverts on sqrtPriceX96 below MIN_SQRT_RATIO", async () => {
      await expect(harness.getTickAtSqrtRatio(MIN_SQRT_RATIO - 1n)).to.be.reverted;
    });

    it("reverts on sqrtPriceX96 >= MAX_SQRT_RATIO", async () => {
      await expect(harness.getTickAtSqrtRatio(MAX_SQRT_RATIO)).to.be.reverted;
    });
  });
});
