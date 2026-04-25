import { useAccount } from "wagmi";
import { useComplianceProof, useComplianceHealth } from "../hooks/useCompliance";
import { WalletGate } from "../components/WalletGate";
import { shortAddr } from "../lib/format";

export default function Compliance() {
  return <WalletGate><Inner /></WalletGate>;
}

function Inner() {
  const { address } = useAccount();
  const { data: proof, isLoading, error } = useComplianceProof();
  const { data: health } = useComplianceHealth();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold mb-2">Compliance</h1>
        <p className="text-noir-mute">KYC allowlist status for the connected address.</p>
      </div>

      <Section label="Connected address">
        <code className="font-mono text-noir-white">{address}</code>
      </Section>

      <Section label="Allowlist status">
        {isLoading && <span className="text-noir-mute">checking…</span>}
        {error && <span className="text-noir-red">backend unreachable: {(error as Error).message}</span>}
        {proof && (
          <div className="flex items-center gap-3">
            {proof.allowlisted ? (
              <span className="px-2 py-1 rounded bg-noir-green/20 text-noir-green text-sm">Allowlisted</span>
            ) : (
              <span className="px-2 py-1 rounded bg-noir-red/20 text-noir-red text-sm">Not allowlisted</span>
            )}
            {proof.allowlisted ? (
              <span className="text-noir-mute text-sm">Proof has {proof.proof.length} sibling(s).</span>
            ) : (
              <a href="mailto:compliance@noirperp.example" className="text-sm text-noir-accent underline">Request access</a>
            )}
          </div>
        )}
      </Section>

      {proof?.allowlisted && (
        <Section label="Proof (use as `complianceProof` in tx)">
          <pre className="bg-noir-gray border border-noir-line rounded p-3 text-xs font-mono overflow-x-auto">
{JSON.stringify(proof.proof, null, 2)}
          </pre>
        </Section>
      )}

      {/* TODO(Phase 9): per spec §6 error-handling table, warn user if compliance
          merkleRoot is older than 7 days. Requires either: (a) extending the
          compliance-backend /health response to include rootUpdatedAt, OR
          (b) adding a useReadContract hook that reads Compliance.rootUpdatedAt()
          directly from chain. Deferred — not blocking Phase 8 acceptance. */}
      <Section label="Backend health">
        {health && (
          <div className="text-sm text-noir-mute">
            root: <code className="text-noir-white">{shortAddr(health.root)}</code> · entries: {health.count}
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-noir-mute mb-2">{label}</div>
      <div className="bg-noir-gray border border-noir-line rounded p-4">{children}</div>
    </div>
  );
}
