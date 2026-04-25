import { useState } from "react";
import { useAccount, useWriteContract } from "wagmi";
import { parseAbi } from "viem";
import { WalletGate } from "../components/WalletGate";
import { Field, Input, Select, Button } from "../components/Form";
import { useDeployment } from "../hooks/useDeployment";
import { useEncryptInput } from "../hooks/useEncrypt";
import { useComplianceProof } from "../hooks/useCompliance";
import { usePositions } from "../hooks/usePositions";
import { EncryptedValue } from "../components/EncryptedValue";
import { MARKETS, marketById } from "../lib/markets";
import { PERP_ABI } from "../lib/abis";

const PERP = parseAbi(PERP_ABI);

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
    <div className="grid grid-cols-2 gap-8">
      <div>
        <h1 className="text-2xl font-semibold mb-4">Open position</h1>
        <div className="space-y-4 bg-noir-gray border border-noir-line rounded p-6">
          <Field label="Market">
            <Select value={marketId} onChange={(e) => setMarketId(Number(e.target.value))}>
              {MARKETS.map((m) => <option key={m.id} value={m.id}>{m.symbol} / USD</option>)}
            </Select>
          </Field>
          <Field label="Side">
            <div className="flex gap-2">
              <button className={`flex-1 py-2 rounded border ${isLong ? "border-noir-green bg-noir-green/20 text-noir-green" : "border-noir-line text-noir-mute"}`} onClick={() => setIsLong(true)}>Long</button>
              <button className={`flex-1 py-2 rounded border ${!isLong ? "border-noir-red bg-noir-red/20 text-noir-red" : "border-noir-line text-noir-mute"}`} onClick={() => setIsLong(false)}>Short</button>
            </div>
          </Field>
          <Field label="Size (units)"><Input type="text" value={size} onChange={(e) => setSize(e.target.value)} placeholder="10" /></Field>
          <Field label="Collateral (USDCx)"><Input type="text" value={collateral} onChange={(e) => setCollateral(e.target.value)} placeholder="1000" /></Field>
          <Button onClick={onSubmit} disabled={isPending || !proof?.allowlisted || !size || !collateral}>
            {isPending ? "submitting…" : "Open position"}
          </Button>
          {!proof?.allowlisted && <p className="text-xs text-noir-red">Address not allowlisted (Compliance page).</p>}
          {error && <p className="text-xs text-noir-red">{error}</p>}
        </div>
      </div>

      <div>
        <h1 className="text-2xl font-semibold mb-4">My positions ({positions.length})</h1>
        {positions.length === 0 ? (
          <p className="text-noir-mute text-sm">No open positions.</p>
        ) : (
          <div className="space-y-3">
            {positions.map((p) => (
              <div key={p.id.toString()} className="bg-noir-gray border border-noir-line rounded p-4 flex items-center justify-between">
                <div>
                  <div className="text-sm">
                    <span className="text-noir-mute">#{p.id.toString()} · </span>
                    <span>{marketById(p.marketId)?.symbol}</span> ·
                    <span className={p.isLong ? "text-noir-green" : "text-noir-red"}> {p.isLong ? "Long" : "Short"}</span>
                  </div>
                  <div className="text-xs text-noir-mute mt-1 flex gap-4">
                    size: <EncryptedValue handle={p.sizeHandle} contractAddr={deployment?.contracts.NoirVault} />
                    coll: <EncryptedValue handle={p.collateralHandle} contractAddr={deployment?.contracts.NoirVault} />
                  </div>
                </div>
                <Button variant="danger" onClick={() => onClose(p.id)}>Close</Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
