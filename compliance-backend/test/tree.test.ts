import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AllowlistTree } from "../src/tree.js";

let path: string;

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "noirperp-compliance-"));
  path = join(dir, "allowlist.json");
  writeFileSync(path, JSON.stringify({ addresses: [] }));
});

describe("AllowlistTree", () => {
  it("starts empty with ZeroHash root", async () => {
    const t = AllowlistTree.fromFile(path);
    expect(t.root).toBeDefined();
    expect(t.size).toEqual(0);
  });

  it("add() persists and rebuilds tree", async () => {
    const t = AllowlistTree.fromFile(path);
    const newRoot = t.add("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
    expect(t.size).toEqual(1);
    expect(newRoot).not.toEqual("0x" + "0".repeat(64));

    // Re-load from disk; should still have the one entry
    const t2 = AllowlistTree.fromFile(path);
    expect(t2.size).toEqual(1);
    expect(t2.root).toEqual(newRoot);
  });

  it("proof() returns a valid proof for an added address", async () => {
    const t = AllowlistTree.fromFile(path);
    const addr = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
    t.add(addr);
    const result = t.proof(addr);
    expect(result.allowlisted).toEqual(true);
    expect(result.proof).toBeDefined();
    expect(result.root).toEqual(t.root);
  });

  it("proof() for non-allowlisted returns allowlisted=false", () => {
    const t = AllowlistTree.fromFile(path);
    t.add("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
    const result = t.proof("0x90F79bf6EB2c4f870365E785982E1f101E93b906");
    expect(result.allowlisted).toEqual(false);
    expect(result.proof).toEqual([]);
  });

  it("remove() drops the entry and rebuilds", () => {
    const t = AllowlistTree.fromFile(path);
    const addr = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
    t.add(addr);
    t.remove(addr);
    expect(t.size).toEqual(0);
    expect(t.proof(addr).allowlisted).toEqual(false);
  });

  it("add() is idempotent for the same address", () => {
    const t = AllowlistTree.fromFile(path);
    const addr = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
    t.add(addr);
    const r1 = t.root;
    t.add(addr);
    expect(t.size).toEqual(1);
    expect(t.root).toEqual(r1);
  });
});
