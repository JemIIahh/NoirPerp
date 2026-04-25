import { describe, it, expect, beforeEach } from "vitest";
import { TrackedSet } from "../src/state.js";

describe("TrackedSet", () => {
  let set: TrackedSet<bigint>;

  beforeEach(() => { set = new TrackedSet<bigint>(); });

  it("starts empty", () => {
    expect(set.size).toEqual(0);
    expect(set.list()).toEqual([]);
  });

  it("add() inserts and is idempotent", () => {
    set.add(1n);
    set.add(1n);
    set.add(2n);
    expect(set.size).toEqual(2);
    expect(set.list().sort()).toEqual([1n, 2n]);
  });

  it("remove() drops entry", () => {
    set.add(1n);
    set.add(2n);
    set.remove(1n);
    expect(set.list()).toEqual([2n]);
  });

  it("has() reports membership", () => {
    set.add(1n);
    expect(set.has(1n)).toEqual(true);
    expect(set.has(2n)).toEqual(false);
  });

  it("groupBy() partitions by key", () => {
    set.add(1n);
    set.add(2n);
    set.add(3n);
    const groups = set.groupBy((id) => Number(id) % 2);
    expect(groups.get(1)).toEqual([1n, 3n]);
    expect(groups.get(0)).toEqual([2n]);
  });
});
