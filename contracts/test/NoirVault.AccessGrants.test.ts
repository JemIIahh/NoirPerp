import { expect } from "chai";
import * as hre from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import type { NoirVault, MockERC7984, MockEngine } from "../typechain-types";

describe("NoirVault — engine access grants", () => {
  let vault: NoirVault;
  let token: MockERC7984;
  let mockEngine: MockEngine;
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

    const EngineFactory = await hre.ethers.getContractFactory("MockEngine");
    mockEngine = (await EngineFactory.deploy(await vault.getAddress())) as unknown as MockEngine;
    await mockEngine.waitForDeployment();
    await (await vault.registerEngine(await mockEngine.getAddress())).wait();
  });

  describe("allowBalanceAccess", () => {
    it("returns the balance handle for an engine to use", async () => {
      // Seed alice with a deposit first
      await (await token.mintPlaintext(alice.address, 10_000n)).wait();
      await (await token.connect(alice).setOperator(await vault.getAddress(), 2n ** 48n - 1n)).wait();
      await (await vault.connect(alice).deposit(500n)).wait();

      // Engine calls allowBalanceAccess via its harness helper
      await (await mockEngine.readAndCopyBalance(alice.address)).wait();
      const handle = await mockEngine.lastReadBalance();
      // MockEngine grants msg.sender (test runner) persistent allow on the copy
      const decoded = await hre.fhevm.userDecryptEuint(
        FhevmType.euint64,
        handle,
        await mockEngine.getAddress(),
        admin,
      );
      expect(decoded).to.equal(500n);
    });

    it("reverts when non-engine calls it", async () => {
      await expect(
        vault.connect(bob).allowBalanceAccess(alice.address)
      ).to.be.revertedWithCustomError(vault, "NotAuthorizedEngine");
    });
  });

  describe("allowPositionAccess", () => {
    it("returns the position struct with engine ACL on each ciphertext field", async () => {
      // Engine opens a mock position first (exercising writePosition path)
      await (await mockEngine.openMockPosition(alice.address, 100n, 3000n, 500n, true, 2)).wait();

      // Then reads it via allowPositionAccess
      await (await mockEngine.readAndCopyPosition(0)).wait();
      const sizeHandle = await mockEngine.lastReadSize();
      const entryHandle = await mockEngine.lastReadEntry();
      const collHandle = await mockEngine.lastReadCollateral();

      const decrypt = async (h: string) =>
        hre.fhevm.userDecryptEuint(FhevmType.euint64, h, await mockEngine.getAddress(), admin);

      expect(await decrypt(sizeHandle)).to.equal(100n);
      expect(await decrypt(entryHandle)).to.equal(3000n);
      expect(await decrypt(collHandle)).to.equal(500n);
    });

    it("reverts when non-engine calls it", async () => {
      await (await mockEngine.openMockPosition(alice.address, 100n, 3000n, 500n, true, 2)).wait();
      await expect(
        vault.connect(bob).allowPositionAccess(0)
      ).to.be.revertedWithCustomError(vault, "NotAuthorizedEngine");
    });

    it("returns public struct fields alongside encrypted ones", async () => {
      await (await mockEngine.openMockPosition(alice.address, 100n, 3000n, 500n, true, 2)).wait();
      await (await mockEngine.readAndCopyPosition(0)).wait();
      expect(await mockEngine.lastReadOwner()).to.equal(alice.address);
      expect(await mockEngine.lastReadMarketId()).to.equal(2);
      expect(await mockEngine.lastReadIsLong()).to.equal(true);
      expect(await mockEngine.lastReadActive()).to.equal(true);
    });
  });
});
