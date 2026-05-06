import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config as dotenvConfig } from "dotenv";

dotenvConfig();

export type Deployment = {
  network: string;
  chainId: number;
  contracts: Record<string, string>;
  relayers: string[];
  admin: string;
};

export type Config = {
  rpcUrl: string;
  wsUrl: string; // unused since 2026-05-05 (HTTP polling); kept for back-compat
  deployment: Deployment;
  botKey: string;
  tickIntervalMs: number;
};

export function loadConfig(): Config {
  const need = (k: string): string => {
    const v = process.env[k];
    if (!v) throw new Error(`missing env ${k}`);
    return v;
  };
  const deploymentPath = resolve(process.cwd(), need("DEPLOYMENT_PATH"));
  return {
    rpcUrl: need("RPC_URL"),
    wsUrl: process.env.WS_URL ?? "",
    deployment: JSON.parse(readFileSync(deploymentPath, "utf8")),
    botKey: need("BOT_PRIVKEY"),
    tickIntervalMs: Number(process.env.TICK_INTERVAL_MS ?? 15000),
  };
}
