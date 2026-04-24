import { expect } from "chai";
import * as hre from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import type { NoirVault, MockERC7984, Oracle, Compliance, PerpEngine } from "../typechain-types";

const MARKET_ETH = 2;
const STALENESS = 90;
const DEVIATION_BPS = 50;

describe("PerpEngine — admin + close-short + constructor guards", () => {
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

  beforeEach(async () => {
    [admin, relayerA, relayerB, relayerC, alice] = await hre.ethers.getSigners();

    const TokenFactory = await hre.ethers.getContractFactory("MockERC7984");
    token = (await TokenFactory.deploy("MockUSDCx", "mUSDCx")) as unknown as MockERC7984;
    await token.waitForDeployment();
    await (await token.mintPlaintext(alice.address, 100_000n)).wait();

    const VaultFactory = await hre.ethers.getContractFactory("NoirVault");
    vault = (await VaultFactory.deploy(admin.address, await token.getAddress())) as unknown as NoirVault;
    await vault.waitForDeployment();

    const OracleFactory = await hre.ethers.getContractFactory("Oracle");
    oracle = (await OracleFactory.deploy(
      admin.address, [relayerA.address, relayerB.address, relayerC.address],
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
  });

  describe("transferAdmin", () => {
    it("admin can transfer admin role", async () => {
      await expect(engine.transferAdmin(alice.address))
        .to.emit(engine, "AdminTransferred")
        .withArgs(admin.address, alice.address);
      expect(await engine.admin()).to.equal(alice.address);
    });

    it("non-admin cannot transfer", async () => {
      await expect(
        engine.connect(alice).transferAdmin(alice.address)
      ).to.be.revertedWithCustomError(engine, "NotAdmin");
    });

    it("reverts on zero address", async () => {
      await expect(
        engine.transferAdmin(hre.ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(engine, "ZeroAddress");
    });
  });

  describe("setLiquidationPool", () => {
    it("admin can set liquidation pool", async () => {
      await expect(engine.setLiquidationPool(alice.address))
        .to.emit(engine, "LiquidationPoolChanged")
        .withArgs(admin.address, alice.address);
      expect(await engine.liquidationPool()).to.equal(alice.address);
    });

    it("non-admin cannot set liquidation pool", async () => {
      await expect(
        engine.connect(alice).setLiquidationPool(alice.address)
      ).to.be.revertedWithCustomError(engine, "NotAdmin");
    });

    it("reverts on zero address", async () => {
      await expect(
        engine.setLiquidationPool(hre.ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(engine, "ZeroAddress");
    });
  });

  describe("constructor zero-address guards", () => {
    it("reverts on zero vault", async () => {
      const Factory = await hre.ethers.getContractFactory("PerpEngine");
      await expect(Factory.deploy(
        hre.ethers.ZeroAddress,
        await oracle.getAddress(),
        await compliance.getAddress(),
        admin.address, admin.address,
      )).to.be.revertedWithCustomError(
        { interface: Factory.interface } as any, "ZeroAddress"
      );
    });

    it("reverts on zero oracle", async () => {
      const Factory = await hre.ethers.getContractFactory("PerpEngine");
      await expect(Factory.deploy(
        await vault.getAddress(),
        hre.ethers.ZeroAddress,
        await compliance.getAddress(),
        admin.address, admin.address,
      )).to.be.revertedWithCustomError(
        { interface: Factory.interface } as any, "ZeroAddress"
      );
    });

    it("reverts on zero compliance", async () => {
      const Factory = await hre.ethers.getContractFactory("PerpEngine");
      await expect(Factory.deploy(
        await vault.getAddress(),
        await oracle.getAddress(),
        hre.ethers.ZeroAddress,
        admin.address, admin.address,
      )).to.be.revertedWithCustomError(
        { interface: Factory.interface } as any, "ZeroAddress"
      );
    });

    it("reverts on zero liquidation pool", async () => {
      const Factory = await hre.ethers.getContractFactory("PerpEngine");
      await expect(Factory.deploy(
        await vault.getAddress(),
        await oracle.getAddress(),
        await compliance.getAddress(),
        hre.ethers.ZeroAddress, admin.address,
      )).to.be.revertedWithCustomError(
        { interface: Factory.interface } as any, "ZeroAddress"
      );
    });

    it("reverts on zero admin", async () => {
      const Factory = await hre.ethers.getContractFactory("PerpEngine");
      await expect(Factory.deploy(
        await vault.getAddress(),
        await oracle.getAddress(),
        await compliance.getAddress(),
        admin.address, hre.ethers.ZeroAddress,
      )).to.be.revertedWithCustomError(
        { interface: Factory.interface } as any, "ZeroAddress"
      );
    });
  });

  describe("close short position (covers pnlShort branch)", () => {
    it("closes a profitable short when price falls", async () => {
      await (await token.connect(alice).setOperator(await vault.getAddress(), 2n ** 48n - 1n)).wait();
      await (await vault.connect(alice).deposit(10_000n)).wait();
      await commitPrice(MARKET_ETH, 3000n);

      // Open SHORT: size 10, collateral 1500 (same sizing as long tests)
      const engineAddr = await engine.getAddress();
      const sizeEnc = await encrypt(engineAddr, alice.address, 10n);
      const collEnc = await encrypt(engineAddr, alice.address, 1500n);
      await (await engine.connect(alice).openPosition(
        sizeEnc.handles[0], sizeEnc.inputProof,
        collEnc.handles[0], collEnc.inputProof,
        false, MARKET_ETH, aliceProof, // isLong=false
      )).wait();

      // Price drops → short profits: profit = 10 * (3000 - 2950) = 500
      // Payout = 1500 + 500 = 2000
      await commitPrice(MARKET_ETH, 2950n);
      await (await engine.connect(alice).closePosition(0)).wait();

      const balHandle = await vault.getBalance(alice.address);
      const bal = await hre.fhevm.userDecryptEuint(
        FhevmType.euint64,
        balHandle,
        await vault.getAddress(),
        alice,
      );
      // Balance = 8_500 (post-open) + 2_000 (payout) = 10_500
      expect(bal).to.equal(10_500n);
    });
  });
});
