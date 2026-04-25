import { readFileSync, writeFileSync } from "node:fs";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { getAddress, ZeroHash } from "ethers";

type Persisted = { addresses: string[] };
type ProofResult = { root: string; allowlisted: boolean; proof: string[] };

/**
 * Wraps an OZ StandardMerkleTree built from `[address]` rows and persists
 * the underlying address list to a JSON file. Empty allowlist returns
 * ZeroHash as root (matches what the on-chain Compliance contract uses
 * to mean "deny everyone").
 */
export class AllowlistTree {
  private addresses: string[];
  private tree: StandardMerkleTree<[string]> | null;

  private constructor(private readonly path: string, addresses: string[]) {
    // Normalize all addresses to checksum form for consistent dedup
    this.addresses = Array.from(new Set(addresses.map((a) => getAddress(a))));
    this.tree =
      this.addresses.length > 0
        ? StandardMerkleTree.of(
            this.addresses.map((a) => [a]),
            ["address"],
          )
        : null;
  }

  static fromFile(path: string): AllowlistTree {
    let data: Persisted;
    try {
      data = JSON.parse(readFileSync(path, "utf8")) as Persisted;
    } catch {
      data = { addresses: [] };
    }
    return new AllowlistTree(path, data.addresses);
  }

  get root(): string {
    return this.tree ? this.tree.root : ZeroHash;
  }

  get size(): number {
    return this.addresses.length;
  }

  add(addr: string): string {
    const checksum = getAddress(addr);
    if (this.addresses.includes(checksum)) return this.root;
    this.addresses.push(checksum);
    this.tree = StandardMerkleTree.of(
      this.addresses.map((a) => [a]),
      ["address"],
    );
    this.persist();
    return this.root;
  }

  remove(addr: string): string {
    const checksum = getAddress(addr);
    const idx = this.addresses.indexOf(checksum);
    if (idx === -1) return this.root;
    this.addresses.splice(idx, 1);
    this.tree =
      this.addresses.length > 0
        ? StandardMerkleTree.of(
            this.addresses.map((a) => [a]),
            ["address"],
          )
        : null;
    this.persist();
    return this.root;
  }

  proof(addr: string): ProofResult {
    const checksum = getAddress(addr);
    if (!this.tree || !this.addresses.includes(checksum)) {
      return { root: this.root, allowlisted: false, proof: [] };
    }
    return {
      root: this.root,
      allowlisted: true,
      proof: this.tree.getProof([checksum]),
    };
  }

  private persist() {
    writeFileSync(
      this.path,
      JSON.stringify({ addresses: this.addresses }, null, 2),
    );
  }
}
