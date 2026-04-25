import { useState } from "react";
import { useAccount, useWriteContract } from "wagmi";
import { WalletGate } from "../components/WalletGate";
import { Field, Input, Select, Button } from "../components/Form";
import { EncryptedValue } from "../components/EncryptedValue";
import { useDeployment } from "../hooks/useDeployment";
import { useEncryptInput } from "../hooks/useEncrypt";
import { useComplianceProof } from "../hooks/useCompliance";
import { useDarkOrders } from "../hooks/useDarkOrders";
import { MARKETS, marketById } from "../lib/markets";
import { DARK_ABI } from "../lib/abis";

// DARK_ABI is already an Abi (parsed strings + JSON submitOrder entry).
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
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    setError(null);
    if (!proof?.allowlisted) { setError("Address not allowlisted"); return; }
    if (!deployment) return;
    try {
      const enc = await encrypt(BigInt(size), BigInt(collateral), BigInt(limitPrice));
      const inputs = {
        eSize: enc.handles[0], sizeProof: enc.inputProof,
        eCollateral: enc.handles[1], collateralProof: enc.inputProof,
        eLimitPrice: enc.handles[2], limitProof: enc.inputProof,
      };
      await writeContractAsync({
        address: deployment.contracts.DarkpoolEngine, abi: DARK,
        functionName: "submitOrder", args: [inputs, marketId, isLong, proof.proof],
      });
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
    <div className="grid grid-cols-2 gap-8">
      {/* Left: submit form */}
      <div>
        <h1 className="text-2xl font-semibold mb-4">Submit dark order</h1>
        <div className="space-y-4 bg-noir-gray border border-noir-line rounded p-6">
          <Field label="Market">
            <Select value={marketId} onChange={(e) => setMarketId(Number(e.target.value))}>
              {MARKETS.map((m) => <option key={m.id} value={m.id}>{m.symbol}</option>)}
            </Select>
          </Field>
          <Field label="Side">
            <div className="flex gap-2">
              <button
                className={`flex-1 py-2 rounded border ${isLong ? "border-noir-green bg-noir-green/20 text-noir-green" : "border-noir-line text-noir-mute"}`}
                onClick={() => setIsLong(true)}
              >Long</button>
              <button
                className={`flex-1 py-2 rounded border ${!isLong ? "border-noir-red bg-noir-red/20 text-noir-red" : "border-noir-line text-noir-mute"}`}
                onClick={() => setIsLong(false)}
              >Short</button>
            </div>
          </Field>
          <Field label="Size (encrypted)">
            <Input value={size} onChange={(e) => setSize(e.target.value)} placeholder="10" />
          </Field>
          <Field label="Collateral, USDCx (encrypted)">
            <Input value={collateral} onChange={(e) => setCollateral(e.target.value)} placeholder="1000" />
          </Field>
          <Field label="Limit price (encrypted)">
            <Input value={limitPrice} onChange={(e) => setLimitPrice(e.target.value)} placeholder="3000" />
          </Field>
          <Button onClick={onSubmit} disabled={isPending || !proof?.allowlisted || !size || !collateral || !limitPrice}>
            Submit dark order
          </Button>
          {!proof?.allowlisted && (
            <p className="text-xs text-noir-mute">Wallet not on compliance allowlist.</p>
          )}
          {error && <p className="text-xs text-noir-red">{error}</p>}
        </div>
      </div>

      {/* Right: active orders */}
      <div>
        <h1 className="text-2xl font-semibold mb-4">My active orders ({orders.length})</h1>
        {orders.length === 0 ? (
          <p className="text-noir-mute text-sm">No active orders.</p>
        ) : (
          <div className="space-y-3">
            {orders.map((o) => (
              <div
                key={o.id.toString()}
                className="bg-noir-gray border border-noir-line rounded p-4 flex items-center justify-between"
              >
                <div>
                  <div className="text-sm">
                    #{o.id.toString()} · {marketById(o.marketId)?.symbol} ·{" "}
                    <span className={o.isLong ? "text-noir-green" : "text-noir-red"}>
                      {o.isLong ? "Long" : "Short"}
                    </span>
                  </div>
                  <div className="text-xs text-noir-mute mt-1 flex gap-4 flex-wrap">
                    <span>size: <EncryptedValue handle={o.sizeHandle} contractAddr={deployment?.contracts.DarkpoolEngine} /></span>
                    <span>collateral: <EncryptedValue handle={o.collateralHandle} contractAddr={deployment?.contracts.DarkpoolEngine} /></span>
                    <span>limit: <EncryptedValue handle={o.limitPriceHandle} contractAddr={deployment?.contracts.DarkpoolEngine} /></span>
                  </div>
                </div>
                <Button variant="danger" onClick={() => onCancel(o.id)}>Cancel</Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
