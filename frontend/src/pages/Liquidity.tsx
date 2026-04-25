import { useState } from "react";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { parseAbi } from "viem";
import {
  Droplets, Layers, Coins, ArrowDownToLine, Plus,
  Bot, AlertCircle, Info, Activity,
} from "lucide-react";
import { WalletGate } from "../components/WalletGate";
import { Field, Input, Button } from "../components/Form";
import { Card, Stat, SectionHeader, Badge } from "../components/ui";
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
      <SectionHeader
        eyebrow="Liquidity"
        title="AMM pool"
        description="Provide USDCx to back the perp engine. Pool totals are public (sharded against your individual share); your own balance stays encrypted."
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Stat
          label="Total shares"
          value={totalShares !== undefined ? Number(totalShares).toLocaleString() : undefined}
          hint="Pool-wide share supply (plaintext)"
          icon={<Layers size={14} />}
        />
        <Stat
          label="Reserve · USDCx"
          value={totalReserve !== undefined ? Number(totalReserve).toLocaleString() : undefined}
          hint="Underlying USDCx held by the AMM"
          icon={<Coins size={14} />}
          accent="violet"
        />
        <Card className="p-5">
          <div className="flex items-start justify-between gap-3 mb-3">
            <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-noir-mute">
              Your shares
            </span>
            <Droplets size={14} className="text-noir-accent2 opacity-70" />
          </div>
          <div className="text-2xl font-semibold font-mono leading-none">
            <EncryptedValue
              handle={userShares as `0x${string}` | undefined}
              contractAddr={ammAddr}
            />
          </div>
          <div className="mt-2 text-xs text-noir-dim">Encrypted · click reveal to decrypt</div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Add liquidity */}
        <Card className="p-6 space-y-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-lg bg-noir-green/15 border border-noir-green/30 flex items-center justify-center">
                <Plus size={14} className="text-noir-green" />
              </div>
              <h2 className="text-base font-semibold text-noir-white">Add liquidity</h2>
            </div>
            <Badge tone="green" icon={<Activity size={10} />}>sync</Badge>
          </div>

          <Field
            label="Amount"
            trailing={<span>USDCx</span>}
            hint="Deposited atomically — shares minted in the same tx."
          >
            <Input
              type="text"
              inputMode="decimal"
              value={addAmount}
              onChange={(e) => setAddAmount(e.target.value)}
              placeholder="1000"
              suffix="USDCx"
            />
          </Field>

          <Button
            variant="success"
            size="lg"
            className="w-full"
            onClick={onAdd}
            loading={isPending}
            disabled={isPending || !addAmount}
            leadingIcon={<Plus size={14} />}
          >
            {isPending ? "Adding…" : "Add liquidity"}
          </Button>
        </Card>

        {/* Request withdraw */}
        <Card className="p-6 space-y-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-lg bg-noir-accent/15 border border-noir-accent/30 flex items-center justify-center">
                <ArrowDownToLine size={14} className="text-noir-accent2" />
              </div>
              <h2 className="text-base font-semibold text-noir-white">Request withdraw</h2>
            </div>
            <Badge tone="violet" icon={<Bot size={10} />}>async</Badge>
          </div>

          <Field
            label="Shares to burn"
            trailing={<span>shares</span>}
            hint={
              <span className="inline-flex items-center gap-1">
                <Bot size={10} className="text-noir-accent2 opacity-70" />
                Settled async by the relayer bot.
              </span>
            }
          >
            <Input
              type="text"
              inputMode="decimal"
              value={withdrawShares}
              onChange={(e) => setWithdrawShares(e.target.value)}
              placeholder="100"
              suffix="shares"
            />
          </Field>

          <Button
            variant="primary"
            size="lg"
            className="w-full"
            onClick={onWithdraw}
            loading={isPending}
            disabled={isPending || !withdrawShares}
            leadingIcon={<ArrowDownToLine size={14} />}
          >
            {isPending ? "Submitting…" : "Request withdraw"}
          </Button>

          <div className="flex items-start gap-2 text-[11px] text-noir-dim bg-noir-black border border-noir-line rounded-lg p-3">
            <Info size={12} className="shrink-0 mt-0.5 text-noir-accent2" />
            <span>
              <span className="text-noir-white font-medium">Two-step withdrawal.</span>{" "}
              Your shares burn now; the relayer bot finalizes USDCx
              transfer once the FHE decrypt callback lands. Watch the
              Portfolio page for completion.
            </span>
          </div>
        </Card>
      </div>

      {error && (
        <Card className="p-4 border-noir-red/40 bg-noir-red/5">
          <div className="flex items-start gap-2 text-sm text-noir-red">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <span className="font-mono break-all">{error}</span>
          </div>
        </Card>
      )}
    </div>
  );
}
