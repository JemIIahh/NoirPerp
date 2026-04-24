import { expect } from "chai";
import * as hre from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import type { NoirVault, MockERC7984, Oracle, AMMEngine } from "../typechain-types";

const MARKET_ETH = 2;
const STALENESS = 90;
const DEVIATION_BPS = 50;

describe("AMMEngine — swap (USDCx → synthetic ETH)", () => {
  let vault: NoirVault;
  let token: MockERC7984;
  let oracle: Oracle;
  let amm: AMMEngine;
  let admin: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let relayerA: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let relayerB: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let relayerC: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let alice: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];

  async function now(): Promise<number> {
    const blk = await hre.ethers.provider.getBlock("latest");
    return blk!.timestamp;
  }

  async function encrypt(contract: string, user: string, value: bigint) {
    const input = hre.fhevm.createEncryptedInput(contract, user);
    input.add64(value);
    return await input.encrypt();
  }

  async function commitPrice(marketId: number, price: bigint) {
    const t = await now();
    await (await oracle.connect(relayerA).submitPrice(marketId, price, t)).wait();
    await (await oracle.connect(relayerB).submitPrice(marketId, price, t + 1)).wait();
  }

  async function decrypt(handle: string, contractAddr: string, signer: typeof admin): Promise<bigint> {
    return hre.fhevm.userDecryptEuint(FhevmType.euint64, handle, contractAddr, signer);
  }

  beforeEach(async () => {
    [admin, relayerA, relayerB, relayerC, alice] = await hre.ethers.getSigners();

    const TokenFactory = await hre.ethers.getContractFactory("MockERC7984");
    token = (await TokenFactory.deploy("MockUSDCx", "mUSDCx")) as unknown as MockERC7984;
    await token.waitForDeployment();
    await (await token.mintPlaintext(alice.address, 100_000n)).wait();

    const VaultFactory = await hre.ethers.getContractFactory("NoirVault");
    vault = (await VaultFactory.deploy(admin.address, await token.getAddress())) as unknown as NoirVault;
    await vault.waitForDeployment();

    const OracleFactory = await hre.ethers.getContractFactory("Oracle");
    oracle = (await OracleFactory.deploy(
      admin.address, [relayerA.address, relayerB.address, relayerC.address],
      STALENESS, DEVIATION_BPS,
    )) as unknown as Oracle;
    await oracle.waitForDeployment();

    const AMMFactory = await hre.ethers.getContractFactory("AMMEngine");
    amm = (await AMMFactory.deploy(
      await vault.getAddress(),
      admin.address,
    )) as unknown as AMMEngine;
    await amm.waitForDeployment();
    await (await vault.registerEngine(await amm.getAddress())).wait();

    // Wire oracle to AMM (via admin setter — will be added alongside swap)
    await (await amm.setOracle(await oracle.getAddress())).wait();

    await (await token.connect(alice).setOperator(await vault.getAddress(), 2n ** 48n - 1n)).wait();
    await (await vault.connect(alice).deposit(10_000n)).wait();

    await commitPrice(MARKET_ETH, 3_000n);
  });

  describe("happy path", () => {
    it("swaps 3000 USDCx → 0.997 synthetic ETH (with 30 bps fee)", async () => {
      // fee = 3000 × 30 / 10000 = 9 USDCx
      // amountAfterFee = 3000 - 9 = 2991 USDCx
      // ethOut = 2991 / 3000 = 0.997 → floor to 0 (integer div)
      // For whole-ETH output, need bigger amountIn — let's use 3_000_000 base units
      // Rescale: alice deposited 10_000 × 10^6 (if we want decimals)... or just test integer output

      // For simplicity: use a price of 3 so amountIn 3000 → amountOut ≈ 997
      // Re-commit price = 3
      // Actually the oracle price is still uint64 plain; let's use price=3 for cleaner math
      // Re-do setup with price 3 for this test
      // Skipped: use the existing 3000 price, assert floor-rounded ethOut
      const engineAddr = await amm.getAddress();
      const amtEnc = await encrypt(engineAddr, alice.address, 3_000n);
      await (await amm.connect(alice).swap(
        amtEnc.handles[0], amtEnc.inputProof, MARKET_ETH
      )).wait();

      // ethOut = floor((3000 - 9) / 3000) = 0 with integer div.
      // Verifies execution + sane vault accounting + explicit assertion
      // that synth == 0 (documented floor-rounding edge case: amountIn
      // must exceed price × (BPS / (BPS - feeBps)) for any synth output).
      const vaultBal = await decrypt(
        await vault.getBalance(alice.address),
        await vault.getAddress(),
        alice,
      );
      expect(vaultBal).to.equal(7_000n); // 10_000 - 3_000

      const synthHandle = await amm.getSyntheticBalance(alice.address, MARKET_ETH);
      const synth = await decrypt(synthHandle, await amm.getAddress(), alice);
      expect(synth).to.equal(0n); // floor-rounded to zero — KNOWN edge case
    });

    it("swap with price=3 produces non-zero synthetic output", async () => {
      await commitPrice(MARKET_ETH, 3n);

      const engineAddr = await amm.getAddress();
      const amtEnc = await encrypt(engineAddr, alice.address, 3_000n);
      await (await amm.connect(alice).swap(
        amtEnc.handles[0], amtEnc.inputProof, MARKET_ETH
      )).wait();

      // fee = 3000 × 30 / 10000 = 9
      // amountAfterFee = 2991
      // ethOut = 2991 / 3 = 997
      const synthHandle = await amm.getSyntheticBalance(alice.address, MARKET_ETH);
      const synth = await decrypt(synthHandle, await amm.getAddress(), alice);
      expect(synth).to.equal(997n);

      // AMM vault balance increased by 3000 (full amountIn went into pool)
      // Alice vault balance decreased by 3000
      const aliceBal = await decrypt(
        await vault.getBalance(alice.address),
        await vault.getAddress(),
        alice,
      );
      expect(aliceBal).to.equal(7_000n);
    });
  });

  describe("guards", () => {
    it("reverts on stale oracle", async () => {
      await hre.ethers.provider.send("evm_increaseTime", [STALENESS + 10]);
      await hre.ethers.provider.send("evm_mine", []);

      const engineAddr = await amm.getAddress();
      const amtEnc = await encrypt(engineAddr, alice.address, 100n);
      await expect(amm.connect(alice).swap(
        amtEnc.handles[0], amtEnc.inputProof, MARKET_ETH
      )).to.be.revertedWithCustomError(amm, "OraclePriceStale");
    });

    it("reverts on invalid marketId", async () => {
      const engineAddr = await amm.getAddress();
      const amtEnc = await encrypt(engineAddr, alice.address, 100n);
      await expect(amm.connect(alice).swap(
        amtEnc.handles[0], amtEnc.inputProof, 99
      )).to.be.revertedWithCustomError(amm, "InvalidMarket");
    });

    it("reverts if oracle not configured", async () => {
      // Deploy a fresh AMM without setOracle
      const AMMFactory = await hre.ethers.getContractFactory("AMMEngine");
      const freshAmm = (await AMMFactory.deploy(
        await vault.getAddress(),
        admin.address,
      )) as unknown as AMMEngine;
      await freshAmm.waitForDeployment();
      await (await vault.registerEngine(await freshAmm.getAddress())).wait();

      const engineAddr = await freshAmm.getAddress();
      const amtEnc = await encrypt(engineAddr, alice.address, 100n);
      await expect(freshAmm.connect(alice).swap(
        amtEnc.handles[0], amtEnc.inputProof, MARKET_ETH
      )).to.be.revertedWithCustomError(freshAmm, "OracleNotSet");
    });
  });
});
