import { expect } from "chai";
import * as hre from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import type { Oracle } from "../typechain-types";

describe("Oracle", () => {
  const MARKET_BTC = 1;
  const MARKET_ETH = 2;
  const MARKET_SOL = 3;
  const STALENESS = 90; // seconds
  const DEVIATION_BPS = 50; // 0.5%

  let oracle: Oracle;
  let admin: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let relayerA: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let relayerB: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let relayerC: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let notRelayer: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];

  async function now(): Promise<number> {
    const blk = await hre.ethers.provider.getBlock("latest");
    return blk!.timestamp;
  }

  beforeEach(async () => {
    [admin, relayerA, relayerB, relayerC, notRelayer] = await hre.ethers.getSigners();
    const Factory = await hre.ethers.getContractFactory("Oracle");
    oracle = (await Factory.deploy(
      admin.address,
      [relayerA.address, relayerB.address, relayerC.address],
      STALENESS,
      DEVIATION_BPS,
    )) as unknown as Oracle;
    await oracle.waitForDeployment();
  });

  describe("constructor", () => {
    it("stores admin, relayers, staleness, and deviation", async () => {
      expect(await oracle.admin()).to.equal(admin.address);
      expect(await oracle.relayers(0)).to.equal(relayerA.address);
      expect(await oracle.relayers(1)).to.equal(relayerB.address);
      expect(await oracle.relayers(2)).to.equal(relayerC.address);
      expect(await oracle.stalenessSeconds()).to.equal(STALENESS);
      expect(await oracle.deviationBps()).to.equal(DEVIATION_BPS);
    });
  });

  describe("submitPrice — access control", () => {
    it("reverts when caller is not a relayer", async () => {
      await expect(
        oracle.connect(notRelayer).submitPrice(MARKET_BTC, 50_000n, await now())
      ).to.be.revertedWithCustomError(oracle, "NotRelayer");
    });

    it("accepts a submission from any of the 3 relayers", async () => {
      await expect(
        oracle.connect(relayerA).submitPrice(MARKET_BTC, 50_000n, await now())
      ).to.not.be.reverted;
    });
  });

  describe("submitPrice — quorum flow", () => {
    it("first submission stores as pending (not fresh yet)", async () => {
      await (await oracle.connect(relayerA).submitPrice(MARKET_ETH, 3000n, await now())).wait();
      const [, fresh] = await oracle.getPrice(MARKET_ETH);
      expect(fresh).to.equal(false);
    });

    it("second submission from a DIFFERENT relayer within deviation commits", async () => {
      const t = await now();
      await (await oracle.connect(relayerA).submitPrice(MARKET_ETH, 3000n, t)).wait();
      await (await oracle.connect(relayerB).submitPrice(MARKET_ETH, 3005n, t + 1)).wait();
      const [price, fresh] = await oracle.getPrice(MARKET_ETH);
      expect(price).to.equal(3005n);
      expect(fresh).to.equal(true);
    });

    it("second submission from SAME relayer does NOT commit", async () => {
      const t = await now();
      await (await oracle.connect(relayerA).submitPrice(MARKET_ETH, 3000n, t)).wait();
      // same relayer resubmits — should be treated as pending replacement, NOT commit
      await (await oracle.connect(relayerA).submitPrice(MARKET_ETH, 3005n, t + 1)).wait();
      const [, fresh] = await oracle.getPrice(MARKET_ETH);
      expect(fresh).to.equal(false);
    });

    it("rejects when second relayer's price exceeds deviation tolerance", async () => {
      const t = await now();
      await (await oracle.connect(relayerA).submitPrice(MARKET_ETH, 3000n, t)).wait();
      // 1% deviation > 0.5% max → reject
      await expect(
        oracle.connect(relayerB).submitPrice(MARKET_ETH, 3030n, t + 1)
      ).to.be.revertedWithCustomError(oracle, "DeviationTooLarge");
    });

    it("rejects when pending is stale", async () => {
      const t = await now();
      await (await oracle.connect(relayerA).submitPrice(MARKET_ETH, 3000n, t)).wait();
      // Fast-forward past staleness window
      await hre.ethers.provider.send("evm_increaseTime", [STALENESS + 1]);
      await hre.ethers.provider.send("evm_mine", []);
      // B tries to commit but A's pending is stale
      await expect(
        oracle.connect(relayerB).submitPrice(MARKET_ETH, 3005n, await now())
      ).to.be.revertedWithCustomError(oracle, "PendingStale");
    });

    it("third submission starts a new pending cycle after prior commit", async () => {
      const t = await now();
      await (await oracle.connect(relayerA).submitPrice(MARKET_ETH, 3000n, t)).wait();
      await (await oracle.connect(relayerB).submitPrice(MARKET_ETH, 3005n, t + 1)).wait();
      // Now committed. Relayer C starts a new cycle.
      await (await oracle.connect(relayerC).submitPrice(MARKET_ETH, 3010n, t + 2)).wait();
      // Committed price is still 3005; new pending is not fresh yet
      const [price, fresh] = await oracle.getPrice(MARKET_ETH);
      expect(price).to.equal(3005n);
      expect(fresh).to.equal(true); // still within staleness window
    });
  });

  describe("getPrice — freshness", () => {
    it("returns fresh=false for never-committed market", async () => {
      const [price, fresh] = await oracle.getPrice(MARKET_SOL);
      expect(price).to.equal(0n);
      expect(fresh).to.equal(false);
    });

    it("returns fresh=false after the committed price ages out", async () => {
      const t = await now();
      await (await oracle.connect(relayerA).submitPrice(MARKET_ETH, 3000n, t)).wait();
      await (await oracle.connect(relayerB).submitPrice(MARKET_ETH, 3005n, t + 1)).wait();
      await hre.ethers.provider.send("evm_increaseTime", [STALENESS + 10]);
      await hre.ethers.provider.send("evm_mine", []);
      const [, fresh] = await oracle.getPrice(MARKET_ETH);
      expect(fresh).to.equal(false);
    });
  });

  describe("getEncryptedPrice", () => {
    it("reverts when price is not fresh", async () => {
      await expect(oracle.getEncryptedPrice(MARKET_SOL))
        .to.be.revertedWithCustomError(oracle, "PriceNotFresh");
    });

    it("returns a ciphertext matching the plaintext for a fresh price", async () => {
      const t = await now();
      await (await oracle.connect(relayerA).submitPrice(MARKET_BTC, 50_000n, t)).wait();
      await (await oracle.connect(relayerB).submitPrice(MARKET_BTC, 50_100n, t + 1)).wait();
      const tx = await oracle.requestEncryptedPrice(MARKET_BTC);
      await tx.wait();
      const handle = await oracle.lastEncryptedPrice();
      const plain = await hre.fhevm.userDecryptEuint(
        FhevmType.euint64,
        handle,
        await oracle.getAddress(),
        admin,
      );
      expect(plain).to.equal(50_100n);
    });

    it("getEncryptedPrice (engine-facing) succeeds on a fresh price", async () => {
      // Covers the engine-facing path (allowTransient, tx-scoped).
      // We can't decrypt across txs here, but we assert the call succeeds,
      // proving the trivial-encrypt + allowTransient + allowThis happy path.
      const t = await now();
      await (await oracle.connect(relayerA).submitPrice(MARKET_ETH, 3000n, t)).wait();
      await (await oracle.connect(relayerB).submitPrice(MARKET_ETH, 3005n, t + 1)).wait();
      const tx = await oracle.getEncryptedPrice(MARKET_ETH);
      const receipt = await tx.wait();
      expect(receipt!.status).to.equal(1);
    });
  });

  describe("admin", () => {
    it("admin can rotate a relayer", async () => {
      await expect(oracle.rotateRelayer(0, notRelayer.address))
        .to.emit(oracle, "RelayerRotated")
        .withArgs(0, relayerA.address, notRelayer.address);
      expect(await oracle.relayers(0)).to.equal(notRelayer.address);
    });

    it("non-admin cannot rotate a relayer", async () => {
      await expect(
        oracle.connect(relayerA).rotateRelayer(0, notRelayer.address)
      ).to.be.revertedWithCustomError(oracle, "NotAdmin");
    });

    it("admin can update staleness seconds", async () => {
      await (await oracle.setStalenessSeconds(120)).wait();
      expect(await oracle.stalenessSeconds()).to.equal(120);
    });

    it("admin can update deviationBps", async () => {
      await (await oracle.setDeviationBps(100)).wait();
      expect(await oracle.deviationBps()).to.equal(100);
    });

    it("rotateRelayer reverts on out-of-range index", async () => {
      await expect(
        oracle.rotateRelayer(3, notRelayer.address)
      ).to.be.revertedWithCustomError(oracle, "BadIndex");
    });

    it("rotateRelayer reverts on zero address", async () => {
      await expect(
        oracle.rotateRelayer(0, hre.ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(oracle, "ZeroAddress");
    });

    it("admin can transfer admin role", async () => {
      await expect(oracle.transferAdmin(notRelayer.address))
        .to.emit(oracle, "AdminTransferred")
        .withArgs(admin.address, notRelayer.address);
      expect(await oracle.admin()).to.equal(notRelayer.address);
    });

    it("transferAdmin reverts on zero address", async () => {
      await expect(
        oracle.transferAdmin(hre.ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(oracle, "ZeroAddress");
    });

    it("non-admin cannot transfer admin role", async () => {
      await expect(
        oracle.connect(relayerA).transferAdmin(relayerA.address)
      ).to.be.revertedWithCustomError(oracle, "NotAdmin");
    });
  });
});
