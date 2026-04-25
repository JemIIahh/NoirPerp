import { expect } from "chai";
import * as hre from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import type { NoirVault, MockERC7984, Oracle, Compliance, DarkpoolEngine } from "../typechain-types";

const MARKET_ETH = 2;
const STALENESS = 90;
const DEVIATION_BPS = 50;

describe("DarkpoolEngine — submitOrder + cancelOrder", () => {
  let vault: NoirVault;
  let token: MockERC7984;
  let oracle: Oracle;
  let compliance: Compliance;
  let dark: DarkpoolEngine;
  let admin: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let relayerA: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let relayerB: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let relayerC: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let alice: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let nonKyc: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
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

  beforeEach(async () => {
    [admin, relayerA, relayerB, relayerC, alice, nonKyc, bob] = await hre.ethers.getSigners();

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

    const DarkFactory = await hre.ethers.getContractFactory("DarkpoolEngine");
    dark = (await DarkFactory.deploy(await vault.getAddress(), admin.address)) as unknown as DarkpoolEngine;
    await dark.waitForDeployment();
    await (await vault.registerEngine(await dark.getAddress())).wait();
    await (await dark.setOracle(await oracle.getAddress())).wait();
    await (await dark.setCompliance(await compliance.getAddress())).wait();

    await (await token.connect(alice).setOperator(await vault.getAddress(), 2n ** 48n - 1n)).wait();
    await (await vault.connect(alice).deposit(10_000n)).wait();
    await commitPrice(MARKET_ETH, 3_000n);
  });

  describe("submitOrder happy path", () => {
    it("submits a long-buy order and locks collateral", async () => {
      const inputs = await buildInputs(
        await dark.getAddress(), alice.address, 5n, 1_000n, 2_900n
      );
      await (await dark.connect(alice).submitOrder(
        inputs, MARKET_ETH, true, aliceProof,
      )).wait();

      const order = await dark.getOrder(0);
      expect(order.owner).to.equal(alice.address);
      expect(order.marketId).to.equal(MARKET_ETH);
      expect(order.isLong).to.equal(true);
      expect(order.active).to.equal(true);

      const aliceBal = await decrypt(
        await vault.getBalance(alice.address),
        await vault.getAddress(),
        alice,
      );
      expect(aliceBal).to.equal(9_000n);
    });

    it("submits a short-sell order", async () => {
      const inputs = await buildInputs(
        await dark.getAddress(), alice.address, 5n, 1_000n, 3_100n
      );
      await (await dark.connect(alice).submitOrder(
        inputs, MARKET_ETH, false, aliceProof,
      )).wait();
      const order = await dark.getOrder(0);
      expect(order.isLong).to.equal(false);
    });

    it("nextOrderId increments across submissions", async () => {
      const i1 = await buildInputs(await dark.getAddress(), alice.address, 5n, 500n, 2_900n);
      await (await dark.connect(alice).submitOrder(i1, MARKET_ETH, true, aliceProof)).wait();
      const i2 = await buildInputs(await dark.getAddress(), alice.address, 5n, 500n, 3_100n);
      await (await dark.connect(alice).submitOrder(i2, MARKET_ETH, false, aliceProof)).wait();
      expect(await dark.nextOrderId()).to.equal(2n);
    });
  });

  describe("submitOrder guards", () => {
    it("reverts on non-KYC user", async () => {
      const inputs = await buildInputs(
        await dark.getAddress(), nonKyc.address, 5n, 1_000n, 2_900n
      );
      await expect(dark.connect(nonKyc).submitOrder(
        inputs, MARKET_ETH, true, aliceProof,
      )).to.be.revertedWithCustomError(dark, "NotCompliant");
    });

    it("reverts on invalid marketId", async () => {
      const inputs = await buildInputs(
        await dark.getAddress(), alice.address, 5n, 1_000n, 2_900n
      );
      await expect(dark.connect(alice).submitOrder(
        inputs, 99, true, aliceProof,
      )).to.be.revertedWithCustomError(dark, "InvalidMarket");
    });

    it("reverts when compliance not set", async () => {
      const F = await hre.ethers.getContractFactory("DarkpoolEngine");
      const fresh = (await F.deploy(await vault.getAddress(), admin.address)) as unknown as DarkpoolEngine;
      await fresh.waitForDeployment();
      const inputs = await buildInputs(
        await fresh.getAddress(), alice.address, 5n, 1_000n, 2_900n
      );
      await expect(fresh.connect(alice).submitOrder(
        inputs, MARKET_ETH, true, aliceProof,
      )).to.be.revertedWithCustomError(fresh, "ComplianceNotSet");
    });
  });

  describe("cancelOrder", () => {
    let orderId: bigint;

    beforeEach(async () => {
      const inputs = await buildInputs(
        await dark.getAddress(), alice.address, 5n, 1_000n, 2_900n
      );
      const tx = await dark.connect(alice).submitOrder(
        inputs, MARKET_ETH, true, aliceProof,
      );
      const r = await tx.wait();
      const ev = r!.logs.find((l: any) => l.fragment?.name === "OrderSubmitted") as any;
      orderId = ev.args.orderId;
    });

    it("owner can cancel and gets escrow refund", async () => {
      let bal = await decrypt(await vault.getBalance(alice.address), await vault.getAddress(), alice);
      expect(bal).to.equal(9_000n);

      await (await dark.connect(alice).cancelOrder(orderId)).wait();

      const order = await dark.getOrder(orderId);
      expect(order.active).to.equal(false);

      bal = await decrypt(await vault.getBalance(alice.address), await vault.getAddress(), alice);
      expect(bal).to.equal(10_000n);
    });

    it("non-owner cannot cancel", async () => {
      await expect(dark.connect(bob).cancelOrder(orderId))
        .to.be.revertedWithCustomError(dark, "NotOrderOwner");
    });

    it("cannot cancel an already-cancelled order", async () => {
      await (await dark.connect(alice).cancelOrder(orderId)).wait();
      await expect(dark.connect(alice).cancelOrder(orderId))
        .to.be.revertedWithCustomError(dark, "OrderNotActive");
    });
  });
});
