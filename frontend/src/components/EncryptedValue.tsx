import { useState } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { useDeployment } from "../hooks/useDeployment";
import { getRelayerInstance } from "../lib/relayer";

type Props = {
  handle: `0x${string}` | undefined;
  contractAddr: `0x${string}` | undefined;
  format?: (v: bigint) => string;
  hidden?: string;
};

export function EncryptedValue({ handle, contractAddr, format = (v) => v.toString(), hidden = "•••" }: Props) {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { data: deployment } = useDeployment();
  const [value, setValue] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!handle || !contractAddr || !deployment) return <span className="text-noir-mute">—</span>;
  if (value !== null) return <span className="font-mono">{format(value)}</span>;

  return (
    <span className="inline-flex items-center gap-2">
      <span className="font-mono text-noir-mute">{hidden}</span>
      <button
        className="px-2 py-0.5 text-xs border border-noir-line rounded hover:bg-noir-gray disabled:opacity-50"
        disabled={busy || !address || !walletClient}
        onClick={async () => {
          if (!address || !walletClient) return;
          setBusy(true); setErr(null);
          try {
            const inst = await getRelayerInstance(deployment);
            const v = await (inst as any).userDecrypt(handle, contractAddr, walletClient);
            setValue(BigInt(v));
          } catch (e) { setErr((e as Error).message); }
          finally { setBusy(false); }
        }}
      >{busy ? "…" : "Reveal"}</button>
      {err && <span className="text-xs text-noir-red">{err}</span>}
    </span>
  );
}
