import { expect } from "chai";
import * as hre from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import type { NoirVault, MockERC7984, Oracle, Compliance, PerpEngine } from "../typechain-types";

const MARKET_BTC = 1;
const MARKET_ETH = 2;
const MARKET_SOL = 3;
const STALENESS = 90;
const DEVIATION_BPS = 50;
const MAX_LEVERAGE = 20;
const MAINT_MARGIN_BPS = 500;
const LIQ_FEE_BPS = 50;

describe("PerpEngine — openPosition", () => {
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
  let nonKycUser: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];

  let aliceProof: string[];

  async function now(): Promise<number> {
    const blk = await hre.ethers.provider.getBlock("latest");
    return blk!.timestamp;
  }

  async function encryptInput(contract: string, user: string, value: bigint) {
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
    [admin, relayerA, relayerB, relayerC, alice, nonKycUser] = await hre.ethers.getSigners();

    // Deploy token + seed alice
    const TokenFactory = await hre.ethers.getContractFactory("MockERC7984");
    token = (await TokenFactory.deploy("MockUSDCx", "mUSDCx")) as unknown as MockERC7984;
    await token.waitForDeployment();
    await (await token.mintPlaintext(alice.address, 100_000n)).wait();

    // Deploy vault
    const VaultFactory = await hre.ethers.getContractFactory("NoirVault");
    vault = (await VaultFactory.deploy(admin.address, await token.getAddress())) as unknown as NoirVault;
    await vault.waitForDeployment();

    // Deploy oracle
    const OracleFactory = await hre.ethers.getContractFactory("Oracle");
    oracle = (await OracleFactory.deploy(
      admin.address,
      [relayerA.address, relayerB.address, relayerC.address],
      STALENESS,
      DEVIATION_BPS,
    )) as unknown as Oracle;
    await oracle.waitForDeployment();

    // Deploy compliance with alice's address allowlisted
    const tree = StandardMerkleTree.of([[alice.address]], ["address"]);
    aliceProof = tree.getProof([alice.address]);
    const ComplianceFactory = await hre.ethers.getContractFactory("Compliance");
    compliance = (await ComplianceFactory.deploy(admin.address, tree.root)) as unknown as Compliance;
    await compliance.waitForDeployment();

    // Deploy engine
    const EngineFactory = await hre.ethers.getContractFactory("PerpEngine");
    engine = (await EngineFactory.deploy(
      await vault.getAddress(),
      await oracle.getAddress(),
      await compliance.getAddress(),
      admin.address, // liquidationPool = admin in tests
      admin.address,
    )) as unknown as PerpEngine;
    await engine.waitForDeployment();

    // Authorize engine on vault
    await (await vault.registerEngine(await engine.getAddress())).wait();

    // Alice deposits 10_000 into vault
    await (await token.connect(alice).setOperator(await vault.getAddress(), 2n ** 48n - 1n)).wait();
    await (await vault.connect(alice).deposit(10_000n)).wait();

    // Commit an ETH price so tests have fresh oracle
    await commitPrice(MARKET_ETH, 3000n);
  });

  describe("happy path", () => {
    it("opens a long position when margin + balance are sufficient", async () => {
      // size = 10 ETH, collateral = 1500 USDC at 3000/ETH
      // notional = 10 * 3000 = 30_000 ; capacity = 1500 * 20 = 30_000 → exactly allowed
      const engineAddr = await engine.getAddress();
      const sizeEnc = await encryptInput(engineAddr, alice.address, 10n);
      const collEnc = await encryptInput(engineAddr, alice.address, 1500n);

      const tx = await engine.connect(alice).openPosition(
        sizeEnc.handles[0],
        sizeEnc.inputProof,
        collEnc.handles[0],
        collEnc.inputProof,
        true, // isLong
        MARKET_ETH,
        aliceProof,
      );
      const receipt = await tx.wait();
      expect(receipt!.status).to.equal(1);

      // First position → id 0
      const pos = await vault.getPosition(0);
      expect(pos.owner).to.equal(alice.address);
      expect(pos.isLong).to.equal(true);
      expect(pos.marketId).to.equal(MARKET_ETH);
      expect(pos.active).to.equal(true);

      // Decrypt position values (alice should have allow via writePosition grant)
      const size = await hre.fhevm.userDecryptEuint(FhevmType.euint64, pos.size, await vault.getAddress(), alice);
      const coll = await hre.fhevm.userDecryptEuint(FhevmType.euint64, pos.collateral, await vault.getAddress(), alice);
      const entry = await hre.fhevm.userDecryptEuint(FhevmType.euint64, pos.entryPrice, await vault.getAddress(), alice);
      expect(size).to.equal(10n);
      expect(coll).to.equal(1500n);
      expect(entry).to.equal(3000n);

      // Alice's vault balance debited by 1500 → 10_000 - 1500 = 8_500
      const balHandle = await vault.getBalance(alice.address);
      const bal = await hre.fhevm.userDecryptEuint(FhevmType.euint64, balHandle, await vault.getAddress(), alice);
      expect(bal).to.equal(8_500n);
    });

    it("opens a short position", async () => {
      const engineAddr = await engine.getAddress();
      const sizeEnc = await encryptInput(engineAddr, alice.address, 5n);
      const collEnc = await encryptInput(engineAddr, alice.address, 1000n);

      await (await engine.connect(alice).openPosition(
        sizeEnc.handles[0], sizeEnc.inputProof,
        collEnc.handles[0], collEnc.inputProof,
        false, MARKET_ETH, aliceProof,
      )).wait();

      const pos = await vault.getPosition(0);
      expect(pos.isLong).to.equal(false);
    });
  });

  describe("silent-zero (insufficient margin)", () => {
    it("writes a 0-size / 0-collateral position when leverage exceeds max", async () => {
      // size = 10 ETH, collateral = 100 USDC → notional 30_000, capacity 2_000 → FAIL
      const engineAddr = await engine.getAddress();
      const sizeEnc = await encryptInput(engineAddr, alice.address, 10n);
      const collEnc = await encryptInput(engineAddr, alice.address, 100n);

      await (await engine.connect(alice).openPosition(
        sizeEnc.handles[0], sizeEnc.inputProof,
        collEnc.handles[0], collEnc.inputProof,
        true, MARKET_ETH, aliceProof,
      )).wait();

      const pos = await vault.getPosition(0);
      expect(pos.active).to.equal(true); // position does get written
      const size = await hre.fhevm.userDecryptEuint(FhevmType.euint64, pos.size, await vault.getAddress(), alice);
      const coll = await hre.fhevm.userDecryptEuint(FhevmType.euint64, pos.collateral, await vault.getAddress(), alice);
      expect(size).to.equal(0n);
      expect(coll).to.equal(0n);

      // Balance not debited
      const balHandle = await vault.getBalance(alice.address);
      const bal = await hre.fhevm.userDecryptEuint(FhevmType.euint64, balHandle, await vault.getAddress(), alice);
      expect(bal).to.equal(10_000n);
    });
  });

  describe("silent-zero (insufficient balance)", () => {
    it("writes a 0-size / 0-collateral position when collateral > balance", async () => {
      // alice has 10_000 in vault. Submits collateral = 20_000.
      // Even though margin would be fine (20k * 20 = 400k >= size * price),
      // balance check fails → final values zeroed.
      const engineAddr = await engine.getAddress();
      const sizeEnc = await encryptInput(engineAddr, alice.address, 100n);
      const collEnc = await encryptInput(engineAddr, alice.address, 20_000n);

      await (await engine.connect(alice).openPosition(
        sizeEnc.handles[0], sizeEnc.inputProof,
        collEnc.handles[0], collEnc.inputProof,
        true, MARKET_ETH, aliceProof,
      )).wait();

      const pos = await vault.getPosition(0);
      const coll = await hre.fhevm.userDecryptEuint(FhevmType.euint64, pos.collateral, await vault.getAddress(), alice);
      expect(coll).to.equal(0n);

      const balHandle = await vault.getBalance(alice.address);
      const bal = await hre.fhevm.userDecryptEuint(FhevmType.euint64, balHandle, await vault.getAddress(), alice);
      expect(bal).to.equal(10_000n); // unchanged
    });
  });

  describe("guards", () => {
    it("reverts on non-KYC user", async () => {
      const engineAddr = await engine.getAddress();
      const sizeEnc = await encryptInput(engineAddr, nonKycUser.address, 10n);
      const collEnc = await encryptInput(engineAddr, nonKycUser.address, 1500n);

      await expect(
        engine.connect(nonKycUser).openPosition(
          sizeEnc.handles[0], sizeEnc.inputProof,
          collEnc.handles[0], collEnc.inputProof,
          true, MARKET_ETH, aliceProof, // wrong proof for nonKycUser
        )
      ).to.be.revertedWithCustomError(engine, "NotCompliant");
    });

    it("reverts on stale oracle", async () => {
      // Jump time past staleness window
      await hre.ethers.provider.send("evm_increaseTime", [STALENESS + 10]);
      await hre.ethers.provider.send("evm_mine", []);

      const engineAddr = await engine.getAddress();
      const sizeEnc = await encryptInput(engineAddr, alice.address, 10n);
      const collEnc = await encryptInput(engineAddr, alice.address, 1500n);

      await expect(
        engine.connect(alice).openPosition(
          sizeEnc.handles[0], sizeEnc.inputProof,
          collEnc.handles[0], collEnc.inputProof,
          true, MARKET_ETH, aliceProof,
        )
      ).to.be.revertedWithCustomError(engine, "OraclePriceStale");
    });

    it("reverts on invalid market id", async () => {
      const engineAddr = await engine.getAddress();
      const sizeEnc = await encryptInput(engineAddr, alice.address, 10n);
      const collEnc = await encryptInput(engineAddr, alice.address, 1500n);

      await expect(
        engine.connect(alice).openPosition(
          sizeEnc.handles[0], sizeEnc.inputProof,
          collEnc.handles[0], collEnc.inputProof,
          true, 99, aliceProof, // invalid marketId
        )
      ).to.be.revertedWithCustomError(engine, "InvalidMarket");
    });
  });
});
