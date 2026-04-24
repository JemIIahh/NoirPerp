import { expect } from "chai";
import * as hre from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import type { NoirVault, MockERC7984 } from "../typechain-types";

describe("NoirVault — balance operations", () => {
  let vault: NoirVault;
  let token: MockERC7984;
  let admin: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let engine: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
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
    [admin, engine, alice, bob] = await hre.ethers.getSigners();

    // Deploy MockERC7984
    const TokenFactory = await hre.ethers.getContractFactory("MockERC7984");
    token = (await TokenFactory.deploy("MockUSDCx", "mUSDCx")) as unknown as MockERC7984;
    await token.waitForDeployment();

    // Seed alice and bob with 10_000 mUSDCx each
    await (await token.mintPlaintext(alice.address, 10_000n)).wait();
    await (await token.mintPlaintext(bob.address, 10_000n)).wait();

    // Deploy Vault
    const VaultFactory = await hre.ethers.getContractFactory("NoirVault");
    vault = (await VaultFactory.deploy(admin.address, await token.getAddress())) as unknown as NoirVault;
    await vault.waitForDeployment();

    // Register engine for adjustBalance tests
    await (await vault.registerEngine(engine.address)).wait();
  });

  describe("deposit", () => {
    it("credits the user's encrypted balance", async () => {
      // alice approves vault to pull 1000 tokens
      await (await token.connect(alice).setOperator(await vault.getAddress(), 2n ** 48n - 1n)).wait();
      await (await vault.connect(alice).deposit(500n)).wait();

      const handle = await vault.getBalance(alice.address);
      expect(await decrypt(handle, alice)).to.equal(500n);
    });

    it("multiple deposits accumulate", async () => {
      await (await token.connect(alice).setOperator(await vault.getAddress(), 2n ** 48n - 1n)).wait();
      await (await vault.connect(alice).deposit(300n)).wait();
      await (await vault.connect(alice).deposit(200n)).wait();

      const handle = await vault.getBalance(alice.address);
      expect(await decrypt(handle, alice)).to.equal(500n);
    });

    it("reverts when paused", async () => {
      await (await token.connect(alice).setOperator(await vault.getAddress(), 2n ** 48n - 1n)).wait();
      await (await vault.pause()).wait();
      await expect(
        vault.connect(alice).deposit(100n)
      ).to.be.revertedWithCustomError(vault, "VaultPaused");
    });
  });

  describe("withdraw", () => {
    beforeEach(async () => {
      await (await token.connect(alice).setOperator(await vault.getAddress(), 2n ** 48n - 1n)).wait();
      await (await vault.connect(alice).deposit(1000n)).wait();
    });

    it("debits balance and transfers tokens back", async () => {
      await (await vault.connect(alice).withdraw(300n)).wait();

      const vaultBalHandle = await vault.getBalance(alice.address);
      expect(await decrypt(vaultBalHandle, alice)).to.equal(700n);
    });

    it("withdrawing more than balance results in zero payout (safe math)", async () => {
      // alice has 1000, tries to withdraw 2000 — saturating: 0 effective
      await (await vault.connect(alice).withdraw(2000n)).wait();
      const handle = await vault.getBalance(alice.address);
      // safeSub semantics: 1000 - 2000 clamped to 0
      expect(await decrypt(handle, alice)).to.equal(0n);
    });

    it("reverts when paused", async () => {
      await (await vault.pause()).wait();
      await expect(
        vault.connect(alice).withdraw(100n)
      ).to.be.revertedWithCustomError(vault, "VaultPaused");
    });
  });

  describe("adjustBalance (engine only)", () => {
    beforeEach(async () => {
      await (await token.connect(alice).setOperator(await vault.getAddress(), 2n ** 48n - 1n)).wait();
      await (await vault.connect(alice).deposit(1000n)).wait();
    });

    it("engine can credit a user's balance", async () => {
      await (await vault.connect(engine).adjustBalance(alice.address, 500n, true)).wait();
      const handle = await vault.getBalance(alice.address);
      expect(await decrypt(handle, alice)).to.equal(1500n);
    });

    it("engine can debit a user's balance", async () => {
      await (await vault.connect(engine).adjustBalance(alice.address, 300n, false)).wait();
      const handle = await vault.getBalance(alice.address);
      expect(await decrypt(handle, alice)).to.equal(700n);
    });

    it("debit larger than balance saturates at 0 (safe math)", async () => {
      await (await vault.connect(engine).adjustBalance(alice.address, 5000n, false)).wait();
      const handle = await vault.getBalance(alice.address);
      expect(await decrypt(handle, alice)).to.equal(0n);
    });

    it("non-engine cannot adjustBalance", async () => {
      await expect(
        vault.connect(bob).adjustBalance(alice.address, 100n, true)
      ).to.be.revertedWithCustomError(vault, "NotAuthorizedEngine");
    });

    it("reverts when paused", async () => {
      await (await vault.pause()).wait();
      await expect(
        vault.connect(engine).adjustBalance(alice.address, 100n, true)
      ).to.be.revertedWithCustomError(vault, "VaultPaused");
    });
  });
});
