import { useAccount, useReadContract } from "wagmi";
import { parseAbi } from "viem";
import { WalletGate } from "../components/WalletGate";
import { EncryptedValue } from "../components/EncryptedValue";
import { useDeployment } from "../hooks/useDeployment";
import { useVaultBalance } from "../hooks/useEncryptedBalance";
import { usePositions } from "../hooks/usePositions";
import { ERC7984_ABI, AMM_ABI } from "../lib/abis";
import { marketById } from "../lib/markets";

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
      <h1 className="text-2xl font-semibold">Portfolio</h1>

      <div className="grid grid-cols-3 gap-4">
        <Stat label="Wallet token (USDCx)" value={tokenBalance ? String(tokenBalance) : "—"} />
        <Stat label="Vault balance (encrypted)" inner={<EncryptedValue handle={vaultBalanceHandle as `0x${string}` | undefined} contractAddr={deployment?.contracts.NoirVault} />} />
        <Stat label="AMM shares (encrypted)" inner={<EncryptedValue handle={lpShares as `0x${string}` | undefined} contractAddr={deployment?.contracts.AMMEngine} />} />
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3">Open positions ({positions.length})</h2>
        {positions.length === 0 ? (
          <p className="text-noir-mute text-sm">No open positions.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-noir-mute border-b border-noir-line">
              <tr><th className="text-left py-2">#</th><th className="text-left">Market</th><th className="text-left">Side</th><th className="text-left">Size</th><th className="text-left">Entry</th><th className="text-left">Collateral</th></tr>
            </thead>
            <tbody>
              {positions.map((p) => (
                <tr key={p.id.toString()} className="border-b border-noir-line/50">
                  <td className="py-2">{p.id.toString()}</td>
                  <td>{marketById(p.marketId)?.symbol ?? p.marketId}</td>
                  <td>{p.isLong ? <span className="text-noir-green">Long</span> : <span className="text-noir-red">Short</span>}</td>
                  <td><EncryptedValue handle={p.sizeHandle} contractAddr={deployment?.contracts.NoirVault} /></td>
                  <td><EncryptedValue handle={p.entryPriceHandle} contractAddr={deployment?.contracts.NoirVault} /></td>
                  <td><EncryptedValue handle={p.collateralHandle} contractAddr={deployment?.contracts.NoirVault} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, inner }: { label: string; value?: string; inner?: React.ReactNode }) {
  return (
    <div className="bg-noir-gray border border-noir-line rounded p-4">
      <div className="text-xs uppercase tracking-wider text-noir-mute mb-1">{label}</div>
      <div className="font-mono text-lg">{inner ?? value}</div>
    </div>
  );
}
