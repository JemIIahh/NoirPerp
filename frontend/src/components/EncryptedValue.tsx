import { useState } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { Lock, Unlock } from "lucide-react";
import clsx from "clsx";
import { useDeployment } from "../hooks/useDeployment";
import { getRelayerInstance } from "../lib/relayer";
import { Spinner } from "./ui";

type Props = {
  handle: `0x${string}` | undefined;
  contractAddr: `0x${string}` | undefined;
  /** Format the revealed bigint into a display string. */
  format?: (v: bigint) => string;
  /** Placeholder shown while still encrypted. */
  hidden?: string;
  /** When true, render a more compact button (used inside table cells). */
  compact?: boolean;
};

export function EncryptedValue({
  handle, contractAddr,
  format = (v) => v.toString(),
  hidden = "••••••",
  compact = false,
}: Props) {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { data: deployment } = useDeployment();
  const [value, setValue] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!handle || !contractAddr || !deployment) {
    return <span className="text-noir-mute">—</span>;
  }

  // Already decrypted — render crisp value with an unlock icon.
  if (value !== null) {
    return (
      <span className="inline-flex items-center gap-1.5 animate-fade-in">
        <Unlock size={11} className="text-noir-green opacity-80" />
        <span className="font-mono text-noir-white tabular-nums">{format(value)}</span>
      </span>
    );
  }

  // Encrypted — blurred placeholder + reveal trigger.
  return (
    <span className="inline-flex items-center gap-2">
      <span className="inline-flex items-center gap-1.5">
        <Lock size={11} className="text-noir-accent2 opacity-70" />
        <span className="encrypted-text font-mono text-noir-dim">{hidden}</span>
      </span>
      <button
        type="button"
        disabled={busy || !address || !walletClient}
        onClick={async (e) => {
          e.preventDefault();
          if (!address || !walletClient) return;
          setBusy(true); setErr(null);
          try {
            const inst = await getRelayerInstance(deployment) as any;
            // SDK 0.4.1 userDecrypt flow: generateKeypair → getExtraData → createEIP712 → sign → userDecrypt
            const { privateKey, publicKey } = inst.generateKeypair();
            const extraData = await inst.getExtraData();
            const startTimestamp = Math.floor(Date.now() / 1000);
            const durationDays = 1;
            const eip712 = inst.createEIP712(publicKey, [contractAddr], startTimestamp, durationDays, extraData);
            const signature = await walletClient.signTypedData({
              domain: eip712.domain,
              types: eip712.types,
              primaryType: eip712.primaryType,
              message: eip712.message,
            });
            const result = await inst.userDecrypt(
              [{ handle, contractAddress: contractAddr }],
              privateKey, publicKey, signature,
              [contractAddr], address!,
              startTimestamp, durationDays, extraData,
            );
            const v = Object.values(result)[0] as bigint;
            setValue(v);
          } catch (e2) {
            setErr((e2 as Error).message);
          } finally {
            setBusy(false);
          }
        }}
        className={clsx(
          "inline-flex items-center gap-1 rounded border font-medium transition-colors",
          "border-noir-edge text-noir-dim",
          "hover:border-noir-accent/60 hover:text-noir-accent2 hover:bg-noir-accent/5",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs",
        )}
        title="Decrypt this value with your wallet (FHEVM userDecrypt)"
      >
        {busy ? (
          <>
            <Spinner size={10} />
            <span>decrypting</span>
          </>
        ) : (
          <>
            <Unlock size={10} />
            <span>Reveal</span>
          </>
        )}
      </button>
      {err && <span className="text-[10px] text-noir-red truncate max-w-[120px]" title={err}>!</span>}
    </span>
  );
}
