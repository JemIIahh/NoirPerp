import { expect } from "chai";
import * as hre from "hardhat";
import type { NoirVault, MockERC7984, LimitEngine } from "../typechain-types";

describe("LimitEngine — admin + scaffold", () => {
  let vault: NoirVault;
  let token: MockERC7984;
  let limit: LimitEngine;
  let admin: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let alice: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let oracle: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let perp: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];

  beforeEach(async () => {
    [admin, alice, oracle, perp] = await hre.ethers.getSigners();

    const TokenFactory = await hre.ethers.getContractFactory("MockERC7984");
    token = (await TokenFactory.deploy("MockUSDCx", "mUSDCx")) as unknown as MockERC7984;
    await token.waitForDeployment();

    const VaultFactory = await hre.ethers.getContractFactory("NoirVault");
    vault = (await VaultFactory.deploy(admin.address, await token.getAddress())) as unknown as NoirVault;
    await vault.waitForDeployment();

    const LimitFactory = await hre.ethers.getContractFactory("LimitEngine");
    limit = (await LimitFactory.deploy(await vault.getAddress(), admin.address)) as unknown as LimitEngine;
    await limit.waitForDeployment();

    await (await vault.registerEngine(await limit.getAddress())).wait();
  });

  describe("constructor", () => {
    it("stores vault + admin + initial state", async () => {
      expect(await limit.admin()).to.equal(admin.address);
      expect(await limit.vault()).to.equal(await vault.getAddress());
      expect(await limit.oracle()).to.equal(hre.ethers.ZeroAddress);
      expect(await limit.perp()).to.equal(hre.ethers.ZeroAddress);
      expect(await limit.nextOrderId()).to.equal(0n);
    });

    it("reverts on zero vault", async () => {
      const F = await hre.ethers.getContractFactory("LimitEngine");
      await expect(F.deploy(hre.ethers.ZeroAddress, admin.address))
        .to.be.revertedWithCustomError({ interface: F.interface } as any, "ZeroAddress");
    });

    it("reverts on zero admin", async () => {
      const F = await hre.ethers.getContractFactory("LimitEngine");
      await expect(F.deploy(await vault.getAddress(), hre.ethers.ZeroAddress))
        .to.be.revertedWithCustomError({ interface: F.interface } as any, "ZeroAddress");
    });
  });

  describe("transferAdmin", () => {
    it("admin can transfer", async () => {
      await expect(limit.transferAdmin(alice.address))
        .to.emit(limit, "AdminTransferred").withArgs(admin.address, alice.address);
      expect(await limit.admin()).to.equal(alice.address);
    });

    it("non-admin cannot transfer", async () => {
      await expect(limit.connect(alice).transferAdmin(alice.address))
        .to.be.revertedWithCustomError(limit, "NotAdmin");
    });

    it("reverts on zero address", async () => {
      await expect(limit.transferAdmin(hre.ethers.ZeroAddress))
        .to.be.revertedWithCustomError(limit, "ZeroAddress");
    });
  });

  describe("setOracle", () => {
    it("admin can set oracle", async () => {
      await expect(limit.setOracle(oracle.address))
        .to.emit(limit, "OracleSet").withArgs(oracle.address);
      expect(await limit.oracle()).to.equal(oracle.address);
    });

    it("non-admin cannot set", async () => {
      await expect(limit.connect(alice).setOracle(oracle.address))
        .to.be.revertedWithCustomError(limit, "NotAdmin");
    });

    it("reverts on zero address", async () => {
      await expect(limit.setOracle(hre.ethers.ZeroAddress))
        .to.be.revertedWithCustomError(limit, "ZeroAddress");
    });
  });

  describe("setPerp", () => {
    it("admin can set perp", async () => {
      await expect(limit.setPerp(perp.address))
        .to.emit(limit, "PerpSet").withArgs(perp.address);
      expect(await limit.perp()).to.equal(perp.address);
    });

    it("non-admin cannot set", async () => {
      await expect(limit.connect(alice).setPerp(perp.address))
        .to.be.revertedWithCustomError(limit, "NotAdmin");
    });

    it("reverts on zero address", async () => {
      await expect(limit.setPerp(hre.ethers.ZeroAddress))
        .to.be.revertedWithCustomError(limit, "ZeroAddress");
    });
  });

  describe("constants", () => {
    it("exposes order type constants", async () => {
      expect(await limit.ORDER_TYPE_TP()).to.equal(1);
      expect(await limit.ORDER_TYPE_SL()).to.equal(2);
      expect(await limit.ORDER_TYPE_LIMIT()).to.equal(3);
    });
  });
});
