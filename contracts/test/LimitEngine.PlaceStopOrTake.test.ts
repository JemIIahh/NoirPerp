import { expect } from "chai";
import * as hre from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import type { NoirVault, MockERC7984, Oracle, Compliance, PerpEngine, LimitEngine } from "../typechain-types";

const MARKET_ETH = 2;
const STALENESS = 90;
const DEVIATION_BPS = 50;
const TP = 1;
const SL = 2;

describe("LimitEngine — placeStopOrTake + cancelOrder", () => {
  let vault: NoirVault;
  let token: MockERC7984;
  let oracle: Oracle;
  let compliance: Compliance;
  let perp: PerpEngine;
  let limit: LimitEngine;
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

  async function commitPrice(marketId: number, price: bigint) {
    const t = await now();
    await (await oracle.connect(relayerA).submitPrice(marketId, price, t)).wait();
    await (await oracle.connect(relayerB).submitPrice(marketId, price, t + 1)).wait();
  }

  async function encrypt(contractAddr: string, user: string, value: bigint) {
    const input = hre.fhevm.createEncryptedInput(contractAddr, user);
    input.add64(value);
    return await input.encrypt();
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
      admin.address, [relayerA.address, relayerB.address, relayerC.address],
      STALENESS, DEVIATION_BPS,
    )) as unknown as Oracle;
    await oracle.waitForDeployment();

    const tree = StandardMerkleTree.of([[alice.address]], ["address"]);
    aliceProof = tree.getProof([alice.address]);
    const ComplianceFactory = await hre.ethers.getContractFactory("Compliance");
    compliance = (await ComplianceFactory.deploy(admin.address, tree.root)) as unknown as Compliance;
    await compliance.waitForDeployment();

    const PerpFactory = await hre.ethers.getContractFactory("PerpEngine");
    perp = (await PerpFactory.deploy(
      await vault.getAddress(),
      await oracle.getAddress(),
      await compliance.getAddress(),
      admin.address, admin.address,
    )) as unknown as PerpEngine;
    await perp.waitForDeployment();
    await (await vault.registerEngine(await perp.getAddress())).wait();

    const LimitFactory = await hre.ethers.getContractFactory("LimitEngine");
    limit = (await LimitFactory.deploy(await vault.getAddress(), admin.address)) as unknown as LimitEngine;
    await limit.waitForDeployment();
    await (await vault.registerEngine(await limit.getAddress())).wait();
    await (await limit.setOracle(await oracle.getAddress())).wait();
    await (await limit.setPerp(await perp.getAddress())).wait();

    // Alice deposits + opens a long position
    await (await token.connect(alice).setOperator(await vault.getAddress(), 2n ** 48n - 1n)).wait();
    await (await vault.connect(alice).deposit(10_000n)).wait();
    await commitPrice(MARKET_ETH, 3_000n);

    const perpAddr = await perp.getAddress();
    const sizeEnc = await encrypt(perpAddr, alice.address, 10n);
    const collEnc = await encrypt(perpAddr, alice.address, 1_500n);
    await (await perp.connect(alice).openPosition(
      sizeEnc.handles[0], sizeEnc.inputProof,
      collEnc.handles[0], collEnc.inputProof,
      true, MARKET_ETH, aliceProof,
    )).wait();
    // Position 0 is now alice's long ETH
  });

  describe("placeStopOrTake — TP", () => {
    it("places a TP order on alice's long position", async () => {
      const limitAddr = await limit.getAddress();
      const trigEnc = await encrypt(limitAddr, alice.address, 3_500n);

      const tx = await limit.connect(alice).placeStopOrTake(
        0, // positionId
        trigEnc.handles[0],
        trigEnc.inputProof,
        TP,
      );
      const receipt = await tx.wait();
      const event = receipt!.logs.find(
        (l: any) => l.fragment?.name === "OrderPlaced"
      ) as any;
      expect(event).to.not.equal(undefined);
      expect(event.args.orderId).to.equal(0n);
      expect(event.args.owner).to.equal(alice.address);
      expect(event.args.orderType).to.equal(TP);

      const order = await limit.getOrder(0);
      expect(order.owner).to.equal(alice.address);
      expect(order.orderType).to.equal(TP);
      expect(order.positionId).to.equal(0);
      expect(order.isLong).to.equal(true);
      expect(order.marketId).to.equal(MARKET_ETH);
      expect(order.active).to.equal(true);
    });

    it("places a SL order on alice's long position", async () => {
      const limitAddr = await limit.getAddress();
      const trigEnc = await encrypt(limitAddr, alice.address, 2_800n);
      await (await limit.connect(alice).placeStopOrTake(
        0, trigEnc.handles[0], trigEnc.inputProof, SL
      )).wait();
      const order = await limit.getOrder(0);
      expect(order.orderType).to.equal(SL);
      expect(order.active).to.equal(true);
    });

    it("nextOrderId increments", async () => {
      const limitAddr = await limit.getAddress();
      const trigEnc1 = await encrypt(limitAddr, alice.address, 3_500n);
      await (await limit.connect(alice).placeStopOrTake(
        0, trigEnc1.handles[0], trigEnc1.inputProof, TP
      )).wait();
      const trigEnc2 = await encrypt(limitAddr, alice.address, 2_800n);
      await (await limit.connect(alice).placeStopOrTake(
        0, trigEnc2.handles[0], trigEnc2.inputProof, SL
      )).wait();
      expect(await limit.nextOrderId()).to.equal(2n);
    });
  });

  describe("placeStopOrTake — guards", () => {
    it("reverts when caller does not own the position", async () => {
      const limitAddr = await limit.getAddress();
      const trigEnc = await encrypt(limitAddr, bob.address, 3_500n);
      await expect(limit.connect(bob).placeStopOrTake(
        0, trigEnc.handles[0], trigEnc.inputProof, TP
      )).to.be.revertedWithCustomError(limit, "NotPositionOwner");
    });

    it("reverts on inactive position", async () => {
      // Close alice's position first
      await (await perp.connect(alice).closePosition(0)).wait();
      const limitAddr = await limit.getAddress();
      const trigEnc = await encrypt(limitAddr, alice.address, 3_500n);
      await expect(limit.connect(alice).placeStopOrTake(
        0, trigEnc.handles[0], trigEnc.inputProof, TP
      )).to.be.revertedWithCustomError(limit, "PositionNotActive");
    });

    it("reverts on invalid orderType (3 = LIMIT not allowed here)", async () => {
      const limitAddr = await limit.getAddress();
      const trigEnc = await encrypt(limitAddr, alice.address, 3_500n);
      await expect(limit.connect(alice).placeStopOrTake(
        0, trigEnc.handles[0], trigEnc.inputProof, 3 /* LIMIT */
      )).to.be.revertedWithCustomError(limit, "InvalidOrderType");
    });

    it("reverts on orderType 0", async () => {
      const limitAddr = await limit.getAddress();
      const trigEnc = await encrypt(limitAddr, alice.address, 3_500n);
      await expect(limit.connect(alice).placeStopOrTake(
        0, trigEnc.handles[0], trigEnc.inputProof, 0
      )).to.be.revertedWithCustomError(limit, "InvalidOrderType");
    });
  });

  describe("cancelOrder — TP/SL (no escrow refund)", () => {
    let orderId: bigint;

    beforeEach(async () => {
      const limitAddr = await limit.getAddress();
      const trigEnc = await encrypt(limitAddr, alice.address, 3_500n);
      const tx = await limit.connect(alice).placeStopOrTake(
        0, trigEnc.handles[0], trigEnc.inputProof, TP
      );
      const r = await tx.wait();
      const ev = r!.logs.find((l: any) => l.fragment?.name === "OrderPlaced") as any;
      orderId = ev.args.orderId;
    });

    it("owner can cancel", async () => {
      await expect(limit.connect(alice).cancelOrder(orderId))
        .to.emit(limit, "OrderCancelled").withArgs(orderId, alice.address);
      const order = await limit.getOrder(orderId);
      expect(order.active).to.equal(false);
    });

    it("non-owner cannot cancel", async () => {
      await expect(limit.connect(bob).cancelOrder(orderId))
        .to.be.revertedWithCustomError(limit, "NotOrderOwner");
    });

    it("cannot cancel an already-cancelled order", async () => {
      await (await limit.connect(alice).cancelOrder(orderId)).wait();
      await expect(limit.connect(alice).cancelOrder(orderId))
        .to.be.revertedWithCustomError(limit, "OrderNotActive");
    });
  });
});
