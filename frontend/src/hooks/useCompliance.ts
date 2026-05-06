import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import type { ComplianceProof } from "../lib/types";

const API_URL = import.meta.env.VITE_COMPLIANCE_API_URL ?? "http://127.0.0.1:4001";

export function useComplianceProof() {
  const { address } = useAccount();
  return useQuery<ComplianceProof | null>({
    queryKey: ["compliance-proof", address],
    enabled: !!address,
    queryFn: async () => {
      if (!address) return null;
      const res = await fetch(`${API_URL}/proof/${address}`);
      if (!res.ok) throw new Error(`compliance API ${res.status}`);
      return (await res.json()) as ComplianceProof;
    },
    refetchInterval: 30_000,
  });
}

export function useComplianceHealth() {
  return useQuery({
    queryKey: ["compliance-health"],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/health`);
      if (!res.ok) throw new Error("compliance health failed");
      return await res.json();
    },
    refetchInterval: 60_000,
  });
}

/**
 * Self-serve enrollment — testnet only. Adds the connected wallet to
 * the Merkle tree and triggers an on-chain root sync server-side.
 * Returns the tx hash (or null when on-chain root already matched).
 * Production deploys disable this endpoint via SELF_SERVE_ENABLED=false
 * and the call returns 503; UI should fall back to the "request access"
 * path in that case.
 */
export function useSelfServeAdd() {
  const qc = useQueryClient();
  const { address } = useAccount();
  return useMutation({
    mutationFn: async () => {
      if (!address) throw new Error("no wallet connected");
      const res = await fetch(`${API_URL}/self-serve/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      return body as { added: boolean; newRoot: string; count: number; txHash: string | null };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["compliance-proof", address] });
      qc.invalidateQueries({ queryKey: ["compliance-health"] });
    },
  });
}
