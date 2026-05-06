import * as hre from "hardhat";
import { readFileSync } from "node:fs";
import { WebSocketProvider, JsonRpcProvider, Contract } from "ethers";

/// Diagnose why bot's WS subscriptions aren't firing on publicnode.
/// Probes three independent layers in parallel for 90s and reports counts:
///   1. WS provider — does `on('block', ...)` fire? (eth_subscribe newHeads)
///   2. Contract event via WS — does `Oracle.on('PriceCommitted', ...)` fire?
///      Oracle commits ~6 prices/minute (BTC+ETH × 2 relayers + skip), so
///      we should see several events in 90s if WS subscriptions work.
///   3. HTTP polling baseline — every 10s, queryFilter the same Oracle
///      events; this is what the bot would use if we ripped out WS.
///
/// Run: npx hardhat run scripts/diagnose-ws.ts --network sepolia
///      (uses SEPOLIA_RPC_URL for HTTP and a hardcoded WS URL from bot/.env)

const PROBE_DURATION_MS = 90_000;
const HTTP_POLL_INTERVAL_MS = 10_000;
const WS_URL = process.env.WS_URL ?? "wss://ethereum-sepolia-rpc.publicnode.com";
const HTTP_URL = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";

const ORACLE_ABI = [
  "event PriceSubmitted(uint8 indexed marketId, address indexed relayer, uint64 price)",
  "event PriceCommitted(uint8 indexed marketId, uint64 price, uint64 timestamp)",
];

async function main() {
  const dep = JSON.parse(readFileSync("deployments/sepolia.json", "utf8"));
  const oracleAddr = dep.contracts.Oracle as string;

  console.log(`probing ws  : ${WS_URL}`);
  console.log(`probing http: ${HTTP_URL}`);
  console.log(`oracle      : ${oracleAddr}`);
  console.log(`duration    : ${PROBE_DURATION_MS / 1000}s\n`);

  let blocks = 0;
  let wsCommitted = 0;
  let wsSubmitted = 0;
  let httpCommitted = 0;
  const wsFirstBlockAt: number[] = [];
  const wsFirstEventAt: number[] = [];

  // ─── WS layer ────────────────────────────────────────────────
  const ws = new WebSocketProvider(WS_URL);
  ws.on("block", (n: number) => {
    blocks++;
    if (wsFirstBlockAt.length < 3) wsFirstBlockAt.push(n);
  });
  const oracleWS = new Contract(oracleAddr, ORACLE_ABI, ws);
  oracleWS.on("PriceCommitted", (marketId: bigint, price: bigint, ts: bigint) => {
    wsCommitted++;
    if (wsFirstEventAt.length < 3) wsFirstEventAt.push(Number(marketId));
  });
  oracleWS.on("PriceSubmitted", () => { wsSubmitted++; });

  // ─── HTTP polling baseline ───────────────────────────────────
  const http = new JsonRpcProvider(HTTP_URL);
  const oracleHTTP = new Contract(oracleAddr, ORACLE_ABI, http);
  const startBlock = await http.getBlockNumber();
  const seen = new Set<string>();
  const httpInterval = setInterval(async () => {
    try {
      const head = await http.getBlockNumber();
      const events = await oracleHTTP.queryFilter("PriceCommitted", startBlock, head);
      for (const e of events) {
        const k = `${e.transactionHash}-${e.index}`;
        if (!seen.has(k)) { seen.add(k); httpCommitted++; }
      }
    } catch (err) {
      console.error("http poll error:", (err as Error).message);
    }
  }, HTTP_POLL_INTERVAL_MS);

  // ─── progress ticker ─────────────────────────────────────────
  const tick = setInterval(() => {
    process.stdout.write(
      `   t=+${Math.round((Date.now() - t0) / 1000)}s  blocks=${blocks}  ws.PriceCommitted=${wsCommitted}  ws.PriceSubmitted=${wsSubmitted}  http.PriceCommitted=${httpCommitted}\r`,
    );
  }, 2000);

  const t0 = Date.now();
  await new Promise(r => setTimeout(r, PROBE_DURATION_MS));
  clearInterval(tick);
  clearInterval(httpInterval);
  process.stdout.write("\n\n");

  console.log(`────────────────────────────────────────────`);
  console.log(`Layer            | events seen in ${PROBE_DURATION_MS / 1000}s`);
  console.log(`────────────────────────────────────────────`);
  console.log(`WS  newHeads     | ${blocks} (expect ~7-8 for Sepolia 12s blocks)`);
  console.log(`WS  PriceCommitted | ${wsCommitted}`);
  console.log(`WS  PriceSubmitted | ${wsSubmitted}`);
  console.log(`HTTP PriceCommitted | ${httpCommitted} (ground truth)`);
  console.log();

  if (httpCommitted === 0) {
    console.log("⚠ HTTP saw no events either — relayer may be quiet right now. Inconclusive.");
  } else if (blocks > 0 && wsCommitted === 0) {
    console.log("⚠ WS reports blocks but ZERO contract events — `eth_subscribe(logs, ...)` is broken on this endpoint.");
    console.log("   This explains the bot bug exactly.");
  } else if (blocks === 0) {
    console.log("⚠ WS reports zero blocks — connection is dead at the protocol level.");
  } else if (wsCommitted < httpCommitted / 2) {
    console.log("⚠ WS sees blocks + some events but loses many — flaky log delivery.");
  } else {
    console.log("✓ WS is healthy. The bot bug is elsewhere (handler-side).");
  }

  await ws.destroy();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
