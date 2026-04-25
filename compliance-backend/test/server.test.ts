import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/server.js";

const ADDR_A = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const ADDR_B = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
const KEY = "test-key";

let app: any;
let path: string;

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "compliance-"));
  path = join(dir, "allowlist.json");
  writeFileSync(path, JSON.stringify({ addresses: [] }));
  app = buildApp({ allowlistPath: path, adminApiKey: KEY });
});

describe("compliance-backend server", () => {
  it("GET /health returns root + count", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toEqual(200);
    expect(res.body.status).toEqual("ok");
    expect(res.body.count).toEqual(0);
  });

  it("GET /proof/:address returns allowlisted=false for unknown", async () => {
    const res = await request(app).get(`/proof/${ADDR_A}`);
    expect(res.status).toEqual(200);
    expect(res.body.allowlisted).toEqual(false);
    expect(res.body.proof).toEqual([]);
  });

  it("POST /admin/add without key returns 401", async () => {
    const res = await request(app).post("/admin/add").send({ address: ADDR_A });
    expect(res.status).toEqual(401);
  });

  it("POST /admin/add with key adds address and returns new root", async () => {
    const res = await request(app)
      .post("/admin/add")
      .set("x-api-key", KEY)
      .send({ address: ADDR_A });
    expect(res.status).toEqual(200);
    expect(res.body.added).toEqual(true);
    expect(res.body.newRoot).toBeDefined();
  });

  it("end-to-end: add then proof returns valid proof", async () => {
    // Add two addresses so the tree has siblings and proof is non-empty.
    // OZ StandardMerkleTree returns proof=[] for a single-leaf tree (leaf IS the root).
    await request(app)
      .post("/admin/add")
      .set("x-api-key", KEY)
      .send({ address: ADDR_B });
    await request(app)
      .post("/admin/add")
      .set("x-api-key", KEY)
      .send({ address: ADDR_A });
    const res = await request(app).get(`/proof/${ADDR_A}`);
    expect(res.body.allowlisted).toEqual(true);
    expect(res.body.proof.length).toBeGreaterThan(0);
  });

  it("POST /admin/remove without key returns 401", async () => {
    const res = await request(app).post("/admin/remove").send({ address: ADDR_A });
    expect(res.status).toEqual(401);
  });

  it("POST /admin/remove drops entry", async () => {
    await request(app).post("/admin/add").set("x-api-key", KEY).send({ address: ADDR_A });
    await request(app).post("/admin/add").set("x-api-key", KEY).send({ address: ADDR_B });
    const res = await request(app)
      .post("/admin/remove")
      .set("x-api-key", KEY)
      .send({ address: ADDR_A });
    expect(res.status).toEqual(200);
    expect(res.body.removed).toEqual(true);
    const proof = await request(app).get(`/proof/${ADDR_A}`);
    expect(proof.body.allowlisted).toEqual(false);
  });

  it("POST /admin/add rejects invalid address", async () => {
    const res = await request(app)
      .post("/admin/add")
      .set("x-api-key", KEY)
      .send({ address: "not-an-address" });
    expect(res.status).toEqual(400);
  });
});
