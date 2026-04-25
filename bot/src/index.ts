import pino from "pino";
import type { Logger } from "pino";
import { loadConfig } from "./config.js";
import { makeClients } from "./clients.js";
import { TrackedSet } from "./state.js";
import { subscribeLiquidation, runLiquidationTick } from "./watchers/liquidation.js";
import { subscribeTrigger, runTriggerTick } from "./watchers/trigger.js";
import { subscribeBatch, runBatchTick, type DarkOrderRef } from "./watchers/batch.js";
import { subscribeDecryptRelay, type PublicDecryptFn } from "./watchers/decrypt-relay.js";

async function makePublicDecrypt(network: string): Promise<PublicDecryptFn> {
  if (network === "local") {
    // Stub for local: bot can't import hardhat plugin from a stand-alone process.
    // The integration smoke test (Task 13) lives inside the hardhat runtime
    // where hre.fhevm.publicDecrypt is the real path. This stub returns
    // empty bytes — calling it from the live local bot would no-op the callback.
    return async () => ({ abiEncodedClearValues: "0x", decryptionProof: "0x" });
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const { createInstance } = await (Function('return import("@zama-fhe/relayer-sdk")')() as Promise<any>);
  const instance = await createInstance({
    chainId: 11155111,
    networkUrl: process.env.RPC_URL!,
  });
  return async (handles) => {
    const result = await (instance as any).publicDecrypt(handles);
    return {
      abiEncodedClearValues: result.abiEncodedClearValues ?? result.cleartexts,
      decryptionProof: result.decryptionProof ?? result.proof,
    };
  };
}

async function replayEvents(
  clients: ReturnType<typeof makeClients>,
  fromBlock: number,
  liquidations: TrackedSet<bigint>,
  triggers: TrackedSet<bigint>,
  batches: TrackedSet<DarkOrderRef>,
  logger: Logger,
): Promise<void> {
  // Position lifecycle: subscribe via VAULT (corrected from plan — PositionOpened is on NoirVault)
  const opened = await clients.vaultRO.queryFilter("PositionOpened", fromBlock);
  const liquidated = await clients.perpRO.queryFilter("Liquidated", fromBlock);
  const closed = await clients.vaultRO.queryFilter("PositionClosed", fromBlock);
  const liqIds = new Set([
    ...liquidated.map((e: any) => e.args.positionId.toString()),
    ...closed.map((e: any) => e.args.positionId.toString()),
  ]);
  for (const ev of opened) {
    const id: bigint = (ev as any).args.positionId;
    if (!liqIds.has(id.toString())) liquidations.add(id);
  }

  // Limit lifecycle: events are Triggered / TriggerNotMet / OrderCancelled (corrected — NOT OrderTriggered/OrderMissed)
  // TriggerNotMet does NOT remove — order stays tracked, bot keeps probing
  const placed = await clients.limitRO.queryFilter("OrderPlaced", fromBlock);
  const triggered = await clients.limitRO.queryFilter("Triggered", fromBlock);
  const cancelled = await clients.limitRO.queryFilter("OrderCancelled", fromBlock);
  const dropIds = new Set(
    [...triggered, ...cancelled].map((e: any) => e.args.orderId.toString()),
  );
  for (const ev of placed) {
    const id: bigint = (ev as any).args.orderId;
    if (!dropIds.has(id.toString())) triggers.add(id);
  }

  // Dark lifecycle
  const submitted = await clients.darkRO.queryFilter("OrderSubmitted", fromBlock);
  const settled = await clients.darkRO.queryFilter("BatchSettled", fromBlock);
  const darkCancelled = await clients.darkRO.queryFilter("OrderCancelled", fromBlock);
  const dropDarkIds = new Set<string>();
  for (const ev of settled) {
    for (const oid of (ev as any).args.orderIds as bigint[]) {
      dropDarkIds.add(oid.toString());
    }
  }
  for (const ev of darkCancelled) {
    dropDarkIds.add((ev as any).args.orderId.toString());
  }
  for (const ev of submitted) {
    const id: bigint = (ev as any).args.orderId;
    if (!dropDarkIds.has(id.toString())) {
      batches.add({ orderId: id, marketId: Number((ev as any).args.marketId) });
    }
  }

  logger.info(
    { liquidations: liquidations.size, triggers: triggers.size, batches: batches.size },
    "replay complete",
  );
}

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

async function main(): Promise<void> {
  const cfg = loadConfig();
  const clients = makeClients(cfg.rpcUrl, cfg.wsUrl, cfg.botKey, cfg.deployment);

  const liquidations = new TrackedSet<bigint>();
  const triggers = new TrackedSet<bigint>();
  const batches = new TrackedSet<DarkOrderRef>();

  const fromBlock = Number(process.env.START_BLOCK ?? 0);
  await replayEvents(clients, fromBlock, liquidations, triggers, batches, logger);
  // MVP: events emitted in the brief window between replay tip and live
  // WS subscription start are silently lost. Acceptable here because
  // replay is fast (~1 block typically), and the bot's tick loop will
  // catch any missed orders on the next tick (requestLiquidation /
  // requestTrigger / requestBatchMatch are idempotent — engine reverts
  // on inactive positions/orders without state change). Real-time
  // guarantees deferred to Phase 9 (WS-then-replay-from-WS-block pattern).

  // CORRECTED: subscribeLiquidation takes (vaultRO, perpRO, tracked, logger) — 4 args per Task 8
  const unsubLiq = subscribeLiquidation(clients.vaultRO, clients.perpRO, liquidations, logger);
  const unsubTrig = subscribeTrigger(clients.limitRO, triggers, logger);
  const unsubBatch = subscribeBatch(clients.darkRO, batches, logger);

  const publicDecrypt = await makePublicDecrypt(cfg.deployment.network);
  const unsubRelay = subscribeDecryptRelay(
    clients.perpRO, clients.perpRW,
    clients.limitRO, clients.limitRW,
    clients.ammRO, clients.ammRW,
    clients.darkRO, clients.darkRW,
    publicDecrypt, logger,
  );

  process.on("SIGTERM", () => {
    unsubLiq();
    unsubTrig();
    unsubBatch();
    unsubRelay();
    process.exit(0);
  });

  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await Promise.all([
        runLiquidationTick(clients.perpRW, liquidations, logger),
        runTriggerTick(clients.limitRW, triggers, logger),
        runBatchTick(clients.darkRW, batches, logger),
      ]);
    } finally {
      busy = false;
    }
  }, cfg.tickIntervalMs);

  logger.info({ tick: cfg.tickIntervalMs }, "bot up");
}

main().catch((err) => {
  logger.fatal({ err: err?.message }, "fatal");
  process.exit(1);
});
