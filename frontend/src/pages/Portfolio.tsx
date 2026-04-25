import { useAccount, useReadContract } from "wagmi";
import { parseAbi } from "viem";
import {
  Wallet, Database, Droplets, TrendingUp, TrendingDown,
  CircleDot, Copy, CheckCircle2,
} from "lucide-react";
import { useState } from "react";
import { WalletGate } from "../components/WalletGate";
import { EncryptedValue } from "../components/EncryptedValue";
import { Card, Stat, SectionHeader, Badge, EmptyState } from "../components/ui";
import { useDeployment } from "../hooks/useDeployment";
import { useVaultBalance } from "../hooks/useEncryptedBalance";
import { usePositions } from "../hooks/usePositions";
import { ERC7984_ABI, AMM_ABI } from "../lib/abis";
import { marketById } from "../lib/markets";
import { shortAddr } from "../lib/format";

export default function Portfolio() { return <WalletGate><Inner /></WalletGate>; }

function Inner() {
  const { address } = useAccount();
  const { data: deployment } = useDeployment();
  const { data: vaultBalanceHandle } = useVaultBalance(address);
  const positions = usePositions(address);

  const { data: tokenBalance } = useReadContract({
    address: deployment?.contracts.MockERC7984, abi: parseAbi(ERC7984_ABI),
    functionName: "balanceOf", args: address ? [address] : undefined,
    query: { enabled: !!address && !!deployment },
  });
  const { data: lpShares } = useReadContract({
    address: deployment?.contracts.AMMEngine, abi: parseAbi(AMM_ABI),
    functionName: "userShares", args: address ? [address] : undefined,
    query: { enabled: !!address && !!deployment },
  });

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Portfolio"
        title="Your encrypted state"
        description="Balances and positions tied to your wallet. Encrypted values are only readable by you — click reveal to decrypt locally via the Zama relayer SDK."
        action={address && <AddressBadge address={address} />}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Wallet token (ciphertext handle from ERC-7984) */}
        <Card className="p-5">
          <div className="flex items-start justify-between gap-3 mb-3">
            <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-noir-mute">
              Wallet · USDCx
            </span>
            <Wallet size={14} className="text-noir-accent2 opacity-70" />
          </div>
          <div className="text-2xl font-semibold font-mono leading-none">
            <EncryptedValue
              handle={tokenBalance as `0x${string}` | undefined}
              contractAddr={deployment?.contracts.MockERC7984}
            />
          </div>
          <div className="mt-2 text-xs text-noir-dim">ERC-7984 confidential token</div>
        </Card>

        {/* Vault balance */}
        <Card className="p-5">
          <div className="flex items-start justify-between gap-3 mb-3">
            <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-noir-mute">
              Vault balance
            </span>
            <Database size={14} className="text-noir-accent2 opacity-70" />
          </div>
          <div className="text-2xl font-semibold font-mono leading-none">
            <EncryptedValue
              handle={vaultBalanceHandle as `0x${string}` | undefined}
              contractAddr={deployment?.contracts.NoirVault}
            />
          </div>
          <div className="mt-2 text-xs text-noir-dim">Held by NoirVault · encrypted</div>
        </Card>

        {/* AMM shares */}
        <Card className="p-5">
          <div className="flex items-start justify-between gap-3 mb-3">
            <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-noir-mute">
              AMM shares
            </span>
            <Droplets size={14} className="text-noir-accent2 opacity-70" />
          </div>
          <div className="text-2xl font-semibold font-mono leading-none">
            <EncryptedValue
              handle={lpShares as `0x${string}` | undefined}
              contractAddr={deployment?.contracts.AMMEngine}
            />
          </div>
          <div className="mt-2 text-xs text-noir-dim">Your LP position · encrypted</div>
        </Card>
      </div>

      <div>
        <div className="flex items-end justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-noir-white">Open positions</h2>
            <p className="text-xs text-noir-dim mt-0.5">
              {positions.length} active{positions.length !== 1 && ""}
            </p>
          </div>
        </div>

        {positions.length === 0 ? (
          <EmptyState
            icon={<CircleDot size={20} />}
            title="No open positions"
            description="Open a perp on the Trade page or submit a dark order. Filled positions show up here with encrypted size, entry, and collateral."
          />
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-[0.12em] text-noir-mute border-b border-noir-line">
                    <th className="text-left py-3 pl-5 pr-3 font-medium">#</th>
                    <th className="text-left py-3 px-3 font-medium">Market</th>
                    <th className="text-left py-3 px-3 font-medium">Side</th>
                    <th className="text-left py-3 px-3 font-medium">Size</th>
                    <th className="text-left py-3 px-3 font-medium">Entry price</th>
                    <th className="text-left py-3 px-3 pr-5 font-medium">Collateral</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((p, idx) => (
                    <tr
                      key={p.id.toString()}
                      className={`group border-b border-noir-line/60 hover:bg-noir-raised/40 transition-colors ${idx === positions.length - 1 ? "border-b-0" : ""}`}
                    >
                      <td className="py-3 pl-5 pr-3 font-mono text-noir-dim">
                        {p.id.toString()}
                      </td>
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-2">
                          <div className="h-7 w-7 rounded-md bg-noir-raised border border-noir-edge flex items-center justify-center text-[10px] font-semibold text-noir-white">
                            {marketById(p.marketId)?.symbol ?? "?"}
                          </div>
                          <span className="text-noir-white font-medium">
                            {marketById(p.marketId)?.symbol ?? p.marketId}/USD
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <Badge tone={p.isLong ? "green" : "red"}>
                          {p.isLong ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                          {p.isLong ? "Long" : "Short"}
                        </Badge>
                      </td>
                      <td className="py-3 px-3">
                        <EncryptedValue
                          handle={p.sizeHandle}
                          contractAddr={deployment?.contracts.NoirVault}
                          compact
                        />
                      </td>
                      <td className="py-3 px-3">
                        <EncryptedValue
                          handle={p.entryPriceHandle}
                          contractAddr={deployment?.contracts.NoirVault}
                          compact
                        />
                      </td>
                      <td className="py-3 px-3 pr-5">
                        <EncryptedValue
                          handle={p.collateralHandle}
                          contractAddr={deployment?.contracts.NoirVault}
                          compact
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

// ---------- Address chip with copy --------------------------------------

function AddressBadge({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(address);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch { /* clipboard not available — silently no-op */ }
      }}
      className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-noir-raised border border-noir-edge hover:border-noir-accent/40 transition-colors text-xs font-mono text-noir-white"
      title="Copy address"
    >
      <span className="h-2 w-2 rounded-full bg-noir-green animate-pulse-soft" />
      {shortAddr(address)}
      {copied
        ? <CheckCircle2 size={12} className="text-noir-green" />
        : <Copy size={12} className="text-noir-mute" />}
    </button>
  );
}
