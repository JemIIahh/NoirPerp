import { useReadContract } from "wagmi";
import { parseAbi } from "viem";
import { useDeployment } from "./useDeployment";
import { VAULT_ABI } from "../lib/abis";

const ABI = parseAbi(VAULT_ABI);

export function useVaultBalance(user: `0x${string}` | undefined) {
  const { data: deployment } = useDeployment();
  return useReadContract({
    address: deployment?.contracts.NoirVault,
    abi: ABI, functionName: "getBalance",
    args: user ? [user] : undefined,
    query: { enabled: !!user && !!deployment, refetchInterval: 10_000 },
  });
}
