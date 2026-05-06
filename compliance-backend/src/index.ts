import pino from "pino";
import { loadConfig } from "./config.js";
import { buildApp } from "./server.js";

const cfg = loadConfig();
const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });
const app = buildApp({
  allowlistPath: cfg.allowlistPath,
  adminApiKey: cfg.adminApiKey,
  selfServe: cfg.selfServe,
  logger,
});

app.listen(cfg.port, () => {
  logger.info({ port: cfg.port, allowlist: cfg.allowlistPath }, "compliance-backend up");
});
