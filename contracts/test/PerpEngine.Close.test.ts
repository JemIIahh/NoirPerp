import { expect } from "chai";
import * as hre from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import type { NoirVault, MockERC7984, Oracle, Compliance, PerpEngine } from "../typechain-types";

const MARKET_ETH = 2;
const STALENESS = 90;
const DEVIATION_BPS = 50;

describe("PerpEngine — closePosition", () => {
  let vault: NoirVault;
  let token: MockERC7984;
  let oracle: Oracle;
  let compliance: Compliance;
  let engine: PerpEngine;
  let admin: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let relayerA: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let relayerB: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let relayerC: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let alice: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let bob: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let aliceProof: string[];

  async function now(): Promise<number> {
    const blk = await hre.ethers.provider.getBlock("latest");
    return blk!.timestamp;
  }

  async function encrypt(contract: string, user: string, value: bigint) {
    const input = hre.fhevm.createEncryptedInput(contract, user);
    input.add64(value);
    return await input.encrypt();
  }

  async function commitPrice(marketId: number, price: bigint) {
    const t = await now();
    await (await oracle.connect(relayerA).submitPrice(marketId, price, t)).wait();
    await (await oracle.connect(relayerB).submitPrice(marketId, price, t + 1)).wait();
  }

  async function decrypt(handle: string, contractAddr: string, signer: typeof admin): Promise<bigint> {
    return hre.fhevm.userDecryptEuint(FhevmType.euint64, handle, contractAddr, signer);
  }

  beforeEach(async () => {
    [admin, relayerA, relayerB, relayerC, alice, bob] = await hre.ethers.getSigners();

    const TokenFactory = await hre.ethers.getContractFactory("MockERC7984");
    token = (await TokenFactory.deploy("MockUSDCx", "mUSDCx")) as unknown as MockERC7984;
    await token.waitForDeployment();
    await (await token.mintPlaintext(alice.address, 100_000n)).wait();

    const VaultFactory = await hre.ethers.getContractFactory("NoirVault");
    vault = (await VaultFactory.deploy(admin.address, await token.getAddress())) as unknown as NoirVault;
    await vault.waitForDeployment();

    const OracleFactory = await hre.ethers.getContractFactory("Oracle");
    oracle = (await OracleFactory.deploy(
      admin.address,
      [relayerA.address, relayerB.address, relayerC.address],
      STALENESS, DEVIATION_BPS,
    )) as unknown as Oracle;
    await oracle.waitForDeployment();

    const tree = StandardMerkleTree.of([[alice.address]], ["address"]);
    aliceProof = tree.getProof([alice.address]);
    const ComplianceFactory = await hre.ethers.getContractFactory("Compliance");
    compliance = (await ComplianceFactory.deploy(admin.address, tree.root)) as unknown as Compliance;
    await compliance.waitForDeployment();

    const EngineFactory = await hre.ethers.getContractFactory("PerpEngine");
    engine = (await EngineFactory.deploy(
      await vault.getAddress(),
      await oracle.getAddress(),
      await compliance.getAddress(),
      admin.address,
      admin.address,
    )) as unknown as PerpEngine;
    await engine.waitForDeployment();

    await (await vault.registerEngine(await engine.getAddress())).wait();

    await (await token.connect(alice).setOperator(await vault.getAddress(), 2n ** 48n - 1n)).wait();
    await (await vault.connect(alice).deposit(10_000n)).wait();

    // Commit price at entry
    await commitPrice(MARKET_ETH, 3000n);

    // Alice opens a 10-ETH long at 3000 with 1500 collateral (10x leverage)
    const engineAddr = await engine.getAddress();
    const sizeEnc = await encrypt(engineAddr, alice.address, 10n);
    const collEnc = await encrypt(engineAddr, alice.address, 1500n);
    await (await engine.connect(alice).openPosition(
      sizeEnc.handles[0], sizeEnc.inputProof,
      collEnc.handles[0], collEnc.inputProof,
      true, MARKET_ETH, aliceProof,
    )).wait();
    // Position 0 is now open. Vault balance = 10_000 - 1500 = 8_500.
  });

  describe("profitable long close", () => {
    it("pays out collateral + profit when price rises", async () => {
      // Price 3000 → 3100 means profit = size * (3100 - 3000) = 10 * 100 = 1000
      // Payout = collateral + profit - loss = 1500 + 1000 - 0 = 2500
      await commitPrice(MARKET_ETH, 3100n);

      await (await engine.connect(alice).closePosition(0)).wait();

      const balHandle = await vault.getBalance(alice.address);
      const bal = await decrypt(balHandle, await vault.getAddress(), alice);
      // Balance = 8_500 (post-open) + 2_500 (payout) = 11_000
      expect(bal).to.equal(11_000n);

      const pos = await vault.getPosition(0);
      expect(pos.active).to.equal(false);
    });
  });

  describe("losing long close", () => {
    it("returns collateral minus loss when price falls", async () => {
      // Price 3000 → 2950 means loss = size * (3000 - 2950) = 10 * 50 = 500
      // Payout = max(0, 1500 - 500) + 0 = 1000
      await commitPrice(MARKET_ETH, 2950n);

      await (await engine.connect(alice).closePosition(0)).wait();

      const balHandle = await vault.getBalance(alice.address);
      const bal = await decrypt(balHandle, await vault.getAddress(), alice);
      // Balance = 8_500 + 1_000 = 9_500
      expect(bal).to.equal(9_500n);
    });

    it("saturates payout at 0 when loss exceeds collateral", async () => {
      // Price 3000 → 2000 means loss = 10 * 1000 = 10_000, exceeding 1500 collateral
      // Payout = safeSub(1500, 10000) = 0, + 0 profit = 0
      await commitPrice(MARKET_ETH, 2000n);

      await (await engine.connect(alice).closePosition(0)).wait();

      const balHandle = await vault.getBalance(alice.address);
      const bal = await decrypt(balHandle, await vault.getAddress(), alice);
      // Balance = 8_500 + 0 = 8_500 (unchanged)
      expect(bal).to.equal(8_500n);
    });
  });

  describe("flat close (no price change)", () => {
    it("returns exactly the collateral", async () => {
      // Price unchanged at 3000 → profit = 0, loss = 0 → payout = 1500
      await (await engine.connect(alice).closePosition(0)).wait();

      const balHandle = await vault.getBalance(alice.address);
      const bal = await decrypt(balHandle, await vault.getAddress(), alice);
      expect(bal).to.equal(10_000n); // 8_500 + 1_500
    });
  });

  describe("guards", () => {
    it("reverts if caller is not the position owner", async () => {
      await expect(
        engine.connect(bob).closePosition(0)
      ).to.be.revertedWithCustomError(engine, "NotPositionOwner");
    });

    it("reverts on already-closed position", async () => {
      await (await engine.connect(alice).closePosition(0)).wait();
      await expect(
        engine.connect(alice).closePosition(0)
      ).to.be.revertedWithCustomError(engine, "PositionNotActive");
    });

    it("reverts on stale oracle at close time", async () => {
      await hre.ethers.provider.send("evm_increaseTime", [STALENESS + 10]);
      await hre.ethers.provider.send("evm_mine", []);

      await expect(
        engine.connect(alice).closePosition(0)
      ).to.be.revertedWithCustomError(engine, "OraclePriceStale");
    });
  });
});
