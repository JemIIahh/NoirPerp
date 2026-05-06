import pino from "pino";
import type { Logger } from "pino";
import { loadConfig } from "./config.js";
import { makeClients } from "./clients.js";
import { TrackedSet } from "./state.js";
import { pollLiquidationEvents, runLiquidationTick } from "./watchers/liquidation.js";
import { pollTriggerEvents, runTriggerTick } from "./watchers/trigger.js";
import { pollBatchEvents, runBatchTick, type DarkOrderRef } from "./watchers/batch.js";
import { pollMatchEvents, runMatchTick, type PairOrderRef, type RecentlyFailed } from "./watchers/match.js";
import { pollDecryptRequests, type PublicDecryptFn } from "./watchers/decrypt-relay.js";

async function makePublicDecrypt(network: string): Promise<PublicDecryptFn> {
  if (network === "local") {
    // Stub for local: bot can't import hardhat plugin from a stand-alone process.
    // The integration smoke test (Task 13) lives inside the hardhat runtime
    // where hre.fhevm.publicDecrypt is the real path. This stub returns
    // empty bytes — calling it from the live local bot would no-op the callback.
    return async () => ({ abiEncodedClearValues: "0x", decryptionProof: "0x" });
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const sdk = await (Function('return import("@zama-fhe/relayer-sdk/node")')() as Promise<any>);
  // SepoliaConfig provides the preset KMS / coprocessor / relayer URLs.
  // We override `network` to point at our chosen RPC.
  const instance = await sdk.createInstance({
    ...sdk.SepoliaConfig,
    network: process.env.RPC_URL!,
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
  pairs: TrackedSet<PairOrderRef>,
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

  // Pair-eligible dark lifecycle (Phase 11). Same drop-set logic — but
  // additionally treat OrderClosed as a removal trigger (the contract emits
  // it when an order is fully consumed by a pair match) and MatchAborted
  // does NOT remove (the cancelled side is already in OrderCancelled; the
  // surviving side stays tracked).
  const submittedPair = await clients.darkRO.queryFilter("OrderSubmittedForPair", fromBlock);
  const pairClosed = await clients.darkRO.queryFilter("OrderClosed", fromBlock);
  const dropPairIds = new Set<string>();
  for (const ev of darkCancelled) dropPairIds.add((ev as any).args.orderId.toString());
  for (const ev of pairClosed) dropPairIds.add((ev as any).args.orderId.toString());
  for (const ev of submittedPair) {
    const id: bigint = (ev as any).args.orderId;
    if (dropPairIds.has(id.toString())) continue;
    pairs.add({
      orderId: id,
      owner: (ev as any).args.owner,
      marketId: Number((ev as any).args.marketId),
      isLong: Boolean((ev as any).args.isLong),
    });
  }

  logger.info(
    { liquidations: liquidations.size, triggers: triggers.size, batches: batches.size, pairs: pairs.size },
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
  const pairs = new TrackedSet<PairOrderRef>();
  const recentlyFailedMatches: RecentlyFailed = new Map();

  const fromBlock = Number(process.env.START_BLOCK ?? 0);
  await replayEvents(clients, fromBlock, liquidations, triggers, batches, pairs, logger);

  const publicDecrypt = await makePublicDecrypt(cfg.deployment.network);

  // Replaces WS subscriptions (removed 2026-05-05 — publicnode WSS dropped
  // connections silently with no auto-reconnect, see CHANGELOG). Each tick
  // polls (lastSeenBlock, head] via HTTP queryFilter, then runs the
  // submission tick functions.
  let lastSeenBlock = await clients.rpc.getBlockNumber();
  logger.info({ lastSeenBlock }, "polling baseline established");

  process.on("SIGTERM", () => {
    logger.info({}, "shutting down");
    process.exit(0);
  });

  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const head = await clients.rpc.getBlockNumber();
      if (head > lastSeenBlock) {
        try {
          await Promise.all([
            pollLiquidationEvents(clients.vaultRO, clients.perpRO, lastSeenBlock + 1, head, liquidations, logger),
            pollTriggerEvents(clients.limitRO, lastSeenBlock + 1, head, triggers, logger),
            pollBatchEvents(clients.darkRO, lastSeenBlock + 1, head, batches, logger),
            pollMatchEvents(clients.darkRO, lastSeenBlock + 1, head, pairs, recentlyFailedMatches, logger),
            pollDecryptRequests(
              clients.perpRO, clients.perpRW,
              clients.limitRO, clients.limitRW,
              clients.ammRO, clients.ammRW,
              clients.darkRO, clients.darkRW,
              publicDecrypt, lastSeenBlock + 1, head, logger,
            ),
          ]);
          lastSeenBlock = head;
        } catch (err) {
          // Any queryFilter failure: don't advance lastSeenBlock, retry next tick.
          // TrackedSet.add is idempotent for primitive ids; object-typed sets
          // are de-duped by orderId in the watchers themselves.
          logger.error({ err: (err as Error).message, fromBlock: lastSeenBlock + 1, toBlock: head }, "event poll failed — will retry");
        }
      }
      // Serialized — all four ticks share the bot's single signer, so
      // running them concurrently on Sepolia produces REPLACEMENT_UNDERPRICED
      // nonce races (observed 2026-05-05). At 15s tick + ~14s/tx, four
      // serial ticks fit comfortably in the budget for typical loads.
      await runLiquidationTick(clients.perpRW, liquidations, logger);
      await runTriggerTick(clients.limitRW, triggers, logger);
      await runBatchTick(clients.darkRW, batches, logger);
      await runMatchTick(clients.darkRW, pairs, recentlyFailedMatches, logger);
    } finally {
      busy = false;
    }
  }, cfg.tickIntervalMs);

  logger.info({ tick: cfg.tickIntervalMs }, "bot up");
}

// Resilience to transient Sepolia RPC failures (DNS lookup hiccups,
// HTTPS timeouts, WS reconnect glitches). Without these guards a single
// failed RPC call inside any subscribed event handler bubbles up as an
// unhandled rejection and kills the whole bot. Watchers themselves
// already wrap their per-event handlers in `.catch(() => {})`, but
// rejections from within `subscribeMatch` / provider polling / ws
// reconnect happen outside that boundary. Log and keep running — bot
// recovers automatically on the next tick (15s).
process.on("unhandledRejection", (reason: unknown) => {
  logger.error({ reason: (reason as Error)?.message ?? String(reason) }, "unhandled rejection — continuing");
});
process.on("uncaughtException", (err: Error) => {
  logger.error({ err: err?.message }, "uncaught exception — continuing");
});

main().catch((err) => {
  logger.fatal({ err: err?.message }, "fatal");
  process.exit(1);
});
