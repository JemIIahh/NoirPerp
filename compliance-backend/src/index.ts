import pino from "pino";
import pinoHttp from "pino-http";
import { loadConfig } from "./config.js";
import { buildApp } from "./server.js";

const cfg = loadConfig();
const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });
const app = buildApp({ allowlistPath: cfg.allowlistPath, adminApiKey: cfg.adminApiKey });
app.use(pinoHttp({ logger }));

app.listen(cfg.port, () => {
  logger.info({ port: cfg.port, allowlist: cfg.allowlistPath }, "compliance-backend up");
});
