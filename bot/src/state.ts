/**
 * Generic tracked-id set used by all watchers. In-memory only —
 * on bot restart, watchers replay events from the deployment block
 * to rebuild state. Persistence (Redis, file) is post-Phase-7 scope.
 */
export class TrackedSet<T> {
  private inner = new Set<T>();

  get size(): number { return this.inner.size; }
  has(v: T): boolean { return this.inner.has(v); }
  add(v: T): void { this.inner.add(v); }
  remove(v: T): void { this.inner.delete(v); }
  list(): T[] { return [...this.inner]; }
  groupBy<K>(keyFn: (v: T) => K): Map<K, T[]> {
    const out = new Map<K, T[]>();
    for (const v of this.inner) {
      const k = keyFn(v);
      const bucket = out.get(k) ?? [];
      bucket.push(v);
      out.set(k, bucket);
    }
    return out;
  }
}
