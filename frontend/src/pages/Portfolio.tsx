import { useAccount, useBalance, useReadContract } from "wagmi";
import { formatEther, parseAbi } from "viem";
import {
  Wallet, Database, Droplets, TrendingUp, TrendingDown,
  CircleDot, Copy, CheckCircle2, ShieldCheck, Fuel,
} from "lucide-react";
import { useState } from "react";
import { WalletGate } from "../components/WalletGate";
import { EncryptedValue } from "../components/EncryptedValue";
import { Card, SectionHeader, Badge, EmptyState, Stat } from "../components/ui";
import { useDeployment } from "../hooks/useDeployment";
import { useVaultBalance } from "../hooks/useEncryptedBalance";
import { usePositions } from "../hooks/usePositions";
import { ERC7984_ABI, AMM_ABI } from "../lib/abis";
import { marketById } from "../lib/markets";
import { shortAddr } from "../lib/format";
import { getUsdcxToken } from "../lib/types";

export default function Portfolio() { return <WalletGate><Inner /></WalletGate>; }

function Inner() {
  const { address } = useAccount();
  const { data: deployment } = useDeployment();
  const { data: vaultBalanceHandle } = useVaultBalance(address);
  const positions = usePositions(address);

  // USDCx address: Sepolia = Zama's cUSDCMock; local = our MockERC7984.
  // Both are ERC-7984 confidential tokens; balanceOf returns a euint64 handle.
  const usdcxAddr = getUsdcxToken(deployment);

  // Native ETH balance (Sepolia / Hardhat ETH for gas) — plaintext, not encrypted.
  const { data: ethBalance } = useBalance({
    address,
    query: { enabled: !!address },
  });

  const { data: tokenBalance } = useReadContract({
    address: usdcxAddr, abi: parseAbi(ERC7984_ABI),
    functionName: "balanceOf", args: address ? [address] : undefined,
    query: { enabled: !!address && !!usdcxAddr },
  });
  const { data: lpShares } = useReadContract({
    address: deployment?.contracts.AMMEngine, abi: parseAbi(AMM_ABI),
    functionName: "userShares", args: address ? [address] : undefined,
    query: { enabled: !!address && !!deployment },
  });

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow={<><Wallet size={10} /> Portfolio</>}
        title={<>Your <span className="shimmer-text">encrypted</span> state</>}
        description="Balances and positions tied to your wallet. Encrypted values are only readable by you — click reveal to decrypt locally via the Zama relayer SDK."
      />

      {/* ============ Identity hero ============ */}
      <IdentityHero address={address} positionCount={positions.length} />

      {/* ============ Balance stats: gas ETH + 3 encrypted ============ */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat
          label="Gas · ETH"
          accent="amber"
          icon={<Fuel size={13} />}
          value={
            ethBalance
              ? <span className="font-mono tabular-nums">
                  {Number(formatEther(ethBalance.value)).toLocaleString(undefined, { maximumFractionDigits: 4 })}
                </span>
              : <span className="text-noir-cream/30">—</span>
          }
          hint={`Native ${deployment?.network === "sepolia" ? "Sepolia ETH" : "Hardhat ETH"} · plaintext`}
        />
        <Stat
          label={`Wallet · ${deployment?.network === "sepolia" ? "cUSDCMock" : "USDCx"}`}
          accent="mint"
          icon={<Wallet size={13} />}
          value={
            <EncryptedValue
              handle={tokenBalance as `0x${string}` | undefined}
              contractAddr={usdcxAddr}
            />
          }
          hint="ERC-7984 confidential token"
        />
        <Stat
          label="Vault balance"
          accent="neutral"
          icon={<Database size={13} />}
          value={
            <EncryptedValue
              handle={vaultBalanceHandle as `0x${string}` | undefined}
              contractAddr={deployment?.contracts.NoirVault}
            />
          }
          hint="Held by NoirVault · encrypted"
        />
        <Stat
          label="AMM shares"
          accent="neutral"
          icon={<Droplets size={13} />}
          value={
            <EncryptedValue
              handle={lpShares as `0x${string}` | undefined}
              contractAddr={deployment?.contracts.AMMEngine}
            />
          }
          hint="Your LP position · encrypted"
        />
      </div>

      <div className="animate-fade-up [animation-delay:80ms]">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-baseline gap-2.5">
            <h2 className="font-display text-[18px] font-medium text-noir-cream tracking-tight">Open positions</h2>
            <span className="text-[12px] text-noir-cream/40 font-mono">{positions.length}</span>
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
                  <tr className="text-[10px] uppercase tracking-[0.16em] text-noir-cream/40 border-b border-white/[0.05]">
                    <th className="text-left py-4 pl-5 pr-3 font-medium">#</th>
                    <th className="text-left py-4 px-3 font-medium">Market</th>
                    <th className="text-left py-4 px-3 font-medium">Side</th>
                    <th className="text-left py-4 px-3 font-medium">Size</th>
                    <th className="text-left py-4 px-3 font-medium">Entry price</th>
                    <th className="text-left py-4 px-3 pr-5 font-medium">Collateral</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((p, idx) => (
                    <tr
                      key={p.id.toString()}
                      className={`group border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors ${idx === positions.length - 1 ? "border-b-0" : ""}`}
                    >
                      <td className="py-4 pl-5 pr-3 font-mono text-noir-cream/40 text-[12px]">
                        {p.id.toString()}
                      </td>
                      <td className="py-4 px-3">
                        <div className="flex items-center gap-2.5">
                          <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-white/[0.08] to-white/[0.02] border border-white/10 flex items-center justify-center text-[10px] font-semibold text-noir-cream font-display">
                            {marketById(p.marketId)?.symbol ?? "?"}
                          </div>
                          <span className="text-noir-cream font-medium font-display text-[13px] tracking-tight">
                            {marketById(p.marketId)?.symbol ?? p.marketId}/USD
                          </span>
                        </div>
                      </td>
                      <td className="py-4 px-3">
                        <Badge tone={p.isLong ? "green" : "red"}>
                          {p.isLong ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                          {p.isLong ? "Long" : "Short"}
                        </Badge>
                      </td>
                      <td className="py-4 px-3">
                        <EncryptedValue
                          handle={p.sizeHandle}
                          contractAddr={deployment?.contracts.NoirVault}
                          compact
                        />
                      </td>
                      <td className="py-4 px-3">
                        <EncryptedValue
                          handle={p.entryPriceHandle}
                          contractAddr={deployment?.contracts.NoirVault}
                          compact
                        />
                      </td>
                      <td className="py-4 px-3 pr-5">
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

// ---------- Identity hero ------------------------------------------------

function IdentityHero({
  address, positionCount,
}: {
  address: string | undefined;
  positionCount: number;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Card hero className="p-7 relative overflow-hidden animate-fade-up">
      <div aria-hidden className="absolute -top-32 -left-32 w-[420px] h-[420px] rounded-full bg-noir-cream/[0.05] blur-3xl pointer-events-none" />
      <div aria-hidden className="absolute -bottom-32 -right-32 w-96 h-96 rounded-full bg-noir-cream/[0.03] blur-3xl pointer-events-none" />
      <div aria-hidden className="absolute inset-0 bg-grid-dots opacity-[0.18] pointer-events-none [mask-image:radial-gradient(ellipse_at_center,black,transparent_80%)]" />

      <div className="relative flex items-center justify-between gap-6 flex-wrap">
        <div className="flex items-center gap-5">
          <div className="relative">
            <div className="absolute inset-0 rounded-2xl conic-ring opacity-50" />
            <div className="relative h-16 w-16 rounded-2xl bg-noir-black/80 backdrop-blur-md border border-white/10 flex items-center justify-center m-[2px]">
              <ShieldCheck size={26} className="text-noir-accent" strokeWidth={1.6} />
            </div>
          </div>
          <div>
            <div className="text-[10px] font-medium uppercase tracking-[0.22em] text-noir-cream/40 mb-1.5">
              Identity
            </div>
            <button
              type="button"
              onClick={async () => {
                if (!address) return;
                try {
                  await navigator.clipboard.writeText(address);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                } catch { /* no-op */ }
              }}
              className="font-display font-mono text-[20px] text-noir-cream tracking-tight inline-flex items-center gap-2 hover:text-noir-accent transition-colors group"
              title="Copy address"
            >
              {address ? shortAddr(address) : "—"}
              {copied
                ? <CheckCircle2 size={14} className="text-noir-accent" />
                : <Copy size={13} className="text-noir-cream/30 group-hover:text-noir-accent transition-colors" />}
            </button>
            <div className="text-[12px] text-noir-cream/50 mt-2">Connected · all values below are decryptable only by this key</div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="font-display text-[28px] font-semibold text-noir-cream tabular-nums leading-none tracking-[-0.02em]">
              {positionCount}
            </div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-noir-cream/40 mt-2 font-medium">
              Open positions
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
