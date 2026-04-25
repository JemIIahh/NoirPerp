import { useState } from "react";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { parseAbi } from "viem";
import { WalletGate } from "../components/WalletGate";
import { Field, Input, Button } from "../components/Form";
import { EncryptedValue } from "../components/EncryptedValue";
import { useDeployment } from "../hooks/useDeployment";
import { AMM_ABI } from "../lib/abis";

const AMM = parseAbi(AMM_ABI);

export default function Liquidity() { return <WalletGate><Inner /></WalletGate>; }

function Inner() {
  const { address } = useAccount();
  const { data: deployment } = useDeployment();
  const { writeContractAsync, isPending } = useWriteContract();
  const [addAmount, setAddAmount] = useState("");
  const [withdrawShares, setWithdrawShares] = useState("");
  const [error, setError] = useState<string | null>(null);

  const ammAddr = deployment?.contracts.AMMEngine;

  const { data: totalShares } = useReadContract({
    address: ammAddr, abi: AMM, functionName: "totalShares",
    query: { enabled: !!ammAddr, refetchInterval: 15_000 },
  });
  const { data: totalReserve } = useReadContract({
    address: ammAddr, abi: AMM, functionName: "totalReserveUsdcx",
    query: { enabled: !!ammAddr, refetchInterval: 15_000 },
  });
  const { data: userShares } = useReadContract({
    address: ammAddr, abi: AMM, functionName: "userShares",
    args: address ? [address] : undefined,
    query: { enabled: !!ammAddr && !!address, refetchInterval: 15_000 },
  });

  async function onAdd() {
    setError(null);
    try {
      await writeContractAsync({
        address: ammAddr!, abi: AMM, functionName: "addLiquidity",
        args: [BigInt(addAmount)],
      });
      setAddAmount("");
    } catch (e) { setError((e as Error).message); }
  }

  async function onWithdraw() {
    setError(null);
    try {
      await writeContractAsync({
        address: ammAddr!, abi: AMM, functionName: "requestWithdraw",
        args: [BigInt(withdrawShares)],
      });
      setWithdrawShares("");
    } catch (e) { setError((e as Error).message); }
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Liquidity</h1>

      <div className="grid grid-cols-3 gap-4">
        <Stat label="Total shares" value={totalShares?.toString() ?? "—"} />
        <Stat label="Total reserve (USDCx)" value={totalReserve?.toString() ?? "—"} />
        <Stat label="Your shares (encrypted)" inner={<EncryptedValue handle={userShares as `0x${string}` | undefined} contractAddr={ammAddr} />} />
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="bg-noir-gray border border-noir-line rounded p-6 space-y-4">
          <h2 className="text-lg font-semibold">Add liquidity</h2>
          <Field label="Amount (USDCx)"><Input value={addAmount} onChange={(e) => setAddAmount(e.target.value)} placeholder="1000" /></Field>
          <Button onClick={onAdd} disabled={isPending || !addAmount}>Add</Button>
        </div>
        <div className="bg-noir-gray border border-noir-line rounded p-6 space-y-4">
          <h2 className="text-lg font-semibold">Request withdraw</h2>
          <Field label="Shares to burn"><Input value={withdrawShares} onChange={(e) => setWithdrawShares(e.target.value)} placeholder="100" /></Field>
          <Button onClick={onWithdraw} disabled={isPending || !withdrawShares}>Request</Button>
          <p className="text-xs text-noir-mute">Async — bot completes settlement. Watch Portfolio for update.</p>
        </div>
      </div>

      {error && <p className="text-noir-red">{error}</p>}
    </div>
  );
}

function Stat({ label, value, inner }: { label: string; value?: string; inner?: React.ReactNode }) {
  return (
    <div className="bg-noir-gray border border-noir-line rounded p-4">
      <div className="text-xs uppercase tracking-wider text-noir-mute mb-1">{label}</div>
      <div className="font-mono text-lg">{inner ?? value}</div>
    </div>
  );
}
