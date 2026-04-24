import { expect } from "chai";
import * as hre from "hardhat";
import type { NoirVault, MockERC7984, AMMEngine } from "../typechain-types";

describe("AMMEngine — admin + scaffold", () => {
  let vault: NoirVault;
  let token: MockERC7984;
  let amm: AMMEngine;
  let admin: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let alice: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let bob: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];

  beforeEach(async () => {
    [admin, alice, bob] = await hre.ethers.getSigners();

    const TokenFactory = await hre.ethers.getContractFactory("MockERC7984");
    token = (await TokenFactory.deploy("MockUSDCx", "mUSDCx")) as unknown as MockERC7984;
    await token.waitForDeployment();

    const VaultFactory = await hre.ethers.getContractFactory("NoirVault");
    vault = (await VaultFactory.deploy(admin.address, await token.getAddress())) as unknown as NoirVault;
    await vault.waitForDeployment();

    const AMMFactory = await hre.ethers.getContractFactory("AMMEngine");
    amm = (await AMMFactory.deploy(await vault.getAddress(), admin.address)) as unknown as AMMEngine;
    await amm.waitForDeployment();

    await (await vault.registerEngine(await amm.getAddress())).wait();
  });

  describe("constructor", () => {
    it("stores admin + vault", async () => {
      expect(await amm.admin()).to.equal(admin.address);
      expect(await amm.vault()).to.equal(await vault.getAddress());
    });

    it("initial pool totals are zero", async () => {
      expect(await amm.totalShares()).to.equal(0n);
      expect(await amm.totalReserveUsdcx()).to.equal(0n);
    });

    it("initial swap fee is 30 bps", async () => {
      expect(await amm.swapFeeBps()).to.equal(30);
    });

    it("reverts on zero vault", async () => {
      const F = await hre.ethers.getContractFactory("AMMEngine");
      await expect(F.deploy(hre.ethers.ZeroAddress, admin.address))
        .to.be.revertedWithCustomError({ interface: F.interface } as any, "ZeroAddress");
    });

    it("reverts on zero admin", async () => {
      const F = await hre.ethers.getContractFactory("AMMEngine");
      await expect(F.deploy(await vault.getAddress(), hre.ethers.ZeroAddress))
        .to.be.revertedWithCustomError({ interface: F.interface } as any, "ZeroAddress");
    });
  });

  describe("transferAdmin", () => {
    it("admin can transfer", async () => {
      await expect(amm.transferAdmin(alice.address))
        .to.emit(amm, "AdminTransferred").withArgs(admin.address, alice.address);
      expect(await amm.admin()).to.equal(alice.address);
    });

    it("non-admin cannot transfer", async () => {
      await expect(amm.connect(alice).transferAdmin(bob.address))
        .to.be.revertedWithCustomError(amm, "NotAdmin");
    });

    it("reverts on zero address", async () => {
      await expect(amm.transferAdmin(hre.ethers.ZeroAddress))
        .to.be.revertedWithCustomError(amm, "ZeroAddress");
    });
  });

  describe("setSwapFeeBps", () => {
    it("admin can update fee", async () => {
      await expect(amm.setSwapFeeBps(50))
        .to.emit(amm, "SwapFeeChanged").withArgs(30, 50);
      expect(await amm.swapFeeBps()).to.equal(50);
    });

    it("non-admin cannot update fee", async () => {
      await expect(amm.connect(alice).setSwapFeeBps(50))
        .to.be.revertedWithCustomError(amm, "NotAdmin");
    });

    it("reverts on fee > 10%", async () => {
      await expect(amm.setSwapFeeBps(1_001))
        .to.be.revertedWithCustomError(amm, "FeeTooHigh");
    });
  });

  describe("getUserShares", () => {
    it("returns uninitialized handle for user with no shares", async () => {
      const handle = await amm.getUserShares(alice.address);
      // Uninitialized euint64 handle is zero (no ciphertext assigned yet)
      expect(handle).to.equal(0n);
    });
  });
});
