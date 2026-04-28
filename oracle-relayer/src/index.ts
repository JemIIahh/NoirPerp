import { JsonRpcProvider, Wallet, Contract } from "ethers";
import pino from "pino";
import { loadConfig } from "./config.js";
import { submitTick, type PriceFn } from "./relayer.js";
import { mockPrice, realPriceFactory } from "./chainlink.js";

// Minimal ABI — only what we call
const ORACLE_ABI = [
  "function submitPrice(uint8 marketId, uint64 price, uint64 timestamp) external",
];

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

async function main() {
  const cfg = loadConfig();
  const provider = new JsonRpcProvider(cfg.rpcUrl);
  const oracleAddr = cfg.deployment.contracts.Oracle;
  const walletA = new Wallet(cfg.relayerAKey, provider);
  const walletB = new Wallet(cfg.relayerBKey, provider);
  const oracleA = new Contract(oracleAddr, ORACLE_ABI, walletA);
  const oracleB = new Contract(oracleAddr, ORACLE_ABI, walletB);

  // Pick the price source based on USE_MOCK_PRICES. Real Chainlink reads
  // are slower (one RPC roundtrip per market) but reflect actual market
  // conditions; mock prices drift around hardcoded baselines.
  let priceFn: PriceFn = mockPrice;
  if (!cfg.useMockPrices) {
    const net = await provider.getNetwork();
    priceFn = realPriceFactory(provider, Number(net.chainId));
    logger.info({ chainId: Number(net.chainId), source: "chainlink" }, "price source: real Chainlink AggregatorV3");
  } else {
    logger.info({ source: "mock" }, "price source: synthetic mock (USE_MOCK_PRICES=true)");
  }

  logger.info({ oracle: oracleAddr, A: walletA.address, B: walletB.address }, "oracle-relayer start");

  // First tick immediately
  await submitTick(oracleA, oracleB, logger, priceFn);

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
      await submitTick(oracleA, oracleB, logger, priceFn);
    } finally {
      busy = false;
    }
  }, cfg.pollIntervalMs);

  process.on("SIGTERM", () => {
    logger.info({}, "shutting down");
    process.exit(0);
  });
}

main().catch((err) => {
  logger.fatal({ err: err?.message }, "fatal");
  process.exit(1);
});
