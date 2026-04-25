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
const LIMIT = 3;

describe("LimitEngine — async trigger (all 3 types)", () => {
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
  let keeper: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
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

  async function decrypt(handle: string, contractAddr: string, signer: typeof admin): Promise<bigint> {
    return hre.fhevm.userDecryptEuint(FhevmType.euint64, handle, contractAddr, signer);
  }

  async function fulfillTrigger(orderId: bigint): Promise<void> {
    // Read the most recent TriggerRequested event for orderId, pull
    // publicDecrypt of the handle, call back.
    const filter = limit.filters.TriggerRequested(undefined, orderId);
    const events = await limit.queryFilter(filter);
    const ev = events[events.length - 1];
    const reqId = ev.args!.requestId;
    const handle = ev.args!.shouldTriggerHandle;

    const { abiEncodedClearValues, decryptionProof } = await hre.fhevm.publicDecrypt([handle]);
    await (await limit._onTriggerDecided(
      reqId, [handle], abiEncodedClearValues, decryptionProof,
    )).wait();
  }

  /// Build the PlaceLimitInputs struct argument for `placeLimit`.
  async function buildLimitInputs(
    contractAddr: string, user: string,
    triggerVal: bigint, sizeVal: bigint, collVal: bigint,
  ) {
    const trig = await encrypt(contractAddr, user, triggerVal);
    const sz = await encrypt(contractAddr, user, sizeVal);
    const col = await encrypt(contractAddr, user, collVal);
    return {
      eTrigger: trig.handles[0],
      triggerProof: trig.inputProof,
      eSize: sz.handles[0],
      sizeProof: sz.inputProof,
      eCollateral: col.handles[0],
      collateralProof: col.inputProof,
    };
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
    await (await limit.setCompliance(await compliance.getAddress())).wait();

    // Authorize LimitEngine as executor on Perp
    await (await perp.setExecutor(await limit.getAddress(), true)).wait();

    await (await token.connect(alice).setOperator(await vault.getAddress(), 2n ** 48n - 1n)).wait();
    await (await vault.connect(alice).deposit(10_000n)).wait();
    await commitPrice(MARKET_ETH, 3_000n);
  });

  describe("TP trigger (long position)", () => {
    it("closes the long position when price rises to TP", async () => {
      // Alice opens a long at 3000
      const perpAddr = await perp.getAddress();
      const sizeEnc = await encrypt(perpAddr, alice.address, 5n);
      const collEnc = await encrypt(perpAddr, alice.address, 1_000n);
      await (await perp.connect(alice).openPosition(
        sizeEnc.handles[0], sizeEnc.inputProof,
        collEnc.handles[0], collEnc.inputProof,
        true, MARKET_ETH, aliceProof,
      )).wait();

      // Alice places TP at 3200
      const limitAddr = await limit.getAddress();
      const trigEnc = await encrypt(limitAddr, alice.address, 3_200n);
      const tx = await limit.connect(alice).placeStopOrTake(
        0, trigEnc.handles[0], trigEnc.inputProof, TP
      );
      const r = await tx.wait();
      const orderId = (r!.logs.find((l: any) => l.fragment?.name === "OrderPlaced") as any).args.orderId;

      // Price moves up to 3200 → TP triggers
      await commitPrice(MARKET_ETH, 3_200n);
      await (await limit.connect(keeper).requestTrigger(orderId)).wait();
      await fulfillTrigger(orderId);

      // Position closed
      const pos = await vault.getPosition(0);
      expect(pos.active).to.equal(false);

      // Order marked inactive
      const order = await limit.getOrder(orderId);
      expect(order.active).to.equal(false);
    });

    it("does not close when price hasn't reached TP", async () => {
      const perpAddr = await perp.getAddress();
      const sizeEnc = await encrypt(perpAddr, alice.address, 5n);
      const collEnc = await encrypt(perpAddr, alice.address, 1_000n);
      await (await perp.connect(alice).openPosition(
        sizeEnc.handles[0], sizeEnc.inputProof,
        collEnc.handles[0], collEnc.inputProof,
        true, MARKET_ETH, aliceProof,
      )).wait();

      const limitAddr = await limit.getAddress();
      const trigEnc = await encrypt(limitAddr, alice.address, 3_500n);
      const tx = await limit.connect(alice).placeStopOrTake(
        0, trigEnc.handles[0], trigEnc.inputProof, TP
      );
      const r = await tx.wait();
      const orderId = (r!.logs.find((l: any) => l.fragment?.name === "OrderPlaced") as any).args.orderId;

      // Price only at 3100 — below 3500 TP
      await commitPrice(MARKET_ETH, 3_100n);
      await (await limit.connect(keeper).requestTrigger(orderId)).wait();
      await fulfillTrigger(orderId);

      // Position still active
      const pos = await vault.getPosition(0);
      expect(pos.active).to.equal(true);

      // Order marked inactive (trigger callback is single-use even on miss)
      const order = await limit.getOrder(orderId);
      expect(order.active).to.equal(false);
    });
  });

  describe("SL trigger (long position)", () => {
    it("closes the long when price falls to SL", async () => {
      const perpAddr = await perp.getAddress();
      const sizeEnc = await encrypt(perpAddr, alice.address, 5n);
      const collEnc = await encrypt(perpAddr, alice.address, 1_000n);
      await (await perp.connect(alice).openPosition(
        sizeEnc.handles[0], sizeEnc.inputProof,
        collEnc.handles[0], collEnc.inputProof,
        true, MARKET_ETH, aliceProof,
      )).wait();

      const limitAddr = await limit.getAddress();
      const trigEnc = await encrypt(limitAddr, alice.address, 2_900n);
      const tx = await limit.connect(alice).placeStopOrTake(
        0, trigEnc.handles[0], trigEnc.inputProof, SL
      );
      const r = await tx.wait();
      const orderId = (r!.logs.find((l: any) => l.fragment?.name === "OrderPlaced") as any).args.orderId;

      await commitPrice(MARKET_ETH, 2_900n);
      await (await limit.connect(keeper).requestTrigger(orderId)).wait();
      await fulfillTrigger(orderId);

      const pos = await vault.getPosition(0);
      expect(pos.active).to.equal(false);
    });
  });

  describe("LIMIT trigger (open new long position)", () => {
    it("opens a new long position when price falls to limit-buy trigger", async () => {
      // Alice places limit-buy at 2_900 (price needs to fall to 2900)
      const limitAddr = await limit.getAddress();
      const inputs = await buildLimitInputs(limitAddr, alice.address, 2_900n, 5n, 1_000n);
      const tx = await limit.connect(alice).placeLimit(
        inputs, MARKET_ETH, true /* long buy */, aliceProof,
      );
      const r = await tx.wait();
      const orderId = (r!.logs.find((l: any) => l.fragment?.name === "OrderPlaced") as any).args.orderId;

      // Pre-trigger: alice has 9_000 vault balance (10_000 - 1_000 escrow)
      let aliceBal = await decrypt(
        await vault.getBalance(alice.address),
        await vault.getAddress(),
        alice,
      );
      expect(aliceBal).to.equal(9_000n);

      // Price falls to 2900 — triggers
      await commitPrice(MARKET_ETH, 2_900n);
      await (await limit.connect(keeper).requestTrigger(orderId)).wait();
      await fulfillTrigger(orderId);

      // Position 0 opened (alice's first; perp.nextPositionId was 0)
      const pos = await vault.getPosition(0);
      expect(pos.owner).to.equal(alice.address);
      expect(pos.isLong).to.equal(true);
      expect(pos.active).to.equal(true);

      // Alice's vault balance: refund 1_000 from escrow, then perp debits
      // 1_000 for the position open. Net: 9_000 + 1_000 - 1_000 = 9_000.
      aliceBal = await decrypt(
        await vault.getBalance(alice.address),
        await vault.getAddress(),
        alice,
      );
      expect(aliceBal).to.equal(9_000n);

      // Order marked inactive
      const order = await limit.getOrder(orderId);
      expect(order.active).to.equal(false);
    });

    it("refunds escrow but does NOT open position when price hasn't crossed", async () => {
      const limitAddr = await limit.getAddress();
      const inputs = await buildLimitInputs(limitAddr, alice.address, 2_500n, 5n, 1_000n);
      const tx = await limit.connect(alice).placeLimit(
        inputs, MARKET_ETH, true, aliceProof,
      );
      const r = await tx.wait();
      const orderId = (r!.logs.find((l: any) => l.fragment?.name === "OrderPlaced") as any).args.orderId;

      // Price at 2_900 — above trigger 2_500, doesn't cross for long-buy
      await commitPrice(MARKET_ETH, 2_900n);
      await (await limit.connect(keeper).requestTrigger(orderId)).wait();
      await fulfillTrigger(orderId);

      // No position opened
      expect(await vault.nextPositionId()).to.equal(0n);

      // Escrow refunded — alice back to 10_000
      const aliceBal = await decrypt(
        await vault.getBalance(alice.address),
        await vault.getAddress(),
        alice,
      );
      expect(aliceBal).to.equal(10_000n);
    });
  });

  describe("guards", () => {
    it("requestTrigger reverts on inactive order", async () => {
      const perpAddr = await perp.getAddress();
      const sizeEnc = await encrypt(perpAddr, alice.address, 5n);
      const collEnc = await encrypt(perpAddr, alice.address, 1_000n);
      await (await perp.connect(alice).openPosition(
        sizeEnc.handles[0], sizeEnc.inputProof,
        collEnc.handles[0], collEnc.inputProof,
        true, MARKET_ETH, aliceProof,
      )).wait();

      const limitAddr = await limit.getAddress();
      const trigEnc = await encrypt(limitAddr, alice.address, 3_500n);
      const tx = await limit.connect(alice).placeStopOrTake(
        0, trigEnc.handles[0], trigEnc.inputProof, TP
      );
      const r = await tx.wait();
      const orderId = (r!.logs.find((l: any) => l.fragment?.name === "OrderPlaced") as any).args.orderId;

      // Cancel the order
      await (await limit.connect(alice).cancelOrder(orderId)).wait();

      // requestTrigger should revert
      await expect(limit.connect(keeper).requestTrigger(orderId))
        .to.be.revertedWithCustomError(limit, "OrderNotActive");
    });

    it("requestTrigger reverts when oracle is stale", async () => {
      const perpAddr = await perp.getAddress();
      const sizeEnc = await encrypt(perpAddr, alice.address, 5n);
      const collEnc = await encrypt(perpAddr, alice.address, 1_000n);
      await (await perp.connect(alice).openPosition(
        sizeEnc.handles[0], sizeEnc.inputProof,
        collEnc.handles[0], collEnc.inputProof,
        true, MARKET_ETH, aliceProof,
      )).wait();

      const limitAddr = await limit.getAddress();
      const trigEnc = await encrypt(limitAddr, alice.address, 3_500n);
      const tx = await limit.connect(alice).placeStopOrTake(
        0, trigEnc.handles[0], trigEnc.inputProof, TP
      );
      const r = await tx.wait();
      const orderId = (r!.logs.find((l: any) => l.fragment?.name === "OrderPlaced") as any).args.orderId;

      await hre.ethers.provider.send("evm_increaseTime", [STALENESS + 10]);
      await hre.ethers.provider.send("evm_mine", []);

      await expect(limit.connect(keeper).requestTrigger(orderId))
        .to.be.revertedWithCustomError(limit, "OraclePriceStale");
    });
  });
});
