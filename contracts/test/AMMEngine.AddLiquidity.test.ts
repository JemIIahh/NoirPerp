import { expect } from "chai";
import * as hre from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import type { NoirVault, MockERC7984, AMMEngine } from "../typechain-types";

describe("AMMEngine — addLiquidity", () => {
  let vault: NoirVault;
  let token: MockERC7984;
  let amm: AMMEngine;
  let admin: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let alice: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let bob: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];

  async function decrypt(handle: string, contractAddr: string, signer: typeof admin): Promise<bigint> {
    return hre.fhevm.userDecryptEuint(FhevmType.euint64, handle, contractAddr, signer);
  }

  beforeEach(async () => {
    [admin, alice, bob] = await hre.ethers.getSigners();

    const TokenFactory = await hre.ethers.getContractFactory("MockERC7984");
    token = (await TokenFactory.deploy("MockUSDCx", "mUSDCx")) as unknown as MockERC7984;
    await token.waitForDeployment();
    await (await token.mintPlaintext(alice.address, 100_000n)).wait();
    await (await token.mintPlaintext(bob.address, 100_000n)).wait();

    const VaultFactory = await hre.ethers.getContractFactory("NoirVault");
    vault = (await VaultFactory.deploy(admin.address, await token.getAddress())) as unknown as NoirVault;
    await vault.waitForDeployment();

    const AMMFactory = await hre.ethers.getContractFactory("AMMEngine");
    amm = (await AMMFactory.deploy(await vault.getAddress(), admin.address)) as unknown as AMMEngine;
    await amm.waitForDeployment();

    await (await vault.registerEngine(await amm.getAddress())).wait();

    // Seed alice and bob with vault balances
    await (await token.connect(alice).setOperator(await vault.getAddress(), 2n ** 48n - 1n)).wait();
    await (await token.connect(bob).setOperator(await vault.getAddress(), 2n ** 48n - 1n)).wait();
    await (await vault.connect(alice).deposit(10_000n)).wait();
    await (await vault.connect(bob).deposit(10_000n)).wait();
  });

  describe("first deposit (bootstrap)", () => {
    it("mints shares 1:1 when pool is empty", async () => {
      await (await amm.connect(alice).addLiquidity(5_000n)).wait();

      expect(await amm.totalShares()).to.equal(5_000n);
      expect(await amm.totalReserveUsdcx()).to.equal(5_000n);

      const sharesHandle = await amm.getUserShares(alice.address);
      const shares = await decrypt(sharesHandle, await amm.getAddress(), alice);
      expect(shares).to.equal(5_000n);

      // Alice's vault balance debited
      const balHandle = await vault.getBalance(alice.address);
      const bal = await decrypt(balHandle, await vault.getAddress(), alice);
      expect(bal).to.equal(5_000n); // 10_000 - 5_000

      // AMM's vault balance credited
      const ammBalHandle = await vault.getBalance(await amm.getAddress());
      // AMM's balance has FHE.allow to the AMM contract only; we can't decrypt as admin.
      // Verify via handle existence.
      expect(ammBalHandle).to.not.equal(hre.ethers.ZeroHash);
    });

    it("emits LiquidityAdded event", async () => {
      await expect(amm.connect(alice).addLiquidity(5_000n))
        .to.emit(amm, "LiquidityAdded")
        .withArgs(alice.address, 5_000n, 5_000n); // amount, sharesMinted
    });
  });

  describe("subsequent deposits (fair ratio)", () => {
    beforeEach(async () => {
      // Alice bootstraps with 1000 USDCx
      await (await amm.connect(alice).addLiquidity(1_000n)).wait();
    });

    it("mints shares pro-rata when pool already has reserves", async () => {
      // Bob deposits 2000. Pool has 1000 reserves + 1000 shares.
      // Bob's shares = 2000 * 1000 / 1000 = 2000
      await (await amm.connect(bob).addLiquidity(2_000n)).wait();

      expect(await amm.totalShares()).to.equal(3_000n);
      expect(await amm.totalReserveUsdcx()).to.equal(3_000n);

      const bobShares = await decrypt(
        await amm.getUserShares(bob.address),
        await amm.getAddress(),
        bob
      );
      expect(bobShares).to.equal(2_000n);
    });

    it("multiple deposits from same user accumulate", async () => {
      await (await amm.connect(alice).addLiquidity(500n)).wait();
      await (await amm.connect(alice).addLiquidity(500n)).wait();

      const aliceShares = await decrypt(
        await amm.getUserShares(alice.address),
        await amm.getAddress(),
        alice
      );
      // Alice initially had 1000 shares; +500 (ratio 1:1) +500 (ratio 1:1) = 2000
      expect(aliceShares).to.equal(2_000n);
    });
  });

  describe("guards", () => {
    it("reverts on zero amount", async () => {
      await expect(amm.connect(alice).addLiquidity(0n))
        .to.be.revertedWithCustomError(amm, "ZeroAmount");
    });
  });
});
