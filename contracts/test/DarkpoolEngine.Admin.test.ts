import { expect } from "chai";
import * as hre from "hardhat";
import type { NoirVault, MockERC7984, DarkpoolEngine } from "../typechain-types";

describe("DarkpoolEngine — admin + scaffold", () => {
  let vault: NoirVault;
  let token: MockERC7984;
  let dark: DarkpoolEngine;
  let admin: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let alice: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let oracle: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let perp: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let compliance: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];

  beforeEach(async () => {
    [admin, alice, oracle, perp, compliance] = await hre.ethers.getSigners();

    const TokenFactory = await hre.ethers.getContractFactory("MockERC7984");
    token = (await TokenFactory.deploy("MockUSDCx", "mUSDCx")) as unknown as MockERC7984;
    await token.waitForDeployment();

    const VaultFactory = await hre.ethers.getContractFactory("NoirVault");
    vault = (await VaultFactory.deploy(admin.address, await token.getAddress())) as unknown as NoirVault;
    await vault.waitForDeployment();

    const DarkFactory = await hre.ethers.getContractFactory("DarkpoolEngine");
    dark = (await DarkFactory.deploy(await vault.getAddress(), admin.address)) as unknown as DarkpoolEngine;
    await dark.waitForDeployment();
    await (await vault.registerEngine(await dark.getAddress())).wait();
  });

  describe("constructor", () => {
    it("stores vault + admin + initial state", async () => {
      expect(await dark.admin()).to.equal(admin.address);
      expect(await dark.vault()).to.equal(await vault.getAddress());
      expect(await dark.oracle()).to.equal(hre.ethers.ZeroAddress);
      expect(await dark.perp()).to.equal(hre.ethers.ZeroAddress);
      expect(await dark.compliance()).to.equal(hre.ethers.ZeroAddress);
      expect(await dark.nextOrderId()).to.equal(0n);
    });

    it("reverts on zero vault", async () => {
      const F = await hre.ethers.getContractFactory("DarkpoolEngine");
      await expect(F.deploy(hre.ethers.ZeroAddress, admin.address))
        .to.be.revertedWithCustomError({ interface: F.interface } as any, "ZeroAddress");
    });

    it("reverts on zero admin", async () => {
      const F = await hre.ethers.getContractFactory("DarkpoolEngine");
      await expect(F.deploy(await vault.getAddress(), hre.ethers.ZeroAddress))
        .to.be.revertedWithCustomError({ interface: F.interface } as any, "ZeroAddress");
    });
  });

  describe("admin setters", () => {
    it("admin can transferAdmin", async () => {
      await expect(dark.transferAdmin(alice.address))
        .to.emit(dark, "AdminTransferred").withArgs(admin.address, alice.address);
      expect(await dark.admin()).to.equal(alice.address);
    });
    it("transferAdmin reverts on zero", async () => {
      await expect(dark.transferAdmin(hre.ethers.ZeroAddress))
        .to.be.revertedWithCustomError(dark, "ZeroAddress");
    });
    it("non-admin cannot transferAdmin", async () => {
      await expect(dark.connect(alice).transferAdmin(alice.address))
        .to.be.revertedWithCustomError(dark, "NotAdmin");
    });

    it("admin can setOracle", async () => {
      await expect(dark.setOracle(oracle.address))
        .to.emit(dark, "OracleSet").withArgs(oracle.address);
    });
    it("setOracle reverts on zero", async () => {
      await expect(dark.setOracle(hre.ethers.ZeroAddress))
        .to.be.revertedWithCustomError(dark, "ZeroAddress");
    });
    it("non-admin cannot setOracle", async () => {
      await expect(dark.connect(alice).setOracle(oracle.address))
        .to.be.revertedWithCustomError(dark, "NotAdmin");
    });

    it("admin can setPerp", async () => {
      await expect(dark.setPerp(perp.address))
        .to.emit(dark, "PerpSet").withArgs(perp.address);
    });
    it("setPerp reverts on zero", async () => {
      await expect(dark.setPerp(hre.ethers.ZeroAddress))
        .to.be.revertedWithCustomError(dark, "ZeroAddress");
    });

    it("admin can setCompliance", async () => {
      await expect(dark.setCompliance(compliance.address))
        .to.emit(dark, "ComplianceSet").withArgs(compliance.address);
    });
    it("setCompliance reverts on zero", async () => {
      await expect(dark.setCompliance(hre.ethers.ZeroAddress))
        .to.be.revertedWithCustomError(dark, "ZeroAddress");
    });
  });
});
