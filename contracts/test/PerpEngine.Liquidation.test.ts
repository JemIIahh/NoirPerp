import { expect } from "chai";
import * as hre from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import type { NoirVault, MockERC7984, Oracle, Compliance, PerpEngine } from "../typechain-types";

const MARKET_ETH = 2;
const STALENESS = 90;
const DEVIATION_BPS = 50;

describe("PerpEngine — liquidation (async)", () => {
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
  let keeper: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let pool: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
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

  /**
   * Simulates the Gateway callback for an async liquidation request.
   * In production the Gateway relayer calls this. In tests we do it manually.
   *
   * Uses hre.fhevm.publicDecrypt([handle]) which returns:
   *   { abiEncodedClearValues, decryptionProof }
   * Both are then passed directly to _onLiquidationDecided.
   *
   * NOTE: publicDecrypt requires the handle to be marked publicly decryptable
   * (via FHE.makePubliclyDecryptable) — which requestLiquidation does.
   */
  async function fulfillDecryption(
    requestId: bigint,
    handle: string,
    caller: typeof admin,
  ): Promise<void> {
    // publicDecrypt returns abiEncodedClearValues + decryptionProof signed by mock KMS
    const result = await hre.fhevm.publicDecrypt([handle]);
    const { abiEncodedClearValues, decryptionProof } = result as {
      abiEncodedClearValues: string;
      decryptionProof: string;
    };

    // Call the callback with the proof
    await (
      await engine
        .connect(caller)
        ._onLiquidationDecided(requestId, [handle], abiEncodedClearValues, decryptionProof)
    ).wait();
  }

  beforeEach(async () => {
    [admin, relayerA, relayerB, relayerC, alice, keeper, pool] = await hre.ethers.getSigners();

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
      pool.address,   // liquidationPool = separate account
      admin.address,
    )) as unknown as PerpEngine;
    await engine.waitForDeployment();

    await (await vault.registerEngine(await engine.getAddress())).wait();

    await (await token.connect(alice).setOperator(await vault.getAddress(), 2n ** 48n - 1n)).wait();
    await (await vault.connect(alice).deposit(10_000n)).wait();

    // Entry price 3000
    await commitPrice(MARKET_ETH, 3000n);

    // Alice opens 10-ETH long with 1500 collateral. Entry notional = 30_000.
    // Maintenance margin = 500bps = 5%. Loss threshold: loss/collateral >= 5%
    // loss = size * delta. liq when: 10 * delta / 1500 >= 0.05 => delta >= 7.5
    // So price drop of 8+ triggers liquidation.
    const engineAddr = await engine.getAddress();
    const sizeEnc = await encrypt(engineAddr, alice.address, 10n);
    const collEnc = await encrypt(engineAddr, alice.address, 1500n);
    await (await engine.connect(alice).openPosition(
      sizeEnc.handles[0], sizeEnc.inputProof,
      collEnc.handles[0], collEnc.inputProof,
      true, MARKET_ETH, aliceProof,
    )).wait();
    // Position 0 is open. Vault balance = 10_000 - 1500 = 8_500.
  });

  describe("underwater position", () => {
    it("liquidates when price drops sufficiently", async () => {
      // Drop price to 2990 → loss = 10 * 10 = 100. Loss/collateral = 100/1500 = 6.67%
      // Maintenance = 5%. 6.67% >= 5% → should liquidate.
      await commitPrice(MARKET_ETH, 2990n);

      // Bot requests liquidation
      const reqTx = await engine.connect(keeper).requestLiquidation(0);
      const reqReceipt = await reqTx.wait();
      expect(reqReceipt!.status).to.equal(1);

      // Read the emitted LiquidationRequested event to get requestId + handle
      const engineIface = engine.interface;
      let requestId: bigint | undefined;
      let underwaterHandle: string | undefined;
      for (const log of reqReceipt!.logs) {
        try {
          const parsed = engineIface.parseLog({ topics: [...log.topics], data: log.data });
          if (parsed && parsed.name === "LiquidationRequested") {
            requestId = parsed.args.requestId as bigint;
            underwaterHandle = parsed.args.underwaterHandle as string;
          }
        } catch { /* skip logs that don't parse */ }
      }
      expect(requestId).to.not.be.undefined;
      expect(underwaterHandle).to.not.be.undefined;

      // Fulfill the decryption (simulate Gateway callback)
      await fulfillDecryption(requestId!, underwaterHandle!, keeper);

      // Position should now be closed
      const pos = await vault.getPosition(0);
      expect(pos.active).to.equal(false);

      // Pool balance = collateral - keeperFee = 1500 - (1500 * 50 / 10000) = 1500 - 7 = 1493
      // (FHE.div rounds down: 75000 / 10000 = 7.5 → 7)
      const poolBalHandle = await vault.getBalance(pool.address);
      const poolBal = await decrypt(poolBalHandle, await vault.getAddress(), pool);
      expect(poolBal).to.equal(1493n);

      // Keeper balance = 7
      const keeperBalHandle = await vault.getBalance(keeper.address);
      const keeperBal = await decrypt(keeperBalHandle, await vault.getAddress(), keeper);
      expect(keeperBal).to.equal(7n);
    });
  });

  describe("healthy position", () => {
    it("does not liquidate when price is only slightly adverse", async () => {
      // Drop price to 2999 → loss = 10 * 1 = 10. Loss/collateral = 10/1500 = 0.67% < 5%
      await commitPrice(MARKET_ETH, 2999n);

      const reqTx = await engine.connect(keeper).requestLiquidation(0);
      const reqReceipt = await reqTx.wait();

      const engineIface = engine.interface;
      let requestId: bigint | undefined;
      let underwaterHandle: string | undefined;
      for (const log of reqReceipt!.logs) {
        try {
          const parsed = engineIface.parseLog({ topics: [...log.topics], data: log.data });
          if (parsed && parsed.name === "LiquidationRequested") {
            requestId = parsed.args.requestId as bigint;
            underwaterHandle = parsed.args.underwaterHandle as string;
          }
        } catch { /* skip */ }
      }
      expect(requestId).to.not.be.undefined;

      await fulfillDecryption(requestId!, underwaterHandle!, keeper);

      // Position should still be active (no-op)
      const pos = await vault.getPosition(0);
      expect(pos.active).to.equal(true);
    });
  });

  describe("guards", () => {
    it("reverts requestLiquidation on non-active position", async () => {
      // Close the position first
      await (await engine.connect(alice).closePosition(0)).wait();

      await expect(
        engine.connect(keeper).requestLiquidation(0)
      ).to.be.revertedWithCustomError(engine, "PositionNotActive");
    });

    it("reverts requestLiquidation on stale oracle", async () => {
      await hre.ethers.provider.send("evm_increaseTime", [STALENESS + 10]);
      await hre.ethers.provider.send("evm_mine", []);

      await expect(
        engine.connect(keeper).requestLiquidation(0)
      ).to.be.revertedWithCustomError(engine, "OraclePriceStale");
    });
  });
});
