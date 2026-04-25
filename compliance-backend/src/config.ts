import { config as dotenvConfig } from "dotenv";
import { resolve } from "node:path";

dotenvConfig();

export type Config = {
  port: number;
  allowlistPath: string;
  adminApiKey: string;
};

export function loadConfig(): Config {
  const need = (k: string): string => {
    const v = process.env[k];
    if (!v) throw new Error(`missing env ${k}`);
    return v;
  };
  return {
    port: Number(process.env.PORT ?? 4001),
    allowlistPath: resolve(
      process.cwd(),
      process.env.ALLOWLIST_PATH ?? "./data/allowlist.json",
    ),
    adminApiKey: need("ADMIN_API_KEY"),
  };
}
