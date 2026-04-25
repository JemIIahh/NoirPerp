/**
 * Task 13 — Phase 7: Bot integration smoke test in hardhat runtime.
 *
 * Proves that the bot's `runLiquidationTick` helper (Task 8) drives a full
 * liquidation flow end-to-end against the real PerpEngine via the FHEVM
 * hardhat mock.
 *
 * Architecture note:
 *   - contracts/ is CJS (`"module": "commonjs"`)
 *   - bot/ is ESM (`"type": "module"`)
 *   - Dynamic `await import(...)` is used to load the ESM bot helpers from this
 *     CJS test file. The bot must be pre-built (`bot/dist/` must exist).
 */

import { expect } from "chai";
import * as hre from "hardhat";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import type { NoirVault, MockERC7984, Oracle, Compliance, PerpEngine } from "../typechain-types";
import * as path from "path";

const MARKET_ETH = 2;
const STALENESS = 90;
const DEVIATION_BPS = 50;

// Resolved absolute paths for the bot dist modules (avoids relative-path
// ambiguity — dynamic import paths are relative to the CWD in Node.js, not
// the test file's location when using ts-node/hardhat).
const BOT_DIST = path.resolve(__dirname, "../../bot/dist");

describe("Bot Integration — runLiquidationTick drives end-to-end liquidation", () => {
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

  // Dynamically imported bot helpers (ESM modules loaded at runtime)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let runLiquidationTick: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let TrackedSet: any;

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

  // Load ESM bot modules once before all tests in this suite.
  before(async () => {
    // Dynamic import of ESM modules from the pre-built bot dist.
    // Using absolute paths via `path.resolve` ensures Node.js can locate
    // them regardless of CWD at test invocation time.
    //
    // TypeScript (CJS tsconfig) will not accept `import()` returning ESM
    // module namespace types for external paths. We work around this by
    // asserting the result as `Record<string, unknown>` before plucking exports.
    const liquidationMod = await import(
      /* webpackIgnore: true */ `${BOT_DIST}/watchers/liquidation.js`
    ) as Record<string, unknown>;
    runLiquidationTick = liquidationMod["runLiquidationTick"];

    const stateMod = await import(
      /* webpackIgnore: true */ `${BOT_DIST}/state.js`
    ) as Record<string, unknown>;
    TrackedSet = stateMod["TrackedSet"];
  });

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
      admin.address,
      [relayerA.address, relayerB.address, relayerC.address],
      STALENESS,
      DEVIATION_BPS,
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
      pool.address,
      admin.address,
    )) as unknown as PerpEngine;
    await engine.waitForDeployment();

    await (await vault.registerEngine(await engine.getAddress())).wait();

    await (await token.connect(alice).setOperator(await vault.getAddress(), 2n ** 48n - 1n)).wait();
    await (await vault.connect(alice).deposit(10_000n)).wait();

    // Entry price 3000
    await commitPrice(MARKET_ETH, 3000n);

    // Alice opens 10-ETH long with 1000 collateral.
    // Notional = 30_000. Maintenance margin = 500bps = 5%.
    // Loss threshold: loss / collateral >= 5%
    // loss = size * delta = 10 * delta
    // liq when: 10 * delta / 1000 >= 0.05  => delta >= 5
    // Price drop to 2990 → delta = 10 → loss = 100 → 100/1000 = 10% >= 5% → liquidates.
    const engineAddr = await engine.getAddress();
    const sizeEnc = await encrypt(engineAddr, alice.address, 10n);
    const collEnc = await encrypt(engineAddr, alice.address, 1000n);
    await (await engine.connect(alice).openPosition(
      sizeEnc.handles[0], sizeEnc.inputProof,
      collEnc.handles[0], collEnc.inputProof,
      true, MARKET_ETH, aliceProof,
    )).wait();
    // Position 0 is open. Vault balance = 10_000 - 1000 = 9_000.
  });

  it("runLiquidationTick triggers requestLiquidation and the position is liquidated after decryption callback", async () => {
    // Crash price to 2990 (delta = 10, loss = 100, 100/1000 = 10% >= 5% maintenance)
    await commitPrice(MARKET_ETH, 2990n);

    // Build a tracked set with position 0 in it (mimics what subscribeLiquidation would populate)
    const tracked = new TrackedSet();
    tracked.add(0n);

    // Silent logger — swallows all output so tests are quiet
    const silentLogger = { info: () => {}, error: () => {} };

    // --- THE BOT TICK ---
    // runLiquidationTick will call engine.requestLiquidation(0n).
    // It uses `keeper` implicitly via perpRW signer, but here we pass the engine
    // as `perpRW` connected to the keeper account so the keeper is the msg.sender.
    const engineAsKeeper = engine.connect(keeper) as unknown as PerpEngine;
    await runLiquidationTick(engineAsKeeper, tracked, silentLogger);

    // Verify the LiquidationRequested event was emitted by querying the contract.
    // We need the requestId and underwaterHandle to complete the callback.
    const engineIface = engine.interface;
    const engineAddr = await engine.getAddress();

    // Query all LiquidationRequested events from block 0 to latest
    const filter = engine.filters.LiquidationRequested();
    const events = await engine.queryFilter(filter);
    expect(events.length).to.be.greaterThan(0, "expected at least one LiquidationRequested event");

    const latestEvent = events[events.length - 1];
    const parsed = engineIface.parseLog({
      topics: [...latestEvent.topics],
      data: latestEvent.data,
    });
    expect(parsed).to.not.be.null;
    expect(parsed!.name).to.equal("LiquidationRequested");

    const requestId = parsed!.args.requestId as bigint;
    const underwaterHandle = parsed!.args.underwaterHandle as string;

    // Simulate Gateway: publicDecrypt reveals the cleartext of the underwater flag,
    // then _onLiquidationDecided callback finalises the liquidation on-chain.
    const result = await hre.fhevm.publicDecrypt([underwaterHandle]);
    const { abiEncodedClearValues, decryptionProof } = result as {
      abiEncodedClearValues: string;
      decryptionProof: string;
    };

    await (
      await engine.connect(keeper)._onLiquidationDecided(
        requestId,
        [underwaterHandle],
        abiEncodedClearValues,
        decryptionProof,
      )
    ).wait();

    // Position 0 must be closed (liquidated)
    const pos = await vault.getPosition(0);
    expect(pos.active).to.equal(false, "position should be inactive after liquidation");

    // Verify Liquidated event was emitted
    const liquidatedFilter = engine.filters.Liquidated();
    const liquidatedEvents = await engine.queryFilter(liquidatedFilter);
    expect(liquidatedEvents.length).to.be.greaterThan(0, "expected Liquidated event");
  });
});
