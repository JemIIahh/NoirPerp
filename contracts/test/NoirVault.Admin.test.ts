import { expect } from "chai";
import * as hre from "hardhat";
import type { NoirVault } from "../typechain-types";

describe("NoirVault — admin + engine authorization + pause", () => {
  let vault: NoirVault;
  let admin: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let engineA: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let engineB: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let alice: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];

  beforeEach(async () => {
    [admin, engineA, engineB, alice] = await hre.ethers.getSigners();
    const Factory = await hre.ethers.getContractFactory("NoirVault");
    // Constructor takes (admin, usdcxToken) — use ZeroAddress for token in admin-only tests
    vault = (await Factory.deploy(admin.address, hre.ethers.ZeroAddress)) as unknown as NoirVault;
    await vault.waitForDeployment();
  });

  describe("constructor", () => {
    it("sets admin", async () => {
      expect(await vault.admin()).to.equal(admin.address);
    });

    it("reverts on zero admin", async () => {
      const Factory = await hre.ethers.getContractFactory("NoirVault");
      await expect(
        Factory.deploy(hre.ethers.ZeroAddress, hre.ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(
        { interface: Factory.interface } as any, "ZeroAddress"
      );
    });

    it("starts unpaused", async () => {
      expect(await vault.paused()).to.equal(false);
    });
  });

  describe("engine registration", () => {
    it("admin can register an engine", async () => {
      await expect(vault.registerEngine(engineA.address))
        .to.emit(vault, "EngineRegistered")
        .withArgs(engineA.address);
      expect(await vault.authorizedEngines(engineA.address)).to.equal(true);
    });

    it("admin can register multiple engines", async () => {
      await (await vault.registerEngine(engineA.address)).wait();
      await (await vault.registerEngine(engineB.address)).wait();
      expect(await vault.authorizedEngines(engineA.address)).to.equal(true);
      expect(await vault.authorizedEngines(engineB.address)).to.equal(true);
    });

    it("admin can deregister an engine", async () => {
      await (await vault.registerEngine(engineA.address)).wait();
      await expect(vault.deregisterEngine(engineA.address))
        .to.emit(vault, "EngineDeregistered")
        .withArgs(engineA.address);
      expect(await vault.authorizedEngines(engineA.address)).to.equal(false);
    });

    it("non-admin cannot register", async () => {
      await expect(
        vault.connect(alice).registerEngine(engineA.address)
      ).to.be.revertedWithCustomError(vault, "NotAdmin");
    });

    it("non-admin cannot deregister", async () => {
      await (await vault.registerEngine(engineA.address)).wait();
      await expect(
        vault.connect(alice).deregisterEngine(engineA.address)
      ).to.be.revertedWithCustomError(vault, "NotAdmin");
    });

    it("cannot register zero address", async () => {
      await expect(
        vault.registerEngine(hre.ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(vault, "ZeroAddress");
    });
  });

  describe("pause / unpause", () => {
    it("admin can pause", async () => {
      await (await vault.pause()).wait();
      expect(await vault.paused()).to.equal(true);
    });

    it("admin can unpause", async () => {
      await (await vault.pause()).wait();
      await (await vault.unpause()).wait();
      expect(await vault.paused()).to.equal(false);
    });

    it("non-admin cannot pause", async () => {
      await expect(
        vault.connect(alice).pause()
      ).to.be.revertedWithCustomError(vault, "NotAdmin");
    });

    it("non-admin cannot unpause", async () => {
      await (await vault.pause()).wait();
      await expect(
        vault.connect(alice).unpause()
      ).to.be.revertedWithCustomError(vault, "NotAdmin");
    });
  });

  describe("admin transfer", () => {
    it("admin can transfer admin role", async () => {
      await expect(vault.transferAdmin(alice.address))
        .to.emit(vault, "AdminTransferred")
        .withArgs(admin.address, alice.address);
      expect(await vault.admin()).to.equal(alice.address);
    });

    it("reverts on zero address", async () => {
      await expect(
        vault.transferAdmin(hre.ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(vault, "ZeroAddress");
    });
  });
});
