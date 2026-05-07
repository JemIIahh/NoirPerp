import { useState } from "react";
import { useAccount, useWriteContract } from "wagmi";
import clsx from "clsx";
import {
  EyeOff, Lock, TrendingUp, TrendingDown, AlertCircle,
  Info, X, ChevronRight, Fingerprint,
} from "lucide-react";
import { WalletGate } from "../components/WalletGate";
import { Field, Input, Select, Button } from "../components/Form";
import { Card, Badge, SectionHeader, EmptyState, TogglePills } from "../components/ui";
import { EncryptedValue } from "../components/EncryptedValue";
import { useDeployment } from "../hooks/useDeployment";
import { useEncryptInput } from "../hooks/useEncrypt";
import { useComplianceProof } from "../hooks/useCompliance";
import { useDarkOrders } from "../hooks/useDarkOrders";
import { TRADEABLE_MARKETS, marketById } from "../lib/markets";
import { DARK_ABI } from "../lib/abis";

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
  // Phase 11 — pair-match opt-in. Default ON: P2P matching is the
  // recommended flow (better fills, true peer-to-peer pairing). Users can
  // toggle off to use the legacy batch-vs-pool path.
  const [pairMatch, setPairMatch] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const market = marketById(marketId);

  // Phase 11 — when pair-match is on, the engine takes (size, collateralPerUnit)
  // instead of (size, collateral). Compute the per-unit value off-chain so the
  // engine never needs the banned ct/ct division. Integer division silently
  // drops the remainder; we surface the resulting effective lock as a hint.
  const sizeNum = Number(size);
  const collNum = Number(collateral);
  const cpuPreview = (pairMatch && sizeNum > 0 && collNum > 0)
    ? Math.floor(collNum / sizeNum)
    : 0;
  const effectiveLock = cpuPreview * sizeNum;
  const lockMismatch = pairMatch && collNum > 0 && sizeNum > 0 && effectiveLock !== collNum;

  async function onSubmit() {
    setError(null);
    if (!proof?.allowlisted) { setError("Address not allowlisted"); return; }
    if (!deployment) return;
    try {
      if (pairMatch) {
        // Pair-eligible path: encrypt (size, collateralPerUnit, limitPrice).
        // collateralPerUnit = total / size, integer division. Total escrow
        // locked by the engine is exactly cpu × size = effectiveLock.
        const sz = BigInt(size);
        const cpu = BigInt(collateral) / sz;
        const enc = await encrypt(sz, cpu, BigInt(limitPrice));
        const inputs = {
          eSize: enc.handles[0],                  sizeProof: enc.inputProof,
          eCollateralPerUnit: enc.handles[1],     collateralPerUnitProof: enc.inputProof,
          eLimitPrice: enc.handles[2],            limitProof: enc.inputProof,
        };
        await writeContractAsync({
          address: deployment.contracts.DarkpoolEngine, abi: DARK,
          functionName: "submitOrderForPairMatch",
          args: [inputs, marketId, isLong, proof.proof],
        });
      } else {
        // Legacy batch-vs-pool path: encrypt (size, collateral, limitPrice).
        const enc = await encrypt(BigInt(size), BigInt(collateral), BigInt(limitPrice));
        const inputs = {
          eSize: enc.handles[0],       sizeProof: enc.inputProof,
          eCollateral: enc.handles[1], collateralProof: enc.inputProof,
          eLimitPrice: enc.handles[2], limitProof: enc.inputProof,
        };
        await writeContractAsync({
          address: deployment.contracts.DarkpoolEngine, abi: DARK,
          functionName: "submitOrder", args: [inputs, marketId, isLong, proof.proof],
        });
      }
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
    <div className="space-y-8">
      <SectionHeader
        eyebrow={<><EyeOff size={10} /> Darkpool</>}
        title={<>Submit a <span className="shimmer-text">dark</span> limit order</>}
        description="Size, collateral, and limit price are all encrypted on submit. Orders match in-batch — front-running has nothing to read."
      />

      {/* ============ Hero strip — 3 stats showing privacy posture ============ */}
      <Card hero className="p-6 relative overflow-hidden animate-fade-up">
        <div aria-hidden className="absolute -top-32 -left-32 w-[420px] h-[420px] rounded-full bg-noir-cream/[0.05] blur-3xl pointer-events-none" />
        <div aria-hidden className="absolute -bottom-32 -right-24 w-96 h-96 rounded-full bg-noir-cream/[0.03] blur-3xl pointer-events-none" />
        <div aria-hidden className="absolute inset-0 bg-grid-dots opacity-[0.18] pointer-events-none [mask-image:radial-gradient(ellipse_at_center,black,transparent_80%)]" />

        <div className="relative grid grid-cols-1 sm:grid-cols-3 gap-6 sm:gap-3">
          <PrivacyStat
            value="3"
            label="Encrypted fields"
            sub="size · collateral · limit"
            icon={<Fingerprint size={14} />}
            accent="mint"
          />
          <PrivacyStat
            value={String(orders.length)}
            label="Your active orders"
            sub="visible row · unreadable contents"
            icon={<EyeOff size={14} />}
            accent="neutral"
          />
          <PrivacyStat
            value="batch"
            label="Match cadence"
            sub="cross-checked under FHE"
            icon={<Lock size={14} />}
            accent="mint"
          />
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-[480px_1fr] gap-6">
        {/* ---------- Left: encrypted submit form ------------------------- */}
        <div className="space-y-4 animate-fade-up [animation-delay:80ms]">
          <Card hero className="p-6 space-y-5 relative overflow-hidden">
            <div
              aria-hidden
              className="absolute inset-0 bg-grid-dots opacity-25 pointer-events-none [mask-image:linear-gradient(to_bottom,black_20%,transparent_85%)]"
            />
            <div
              aria-hidden
              className="absolute -top-32 -right-24 w-72 h-72 rounded-full bg-noir-cream/[0.04] blur-3xl pointer-events-none"
            />
            <div className="relative space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-display text-[16px] font-medium text-noir-cream tracking-tight">Dark order</div>
                  <div className="text-[11px] text-noir-cream/45 mt-0.5">3 fields encrypted before submission</div>
                </div>
                <Badge tone="encrypted" icon={<Fingerprint size={10} />}>
                  3 encrypted
                </Badge>
              </div>

              <TogglePills
                value={isLong ? "long" : "short"}
                onChange={(v) => setIsLong(v === "long")}
                options={[
                  { value: "long",  label: "Long",  icon: <TrendingUp size={14} />,   tone: "green" },
                  { value: "short", label: "Short", icon: <TrendingDown size={14} />, tone: "red" },
                ]}
              />

              <TogglePills
                value={pairMatch ? "p2p" : "pool"}
                onChange={(v) => setPairMatch(v === "p2p")}
                options={[
                  { value: "p2p",  label: "P2P pair-match", tone: "green" },
                  { value: "pool", label: "Batch vs pool",  tone: "neutral" },
                ]}
              />

              <Field label="Market">
                <Select value={marketId} onChange={(e) => setMarketId(Number(e.target.value))}>
                  {TRADEABLE_MARKETS.map((m) => (
                    <option key={m.id} value={m.id}>{m.symbol} / USD</option>
                  ))}
                </Select>
              </Field>

              <Field label="Size" trailing={<EncryptedTag />}>
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
                trailing={<EncryptedTag />}
                hint={
                  pairMatch && cpuPreview > 0
                    ? lockMismatch
                      ? <>P2P locks <span className="text-noir-cream/80">{cpuPreview} × {sizeNum} = {effectiveLock} USDCx</span> (rounded down). Make collateral a multiple of size to avoid the {collNum - effectiveLock} USDCx remainder.</>
                      : <>P2P locks {cpuPreview} USDCx per unit · {effectiveLock} USDCx total</>
                    : undefined
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
                trailing={<EncryptedTag />}
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
                <div className="flex items-start gap-2 text-[12px] text-noir-amber bg-noir-amber/[0.06] border border-noir-amber/30 rounded-xl p-3 backdrop-blur-md">
                  <AlertCircle size={14} className="shrink-0 mt-0.5" />
                  <span>Wallet not on the compliance allowlist.</span>
                </div>
              )}
              {error && (
                <div className="flex items-start gap-2 text-[12px] text-noir-red bg-noir-red/[0.06] border border-noir-red/30 rounded-xl p-3 backdrop-blur-md">
                  <AlertCircle size={14} className="shrink-0 mt-0.5" />
                  <span className="font-mono break-all">{error}</span>
                </div>
              )}
            </div>
          </Card>

          {/* What gets encrypted — console mode: schematic visibility
              ledger, sharp corners, hairline frame. Reads as a spec
              table, not a marketing card. */}
          <div className="console rounded-md p-5">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-noir-cream/[0.05]">
              <span className="text-[10px] uppercase tracking-[0.22em] text-noir-cream/45 font-medium">
                Field visibility
              </span>
              <span className="text-[10px] text-noir-cream/30 font-mono tracking-wider">on-chain</span>
            </div>
            <div className="space-y-1.5">
              <EncryptedRow label="Order size" />
              <EncryptedRow label="Collateral amount" />
              <EncryptedRow label="Limit price" />
              <EncryptedRow label="Side · long/short" plaintext />
              <EncryptedRow label="Market id" plaintext />
            </div>
          </div>
        </div>

        {/* ---------- Right: active orders -------------------------------- */}
        <div className="space-y-4 animate-fade-up [animation-delay:120ms]">
          <div className="flex items-center justify-between">
            <div className="flex items-baseline gap-2.5">
              <h2 className="font-display text-[18px] font-medium text-noir-cream tracking-tight">Active orders</h2>
              <span className="text-[12px] text-noir-cream/40 font-mono">{orders.length}</span>
            </div>
            <span className="inline-flex items-center gap-1.5 text-[11px] text-noir-cream/45">
              <span className="relative inline-flex w-1.5 h-1.5">
                <span className="absolute inset-0 rounded-full bg-noir-accent pulse-dot" />
                <span className="relative inline-block w-1.5 h-1.5 rounded-full bg-noir-accent" />
              </span>
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
            // Console mode: sharp-cornered tape of orders, hairline-divided
            // rows. Each row reads as a register entry — symbol, side+id,
            // P2P/Pool tag, three encrypted cells, cancel. Other traders
            // see the row exists but not its contents.
            <div className="console rounded-md overflow-hidden">
              {orders.map((o, idx) => (
                <div
                  key={o.id.toString()}
                  className={clsx(
                    "px-5 py-4 flex items-center gap-4 hover:bg-white/[0.02] transition-colors animate-fade-up",
                    idx > 0 && "border-t border-noir-cream/[0.05]",
                  )}
                  style={{ animationDelay: `${idx * 60}ms` } as React.CSSProperties}
                >
                  <div className="h-10 w-10 rounded-md bg-white/[0.03] border border-white/10 flex items-center justify-center text-[10px] font-semibold text-noir-cream/85 font-display shrink-0">
                    {marketById(o.marketId)?.symbol ?? "?"}
                  </div>

                  <div className="min-w-0 w-32 sm:w-36 shrink-0">
                    <div className="text-[13px] font-medium text-noir-cream font-display tracking-tight truncate">
                      {marketById(o.marketId)?.symbol}/USD
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={clsx(
                        "inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.12em] font-medium",
                        o.isLong ? "text-noir-green" : "text-noir-red",
                      )}>
                        {o.isLong ? <TrendingUp size={9} /> : <TrendingDown size={9} />}
                        {o.isLong ? "long" : "short"}
                      </span>
                      <span className="text-[10px] font-mono text-noir-cream/30">#{o.id.toString()}</span>
                    </div>
                    <div className="mt-1.5">
                      <span className={clsx(
                        "inline-flex items-center text-[9px] uppercase tracking-[0.14em] font-medium px-1.5 py-0.5 rounded-sm border",
                        o.pairMatchEligible
                          ? "text-noir-accent border-noir-accent/30 bg-noir-accent/[0.05]"
                          : "text-noir-cream/55 border-noir-cream/15 bg-white/[0.02]",
                      )}>
                        {o.pairMatchEligible ? "P2P" : "Pool"}
                      </span>
                    </div>
                  </div>

                  <div className="flex-1 grid grid-cols-3 gap-4 min-w-0">
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

                  <Button
                    variant="danger"
                    size="sm"
                    leadingIcon={<X size={12} />}
                    onClick={() => onCancel(o.id)}
                    className="shrink-0"
                  >
                    Cancel
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-start gap-2.5 text-[11px] text-noir-cream/45 rounded-xl p-3.5 border border-white/[0.05] bg-white/[0.02] backdrop-blur-md">
            <Info size={12} className="shrink-0 mt-0.5 text-noir-accent" />
            <span className="leading-relaxed">
              <span className="text-noir-cream/80 font-medium">Batch matching.</span>{" "}
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

function PrivacyStat({
  value, label, sub, icon, accent,
}: {
  value: string;
  label: string;
  sub: string;
  icon: React.ReactNode;
  accent: "mint" | "neutral";
}) {
  const accentClass = accent === "mint"
    ? "text-noir-accent border-noir-accent/30 bg-noir-accent/[0.06]"
    : "text-noir-cream border-noir-cream/15 bg-noir-cream/[0.04]";
  return (
    <div className="flex items-start gap-4">
      <div className={`h-11 w-11 rounded-xl border flex items-center justify-center backdrop-blur-md ${accentClass}`}>
        {icon}
      </div>
      <div>
        <div className="font-display text-[28px] font-semibold text-noir-cream tabular-nums leading-none tracking-[-0.02em]">
          {value}
        </div>
        <div className="text-[11px] uppercase tracking-[0.16em] text-noir-cream/45 font-medium mt-2">
          {label}
        </div>
        <div className="text-[11px] text-noir-cream/40 mt-1">{sub}</div>
      </div>
    </div>
  );
}

function EncryptedTag() {
  return (
    <span className="inline-flex items-center gap-1 text-noir-accent font-medium tracking-[0.04em]">
      <Lock size={9} /> encrypted
    </span>
  );
}

function OrderField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.16em] text-noir-cream/40 mb-1.5 font-medium">
        {label}
      </div>
      <div>{value}</div>
    </div>
  );
}

function EncryptedRow({ label, plaintext }: { label: string; plaintext?: boolean }) {
  return (
    <div className="flex items-center justify-between text-xs py-1.5">
      <span className="text-noir-cream/60">{label}</span>
      {plaintext ? (
        <span className="inline-flex items-center gap-1 text-noir-cream/40 font-medium">
          plaintext
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-noir-accent font-medium">
          <Lock size={9} /> ciphertext
        </span>
      )}
    </div>
  );
}
