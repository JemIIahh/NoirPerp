import { expect } from "chai";
import * as hre from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import type { NoirVault, MockERC7984, AMMEngine } from "../typechain-types";

describe("AMMEngine — requestWithdraw + async callback", () => {
  let vault: NoirVault;
  let token: MockERC7984;
  let amm: AMMEngine;
  let admin: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let alice: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let bob: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];

  async function decrypt(handle: string, contractAddr: string, signer: typeof admin): Promise<bigint> {
    return hre.fhevm.userDecryptEuint(FhevmType.euint64, handle, contractAddr, signer);
  }

  async function fulfillWithdraw(reqId: bigint, handle: string): Promise<void> {
    const { abiEncodedClearValues, decryptionProof } = await hre.fhevm.publicDecrypt([handle]);
    await (await amm._onWithdrawDecided(
      reqId,
      [handle],
      abiEncodedClearValues,
      decryptionProof,
    )).wait();
  }

  /**
   * Helper: extract WithdrawRequested event args from a tx receipt.
   * Uses robust parseLog iteration (matches PerpEngine.Liquidation test pattern).
   */
  function extractWithdrawEvent(receipt: any): { reqId: bigint; matchHandle: string } {
    const ammIface = amm.interface;
    let reqId: bigint | undefined;
    let matchHandle: string | undefined;
    for (const log of receipt!.logs) {
      try {
        const parsed = ammIface.parseLog({ topics: [...log.topics], data: log.data });
        if (parsed && parsed.name === "WithdrawRequested") {
          reqId = parsed.args.requestId as bigint;
          matchHandle = parsed.args.matchHandle as string;
        }
      } catch { /* skip logs that don't parse as AMMEngine events */ }
    }
    if (reqId === undefined || matchHandle === undefined) {
      throw new Error("WithdrawRequested event not found in receipt");
    }
    return { reqId, matchHandle };
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

    await (await token.connect(alice).setOperator(await vault.getAddress(), 2n ** 48n - 1n)).wait();
    await (await token.connect(bob).setOperator(await vault.getAddress(), 2n ** 48n - 1n)).wait();
    await (await vault.connect(alice).deposit(10_000n)).wait();
    await (await vault.connect(bob).deposit(10_000n)).wait();

    // Alice adds 1000 liquidity → shares = 1000
    await (await amm.connect(alice).addLiquidity(1_000n)).wait();
  });

  describe("full-amount withdraw", () => {
    it("pays out pro-rata and zeros user shares", async () => {
      const tx = await amm.connect(alice).requestWithdraw(1_000n);
      const receipt = await tx.wait();
      const { reqId, matchHandle } = await extractWithdrawEvent(receipt);

      await fulfillWithdraw(reqId, matchHandle);

      // Alice's shares decremented to 0
      const sharesHandle = await amm.getUserShares(alice.address);
      const shares = await decrypt(sharesHandle, await amm.getAddress(), alice);
      expect(shares).to.equal(0n);

      // Pool totals decremented
      expect(await amm.totalShares()).to.equal(0n);
      expect(await amm.totalReserveUsdcx()).to.equal(0n);

      // Alice's vault USDCx balance credited (back to 10_000)
      const balHandle = await vault.getBalance(alice.address);
      const bal = await decrypt(balHandle, await vault.getAddress(), alice);
      expect(bal).to.equal(10_000n); // full return
    });
  });

  describe("partial withdraw", () => {
    it("pays out fair fraction and decrements shares + totals", async () => {
      // Alice has 1000 shares. She withdraws 400 (≤ 1000, valid).
      // payout = 400 × 1000 / 1000 = 400
      // remaining: shares = 600, reserve = 600
      const tx = await amm.connect(alice).requestWithdraw(400n);
      const receipt = await tx.wait();
      const { reqId, matchHandle } = await extractWithdrawEvent(receipt);

      await fulfillWithdraw(reqId, matchHandle);

      expect(await amm.totalShares()).to.equal(600n);
      expect(await amm.totalReserveUsdcx()).to.equal(600n);

      const shares = await decrypt(
        await amm.getUserShares(alice.address),
        await amm.getAddress(),
        alice
      );
      expect(shares).to.equal(600n);
    });
  });

  describe("mismatch guard", () => {
    it("emits WithdrawRejected and does nothing if claimedShares > user encrypted balance", async () => {
      // Bob also deposits 2000 → pool: totalShares=3000, totalReserveUsdcx=3000
      // Alice has 1000 shares, Bob has 2000 shares.
      // Alice claims 1500 (≤ totalShares=3000, passes Phase 1 guard).
      // FHE check: claimedShares (1500) > userBal (1000) → isValid = false → rejected.
      await (await amm.connect(bob).addLiquidity(2_000n)).wait();

      // Alice claims 1500 — more than her 1000 encrypted shares
      const tx = await amm.connect(alice).requestWithdraw(1_500n);
      const receipt = await tx.wait();
      const { reqId, matchHandle } = await extractWithdrawEvent(receipt);

      const { abiEncodedClearValues, decryptionProof } = await hre.fhevm.publicDecrypt([matchHandle]);

      await expect(amm._onWithdrawDecided(
        reqId, [matchHandle], abiEncodedClearValues, decryptionProof
      )).to.emit(amm, "WithdrawRejected").withArgs(reqId, alice.address);

      // Alice's shares unchanged (1000), pool totals unchanged (3000)
      const shares = await decrypt(
        await amm.getUserShares(alice.address),
        await amm.getAddress(),
        alice
      );
      expect(shares).to.equal(1_000n);
      expect(await amm.totalShares()).to.equal(3_000n);
    });
  });

  describe("guards", () => {
    it("requestWithdraw reverts on zero shares claimed", async () => {
      await expect(amm.connect(alice).requestWithdraw(0n))
        .to.be.revertedWithCustomError(amm, "ZeroAmount");
    });

    it("requestWithdraw reverts when claimed > totalShares", async () => {
      await expect(amm.connect(alice).requestWithdraw(10_000n))
        .to.be.revertedWithCustomError(amm, "ClaimExceedsPoolTotal");
    });

    it("requestWithdraw reverts when pool is empty", async () => {
      // Drain the pool first by fulfilling alice's full withdrawal
      const tx = await amm.connect(alice).requestWithdraw(1_000n);
      const receipt = await tx.wait();
      const { reqId, matchHandle } = await extractWithdrawEvent(receipt);
      await fulfillWithdraw(reqId, matchHandle);

      // Pool is now empty (totalShares == 0); any claim should revert
      await expect(amm.connect(bob).requestWithdraw(100n))
        .to.be.revertedWithCustomError(amm, "ClaimExceedsPoolTotal");
    });
  });
});
