import { useAccount } from "wagmi";
import { useDeployment } from "./useDeployment";
import { getRelayerInstance } from "../lib/relayer";

export function useEncryptInput(contractAddr: `0x${string}` | undefined) {
  const { address } = useAccount();
  const { data: deployment } = useDeployment();

  return async (...values: bigint[]): Promise<{ handles: `0x${string}`[]; inputProof: `0x${string}` }> => {
    if (!address || !deployment || !contractAddr) {
      throw new Error("not ready: wallet/deployment/contractAddr missing");
    }
    const inst = await getRelayerInstance(deployment);
    let inp = (inst as any).createEncryptedInput(contractAddr, address);
    for (const v of values) inp = inp.add64(v);
    return await inp.encrypt();
  };
}
