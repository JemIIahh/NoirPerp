import { useQuery } from "@tanstack/react-query";
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
