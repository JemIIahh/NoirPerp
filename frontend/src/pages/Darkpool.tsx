import { useState } from "react";
import { useAccount, useWriteContract } from "wagmi";
import {
  EyeOff, Lock, TrendingUp, TrendingDown, Activity, AlertCircle,
  Info, X, ChevronRight, Fingerprint,
} from "lucide-react";
import clsx from "clsx";
import { WalletGate } from "../components/WalletGate";
import { Field, Input, Select, Button } from "../components/Form";
import { Card, Badge, SectionHeader, EmptyState } from "../components/ui";
import { EncryptedValue } from "../components/EncryptedValue";
import { useDeployment } from "../hooks/useDeployment";
import { useEncryptInput } from "../hooks/useEncrypt";
import { useComplianceProof } from "../hooks/useCompliance";
import { useDarkOrders } from "../hooks/useDarkOrders";
import { MARKETS, marketById } from "../lib/markets";
import { DARK_ABI } from "../lib/abis";

// DARK_ABI is already an Abi (parsed strings + JSON submitOrder entry).
const DARK = DARK_ABI;

export default function Darkpool() { return <WalletGate><Inner /></WalletGate>; }

function Inner() {
  const { address } = useAccount();
  const { data: deployment } = useDeployment();
  const { data: proof } = useComplianceProof();
  const orders = useDarkOrders(address);
  const encrypt = useEncryptInput(deployment?.contracts.DarkpoolEngine);
  const { writeContractAsync, isPending } = useWriteContract();

  const [marketId, setMarketId] = useState(2);
  const [isLong, setIsLong] = useState(true);
  const [size, setSize] = useState("");
  const [collateral, setCollateral] = useState("");
  const [limitPrice, setLimitPrice] = useState("");
  const [error, setError] = useState<string | null>(null);

  const market = marketById(marketId);

  async function onSubmit() {
    setError(null);
    if (!proof?.allowlisted) { setError("Address not allowlisted"); return; }
    if (!deployment) return;
    try {
      const enc = await encrypt(BigInt(size), BigInt(collateral), BigInt(limitPrice));
      const inputs = {
        eSize: enc.handles[0], sizeProof: enc.inputProof,
        eCollateral: enc.handles[1], collateralProof: enc.inputProof,
        eLimitPrice: enc.handles[2], limitProof: enc.inputProof,
      };
      await writeContractAsync({
        address: deployment.contracts.DarkpoolEngine, abi: DARK,
        functionName: "submitOrder", args: [inputs, marketId, isLong, proof.proof],
      });
      setSize(""); setCollateral(""); setLimitPrice("");
    } catch (e) { setError((e as Error).message); }
  }

  async function onCancel(orderId: bigint) {
    setError(null);
    if (!deployment) return;
    try {
      await writeContractAsync({
        address: deployment.contracts.DarkpoolEngine, abi: DARK,
        functionName: "cancelOrder", args: [orderId],
      });
    } catch (e) { setError((e as Error).message); }
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <EyeOff size={11} /> Darkpool
          </span>
        }
        title={<>Submit a <span className="text-noir-accent2">dark</span> limit order</>}
        description="Size, collateral, and limit price are all encrypted on submit. Orders match in-batch — front-running has nothing to read."
      />

      <div className="grid grid-cols-1 lg:grid-cols-[440px_1fr] gap-6">
        {/* ---------- Left: encrypted submit form ------------------------- */}
        <div className="space-y-4">
          <Card className="p-6 space-y-5 relative overflow-hidden">
            {/* Faint dotted texture inside the card — reinforces the dark vibe. */}
            <div
              aria-hidden
              className="absolute inset-0 bg-grid-dots opacity-30 pointer-events-none [mask-image:linear-gradient(to_bottom,black_30%,transparent_100%)]"
            />
            <div className="relative space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-noir-white">Dark order</h2>
                <Badge tone="encrypted" icon={<Fingerprint size={10} />}>
                  3 encrypted fields
                </Badge>
              </div>

              {/* Side toggle */}
              <div className="grid grid-cols-2 gap-2 p-1 rounded-lg bg-noir-black border border-noir-line">
                <button
                  type="button"
                  onClick={() => setIsLong(true)}
                  className={clsx(
                    "flex items-center justify-center gap-1.5 py-2 rounded-md text-sm font-medium transition-all",
                    isLong
                      ? "bg-noir-green/15 text-noir-green border border-noir-green/40"
                      : "text-noir-mute hover:text-noir-white border border-transparent",
                  )}
                >
                  <TrendingUp size={14} /> Long
                </button>
                <button
                  type="button"
                  onClick={() => setIsLong(false)}
                  className={clsx(
                    "flex items-center justify-center gap-1.5 py-2 rounded-md text-sm font-medium transition-all",
                    !isLong
                      ? "bg-noir-red/15 text-noir-red border border-noir-red/40"
                      : "text-noir-mute hover:text-noir-white border border-transparent",
                  )}
                >
                  <TrendingDown size={14} /> Short
                </button>
              </div>

              <Field label="Market">
                <Select value={marketId} onChange={(e) => setMarketId(Number(e.target.value))}>
                  {MARKETS.map((m) => (
                    <option key={m.id} value={m.id}>{m.symbol} / USD</option>
                  ))}
                </Select>
              </Field>

              <Field
                label="Size"
                trailing={
                  <span className="inline-flex items-center gap-1 text-noir-accent2">
                    <Lock size={9} /> encrypted
                  </span>
                }
              >
                <Input
                  type="text"
                  inputMode="decimal"
                  value={size}
                  onChange={(e) => setSize(e.target.value)}
                  placeholder="10"
                  suffix={market?.symbol}
                />
              </Field>

              <Field
                label="Collateral"
                trailing={
                  <span className="inline-flex items-center gap-1 text-noir-accent2">
                    <Lock size={9} /> encrypted
                  </span>
                }
              >
                <Input
                  type="text"
                  inputMode="decimal"
                  value={collateral}
                  onChange={(e) => setCollateral(e.target.value)}
                  placeholder="1000"
                  suffix="USDCx"
                />
              </Field>

              <Field
                label="Limit price"
                trailing={
                  <span className="inline-flex items-center gap-1 text-noir-accent2">
                    <Lock size={9} /> encrypted
                  </span>
                }
                hint="Order matches when the oracle price crosses your limit, in batch."
              >
                <Input
                  type="text"
                  inputMode="decimal"
                  value={limitPrice}
                  onChange={(e) => setLimitPrice(e.target.value)}
                  placeholder="3000"
                  suffix="USD"
                />
              </Field>

              <Button
                onClick={onSubmit}
                loading={isPending}
                disabled={isPending || !proof?.allowlisted || !size || !collateral || !limitPrice}
                size="lg"
                className="w-full"
              >
                {isPending ? "Submitting…" : (
                  <>Submit dark order <ChevronRight size={14} /></>
                )}
              </Button>

              {!proof?.allowlisted && (
                <div className="flex items-start gap-2 text-xs text-noir-amber bg-noir-amber/5 border border-noir-amber/30 rounded-lg p-3">
                  <AlertCircle size={14} className="shrink-0 mt-0.5" />
                  <span>Wallet not on the compliance allowlist.</span>
                </div>
              )}
              {error && (
                <div className="flex items-start gap-2 text-xs text-noir-red bg-noir-red/5 border border-noir-red/30 rounded-lg p-3">
                  <AlertCircle size={14} className="shrink-0 mt-0.5" />
                  <span className="font-mono break-all">{error}</span>
                </div>
              )}
            </div>
          </Card>

          {/* What gets encrypted — pedagogical card */}
          <Card className="p-5 space-y-3">
            <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-noir-mute">
              What's encrypted
            </div>
            <div className="space-y-1.5">
              <EncryptedRow label="Order size" />
              <EncryptedRow label="Collateral amount" />
              <EncryptedRow label="Limit price" />
              <EncryptedRow label="Side · long/short" plaintext />
              <EncryptedRow label="Market id" plaintext />
            </div>
          </Card>
        </div>

        {/* ---------- Right: active orders -------------------------------- */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-noir-white">
              Active orders
              <span className="text-noir-mute font-normal ml-2">{orders.length}</span>
            </h2>
            <span className="inline-flex items-center gap-1.5 text-[11px] text-noir-dim">
              <Activity size={11} className="text-noir-green" />
              auto-refresh 15s
            </span>
          </div>

          {orders.length === 0 ? (
            <EmptyState
              icon={<EyeOff size={20} />}
              title="No active orders"
              description="Encrypted orders appear here as soon as the tx confirms. Other traders see your row exists — but not the size, price, or value."
            />
          ) : (
            <div className="space-y-3">
              {orders.map((o) => (
                <Card key={o.id.toString()} interactive className="p-5">
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-md bg-noir-raised border border-noir-edge flex items-center justify-center text-[10px] font-semibold text-noir-white">
                        {marketById(o.marketId)?.symbol ?? "?"}
                      </div>
                      <div>
                        <div className="text-sm font-medium text-noir-white">
                          {marketById(o.marketId)?.symbol}/USD
                          <span className="text-noir-mute font-normal ml-1.5">#{o.id.toString()}</span>
                        </div>
                        <Badge tone={o.isLong ? "green" : "red"} className="mt-0.5">
                          {o.isLong ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                          {o.isLong ? "Long" : "Short"}
                        </Badge>
                      </div>
                    </div>

                    <Button
                      variant="danger"
                      size="sm"
                      leadingIcon={<X size={12} />}
                      onClick={() => onCancel(o.id)}
                    >
                      Cancel
                    </Button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs pt-3 border-t border-noir-line">
                    <OrderField
                      label="Size"
                      value={
                        <EncryptedValue
                          handle={o.sizeHandle}
                          contractAddr={deployment?.contracts.DarkpoolEngine}
                          compact
                        />
                      }
                    />
                    <OrderField
                      label="Collateral"
                      value={
                        <EncryptedValue
                          handle={o.collateralHandle}
                          contractAddr={deployment?.contracts.DarkpoolEngine}
                          compact
                        />
                      }
                    />
                    <OrderField
                      label="Limit"
                      value={
                        <EncryptedValue
                          handle={o.limitPriceHandle}
                          contractAddr={deployment?.contracts.DarkpoolEngine}
                          compact
                        />
                      }
                    />
                  </div>
                </Card>
              ))}
            </div>
          )}

          <div className="flex items-start gap-2 text-[11px] text-noir-dim bg-noir-panel border border-noir-line rounded-lg p-3">
            <Info size={12} className="shrink-0 mt-0.5 text-noir-accent2" />
            <span>
              <span className="text-noir-white font-medium">Batch matching.</span>{" "}
              The matcher consumes encrypted orders, runs the cross-check
              under FHE, and emits filled positions. Other addresses can
              see your row exists but cannot read its contents.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Helpers -------------------------------------------------------

function OrderField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-noir-mute mb-1">
        {label}
      </div>
      <div>{value}</div>
    </div>
  );
}

function EncryptedRow({ label, plaintext }: { label: string; plaintext?: boolean }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-noir-dim">{label}</span>
      {plaintext ? (
        <span className="inline-flex items-center gap-1 text-noir-mute">
          plaintext
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-noir-accent2">
          <Lock size={9} /> ciphertext
        </span>
      )}
    </div>
  );
}
