import { expect } from "chai";
import * as hre from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import type { NoirVault, MockERC7984, Oracle, Compliance, PerpEngine, DarkpoolEngine } from "../typechain-types";

const MARKET_ETH = 2;
const MARKET_BTC = 1;
const STALENESS = 90;
const DEVIATION_BPS = 50;
const ORACLE_PRICE = 3_000n;

describe("DarkpoolEngine — submitMatchPair + _onMatchDecided (Phase 11)", () => {
  let vault: NoirVault;
  let token: MockERC7984;
  let oracle: Oracle;
  let compliance: Compliance;
  let perp: PerpEngine;
  let dark: DarkpoolEngine;
  let admin: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let relayerA: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let relayerB: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let relayerC: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let alice: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let bob: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let charlie: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let keeper: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let aliceProof: string[];
  let bobProof: string[];
  let charlieProof: string[];

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

  async function decryptBalance(user: typeof alice): Promise<bigint> {
    return hre.fhevm.userDecryptEuint(
      FhevmType.euint64,
      await vault.getBalance(user.address),
      await vault.getAddress(),
      user,
    );
  }

  async function buildPairInputs(
    user: string, sizeVal: bigint, cpuVal: bigint, limitVal: bigint,
  ) {
    const addr = await dark.getAddress();
    const sz = await encrypt(addr, user, sizeVal);
    const cpu = await encrypt(addr, user, cpuVal);
    const lim = await encrypt(addr, user, limitVal);
    return {
      eSize: sz.handles[0], sizeProof: sz.inputProof,
      eCollateralPerUnit: cpu.handles[0], collateralPerUnitProof: cpu.inputProof,
      eLimitPrice: lim.handles[0], limitProof: lim.inputProof,
    };
  }

  async function submitPairOrder(
    signer: typeof alice, proof: string[],
    sizeVal: bigint, cpuVal: bigint, limitVal: bigint,
    isLong: boolean, marketId: number = MARKET_ETH,
  ): Promise<bigint> {
    const inputs = await buildPairInputs(signer.address, sizeVal, cpuVal, limitVal);
    const tx = await dark.connect(signer).submitOrderForPairMatch(
      inputs, marketId, isLong, proof,
    );
    const r = await tx.wait();
    const ev = r!.logs.find((l: any) => l.fragment?.name === "OrderSubmittedForPair") as any;
    return ev.args.orderId;
  }

  async function submitLegacyOrder(
    signer: typeof alice, proof: string[],
    sizeVal: bigint, collVal: bigint, limitVal: bigint,
    isLong: boolean, marketId: number = MARKET_ETH,
  ): Promise<bigint> {
    const addr = await dark.getAddress();
    const sz = await encrypt(addr, signer.address, sizeVal);
    const co = await encrypt(addr, signer.address, collVal);
    const lim = await encrypt(addr, signer.address, limitVal);
    const inputs = {
      eSize: sz.handles[0], sizeProof: sz.inputProof,
      eCollateral: co.handles[0], collateralProof: co.inputProof,
      eLimitPrice: lim.handles[0], limitProof: lim.inputProof,
    };
    const tx = await dark.connect(signer).submitOrder(inputs, marketId, isLong, proof);
    const r = await tx.wait();
    const ev = r!.logs.find((l: any) => l.fragment?.name === "OrderSubmitted") as any;
    return ev.args.orderId;
  }

  type MatchEv = { requestId: bigint; handles: string[] };
  async function callMatch(buyId: bigint, sellId: bigint, signer = keeper): Promise<MatchEv> {
    const tx = await dark.connect(signer).submitMatchPair(buyId, sellId);
    const r = await tx.wait();
    const ev = r!.logs.find((l: any) => l.fragment?.name === "MatchProposed") as any;
    return { requestId: ev.args.requestId, handles: ev.args.handles };
  }

  async function fulfillMatch(requestId: bigint, handles: string[]) {
    const mutable: string[] = [...handles];
    const { abiEncodedClearValues, decryptionProof } = await hre.fhevm.publicDecrypt(mutable);
    return await dark._onMatchDecided(requestId, mutable, abiEncodedClearValues, decryptionProof);
  }

  beforeEach(async () => {
    [admin, relayerA, relayerB, relayerC, alice, bob, charlie, keeper] = await hre.ethers.getSigners();

    const TokenFactory = await hre.ethers.getContractFactory("MockERC7984");
    token = (await TokenFactory.deploy("MockUSDCx", "mUSDCx")) as unknown as MockERC7984;
    await token.waitForDeployment();
    await (await token.mintPlaintext(alice.address,   100_000n)).wait();
    await (await token.mintPlaintext(bob.address,     100_000n)).wait();
    await (await token.mintPlaintext(charlie.address, 100_000n)).wait();

    const VaultFactory = await hre.ethers.getContractFactory("NoirVault");
    vault = (await VaultFactory.deploy(admin.address, await token.getAddress())) as unknown as NoirVault;
    await vault.waitForDeployment();

    const OracleFactory = await hre.ethers.getContractFactory("Oracle");
    oracle = (await OracleFactory.deploy(
      admin.address, [relayerA.address, relayerB.address, relayerC.address],
      STALENESS, DEVIATION_BPS,
    )) as unknown as Oracle;
    await oracle.waitForDeployment();

    const tree = StandardMerkleTree.of(
      [[alice.address], [bob.address], [charlie.address]], ["address"],
    );
    aliceProof   = tree.getProof([alice.address]);
    bobProof     = tree.getProof([bob.address]);
    charlieProof = tree.getProof([charlie.address]);
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

    const DarkFactory = await hre.ethers.getContractFactory("DarkpoolEngine");
    dark = (await DarkFactory.deploy(await vault.getAddress(), admin.address)) as unknown as DarkpoolEngine;
    await dark.waitForDeployment();
    await (await vault.registerEngine(await dark.getAddress())).wait();
    await (await dark.setOracle(await oracle.getAddress())).wait();
    await (await dark.setPerp(await perp.getAddress())).wait();
    await (await dark.setCompliance(await compliance.getAddress())).wait();

    await (await perp.setExecutor(await dark.getAddress(), true)).wait();

    for (const u of [alice, bob, charlie]) {
      await (await token.connect(u).setOperator(await vault.getAddress(), 2n ** 48n - 1n)).wait();
      await (await vault.connect(u).deposit(20_000n)).wait();
    }
    await commitPrice(MARKET_ETH, ORACLE_PRICE);
  });

  // 7.1 — pair found + intersects (equal sizes; happy path; positions opened)
  it("settles a fully-intersecting pair with equal sizes; both positions open at oracle price", async () => {
    const buyId  = await submitPairOrder(alice, aliceProof, 5n, 200n, 3_100n, true);
    const sellId = await submitPairOrder(bob,   bobProof,   5n, 200n, 2_900n, false);

    const { requestId, handles } = await callMatch(buyId, sellId);
    await (await fulfillMatch(requestId, handles)).wait();

    expect(await vault.nextPositionId()).to.equal(2n);
    const p0 = await vault.getPosition(0);
    const p1 = await vault.getPosition(1);
    expect(p0.owner).to.equal(alice.address);
    expect(p0.isLong).to.equal(true);
    expect(p1.owner).to.equal(bob.address);
    expect(p1.isLong).to.equal(false);

    expect((await dark.getOrder(buyId)).active).to.equal(false);
    expect((await dark.getOrder(sellId)).active).to.equal(false);

    // Each user: deposit 20_000 - lock 1000 + refund 1000 - perp debit 1000 = 19_000
    expect(await decryptBalance(alice)).to.equal(19_000n);
    expect(await decryptBalance(bob)).to.equal(19_000n);
  });

  // 7.2 — pair found + no-intersect (callback returns MatchRejected, both stay active)
  it("emits MatchRejected and leaves both orders active when prices don't intersect", async () => {
    const buyId  = await submitPairOrder(alice, aliceProof, 5n, 200n, 2_900n, true);  // bid 2900
    const sellId = await submitPairOrder(bob,   bobProof,   5n, 200n, 3_100n, false); // ask 3100

    const { requestId, handles } = await callMatch(buyId, sellId);
    const rcpt = await (await fulfillMatch(requestId, handles)).wait();

    const rej = rcpt!.logs.find((l: any) => l.fragment?.name === "MatchRejected") as any;
    expect(rej).to.not.equal(undefined);
    expect(rej.args.requestId).to.equal(requestId);

    expect(await vault.nextPositionId()).to.equal(0n);
    expect((await dark.getOrder(buyId)).active).to.equal(true);
    expect((await dark.getOrder(sellId)).active).to.equal(true);

    // No fill → both still escrowed, balance reflects only the submit-time lock.
    expect(await decryptBalance(alice)).to.equal(19_000n);
    expect(await decryptBalance(bob)).to.equal(19_000n);
  });

  // 7.3 — partial fill leaves residual on the larger order
  it("fills the smaller order fully and leaves a residual on the larger", async () => {
    // buy 10 @ cpu 200 (lock 2000), sell 7 @ cpu 300 (lock 2100)
    const buyId  = await submitPairOrder(alice, aliceProof, 10n, 200n, 3_100n, true);
    const sellId = await submitPairOrder(bob,   bobProof,    7n, 300n, 2_900n, false);

    const { requestId, handles } = await callMatch(buyId, sellId);
    await (await fulfillMatch(requestId, handles)).wait();

    expect(await vault.nextPositionId()).to.equal(2n);

    // Larger order keeps active with residual size; smaller closes.
    const buyOrder  = await dark.getOrder(buyId);
    const sellOrder = await dark.getOrder(sellId);
    expect(buyOrder.active).to.equal(true);
    expect(sellOrder.active).to.equal(false);

    // Residual size on buy = 10 - 7 = 3. Decrypt via alice's user-decrypt.
    const buySizeAfter = await hre.fhevm.userDecryptEuint(
      FhevmType.euint64, buyOrder.size, await dark.getAddress(), alice,
    );
    expect(buySizeAfter).to.equal(3n);

    // Alice: 20000 - 2000(lock) + 1400(refund 200×7) - 1400(perp debit) = 18_000
    // Bob:   20000 - 2100(lock) + 2100(refund 300×7) - 2100(perp debit) = 17_900
    expect(await decryptBalance(alice)).to.equal(18_000n);
    expect(await decryptBalance(bob)).to.equal(17_900n);
  });

  // 7.4 — residual order can be matched against a fresh counterparty
  it("the residual on the larger order is re-eligible for a fresh pair match", async () => {
    // First pair: buy 10 vs sell 7 → buy residual 3.
    const buyId  = await submitPairOrder(alice, aliceProof, 10n, 200n, 3_100n, true);
    const firstSell = await submitPairOrder(bob, bobProof, 7n, 300n, 2_900n, false);
    {
      const { requestId, handles } = await callMatch(buyId, firstSell);
      await (await fulfillMatch(requestId, handles)).wait();
    }

    // Second pair: charlie sells 3 → matches the residual exactly.
    const secondSell = await submitPairOrder(charlie, charlieProof, 3n, 300n, 2_900n, false);
    {
      const { requestId, handles } = await callMatch(buyId, secondSell);
      await (await fulfillMatch(requestId, handles)).wait();
    }

    // After 2nd settle: buyId fully consumed, both orders inactive, total 4 positions.
    expect(await vault.nextPositionId()).to.equal(4n);
    expect((await dark.getOrder(buyId)).active).to.equal(false);
    expect((await dark.getOrder(secondSell)).active).to.equal(false);

    // Alice net across both fills: 20000 - 2000(lock) + 600(refund 200×3 on 2nd) - 600(perp debit on 2nd)
    //                              + 1400(refund 200×7 on 1st) - 1400(perp debit on 1st) = 18_000
    expect(await decryptBalance(alice)).to.equal(18_000n);
  });

  // 7.5 — self-match revert
  it("reverts PairOrdersSameOwner when both orders share an owner", async () => {
    const buyId  = await submitPairOrder(alice, aliceProof, 5n, 200n, 3_100n, true);
    const sellId = await submitPairOrder(alice, aliceProof, 5n, 200n, 2_900n, false);
    await expect(dark.connect(keeper).submitMatchPair(buyId, sellId))
      .to.be.revertedWithCustomError(dark, "PairOrdersSameOwner");
  });

  // 7.6 — cross-market revert
  it("reverts PairOrdersDifferentMarket when orders are on different markets", async () => {
    await commitPrice(MARKET_BTC, 60_000n);
    const buyEth = await submitPairOrder(alice, aliceProof, 5n, 200n, 3_100n, true,  MARKET_ETH);
    const sellBtc = await submitPairOrder(bob,  bobProof,   5n, 200n,  2_900n, false, MARKET_BTC);
    await expect(dark.connect(keeper).submitMatchPair(buyEth, sellBtc))
      .to.be.revertedWithCustomError(dark, "PairOrdersDifferentMarket");
  });

  // 7.7 — same-side revert + canonicalization revert
  it("reverts PairOrdersSameSide on two longs and PairOrdersWrongCanonicalization on (short, long)", async () => {
    const long1 = await submitPairOrder(alice, aliceProof, 5n, 200n, 3_100n, true);
    const long2 = await submitPairOrder(bob,   bobProof,   5n, 200n, 3_100n, true);
    await expect(dark.connect(keeper).submitMatchPair(long1, long2))
      .to.be.revertedWithCustomError(dark, "PairOrdersSameSide");

    // Opposite sides but caller passed sellId as buyId → canonicalization revert.
    const longBuy   = await submitPairOrder(charlie, charlieProof, 5n, 200n, 3_100n, true);
    const shortSell = await submitPairOrder(alice,   aliceProof,   5n, 200n, 2_900n, false);
    await expect(dark.connect(keeper).submitMatchPair(shortSell, longBuy))
      .to.be.revertedWithCustomError(dark, "PairOrdersWrongCanonicalization");
  });

  // 7.8 — inactive-order revert
  it("reverts PairOrderInactive when an order was cancelled before submitMatchPair", async () => {
    const buyId  = await submitPairOrder(alice, aliceProof, 5n, 200n, 3_100n, true);
    const sellId = await submitPairOrder(bob,   bobProof,   5n, 200n, 2_900n, false);
    await (await dark.connect(alice).cancelOrder(buyId)).wait();

    await expect(dark.connect(keeper).submitMatchPair(buyId, sellId))
      .to.be.revertedWithCustomError(dark, "PairOrderInactive");

    // Also: legacy (batch-only) order paired with a pair-eligible one → NotEligible.
    const legacyId = await submitLegacyOrder(charlie, charlieProof, 5n, 1_000n, 3_100n, true);
    await expect(dark.connect(keeper).submitMatchPair(legacyId, sellId))
      .to.be.revertedWithCustomError(dark, "PairOrderNotEligible");
  });

  // 7.9 — MAX_LEVERAGE breach is silent-zeroed by PerpEngine; pair flow still completes
  it("settles pair without revert when leverage breaches MAX_LEVERAGE; PerpEngine silent-zeros positions", async () => {
    // notional = 5 × 3000 = 15_000; collateral = 5 × 1 = 5 → leverage 3000× (way over 20×)
    const buyId  = await submitPairOrder(alice, aliceProof, 5n, 1n, 3_100n, true);
    const sellId = await submitPairOrder(bob,   bobProof,   5n, 1n, 2_900n, false);

    const { requestId, handles } = await callMatch(buyId, sellId);
    const rcpt = await (await fulfillMatch(requestId, handles)).wait();

    // Pair settled cleanly (MatchSettled emitted, both orders closed).
    const settled = rcpt!.logs.find((l: any) => l.fragment?.name === "MatchSettled") as any;
    expect(settled).to.not.equal(undefined);
    expect((await dark.getOrder(buyId)).active).to.equal(false);
    expect((await dark.getOrder(sellId)).active).to.equal(false);

    // Two position slots written (silent-zero still allocates a positionId).
    expect(await vault.nextPositionId()).to.equal(2n);

    // Silent-zero → perp debit is 0, refund is 5. Net for each user: 20000 - 5(lock) + 5(refund) - 0 = 20_000
    expect(await decryptBalance(alice)).to.equal(20_000n);
    expect(await decryptBalance(bob)).to.equal(20_000n);
  });

  // 7.10 — replay guard: second _onMatchDecided with the same requestId reverts
  it("the callback rejects replay of the same requestId via DecryptNotPending", async () => {
    const buyId  = await submitPairOrder(alice, aliceProof, 5n, 200n, 3_100n, true);
    const sellId = await submitPairOrder(bob,   bobProof,   5n, 200n, 2_900n, false);

    const { requestId, handles } = await callMatch(buyId, sellId);
    const mutable: string[] = [...handles];
    const { abiEncodedClearValues, decryptionProof } = await hre.fhevm.publicDecrypt(mutable);

    await (await dark._onMatchDecided(requestId, mutable, abiEncodedClearValues, decryptionProof)).wait();

    await expect(
      dark._onMatchDecided(requestId, mutable, abiEncodedClearValues, decryptionProof),
    ).to.be.revertedWithCustomError(dark, "DecryptNotPending");
  });

  // 7.11 — both orders simultaneously closing emits OrderClosed for each
  it("emits OrderClosed for both orders when sizes are equal (both fully consumed)", async () => {
    const buyId  = await submitPairOrder(alice, aliceProof, 5n, 200n, 3_100n, true);
    const sellId = await submitPairOrder(bob,   bobProof,   5n, 200n, 2_900n, false);

    const { requestId, handles } = await callMatch(buyId, sellId);
    const rcpt = await (await fulfillMatch(requestId, handles)).wait();

    const closedEvents = rcpt!.logs.filter((l: any) => l.fragment?.name === "OrderClosed") as any[];
    expect(closedEvents.length).to.equal(2);
    const closedIds = new Set(closedEvents.map((e: any) => e.args.orderId.toString()));
    expect(closedIds.has(buyId.toString())).to.equal(true);
    expect(closedIds.has(sellId.toString())).to.equal(true);
    for (const ev of closedEvents) expect(ev.args.reason).to.equal("filled");
  });

  // 7.11b — concurrent cancel during in-flight decrypt → MatchAborted (verifies the safety-guard edit)
  it("aborts the match cleanly via MatchAborted if an order is cancelled during the in-flight decrypt", async () => {
    const buyId  = await submitPairOrder(alice, aliceProof, 5n, 200n, 3_100n, true);
    const sellId = await submitPairOrder(bob,   bobProof,   5n, 200n, 2_900n, false);

    // submitMatchPair locks the decision in the queue but doesn't fulfill yet.
    const { requestId, handles } = await callMatch(buyId, sellId);

    // Bob cancels mid-flight; cancelOrder refunds the full escrow.
    await (await dark.connect(bob).cancelOrder(sellId)).wait();

    // Now the Gateway delivers the (intersects=true) cleartext. Callback must
    // detect the cancelled side and abort cleanly — no positions opened, no
    // double-debit, both users keep their state.
    const rcpt = await (await fulfillMatch(requestId, handles)).wait();

    const aborted = rcpt!.logs.find((l: any) => l.fragment?.name === "MatchAborted") as any;
    expect(aborted).to.not.equal(undefined);
    expect(aborted.args.requestId).to.equal(requestId);
    expect(aborted.args.reason).to.equal("cancelled during decrypt");

    // No positions opened.
    expect(await vault.nextPositionId()).to.equal(0n);

    // Buy order still active (alice never cancelled); sell order inactive (cancelled).
    expect((await dark.getOrder(buyId)).active).to.equal(true);
    expect((await dark.getOrder(sellId)).active).to.equal(false);

    // Alice: still has lock (1000) → balance 19_000.
    // Bob: cancelOrder refunded the full lock (1000) → balance 20_000.
    expect(await decryptBalance(alice)).to.equal(19_000n);
    expect(await decryptBalance(bob)).to.equal(20_000n);
  });

  // 7.12 — oracle stale revert
  it("reverts OraclePriceStale at submitMatchPair when the oracle is past the staleness window", async () => {
    const buyId  = await submitPairOrder(alice, aliceProof, 5n, 200n, 3_100n, true);
    const sellId = await submitPairOrder(bob,   bobProof,   5n, 200n, 2_900n, false);

    await hre.ethers.provider.send("evm_increaseTime", [STALENESS + 10]);
    await hre.ethers.provider.send("evm_mine", []);

    await expect(dark.connect(keeper).submitMatchPair(buyId, sellId))
      .to.be.revertedWithCustomError(dark, "OraclePriceStale");
  });
});
