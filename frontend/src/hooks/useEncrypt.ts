import { useAccount } from "wagmi";
import { bytesToHex } from "viem";
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
    const out = await inp.encrypt();
    // SDK 0.5.0-alpha.3 returns Uint8Array for handles + inputProof, where
    // 0.4.x returned 0x-hex strings. The rest of the app (viem encoding,
    // contract callsites) wants hex — convert at this boundary so nothing
    // downstream changes.
    const toHex = (v: unknown): `0x${string}` =>
      v instanceof Uint8Array ? bytesToHex(v) : (v as `0x${string}`);
    return {
      handles: (out.handles as unknown[]).map(toHex),
      inputProof: toHex(out.inputProof),
    };
  };
}
