export function formatBigint(v: bigint, decimals = 0): string {
  if (decimals === 0) return v.toString();
  const s = v.toString().padStart(decimals + 1, "0");
  const head = s.slice(0, -decimals);
  const tail = s.slice(-decimals).replace(/0+$/, "");
  return tail ? `${head}.${tail}` : head;
}

export function shortAddr(a: string): string {
  return a.length > 10 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}
