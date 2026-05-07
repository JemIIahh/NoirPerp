import { useAccount } from "wagmi";
import { useState } from "react";
import {
  ShieldCheck, ShieldX, Mail, Copy, CheckCircle2, AlertCircle,
  Activity, GitBranch, Hash, Info, Sparkles, Loader2,
} from "lucide-react";
import clsx from "clsx";
import { useComplianceProof, useComplianceHealth, useSelfServeAdd } from "../hooks/useCompliance";
import { WalletGate } from "../components/WalletGate";
import { Card, SectionHeader, Badge, Spinner, StatStripCell } from "../components/ui";
import { Button } from "../components/Form";
import { shortAddr } from "../lib/format";

export default function Compliance() {
  return <WalletGate><Inner /></WalletGate>;
}

function Inner() {
  const { address } = useAccount();
  const { data: proof, isLoading, error } = useComplianceProof();
  const { data: health } = useComplianceHealth();
  const selfServe = useSelfServeAdd();

  const allowlisted = proof?.allowlisted ?? false;
  const selfServeEnabled = health?.selfServe === true;

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow={<><ShieldCheck size={10} /> Compliance</>}
        title={<>KYC <span className="shimmer-text">merkle</span> allowlist</>}
        description="The compliance backend issues a merkle proof for your address. Trades include the proof so on-chain engines verify you without learning the rest of the allowlist."
      />

      {/* ---------- Status hero ---------------------------------------- */}
      <Card hero className="p-8 relative overflow-hidden animate-fade-up">
        <div
          aria-hidden
          className={clsx(
            "absolute -inset-x-32 -top-40 h-80 opacity-70 pointer-events-none",
            allowlisted ? "bg-[radial-gradient(ellipse_at_top,rgba(94,234,212,0.18),transparent_60%)]"
                        : isLoading
                          ? "bg-[radial-gradient(ellipse_at_top,rgba(243,237,224,0.06),transparent_60%)]"
                          : "bg-[radial-gradient(ellipse_at_top,rgba(255,92,92,0.15),transparent_60%)]",
          )}
        />
        <div aria-hidden className="absolute inset-0 bg-grid-dots opacity-[0.18] pointer-events-none [mask-image:radial-gradient(ellipse_at_center,black,transparent_80%)]" />

        <div className="relative flex items-center justify-between gap-6 flex-wrap">
          <div className="flex items-center gap-5">
            <div className="relative">
              {allowlisted && <div className="absolute inset-0 rounded-2xl conic-ring opacity-50" />}
              <div className={clsx(
                "relative h-16 w-16 rounded-2xl backdrop-blur-md border flex items-center justify-center m-[2px]",
                allowlisted ? "bg-noir-accent/[0.12] border-noir-accent/35"
                            : "bg-noir-red/[0.10] border-noir-red/35",
              )}>
                {allowlisted
                  ? <ShieldCheck size={28} className="text-noir-accent" strokeWidth={1.6} />
                  : <ShieldX size={28} className="text-noir-red" strokeWidth={1.6} />}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-medium uppercase tracking-[0.22em] text-noir-cream/40 mb-2">
                Status
              </div>
              {isLoading && (
                <div className="inline-flex items-center gap-2 text-noir-cream/60">
                  <Spinner /> checking…
                </div>
              )}
              {error && (
                <div className="inline-flex items-center gap-2 text-noir-red text-sm">
                  <AlertCircle size={14} /> backend unreachable
                </div>
              )}
              {proof && (
                <>
                  <div className="font-display text-[30px] md:text-[34px] font-medium text-noir-cream tracking-[-0.02em] leading-tight">
                    {allowlisted ? "Allowlisted" : "Not allowlisted"}
                  </div>
                  <div className="text-[13px] text-noir-cream/55 mt-2 leading-relaxed">
                    {allowlisted
                      ? <>Your address is approved. {proof.proof.length} merkle sibling{proof.proof.length === 1 ? "" : "s"} returned.</>
                      : <>This address is not on the current allowlist. Request access to begin trading.</>}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="flex flex-col items-end gap-2">
            {allowlisted ? (
              <Badge tone="mint" icon={<CheckCircle2 size={11} />}>verified</Badge>
            ) : !isLoading && (
              <>
                {selfServeEnabled ? (
                  <button
                    onClick={() => selfServe.mutate()}
                    disabled={selfServe.isPending || !address}
                    className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-noir-cream text-noir-black text-[13px] font-semibold tracking-tight hover:bg-noir-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {selfServe.isPending
                      ? <><Loader2 size={14} className="animate-spin" /> Enrolling…</>
                      : <><Sparkles size={14} /> Get verified (testnet)</>}
                  </button>
                ) : (
                  <a
                    href="mailto:compliance@noirperp.example?subject=NoirPerp%20allowlist%20access"
                    className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-noir-cream text-noir-black text-[13px] font-semibold tracking-tight hover:bg-noir-accent transition-colors"
                  >
                    <Mail size={14} />
                    Request access
                  </a>
                )}
                {selfServe.isError && (
                  <div className="text-[11px] text-rose-300 max-w-[260px] text-right">
                    {(selfServe.error as Error).message}
                  </div>
                )}
                {selfServeEnabled && (
                  <div className="text-[10px] text-noir-cream/40 max-w-[260px] text-right leading-snug">
                    Testnet only. Adds your address to the Merkle tree
                    instantly. Mainnet would gate this behind a real KYC
                    provider — same on-chain mechanism.
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </Card>

      {/* ---------- Connected address + metrics — console strip ------ */}
      <div
        className="console rounded-md overflow-hidden grid grid-cols-1 lg:grid-cols-[1.4fr_1fr_1fr] divide-y lg:divide-y-0 lg:divide-x divide-noir-cream/[0.06] animate-fade-up [animation-delay:60ms]"
      >
        <div className="p-5 min-w-0">
          <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-noir-cream/45 mb-3">
            Connected address
          </div>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <code className="font-mono text-[13px] text-noir-cream break-all">{address}</code>
            {address && <CopyButton text={address} label="Copy" />}
          </div>
        </div>

        <StatStripCell
          label="Merkle root"
          accent="neutral"
          icon={<Hash size={13} />}
          value={health ? <span className="font-mono text-[18px]">{shortAddr(health.root)}</span> : undefined}
          hint="Committed on-chain via Compliance.updateRoot"
        />
        <StatStripCell
          label="Allowlist size"
          accent="mint"
          icon={<Activity size={13} />}
          value={health ? Number(health.count).toLocaleString() : undefined}
          hint="Approved addresses in current root"
        />
      </div>

      {/* ---------- Proof JSON — console block, schematic frame ------- */}
      {allowlisted && proof && (
        <div className="console rounded-md overflow-hidden animate-fade-up [animation-delay:80ms]">
          <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-noir-cream/[0.08]">
            <div className="flex items-center gap-3.5">
              <div className="h-10 w-10 rounded-md bg-noir-accent/[0.08] border border-noir-accent/30 flex items-center justify-center">
                <GitBranch size={15} className="text-noir-accent" />
              </div>
              <div>
                <div className="text-[14px] font-medium text-noir-cream font-display tracking-tight">Merkle proof</div>
                <div className="text-[11px] text-noir-cream/50 mt-0.5">
                  Pass as <code className="font-mono text-noir-accent">complianceProof</code> to PerpEngine.openPosition / DarkpoolEngine.submitOrder
                </div>
              </div>
            </div>
            <CopyButton text={JSON.stringify(proof.proof, null, 2)} label="Copy JSON" />
          </div>
          <pre className="px-6 py-5 text-[12px] font-mono text-noir-cream/70 leading-relaxed overflow-x-auto bg-black/40">
{JSON.stringify(proof.proof, null, 2)}
          </pre>
        </div>
      )}

      <div className="flex items-start gap-2.5 text-[11px] text-noir-cream/45 rounded-xl p-3.5 border border-white/[0.05] bg-white/[0.02] backdrop-blur-md">
        <Info size={12} className="shrink-0 mt-0.5 text-noir-accent" />
        <span className="leading-relaxed">
          <span className="text-noir-cream/80 font-medium">How verification works.</span>{" "}
          The backend signs a proof that your address sits in the merkle tree.
          On-chain engines verify the proof against the committed root — they
          learn you're approved, but learn nothing else about who else is.
        </span>
      </div>
    </div>
  );
}

// ---------- Copy button helper ------------------------------------------

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch { /* no-op */ }
      }}
      leadingIcon={copied
        ? <CheckCircle2 size={12} className="text-noir-accent" />
        : <Copy size={12} />}
    >
      {copied ? "Copied" : label}
    </Button>
  );
}
