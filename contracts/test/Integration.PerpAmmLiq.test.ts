import { expect } from "chai";
import * as hre from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import type { NoirVault, MockERC7984, Oracle, Compliance, PerpEngine, AMMEngine } from "../typechain-types";

const MARKET_ETH = 2;
const STALENESS = 90;
const DEVIATION_BPS = 50;

describe("Integration — Perp → AMM liquidation forfeit flow", () => {
  let vault: NoirVault;
  let token: MockERC7984;
  let oracle: Oracle;
  let compliance: Compliance;
  let perp: PerpEngine;
  let amm: AMMEngine;
  let admin: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let relayerA: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let relayerB: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let relayerC: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let alice: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let keeper: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
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

  async function fulfillLiq(reqId: bigint, handle: string): Promise<void> {
    const { abiEncodedClearValues, decryptionProof } = await hre.fhevm.publicDecrypt([handle]);
    await (await perp._onLiquidationDecided(
      reqId, [handle], abiEncodedClearValues, decryptionProof,
    )).wait();
  }

  beforeEach(async () => {
    [admin, relayerA, relayerB, relayerC, alice, keeper] = await hre.ethers.getSigners();

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

    const AMMFactory = await hre.ethers.getContractFactory("AMMEngine");
    amm = (await AMMFactory.deploy(await vault.getAddress(), admin.address)) as unknown as AMMEngine;
    await amm.waitForDeployment();

    const PerpFactory = await hre.ethers.getContractFactory("PerpEngine");
    perp = (await PerpFactory.deploy(
      await vault.getAddress(),
      await oracle.getAddress(),
      await compliance.getAddress(),
      await amm.getAddress(), // liquidationPool = AMM
      admin.address,
    )) as unknown as PerpEngine;
    await perp.waitForDeployment();

    await (await vault.registerEngine(await perp.getAddress())).wait();
    await (await vault.registerEngine(await amm.getAddress())).wait();

    await (await token.connect(alice).setOperator(await vault.getAddress(), 2n ** 48n - 1n)).wait();
    await (await vault.connect(alice).deposit(10_000n)).wait();

    await commitPrice(MARKET_ETH, 3_000n);

    // Alice opens a long position that will go underwater
    const perpAddr = await perp.getAddress();
    const sizeEnc = await encrypt(perpAddr, alice.address, 10n);
    const collEnc = await encrypt(perpAddr, alice.address, 1_500n);
    await (await perp.connect(alice).openPosition(
      sizeEnc.handles[0], sizeEnc.inputProof,
      collEnc.handles[0], collEnc.inputProof,
      true, MARKET_ETH, aliceProof,
    )).wait();
  });

  it("liquidation forfeit flows to AMM's vault balance", async () => {
    // Drop price → position underwater → liquidate
    await commitPrice(MARKET_ETH, 2_990n);

    const tx = await perp.connect(keeper).requestLiquidation(0);
    const receipt = await tx.wait();
    const event = receipt!.logs.find(
      (l: any) => l.fragment?.name === "LiquidationRequested"
    ) as any;
    await fulfillLiq(event.args.requestId, event.args.underwaterHandle);

    // Position is closed
    const pos = await vault.getPosition(0);
    expect(pos.active).to.equal(false);

    // AMM's vault balance is non-zero — forfeit landed there
    const ammBalHandle = await vault.getBalance(await amm.getAddress());
    expect(ammBalHandle).to.not.equal(hre.ethers.ZeroHash);

    // NOTE: AMM's plaintext totalReserveUsdcx is still 0 (forfeit is
    // "stranded" in vault balance but not reflected in plaintext counter).
    // This is the documented MVP limitation.
    expect(await amm.totalReserveUsdcx()).to.equal(0n);
  });
});
