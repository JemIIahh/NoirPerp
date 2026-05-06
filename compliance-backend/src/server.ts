import express, { Request, Response, NextFunction } from "express";
import { isAddress, JsonRpcProvider, Wallet, Contract } from "ethers";
import pinoHttp from "pino-http";
import { AllowlistTree } from "./tree.js";
import type { SelfServeConfig } from "./config.js";

type AppOpts = {
  allowlistPath: string;
  adminApiKey: string;
  selfServe: SelfServeConfig;
  logger?: any; // pino Logger; optional so tests can omit
};

const COMPLIANCE_ABI = [
  "function updateRoot(bytes32 newRoot) external",
  "function merkleRoot() external view returns (bytes32)",
];

// Push the on-chain Merkle root to match `tree.root`. Only used when
// SELF_SERVE_ENABLED=true. Returns the tx hash on success; throws on
// failure so the caller can surface a 5xx to the client.
async function syncOnchainRoot(cfg: SelfServeConfig, expected: string): Promise<string> {
  const provider = new JsonRpcProvider(cfg.rpcUrl);
  const signer = new Wallet(cfg.adminPrivateKey, provider);
  const c = new Contract(cfg.complianceAddress, COMPLIANCE_ABI, signer);
  const current: string = await c.merkleRoot();
  if (current.toLowerCase() === expected.toLowerCase()) return ""; // no-op
  const tx = await (c as any).updateRoot(expected);
  await tx.wait();
  return tx.hash;
}

export function buildApp(opts: AppOpts) {
  const tree = AllowlistTree.fromFile(opts.allowlistPath);
  const app = express();
  if (opts.logger) {
    app.use(pinoHttp({ logger: opts.logger }));
  }
  // Permissive CORS — read endpoints (`/health`, `/proof/:address`) and
  // self-serve add are public; admin endpoints are gated by `x-api-key`.
  app.use((_req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, x-api-key");
    if (_req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      root: tree.root,
      count: tree.size,
      selfServe: opts.selfServe.enabled,
    });
  });

  app.get("/proof/:address", (req, res) => {
    const addr = req.params.address;
    if (!isAddress(addr)) {
      res.status(400).json({ error: "invalid address" });
      return;
    }
    res.json(tree.proof(addr));
  });

  const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
    if (req.header("x-api-key") !== opts.adminApiKey) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  };

  app.post("/admin/add", requireAdmin, (req, res) => {
    const addr = req.body?.address;
    if (typeof addr !== "string" || !isAddress(addr)) {
      res.status(400).json({ error: "invalid address" });
      return;
    }
    const newRoot = tree.add(addr);
    res.json({ added: true, newRoot, count: tree.size });
  });

  app.post("/admin/remove", requireAdmin, (req, res) => {
    const addr = req.body?.address;
    if (typeof addr !== "string" || !isAddress(addr)) {
      res.status(400).json({ error: "invalid address" });
      return;
    }
    const newRoot = tree.remove(addr);
    res.json({ removed: true, newRoot, count: tree.size });
  });

  // Self-serve enrollment — testnet-only path that bypasses the
  // admin API key. Adds the caller's address to the Merkle tree AND
  // pushes the new root on-chain in one operation. Behind a config
  // flag (SELF_SERVE_ENABLED=true) so production deploys can leave
  // it disabled and rely on real KYC integration via /admin/add.
  app.post("/self-serve/add", async (req, res) => {
    if (!opts.selfServe.enabled) {
      res.status(503).json({
        error: "self-serve not enabled — this deployment requires admin enrollment",
      });
      return;
    }
    const addr = req.body?.address;
    if (typeof addr !== "string" || !isAddress(addr)) {
      res.status(400).json({ error: "invalid address" });
      return;
    }
    // Idempotent at the tree level — re-adds are no-ops.
    const newRoot = tree.add(addr);
    try {
      const txHash = await syncOnchainRoot(opts.selfServe, newRoot);
      res.json({
        added: true,
        newRoot,
        count: tree.size,
        txHash: txHash || null, // null when on-chain root already matched (no-op)
      });
    } catch (err) {
      opts.logger?.error?.({ err: (err as Error).message, addr }, "self-serve sync failed");
      res.status(502).json({
        error: "tree updated locally but on-chain sync failed; retry",
        detail: (err as Error).message,
      });
    }
  });

  return app;
}
