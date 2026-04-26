import express, { Request, Response, NextFunction } from "express";
import { isAddress } from "ethers";
import pinoHttp from "pino-http";
import { AllowlistTree } from "./tree.js";

type AppOpts = {
  allowlistPath: string;
  adminApiKey: string;
  logger?: any; // pino Logger; optional so tests can omit
};

export function buildApp(opts: AppOpts) {
  const tree = AllowlistTree.fromFile(opts.allowlistPath);
  const app = express();
  if (opts.logger) {
    app.use(pinoHttp({ logger: opts.logger }));
  }
  // Permissive CORS — read endpoints (`/health`, `/proof/:address`) are
  // public; admin endpoints are gated separately by `x-api-key` header.
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
    res.json({ status: "ok", root: tree.root, count: tree.size });
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

  return app;
}
