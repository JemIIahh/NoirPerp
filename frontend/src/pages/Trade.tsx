import { useState } from "react";
import { useAccount, useReadContract, useReadContracts, useWriteContract } from "wagmi";
import { parseAbi } from "viem";
import {
  TrendingUp, TrendingDown, Lock, Activity, Info, AlertCircle,
  CircleDot, ChevronRight,
} from "lucide-react";
import clsx from "clsx";
import { WalletGate } from "../components/WalletGate";
import { Field, Input, Select, Button } from "../components/Form";
import { Card, Badge, SectionHeader, EmptyState } from "../components/ui";
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

  // Live oracle price for the selected market — used in the market header.
  const { data: priceData } = useReadContract({
    address: deployment?.contracts.Oracle,
    abi: ORACLE,
    functionName: "getPrice",
    args: [marketId],
    query: { enabled: !!deployment, refetchInterval: 5_000 },
  });

  // Batch-fetch all three market prices for the ticker strip below the header.
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
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Trade"
        title={<>Open an <span className="text-noir-accent2">encrypted</span> position</>}
        description="Size and collateral are encrypted client-side, then committed on-chain as FHE ciphertexts. Only you can decrypt your own position."
      />

      {/* Market ticker — live oracle prices for all three markets. */}
      <MarketTicker prices={allPrices} selected={marketId} onSelect={setMarketId} />

      <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-6">
        {/* ---------- Left: order form ------------------------------------ */}
        <div className="space-y-4">
          <Card className="p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-noir-white">Order</h2>
              <Badge tone="violet" icon={<Lock size={10} />}>FHE-encrypted</Badge>
            </div>

            {/* Side toggle — pill switch with bigger hit area. */}
            <div className="grid grid-cols-2 gap-2 p-1 rounded-lg bg-noir-black border border-noir-line">
              <button
                type="button"
                onClick={() => setIsLong(true)}
                className={clsx(
                  "flex items-center justify-center gap-1.5 py-2 rounded-md text-sm font-medium transition-all",
                  isLong
                    ? "bg-noir-green/15 text-noir-green border border-noir-green/40 shadow-[0_0_0_1px_rgba(61,220,132,0.2)]"
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
                    ? "bg-noir-red/15 text-noir-red border border-noir-red/40 shadow-[0_0_0_1px_rgba(255,92,92,0.2)]"
                    : "text-noir-mute hover:text-noir-white border border-transparent",
                )}
              >
                <TrendingDown size={14} /> Short
              </button>
            </div>

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
                <span className="inline-flex items-center gap-1">
                  <Lock size={10} className="text-noir-accent2 opacity-70" />
                  Encrypted before leaving your browser.
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
              <div className="flex items-start gap-2 text-xs text-noir-amber bg-noir-amber/5 border border-noir-amber/30 rounded-lg p-3">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <span>
                  Address not on the compliance allowlist.
                  Visit the <a href="/compliance" className="underline hover:text-noir-amber">Compliance page</a> to request access.
                </span>
              </div>
            )}
            {error && (
              <div className="flex items-start gap-2 text-xs text-noir-red bg-noir-red/5 border border-noir-red/30 rounded-lg p-3">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <span className="font-mono break-all">{error}</span>
              </div>
            )}
          </Card>

          {/* Order summary — shows what's about to hit the chain. */}
          <Card className="p-5 space-y-3">
            <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-noir-mute">
              Order summary
            </div>
            <div className="space-y-2 text-sm">
              <Row label="Market" value={market ? `${market.symbol}/USD` : "—"} mono />
              <Row label="Side" value={
                <span className={isLong ? "text-noir-green" : "text-noir-red"}>
                  {isLong ? "Long" : "Short"}
                </span>
              } />
              <Row
                label="Index price"
                value={priceData ? <PriceDisplay price={priceData} /> : "—"}
                mono
              />
              <Row label="Encrypted fields" value="size · collateral" hintMono />
              <Row label="Compliance proof" value={
                proof?.allowlisted
                  ? `${proof.proof.length} sibling${proof.proof.length === 1 ? "" : "s"}`
                  : "—"
              } hintMono />
            </div>
          </Card>
        </div>

        {/* ---------- Right: positions ------------------------------------ */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-noir-white">
              My positions
              <span className="text-noir-mute font-normal ml-2">{positions.length}</span>
            </h2>
            <span className="inline-flex items-center gap-1.5 text-[11px] text-noir-dim">
              <Activity size={11} className="text-noir-green" />
              auto-refresh 15s
            </span>
          </div>

          {positions.length === 0 ? (
            <EmptyState
              icon={<CircleDot size={20} />}
              title="No open positions"
              description="Submit your first encrypted order on the left. Positions appear here as soon as the tx confirms."
            />
          ) : (
            <div className="space-y-3">
              {positions.map((p) => (
                <Card key={p.id.toString()} interactive className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="h-8 w-8 rounded-md bg-noir-raised border border-noir-edge flex items-center justify-center text-[10px] font-semibold text-noir-white">
                          {marketById(p.marketId)?.symbol ?? "?"}
                        </div>
                        <div>
                          <div className="text-sm font-medium text-noir-white">
                            {marketById(p.marketId)?.symbol}/USD
                            <span className="text-noir-mute font-normal ml-1.5">#{p.id.toString()}</span>
                          </div>
                          <Badge tone={p.isLong ? "green" : "red"} className="mt-0.5">
                            {p.isLong ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                            {p.isLong ? "Long" : "Short"}
                          </Badge>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
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

          {/* Local-mode reveal caveat — informational, not blocking. */}
          <div className="flex items-start gap-2 text-[11px] text-noir-dim bg-noir-panel border border-noir-line rounded-lg p-3">
            <Info size={12} className="shrink-0 mt-0.5 text-noir-accent2" />
            <span>
              <span className="text-noir-white font-medium">Local mode:</span>{" "}
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
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
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
              "group flex items-center justify-between p-4 rounded-xl border text-left transition-all duration-150",
              isSelected
                ? "bg-noir-raised border-noir-accent/50 shadow-glow-soft"
                : "bg-noir-panel border-noir-line hover:border-noir-edge hover:bg-noir-raised",
            )}
          >
            <div className="flex items-center gap-3">
              <div className={clsx(
                "h-10 w-10 rounded-lg border flex items-center justify-center text-[11px] font-semibold transition-colors",
                isSelected
                  ? "bg-noir-accent/15 border-noir-accent/40 text-noir-accent2"
                  : "bg-noir-raised border-noir-edge text-noir-white",
              )}>
                {m.symbol}
              </div>
              <div>
                <div className="text-sm font-medium text-noir-white">
                  {m.symbol}-USD
                </div>
                <div className="text-[11px] text-noir-mute">{m.name} perp</div>
              </div>
            </div>
            <div className="text-right">
              {tuple ? (
                <PriceDisplay price={tuple} large />
              ) : (
                <div className="text-sm text-noir-mute font-mono">—</div>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function PriceDisplay({ price, large }: { price: PriceTuple; large?: boolean }) {
  const [p, fresh] = price;
  return (
    <div className="inline-flex flex-col items-end">
      <span className={clsx(
        "font-mono font-semibold tabular-nums text-noir-white",
        large ? "text-base" : "text-sm",
      )}>
        ${Number(p).toLocaleString()}
      </span>
      <span className={clsx(
        "inline-flex items-center gap-1 text-[10px] mt-0.5",
        fresh ? "text-noir-green" : "text-noir-amber",
      )}>
        <span className={clsx(
          "inline-block h-1 w-1 rounded-full",
          fresh ? "bg-noir-green animate-pulse-soft" : "bg-noir-amber",
        )} />
        {fresh ? "live" : "stale"}
      </span>
    </div>
  );
}

// ---------- Helpers -------------------------------------------------------

function Row({ label, value, mono, hintMono }: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  hintMono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-noir-mute text-xs">{label}</span>
      <span className={clsx(
        "text-noir-white",
        mono && "font-mono tabular-nums",
        hintMono && "font-mono text-noir-dim text-xs",
      )}>
        {value}
      </span>
    </div>
  );
}

function PositionField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-noir-mute mb-0.5">
        {label}
      </div>
      <div>{value}</div>
    </div>
  );
}

