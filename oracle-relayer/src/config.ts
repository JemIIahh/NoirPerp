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
  deployment: Deployment;
  relayerAKey: string;
  relayerBKey: string;
  pollIntervalMs: number;
  useMockPrices: boolean;
};

export function loadConfig(): Config {
  const need = (k: string): string => {
    const v = process.env[k];
    if (!v) throw new Error(`missing env ${k}`);
    return v;
  };
  const deploymentPath = resolve(process.cwd(), need("DEPLOYMENT_PATH"));
  const deployment = JSON.parse(readFileSync(deploymentPath, "utf8")) as Deployment;
  return {
    rpcUrl: need("RPC_URL"),
    deployment,
    relayerAKey: need("RELAYER_A_PRIVKEY"),
    relayerBKey: need("RELAYER_B_PRIVKEY"),
    pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 30000),
    useMockPrices: process.env.USE_MOCK_PRICES === "true",
  };
}
