import { config as dotenvConfig } from "dotenv";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

dotenvConfig();

export type SelfServeConfig = {
  enabled: boolean;
  rpcUrl: string;
  adminPrivateKey: string;
  complianceAddress: string;
};

export type Config = {
  port: number;
  allowlistPath: string;
  adminApiKey: string;
  selfServe: SelfServeConfig;
};

export function loadConfig(): Config {
  const need = (k: string): string => {
    const v = process.env[k];
    if (!v) throw new Error(`missing env ${k}`);
    return v;
  };

  // Self-serve enrollment is opt-in via env. When enabled, the backend
  // can autonomously call Compliance.updateRoot after adding an address
  // — used on testnet only to remove the admin-curl friction. Production
  // (mainnet) leaves SELF_SERVE_ENABLED unset; admin add via x-api-key
  // remains the only path.
  const selfServeEnabled = (process.env.SELF_SERVE_ENABLED ?? "false") === "true";
  let selfServe: SelfServeConfig = {
    enabled: false, rpcUrl: "", adminPrivateKey: "", complianceAddress: "",
  };
  if (selfServeEnabled) {
    const deploymentPath = resolve(process.cwd(), need("DEPLOYMENT_PATH"));
    const dep = JSON.parse(readFileSync(deploymentPath, "utf8")) as {
      contracts: { Compliance: string };
    };
    selfServe = {
      enabled: true,
      rpcUrl: need("RPC_URL"),
      adminPrivateKey: need("ADMIN_PRIVATE_KEY"),
      complianceAddress: dep.contracts.Compliance,
    };
  }

  return {
    port: Number(process.env.PORT ?? 4001),
    allowlistPath: resolve(
      process.cwd(),
      process.env.ALLOWLIST_PATH ?? "./data/allowlist.json",
    ),
    adminApiKey: need("ADMIN_API_KEY"),
    selfServe,
  };
}
