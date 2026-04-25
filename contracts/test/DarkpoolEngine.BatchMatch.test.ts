import { expect } from "chai";
import * as hre from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import type { NoirVault, MockERC7984, Oracle, Compliance, PerpEngine, DarkpoolEngine } from "../typechain-types";

const MARKET_ETH = 2;
const STALENESS = 90;
const DEVIATION_BPS = 50;

describe("DarkpoolEngine — batch match (async)", () => {
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

  async function buildInputs(
    contractAddr: string, user: string,
    sizeVal: bigint, collVal: bigint, limitVal: bigint,
  ) {
    const sz = await encrypt(contractAddr, user, sizeVal);
    const col = await encrypt(contractAddr, user, collVal);
    const lim = await encrypt(contractAddr, user, limitVal);
    return {
      eSize: sz.handles[0], sizeProof: sz.inputProof,
      eCollateral: col.handles[0], collateralProof: col.inputProof,
      eLimitPrice: lim.handles[0], limitProof: lim.inputProof,
    };
  }

  async function submitOrder(
    sizeVal: bigint, collVal: bigint, limitVal: bigint, isLong: boolean
  ): Promise<bigint> {
    const inputs = await buildInputs(
      await dark.getAddress(), alice.address, sizeVal, collVal, limitVal
    );
    const tx = await dark.connect(alice).submitOrder(
      inputs, MARKET_ETH, isLong, aliceProof
    );
    const r = await tx.wait();
    const ev = r!.logs.find((l: any) => l.fragment?.name === "OrderSubmitted") as any;
    return ev.args.orderId;
  }

  async function fulfillBatch(requestId: bigint, handles: string[]): Promise<void> {
    // Spread into a plain mutable array — ethers returns frozen Result objects
    // from event args which cause "Cannot assign to read only property" in ethers internals.
    const mutableHandles: string[] = [...handles];
    const { abiEncodedClearValues, decryptionProof } = await hre.fhevm.publicDecrypt(mutableHandles);
    await (await dark._onBatchDecided(
      requestId, mutableHandles, abiEncodedClearValues, decryptionProof,
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

    await (await token.connect(alice).setOperator(await vault.getAddress(), 2n ** 48n - 1n)).wait();
    await (await vault.connect(alice).deposit(20_000n)).wait();
    await commitPrice(MARKET_ETH, 3_000n);
  });

  describe("single-order batch", () => {
    it("settles a single fillable long-buy at oracle price", async () => {
      const id = await submitOrder(5n, 1_000n, 3_100n, true); // limit 3100, oracle 3000 → fill (le)

      const tx = await dark.connect(keeper).requestBatchMatch([id]);
      const receipt = await tx.wait();
      const ev = receipt!.logs.find(
        (l: any) => l.fragment?.name === "BatchMatchRequested"
      ) as any;
      const reqId = ev.args.requestId;
      const handles = ev.args.handles;

      await fulfillBatch(reqId, handles);

      // Order inactive
      const order = await dark.getOrder(id);
      expect(order.active).to.equal(false);

      // Position 0 opened
      const pos = await vault.getPosition(0);
      expect(pos.owner).to.equal(alice.address);
      expect(pos.isLong).to.equal(true);
      expect(pos.active).to.equal(true);
    });

    it("settles a single non-fillable order with refund only", async () => {
      const id = await submitOrder(5n, 1_000n, 2_900n, true); // limit 2900, oracle 3000 → !le → no fill

      const tx = await dark.connect(keeper).requestBatchMatch([id]);
      const r = await tx.wait();
      const ev = r!.logs.find((l: any) => l.fragment?.name === "BatchMatchRequested") as any;
      await fulfillBatch(ev.args.requestId, ev.args.handles);

      // No position opened
      expect(await vault.nextPositionId()).to.equal(0n);

      // Order inactive
      const order = await dark.getOrder(id);
      expect(order.active).to.equal(false);

      // Alice's escrow refunded
      const bal = await decrypt(await vault.getBalance(alice.address), await vault.getAddress(), alice);
      expect(bal).to.equal(20_000n); // full deposit back
    });
  });

  describe("multi-order batch", () => {
    it("settles a mixed batch: some fill, some don't", async () => {
      // Order 0: long, limit 3100 → FILL
      const id0 = await submitOrder(5n, 1_000n, 3_100n, true);
      // Order 1: long, limit 2900 → NO FILL (oracle 3000 > 2900)
      const id1 = await submitOrder(5n, 1_000n, 2_900n, true);
      // Order 2: short, limit 2900 → FILL (oracle 3000 >= 2900)
      const id2 = await submitOrder(5n, 1_000n, 2_900n, false);

      const tx = await dark.connect(keeper).requestBatchMatch([id0, id1, id2]);
      const r = await tx.wait();
      const ev = r!.logs.find((l: any) => l.fragment?.name === "BatchMatchRequested") as any;
      await fulfillBatch(ev.args.requestId, ev.args.handles);

      // Two positions opened (id0 long + id2 short)
      expect(await vault.nextPositionId()).to.equal(2n);

      const p0 = await vault.getPosition(0);
      const p1 = await vault.getPosition(1);
      expect(p0.isLong).to.equal(true);
      expect(p1.isLong).to.equal(false);

      // All orders inactive
      const o0 = await dark.getOrder(id0);
      const o1 = await dark.getOrder(id1);
      const o2 = await dark.getOrder(id2);
      expect(o0.active).to.equal(false);
      expect(o1.active).to.equal(false);
      expect(o2.active).to.equal(false);
    });
  });

  describe("guards", () => {
    it("requestBatchMatch reverts on empty array", async () => {
      await expect(dark.connect(keeper).requestBatchMatch([]))
        .to.be.revertedWithCustomError(dark, "EmptyBatch");
    });

    it("requestBatchMatch reverts on inactive order in batch", async () => {
      const id = await submitOrder(5n, 1_000n, 3_100n, true);
      await (await dark.connect(alice).cancelOrder(id)).wait();
      await expect(dark.connect(keeper).requestBatchMatch([id]))
        .to.be.revertedWithCustomError(dark, "OrderNotActive");
    });

    it("requestBatchMatch reverts on stale oracle", async () => {
      const id = await submitOrder(5n, 1_000n, 3_100n, true);
      await hre.ethers.provider.send("evm_increaseTime", [STALENESS + 10]);
      await hre.ethers.provider.send("evm_mine", []);
      await expect(dark.connect(keeper).requestBatchMatch([id]))
        .to.be.revertedWithCustomError(dark, "OraclePriceStale");
    });

    it("requestBatchMatch reverts when oracle/perp not set", async () => {
      const F = await hre.ethers.getContractFactory("DarkpoolEngine");
      const fresh = (await F.deploy(await vault.getAddress(), admin.address)) as unknown as DarkpoolEngine;
      await fresh.waitForDeployment();
      await expect(fresh.connect(keeper).requestBatchMatch([0]))
        .to.be.revertedWithCustomError(fresh, "OracleNotSet");
    });
  });
});
