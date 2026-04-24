import { expect } from "chai";
import * as hre from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import type { NoirVault, MockERC7984, Oracle, Compliance, PerpEngine } from "../typechain-types";

describe("PerpEngine — multi-market (BTC/ETH/SOL)", () => {
  const MARKETS = [
    { id: 1, name: "BTC", price: 50_000n, size: 1n, coll: 3_000n },
    { id: 2, name: "ETH", price: 3_000n, size: 10n, coll: 2_000n },
    { id: 3, name: "SOL", price: 150n, size: 100n, coll: 1_000n },
  ];
  const STALENESS = 90;
  const DEVIATION_BPS = 50;

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
    await (await token.mintPlaintext(alice.address, 1_000_000n)).wait();

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
    await (await token.connect(alice).setOperator(await vault.getAddress(), 2n ** 48n - 1n)).wait();
    await (await vault.connect(alice).deposit(100_000n)).wait();
  });

  for (const m of MARKETS) {
    it(`opens and closes a ${m.name} position`, async () => {
      await commitPrice(m.id, m.price);

      const engineAddr = await engine.getAddress();
      const sizeEnc = await encrypt(engineAddr, alice.address, m.size);
      const collEnc = await encrypt(engineAddr, alice.address, m.coll);
      await (await engine.connect(alice).openPosition(
        sizeEnc.handles[0], sizeEnc.inputProof,
        collEnc.handles[0], collEnc.inputProof,
        true, m.id, aliceProof,
      )).wait();

      const nextId = await vault.nextPositionId();
      const positionId = nextId - 1n;
      const pos = await vault.getPosition(positionId);
      expect(pos.marketId).to.equal(m.id);
      expect(pos.active).to.equal(true);

      // Close at same price (flat PnL)
      await (await engine.connect(alice).closePosition(positionId)).wait();
      const closedPos = await vault.getPosition(positionId);
      expect(closedPos.active).to.equal(false);
    });
  }
});
