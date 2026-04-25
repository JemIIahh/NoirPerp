import { useAccount } from "wagmi";
import { useState } from "react";
import {
  ShieldCheck, ShieldX, Mail, Copy, CheckCircle2, AlertCircle,
  Activity, GitBranch, Hash, Info,
} from "lucide-react";
import clsx from "clsx";
import { useComplianceProof, useComplianceHealth } from "../hooks/useCompliance";
import { WalletGate } from "../components/WalletGate";
import { Card, SectionHeader, Badge, Spinner } from "../components/ui";
import { Button } from "../components/Form";
import { shortAddr } from "../lib/format";

export default function Compliance() {
  return <WalletGate><Inner /></WalletGate>;
}

function Inner() {
  const { address } = useAccount();
  const { data: proof, isLoading, error } = useComplianceProof();
  const { data: health } = useComplianceHealth();

  const allowlisted = proof?.allowlisted ?? false;

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck size={11} /> Compliance
          </span>
        }
        title="KYC merkle allowlist"
        description="The compliance backend issues a merkle proof for your address. Your trades include that proof so on-chain engines can verify you without learning the rest of the allowlist."
      />

      {/* ---------- Status hero ---------------------------------------- */}
      <Card className="p-7 relative overflow-hidden">
        <div
          aria-hidden
          className={clsx(
            "absolute -inset-x-20 -top-32 h-64 opacity-50 pointer-events-none",
            allowlisted ? "bg-[radial-gradient(ellipse_at_top,rgba(61,220,132,0.18),transparent_60%)]"
                        : isLoading
                          ? "bg-noir-radial"
                          : "bg-[radial-gradient(ellipse_at_top,rgba(255,92,92,0.15),transparent_60%)]",
          )}
        />
        <div className="relative flex items-center justify-between gap-6 flex-wrap">
          <div className="flex items-center gap-5">
            <div className={clsx(
              "h-14 w-14 rounded-xl border flex items-center justify-center shrink-0",
              allowlisted ? "bg-noir-green/15 border-noir-green/40"
                          : "bg-noir-red/10 border-noir-red/40",
            )}>
              {allowlisted
                ? <ShieldCheck size={26} className="text-noir-green" />
                : <ShieldX size={26} className="text-noir-red" />}
            </div>
            <div>
              <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-noir-mute mb-1">
                Status
              </div>
              {isLoading && (
                <div className="inline-flex items-center gap-2 text-noir-dim">
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
                  <div className="text-2xl font-semibold text-noir-white">
                    {allowlisted ? "Allowlisted" : "Not allowlisted"}
                  </div>
                  <div className="text-sm text-noir-dim mt-1">
                    {allowlisted
                      ? <>Your address is approved. {proof.proof.length} merkle sibling{proof.proof.length === 1 ? "" : "s"} returned.</>
                      : <>This address is not on the current allowlist. Request access to begin trading.</>}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {allowlisted ? (
              <Badge tone="green" icon={<CheckCircle2 size={11} />}>verified</Badge>
            ) : !isLoading && (
              <a
                href="mailto:compliance@noirperp.example?subject=NoirPerp%20allowlist%20access"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-noir-accent text-white text-sm font-semibold border border-noir-accent2/40 shadow-glow-violet hover:bg-noir-violet transition-all"
              >
                <Mail size={14} />
                Request access
              </a>
            )}
          </div>
        </div>
      </Card>

      {/* ---------- Connected address --------------------------------- */}
      <Card className="p-5">
        <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-noir-mute mb-3">
          Connected address
        </div>
        <div className="flex items-center justify-between gap-4">
          <code className="font-mono text-sm text-noir-white break-all">{address}</code>
          {address && <CopyButton text={address} label="Copy" />}
        </div>
      </Card>

      {/* ---------- Proof JSON ---------------------------------------- */}
      {allowlisted && proof && (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-noir-line">
            <div className="flex items-center gap-2.5">
              <GitBranch size={14} className="text-noir-accent2" />
              <div>
                <div className="text-sm font-medium text-noir-white">Merkle proof</div>
                <div className="text-[11px] text-noir-dim">
                  Pass as <code className="font-mono text-noir-accent2">complianceProof</code> to PerpEngine.openPosition / DarkpoolEngine.submitOrder
                </div>
              </div>
            </div>
            <CopyButton text={JSON.stringify(proof.proof, null, 2)} label="Copy JSON" />
          </div>
          <pre className="px-5 py-4 text-xs font-mono text-noir-dim leading-relaxed overflow-x-auto bg-noir-black">
{JSON.stringify(proof.proof, null, 2)}
          </pre>
        </Card>
      )}

      {/* ---------- Backend health ------------------------------------ */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card className="p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-noir-mute">
              Merkle root
            </span>
            <Hash size={12} className="text-noir-mute" />
          </div>
          {health ? (
            <div className="space-y-2">
              <div className="font-mono text-sm text-noir-white truncate">
                {shortAddr(health.root)}
              </div>
              <div className="text-[11px] text-noir-dim">
                Committed on-chain via Compliance.updateRoot
              </div>
            </div>
          ) : (
            <div className="text-noir-mute text-sm">—</div>
          )}
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-noir-mute">
              Allowlist size
            </span>
            <Activity size={12} className="text-noir-green" />
          </div>
          {health ? (
            <div className="space-y-2">
              <div className="font-mono text-2xl font-semibold text-noir-white tabular-nums">
                {Number(health.count).toLocaleString()}
              </div>
              <div className="text-[11px] text-noir-dim">
                Approved addresses in current root
              </div>
            </div>
          ) : (
            <div className="text-noir-mute text-sm">—</div>
          )}
        </Card>
      </div>

      {/* TODO(Phase 9): per spec §6 error-handling table, warn user if compliance
          merkleRoot is older than 7 days. Requires either: (a) extending the
          compliance-backend /health response to include rootUpdatedAt, OR
          (b) adding a useReadContract hook that reads Compliance.rootUpdatedAt()
          directly from chain. Deferred — not blocking Phase 8 acceptance. */}

      <div className="flex items-start gap-2 text-[11px] text-noir-dim bg-noir-panel border border-noir-line rounded-lg p-3">
        <Info size={12} className="shrink-0 mt-0.5 text-noir-accent2" />
        <span>
          <span className="text-noir-white font-medium">How verification works.</span>{" "}
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
        ? <CheckCircle2 size={12} className="text-noir-green" />
        : <Copy size={12} />}
    >
      {copied ? "Copied" : label}
    </Button>
  );
}
