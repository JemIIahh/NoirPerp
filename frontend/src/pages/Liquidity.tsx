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
    address: ammAddr, abi: AMM, functionName: "getUserShares",
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

  const reserveDisplay = totalReserve !== undefined ? Number(totalReserve).toLocaleString() : null;

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow={<><Droplets size={10} /> Liquidity</>}
        title={<>The <span className="shimmer-text">AMM</span> pool</>}
        description="Provide USDCx to back the perp engine. Pool totals are public; your individual share stays encrypted."
      />

      {/* ============ Hero TVL card ============ */}
      <Card hero className="p-7 relative overflow-hidden animate-fade-up">
        <div aria-hidden className="absolute -top-40 -left-32 w-[420px] h-[420px] rounded-full bg-noir-cream/[0.05] blur-3xl pointer-events-none" />
        <div aria-hidden className="absolute -bottom-32 -right-24 w-96 h-96 rounded-full bg-noir-cream/[0.03] blur-3xl pointer-events-none" />

        <div className="relative flex items-center justify-between gap-8 flex-wrap">
          <div>
            <div className="text-[10px] font-medium uppercase tracking-[0.22em] text-noir-cream/40 mb-2">
              Total reserve
            </div>
            <div className="font-mono font-semibold text-[44px] md:text-[56px] tabular-nums text-noir-cream tracking-[-0.03em] leading-none">
              {reserveDisplay ? <>${reserveDisplay}</> : <span className="text-noir-cream/30">—</span>}
            </div>
            <div className="text-[12px] text-noir-cream/50 mt-2.5 max-w-md leading-relaxed">
              Underlying USDCx held by the AMM. Backs every encrypted long &amp; short.
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden md:block h-20 w-px bg-gradient-to-b from-transparent via-white/10 to-transparent" />
            <div>
              <div className="text-[10px] font-medium uppercase tracking-[0.22em] text-noir-cream/40 mb-1.5">
                Pool shares
              </div>
              <div className="font-display font-semibold text-[28px] tabular-nums text-noir-cream/90 leading-none">
                {totalShares !== undefined ? Number(totalShares).toLocaleString() : "—"}
              </div>
              <div className="text-[11px] text-noir-cream/45 mt-2 inline-flex items-center gap-1.5">
                <Layers size={11} />
                Plaintext supply
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* ============ Your share — encrypted callout ============ */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Stat
          label="Your shares"
          accent="mint"
          icon={<Droplets size={13} />}
          value={
            <EncryptedValue
              handle={userShares as `0x${string}` | undefined}
              contractAddr={ammAddr}
            />
          }
          hint="Encrypted · click reveal to decrypt"
        />
        <Stat
          label="Pool TVL"
          accent="neutral"
          icon={<Coins size={13} />}
          value={reserveDisplay ?? undefined}
          hint="USDCx underlying the pool"
        />
        <Stat
          label="Outstanding"
          accent="neutral"
          icon={<Activity size={13} />}
          value={totalShares !== undefined ? Number(totalShares).toLocaleString() : undefined}
          hint="Plaintext share supply on-chain"
        />
      </div>

      {/* ============ Action panels — asymmetric, deposit dominates ============ */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-4">
        {/* Add liquidity */}
        <Card hero className="p-6 space-y-5 relative overflow-hidden animate-fade-up [animation-delay:80ms]">
          <div aria-hidden className="absolute -top-24 -right-20 w-64 h-64 rounded-full bg-noir-cream/[0.04] blur-3xl pointer-events-none" />
          <div aria-hidden className="absolute inset-0 bg-grid-dots opacity-[0.12] pointer-events-none [mask-image:linear-gradient(to_bottom,black,transparent_80%)]" />
          <div className="relative space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="absolute inset-0 rounded-xl bg-noir-accent/30 blur-md" />
                  <div className="relative h-11 w-11 rounded-xl bg-noir-accent/[0.10] border border-noir-accent/35 flex items-center justify-center">
                    <Plus size={18} className="text-noir-accent" />
                  </div>
                </div>
                <div>
                  <div className="font-display text-[16px] font-medium text-noir-cream tracking-tight">Add liquidity</div>
                  <div className="text-[11px] text-noir-cream/45 mt-0.5">Atomic deposit · shares minted in-tx</div>
                </div>
              </div>
              <Badge tone="mint" icon={<Activity size={10} />}>sync</Badge>
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
          </div>
        </Card>

        {/* Request withdraw */}
        <Card className="p-6 space-y-5 relative overflow-hidden animate-fade-up [animation-delay:120ms]">
          <div aria-hidden className="absolute -top-24 -right-20 w-64 h-64 rounded-full bg-noir-cream/[0.04] blur-3xl pointer-events-none" />
          <div className="relative space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-11 w-11 rounded-xl bg-noir-cream/[0.06] border border-noir-cream/20 flex items-center justify-center">
                  <ArrowDownToLine size={18} className="text-noir-cream" />
                </div>
                <div>
                  <div className="font-display text-[16px] font-medium text-noir-cream tracking-tight">Withdraw</div>
                  <div className="text-[11px] text-noir-cream/45 mt-0.5">Two-step · settled by relayer</div>
                </div>
              </div>
              <Badge tone="neutral" icon={<Bot size={10} />}>async</Badge>
            </div>

            <Field
              label="Shares to burn"
              trailing={<span>shares</span>}
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

            <div className="flex items-start gap-2.5 text-[11px] text-noir-cream/55 rounded-xl p-3.5 border border-white/[0.06] bg-white/[0.02] backdrop-blur-md">
              <Info size={12} className="shrink-0 mt-0.5 text-noir-accent" />
              <span className="leading-relaxed">
                <span className="text-noir-cream/80 font-medium">Two-step withdrawal.</span>{" "}
                Your shares burn now; the relayer bot finalizes USDCx
                transfer once the FHE decrypt callback lands.
              </span>
            </div>
          </div>
        </Card>
      </div>

      {error && (
        <Card className="p-4 border-noir-red/40">
          <div className="flex items-start gap-2 text-sm text-noir-red">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <span className="font-mono break-all">{error}</span>
          </div>
        </Card>
      )}
    </div>
  );
}
