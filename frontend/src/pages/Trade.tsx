import { useState } from "react";
import { useAccount, useReadContract, useReadContracts, useWriteContract } from "wagmi";
import { parseAbi } from "viem";
import {
  TrendingUp, TrendingDown, Lock, Activity, Info, AlertCircle,
  CircleDot, ChevronRight, LineChart, ArrowUpRight,
} from "lucide-react";
import clsx from "clsx";
import { WalletGate } from "../components/WalletGate";
import { Field, Input, Select, Button } from "../components/Form";
import { Card, Badge, SectionHeader, EmptyState, TogglePills, KeyValue } from "../components/ui";
import { useDeployment } from "../hooks/useDeployment";
import { useEncryptInput } from "../hooks/useEncrypt";
import { useComplianceProof } from "../hooks/useCompliance";
import { usePositions } from "../hooks/usePositions";
import { EncryptedValue } from "../components/EncryptedValue";
import { MARKETS, marketById } from "../lib/markets";
import { PERP_ABI, ORACLE_ABI } from "../lib/abis";

const PERP = parseAbi(PERP_ABI);
const ORACLE = parseAbi(ORACLE_ABI);

export default function Trade() { return <WalletGate><Inner /></WalletGate>; }

function Inner() {
  const { address } = useAccount();
  const { data: deployment } = useDeployment();
  const { data: proof } = useComplianceProof();
  const positions = usePositions(address);
  const encrypt = useEncryptInput(deployment?.contracts.PerpEngine);
  const { writeContractAsync, isPending } = useWriteContract();

  const [marketId, setMarketId] = useState(2);
  const [isLong, setIsLong] = useState(true);
  const [size, setSize] = useState("");
  const [collateral, setCollateral] = useState("");
  const [error, setError] = useState<string | null>(null);

  const market = marketById(marketId);

  const { data: priceData } = useReadContract({
    address: deployment?.contracts.Oracle,
    abi: ORACLE,
    functionName: "getPrice",
    args: [marketId],
    query: { enabled: !!deployment, refetchInterval: 5_000 },
  });

  const { data: allPrices } = useReadContracts({
    contracts: MARKETS.map((m) => ({
      address: deployment?.contracts.Oracle,
      abi: ORACLE,
      functionName: "getPrice" as const,
      args: [m.id] as const,
    })),
    query: { enabled: !!deployment, refetchInterval: 5_000 },
  });

  async function onSubmit() {
    setError(null);
    if (!proof?.allowlisted) { setError("Address not allowlisted (visit Compliance page)"); return; }
    if (!deployment) return;
    try {
      const enc = await encrypt(BigInt(size), BigInt(collateral));
      await writeContractAsync({
        address: deployment.contracts.PerpEngine, abi: PERP, functionName: "openPosition",
        args: [enc.handles[0], enc.inputProof, enc.handles[1], enc.inputProof, isLong, marketId, proof.proof],
      });
      setSize(""); setCollateral("");
    } catch (e) { setError((e as Error).message); }
  }

  async function onClose(positionId: bigint) {
    setError(null);
    if (!deployment) return;
    try {
      await writeContractAsync({
        address: deployment.contracts.PerpEngine, abi: PERP, functionName: "closePosition",
        args: [positionId],
      });
    } catch (e) { setError((e as Error).message); }
  }

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow={<><LineChart size={10} /> Trade</>}
        title={
          <>Open an{" "}
            <span className="shimmer-text">encrypted</span>{" "}
            position
          </>
        }
        description="Size and collateral are encrypted client-side, then committed on-chain as FHE ciphertexts. Only you can decrypt your own position."
      />

      <FeaturedMarket
        marketId={marketId}
        priceData={priceData as PriceTuple | undefined}
      />

      <MarketTicker prices={allPrices} selected={marketId} onSelect={setMarketId} />

      <div className="grid grid-cols-1 lg:grid-cols-[460px_1fr] gap-6">
        {/* ---------- Left: order form ------------------------------------ */}
        <div className="space-y-4 animate-fade-up">
          <Card hero className="p-6 space-y-5 overflow-hidden">
            <div
              aria-hidden
              className="absolute -top-32 -right-24 w-72 h-72 rounded-full bg-noir-cream/[0.04] blur-3xl pointer-events-none"
            />
            <div className="relative space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-display text-[16px] font-medium text-noir-cream tracking-tight">Order</div>
                  <div className="text-[11px] text-noir-cream/45 mt-0.5">Encrypted submission</div>
                </div>
                <Badge tone="encrypted" icon={<Lock size={10} />}>FHE</Badge>
              </div>

              <TogglePills
                value={isLong ? "long" : "short"}
                onChange={(v) => setIsLong(v === "long")}
                options={[
                  { value: "long",  label: "Long",  icon: <TrendingUp size={14} />,   tone: "green" },
                  { value: "short", label: "Short", icon: <TrendingDown size={14} />, tone: "red" },
                ]}
              />

              <Field label="Market">
                <Select value={marketId} onChange={(e) => setMarketId(Number(e.target.value))}>
                  {MARKETS.map((m) => (
                    <option key={m.id} value={m.id}>{m.symbol} / USD perpetual</option>
                  ))}
                </Select>
              </Field>

              <Field
                label="Size"
                trailing={market && <span>units of {market.symbol}</span>}
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
                trailing={<span>USDCx</span>}
                hint={
                  <span className="inline-flex items-center gap-1.5">
                    <Lock size={10} className="text-noir-accent opacity-80" />
                    Encrypted before leaving your browser
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

              <Button
                onClick={onSubmit}
                loading={isPending}
                disabled={isPending || !proof?.allowlisted || !size || !collateral}
                size="lg"
                className="w-full"
              >
                {isPending ? "Submitting…" : (
                  <>Open {isLong ? "long" : "short"} on {market?.symbol ?? "—"}<ChevronRight size={14} /></>
                )}
              </Button>

              {!proof?.allowlisted && (
                <div className="flex items-start gap-2.5 text-[12px] text-noir-amber bg-noir-amber/[0.06] border border-noir-amber/30 rounded-xl p-3 backdrop-blur-md">
                  <AlertCircle size={14} className="shrink-0 mt-0.5" />
                  <span className="leading-relaxed">
                    Address not on the compliance allowlist.{" "}
                    <a href="/compliance" className="underline decoration-dotted underline-offset-2 hover:text-noir-amber/80">
                      Request access
                    </a>.
                  </span>
                </div>
              )}
              {error && (
                <div className="flex items-start gap-2.5 text-[12px] text-noir-red bg-noir-red/[0.06] border border-noir-red/30 rounded-xl p-3 backdrop-blur-md">
                  <AlertCircle size={14} className="shrink-0 mt-0.5" />
                  <span className="font-mono break-all">{error}</span>
                </div>
              )}
            </div>
          </Card>

          {/* Order summary */}
          <Card className="p-5">
            <div className="flex items-center justify-between mb-3 pb-3 border-b border-white/[0.05]">
              <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-noir-cream/45">
                Order summary
              </span>
              <span className="text-[10px] text-noir-cream/30 font-mono">preview</span>
            </div>
            <div className="space-y-1">
              <KeyValue label="Market" value={market ? `${market.symbol}/USD` : "—"} mono />
              <KeyValue
                label="Side"
                value={
                  <span className={clsx(
                    "inline-flex items-center gap-1",
                    isLong ? "text-noir-green" : "text-noir-red",
                  )}>
                    {isLong ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                    {isLong ? "Long" : "Short"}
                  </span>
                }
              />
              <KeyValue
                label="Index price"
                value={priceData ? <PriceInline price={priceData as PriceTuple} /> : "—"}
                mono
              />
              <KeyValue label="Encrypted" value="size · collateral" hint mono />
              <KeyValue
                label="Compliance"
                value={proof?.allowlisted
                  ? `${proof.proof.length} sibling${proof.proof.length === 1 ? "" : "s"}`
                  : "—"}
                hint mono
              />
            </div>
          </Card>
        </div>

        {/* ---------- Right: positions ------------------------------------ */}
        <div className="space-y-4 animate-fade-up [animation-delay:80ms]">
          <div className="flex items-center justify-between">
            <div className="flex items-baseline gap-2.5">
              <h2 className="font-display text-[18px] font-medium text-noir-cream tracking-tight">Positions</h2>
              <span className="text-[12px] text-noir-cream/40 font-mono">{positions.length}</span>
            </div>
            <span className="inline-flex items-center gap-1.5 text-[11px] text-noir-cream/45">
              <span className="relative inline-flex w-1.5 h-1.5">
                <span className="absolute inset-0 rounded-full bg-noir-accent pulse-dot" />
                <span className="relative inline-block w-1.5 h-1.5 rounded-full bg-noir-accent" />
              </span>
              auto-refresh 15s
            </span>
          </div>

          {positions.length === 0 ? (
            <EmptyState
              icon={<CircleDot size={20} />}
              title="No open positions yet"
              description="Submit your first encrypted order on the left. Positions appear here as soon as the tx confirms."
            />
          ) : (
            <div className="space-y-3">
              {positions.map((p, idx) => (
                <Card
                  key={p.id.toString()}
                  interactive
                  className="p-5 animate-fade-up overflow-hidden"
                  style={{ animationDelay: `${idx * 60}ms` } as React.CSSProperties}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-white/[0.08] to-white/[0.02] border border-white/10 flex items-center justify-center text-[10px] font-semibold text-noir-cream font-display">
                          {marketById(p.marketId)?.symbol ?? "?"}
                        </div>
                        <div>
                          <div className="text-[15px] font-medium text-noir-cream font-display tracking-tight">
                            {marketById(p.marketId)?.symbol}/USD
                            <span className="text-noir-cream/30 font-mono font-normal ml-2 text-[12px]">
                              #{p.id.toString()}
                            </span>
                          </div>
                          <Badge tone={p.isLong ? "green" : "red"} className="mt-1.5">
                            {p.isLong ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                            {p.isLong ? "Long" : "Short"}
                          </Badge>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-xs">
                        <PositionField
                          label="Size"
                          value={
                            <EncryptedValue
                              handle={p.sizeHandle}
                              contractAddr={deployment?.contracts.NoirVault}
                              compact
                            />
                          }
                        />
                        <PositionField
                          label="Collateral"
                          value={
                            <EncryptedValue
                              handle={p.collateralHandle}
                              contractAddr={deployment?.contracts.NoirVault}
                              compact
                            />
                          }
                        />
                      </div>
                    </div>

                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => onClose(p.id)}
                    >
                      Close
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}

          <div className="flex items-start gap-2.5 text-[11px] text-noir-cream/45 rounded-xl p-3.5 border border-white/[0.05] bg-white/[0.02] backdrop-blur-md">
            <Info size={12} className="shrink-0 mt-0.5 text-noir-accent" />
            <span className="leading-relaxed">
              <span className="text-noir-cream/80 font-medium">Local mode.</span>{" "}
              <span className="font-mono">userDecrypt</span> returns 0 against the
              in-process Hardhat mock. The full encrypt → compute → decrypt
              round-trip activates on Sepolia.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Featured market ----------------------------------------------
// Big glassy hero card showing the currently-selected market with its
// price, freshness, and a quick-jump to docs.
function FeaturedMarket({
  marketId, priceData,
}: {
  marketId: number;
  priceData: PriceTuple | undefined;
}) {
  const market = marketById(marketId);
  if (!market) return null;
  const price = priceData ? Number(priceData[0]) : null;
  const fresh = priceData ? priceData[1] : false;

  return (
    <Card hero className="p-7 relative overflow-hidden animate-fade-up [animation-delay:40ms]">
      {/* cream-only halos — landing-page palette is noir + cream first;
          mint is reserved for accent surfaces, never canvas wash */}
      <div aria-hidden className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-noir-cream/[0.05] blur-3xl pointer-events-none" />
      <div aria-hidden className="absolute -bottom-32 -right-24 w-96 h-96 rounded-full bg-noir-cream/[0.03] blur-3xl pointer-events-none" />
      <div aria-hidden className="absolute inset-0 bg-grid-dots opacity-[0.18] pointer-events-none [mask-image:linear-gradient(to_bottom,black,transparent_85%)]" />

      <div className="relative flex items-center justify-between gap-6 flex-wrap">
        <div className="flex items-center gap-5">
          <div className="relative">
            <div className="absolute inset-0 rounded-2xl conic-ring opacity-50" />
            <div className="relative h-16 w-16 rounded-2xl bg-noir-black/80 backdrop-blur-md border border-white/10 flex items-center justify-center text-[13px] font-bold font-display text-noir-cream m-[2px]">
              {market.symbol}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-medium uppercase tracking-[0.22em] text-noir-cream/40 mb-1.5">
              Live market
            </div>
            <div className="font-display text-[28px] md:text-[32px] font-medium text-noir-cream tracking-[-0.02em] leading-none">
              {market.symbol}-USD
            </div>
            <div className="text-[12px] text-noir-cream/50 mt-2">{market.name} perpetual</div>
          </div>
        </div>

        <div className="flex flex-col items-start sm:items-end gap-2">
          <div className="font-mono font-semibold text-[40px] md:text-[48px] tabular-nums text-noir-cream tracking-[-0.03em] leading-none">
            {price !== null ? `$${price.toLocaleString()}` : "—"}
          </div>
          <div className="flex items-center gap-3">
            <span className={clsx(
              "inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.14em] font-medium",
              fresh ? "text-noir-accent" : "text-noir-amber",
            )}>
              <span className={clsx(
                "relative inline-flex w-2 h-2 rounded-full",
                fresh ? "bg-noir-accent" : "bg-noir-amber",
              )}>
                {fresh && <span className="absolute inset-0 rounded-full bg-noir-accent pulse-dot" />}
              </span>
              {fresh ? "Live" : "Stale"}
            </span>
            <span className="text-noir-cream/20">·</span>
            <span className="text-[11px] uppercase tracking-[0.14em] text-noir-cream/40 font-medium">
              Oracle feed
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
}

// ---------- Market ticker -------------------------------------------------

type PriceTuple = readonly [bigint, boolean];

function MarketTicker({
  prices, selected, onSelect,
}: {
  prices: ReadonlyArray<{ status: string; result?: unknown }> | undefined;
  selected: number;
  onSelect: (id: number) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 animate-fade-up [animation-delay:60ms]">
      {MARKETS.map((m, idx) => {
        const r = prices?.[idx];
        const tuple = r?.status === "success" ? (r.result as PriceTuple) : undefined;
        const isSelected = selected === m.id;
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => onSelect(m.id)}
            className={clsx(
              "group relative flex items-center justify-between p-4 rounded-2xl text-left transition-all duration-200 overflow-hidden glass",
              isSelected
                ? "border-noir-accent/40 shadow-[0_0_32px_-8px_rgba(94,234,212,0.4)]"
                : "glass-hover",
            )}
          >
            {isSelected && (
              <div
                aria-hidden
                className="absolute inset-0 bg-gradient-to-br from-noir-accent/[0.08] to-transparent pointer-events-none"
              />
            )}
            <div className="relative flex items-center gap-3">
              <div className={clsx(
                "h-11 w-11 rounded-xl flex items-center justify-center text-[11px] font-semibold font-display border transition-colors",
                isSelected
                  ? "bg-noir-accent/15 border-noir-accent/40 text-noir-accent"
                  : "bg-white/[0.04] border-white/10 text-noir-cream/80",
              )}>
                {m.symbol}
              </div>
              <div>
                <div className="text-[14px] font-medium text-noir-cream font-display tracking-tight">
                  {m.symbol}-USD
                </div>
                <div className="text-[11px] text-noir-cream/40 mt-0.5">{m.name} perp</div>
              </div>
            </div>
            <div className="relative text-right">
              {tuple ? (
                <PriceInline price={tuple} large />
              ) : (
                <div className="text-sm text-noir-cream/30 font-mono">—</div>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function PriceInline({ price, large }: { price: PriceTuple; large?: boolean }) {
  const [p, fresh] = price;
  return (
    <div className="inline-flex flex-col items-end">
      <span className={clsx(
        "font-mono font-semibold tabular-nums text-noir-cream tracking-tight",
        large ? "text-[16px]" : "text-sm",
      )}>
        ${Number(p).toLocaleString()}
      </span>
      <span className={clsx(
        "inline-flex items-center gap-1 text-[10px] mt-1 uppercase tracking-[0.1em] font-medium",
        fresh ? "text-noir-accent" : "text-noir-amber/80",
      )}>
        <span className={clsx(
          "inline-block h-1 w-1 rounded-full",
          fresh ? "bg-noir-accent animate-pulse-soft" : "bg-noir-amber",
        )} />
        {fresh ? "live" : "stale"}
      </span>
    </div>
  );
}

// ---------- Helpers -------------------------------------------------------

function PositionField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.16em] text-noir-cream/40 mb-1.5 font-medium">
        {label}
      </div>
      <div>{value}</div>
    </div>
  );
}
