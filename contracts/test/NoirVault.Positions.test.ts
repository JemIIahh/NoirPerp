import { expect } from "chai";
import * as hre from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import type { NoirVault, MockERC7984, MockEngine } from "../typechain-types";

describe("NoirVault — position storage", () => {
  let vault: NoirVault;
  let engine: MockEngine;
  let token: MockERC7984;
  let admin: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let alice: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let bob: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];

  async function decrypt(handle: string, user: typeof admin): Promise<bigint> {
    return hre.fhevm.userDecryptEuint(
      FhevmType.euint64,
      handle,
      await vault.getAddress(),
      user,
    );
  }

  beforeEach(async () => {
    [admin, alice, bob] = await hre.ethers.getSigners();

    const TokenFactory = await hre.ethers.getContractFactory("MockERC7984");
    token = (await TokenFactory.deploy("MockUSDCx", "mUSDCx")) as unknown as MockERC7984;
    await token.waitForDeployment();

    const VaultFactory = await hre.ethers.getContractFactory("NoirVault");
    vault = (await VaultFactory.deploy(admin.address, await token.getAddress())) as unknown as NoirVault;
    await vault.waitForDeployment();

    const EngineFactory = await hre.ethers.getContractFactory("MockEngine");
    engine = (await EngineFactory.deploy(await vault.getAddress())) as unknown as MockEngine;
    await engine.waitForDeployment();

    await (await vault.registerEngine(await engine.getAddress())).wait();
  });

  describe("writePosition", () => {
    it("stores a new position and increments nextPositionId", async () => {
      const id0 = await vault.nextPositionId();
      await (
        await engine.openMockPosition(
          alice.address,
          100n /* size */,
          3000n /* entryPrice */,
          500n /* collateral */,
          true /* isLong */,
          2 /* marketId = ETH */,
        )
      ).wait();
      const id1 = await vault.nextPositionId();
      expect(id1).to.equal(id0 + 1n);

      const pos = await vault.getPosition(id0);
      expect(pos.owner).to.equal(alice.address);
      expect(pos.isLong).to.equal(true);
      expect(pos.marketId).to.equal(2);
      expect(pos.active).to.equal(true);
    });

    it("position's encrypted fields decrypt to the written values", async () => {
      await (
        await engine.openMockPosition(alice.address, 100n, 3000n, 500n, true, 2)
      ).wait();
      const pos = await vault.getPosition(0);
      expect(await decrypt(pos.size, alice)).to.equal(100n);
      expect(await decrypt(pos.entryPrice, alice)).to.equal(3000n);
      expect(await decrypt(pos.collateral, alice)).to.equal(500n);
    });

    it("non-engine cannot call writePosition directly", async () => {
      // writePosition is engine-only; simulate direct call from alice
      const dummyCt = hre.ethers.ZeroHash;
      await expect(
        vault.connect(alice).writePosition(alice.address, dummyCt, dummyCt, dummyCt, true, 2)
      ).to.be.revertedWithCustomError(vault, "NotAuthorizedEngine");
    });

    it("reverts when paused", async () => {
      await (await vault.pause()).wait();
      await expect(
        engine.openMockPosition(alice.address, 100n, 3000n, 500n, true, 2)
      ).to.be.reverted; // reverts with VaultPaused (but MockEngine doesn't forward the custom error name)
    });
  });

  describe("closePosition", () => {
    beforeEach(async () => {
      await (
        await engine.openMockPosition(alice.address, 100n, 3000n, 500n, true, 2)
      ).wait();
    });

    it("engine can close an active position", async () => {
      await (await engine.closeMockPosition(0)).wait();
      const pos = await vault.getPosition(0);
      expect(pos.active).to.equal(false);
    });

    it("non-engine cannot closePosition", async () => {
      await expect(
        vault.connect(bob).closePosition(0)
      ).to.be.revertedWithCustomError(vault, "NotAuthorizedEngine");
    });

    it("closing an already-closed position does not revert but stays inactive", async () => {
      await (await engine.closeMockPosition(0)).wait();
      await (await engine.closeMockPosition(0)).wait(); // idempotent
      const pos = await vault.getPosition(0);
      expect(pos.active).to.equal(false);
    });
  });

  describe("position id counter", () => {
    it("increments independently per position", async () => {
      await (await engine.openMockPosition(alice.address, 100n, 3000n, 500n, true, 2)).wait();
      await (await engine.openMockPosition(bob.address, 200n, 50000n, 1000n, false, 1)).wait();
      await (await engine.openMockPosition(alice.address, 50n, 100n, 250n, true, 3)).wait();
      expect(await vault.nextPositionId()).to.equal(3n);
    });

    it("positions for different users are isolated", async () => {
      await (await engine.openMockPosition(alice.address, 100n, 3000n, 500n, true, 2)).wait();
      await (await engine.openMockPosition(bob.address, 200n, 50000n, 1000n, false, 1)).wait();
      const pAlice = await vault.getPosition(0);
      const pBob = await vault.getPosition(1);
      expect(pAlice.owner).to.equal(alice.address);
      expect(pBob.owner).to.equal(bob.address);
      expect(pAlice.isLong).to.equal(true);
      expect(pBob.isLong).to.equal(false);
    });
  });
});
