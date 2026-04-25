import { JsonRpcProvider, Wallet, Contract } from "ethers";
import pino from "pino";
import { loadConfig } from "./config.js";
import { submitTick } from "./relayer.js";

// Minimal ABI — only what we call
const ORACLE_ABI = [
  "function submitPrice(uint8 marketId, uint64 price, uint64 timestamp) external",
];

async function main() {
  const cfg = loadConfig();
  const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });
  const provider = new JsonRpcProvider(cfg.rpcUrl);
  const oracleAddr = cfg.deployment.contracts.Oracle;
  const walletA = new Wallet(cfg.relayerAKey, provider);
  const walletB = new Wallet(cfg.relayerBKey, provider);
  const oracleA = new Contract(oracleAddr, ORACLE_ABI, walletA);
  const oracleB = new Contract(oracleAddr, ORACLE_ABI, walletB);

  logger.info({ oracle: oracleAddr, A: walletA.address, B: walletB.address }, "oracle-relayer start");

  // First tick immediately
  await submitTick(oracleA, oracleB, logger);

  // Then on interval — use setInterval but guard re-entry with a busy flag
  // so a slow tick doesn't stack up if the interval fires again.
  let busy = false;
  setInterval(async () => {
    if (busy) {
      logger.info({}, "previous tick still running — skipping");
      return;
    }
    busy = true;
    try {
      await submitTick(oracleA, oracleB, logger);
    } finally {
      busy = false;
    }
  }, cfg.pollIntervalMs);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
