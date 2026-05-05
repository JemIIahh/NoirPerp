import { useState } from "react";
import { useAccount, useReadContract, useWriteContract, usePublicClient } from "wagmi";
import { parseAbi, parseUnits, formatUnits, maxUint256, type Address } from "viem";
import { Coins, Droplets, CheckCircle2, AlertCircle, Loader2, ExternalLink } from "lucide-react";
import { WalletGate } from "../components/WalletGate";
import { Button } from "../components/Form";
import { Card, SectionHeader, Stat, Badge } from "../components/ui";
import { useDeployment } from "../hooks/useDeployment";
import { ERC7984_ABI, UNDERLYING_USDC_ABI } from "../lib/abis";

// Underlying ERC20 mock that backs Zama's cUSDCMock on Sepolia.
// Hardcoded — it's an external contract, not part of our deployments.json.
const UNDERLYING_USDC_ADDRESS: Address =
  "0x9b5Cd13b8eFbB58Dc25A05CF411D8056058aDFfF";

const FAUCET_AMOUNT_USDC = 10_000n;
const UNDERLYING = parseAbi(UNDERLYING_USDC_ABI);
const CUSDC = parseAbi(ERC7984_ABI);

type Step = "idle" | "minting" | "approving" | "wrapping" | "done" | "error";

export default function Faucet() { return <WalletGate><Inner /></WalletGate>; }

function Inner() {
  const { address } = useAccount();
  const { data: deployment } = useDeployment();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);

  const cUSDCAddr = deployment?.contracts.cUSDCMock as Address | undefined;
  const amount = parseUnits(FAUCET_AMOUNT_USDC.toString(), 6);

  const { data: underlyingBal, refetch: refetchUnderlying } = useReadContract({
    address: UNDERLYING_USDC_ADDRESS,
    abi: UNDERLYING,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 10_000 },
  });

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: UNDERLYING_USDC_ADDRESS,
    abi: UNDERLYING,
    functionName: "allowance",
    args: address && cUSDCAddr ? [address, cUSDCAddr] : undefined,
    query: { enabled: !!address && !!cUSDCAddr, refetchInterval: 10_000 },
  });

  async function onMint() {
    if (!address || !cUSDCAddr || !publicClient) return;
    setError(null);
    setLastTxHash(null);

    try {
      // Step 1: mint underlying public USDC to the user
      setStep("minting");
      const mintHash = await writeContractAsync({
        address: UNDERLYING_USDC_ADDRESS,
        abi: UNDERLYING,
        functionName: "mint",
        args: [address, amount],
      });
      await publicClient.waitForTransactionReceipt({ hash: mintHash });

      // Step 2: approve cUSDCMock to pull underlying. Skip if allowance is
      // already at-or-above what we need; saves a tx on repeat mints.
      const currentAllowance = (allowance as bigint | undefined) ?? 0n;
      if (currentAllowance < amount) {
        setStep("approving");
        const approveHash = await writeContractAsync({
          address: UNDERLYING_USDC_ADDRESS,
          abi: UNDERLYING,
          functionName: "approve",
          args: [cUSDCAddr, maxUint256],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
      }

      // Step 3: wrap underlying → confidential cUSDCMock balance
      setStep("wrapping");
      const wrapHash = await writeContractAsync({
        address: cUSDCAddr,
        abi: CUSDC,
        functionName: "wrap",
        args: [address, amount],
      });
      await publicClient.waitForTransactionReceipt({ hash: wrapHash });

      setLastTxHash(wrapHash);
      setStep("done");
      refetchUnderlying();
      refetchAllowance();
    } catch (e) {
      setError((e as Error).message ?? "unknown error");
      setStep("error");
    }
  }

  const busy = step === "minting" || step === "approving" || step === "wrapping";
  const stepLabel: Record<Step, string> = {
    idle: `Mint ${FAUCET_AMOUNT_USDC.toLocaleString()} USDCx`,
    minting: "1/3 — minting underlying USDC…",
    approving: "2/3 — approving wrapper…",
    wrapping: "3/3 — wrapping into confidential balance…",
    done: `Mint ${FAUCET_AMOUNT_USDC.toLocaleString()} more USDCx`,
    error: "Try again",
  };

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow={<><Droplets size={10} /> Faucet</>}
        title={<>Test <span className="shimmer-text">USDCx</span> for Sepolia</>}
        description="Mint test USDCx for trading. One click runs three transactions: mint the underlying public USDC mock, approve the confidential wrapper, then wrap into your encrypted USDCx balance. Free, unlimited."
      />

      <Card hero className="p-8 relative overflow-hidden animate-fade-up">
        <div
          aria-hidden
          className="absolute inset-0 bg-grid-dots opacity-[0.18] pointer-events-none [mask-image:radial-gradient(ellipse_at_center,black,transparent_80%)]"
        />
        <div className="relative space-y-6">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-xl bg-noir-cream/[0.06] flex items-center justify-center">
              <Coins size={20} className="text-noir-accent" />
            </div>
            <div>
              <div className="font-display text-2xl font-semibold tracking-tight text-noir-cream">
                {FAUCET_AMOUNT_USDC.toLocaleString()} USDCx
              </div>
              <div className="text-[12px] text-noir-cream/45">
                per mint, no limit on repeats
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Stat
              label="Your underlying USDC"
              value={underlyingBal !== undefined ? Number(formatUnits(underlyingBal as bigint, 6)).toLocaleString() : "—"}
              hint="Public ERC20, decryptable"
            />
            <Stat
              label="Wrapper allowance"
              value={
                allowance !== undefined
                  ? (allowance as bigint) >= amount
                    ? "Set"
                    : "Not set"
                  : "—"
              }
              hint="approve(cUSDCMock, …)"
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-noir-red/10 border border-noir-red/30 text-[12px] text-noir-red">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <span className="break-all">{error}</span>
            </div>
          )}

          {step === "done" && lastTxHash && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-noir-accent/10 border border-noir-accent/30 text-[12px] text-noir-accent">
              <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
              <span>
                Wrapped successfully.{" "}
                <a
                  href={`https://sepolia.etherscan.io/tx/${lastTxHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="underline decoration-dotted inline-flex items-center gap-1"
                >
                  View wrap tx <ExternalLink size={11} />
                </a>
              </span>
            </div>
          )}

          <Button
            type="button"
            variant="primary"
            onClick={onMint}
            disabled={busy || !address || !cUSDCAddr}
            className="w-full justify-center gap-2"
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            {stepLabel[step]}
          </Button>

          <div className="text-[11px] text-noir-cream/40 leading-relaxed">
            cUSDCMock at <code className="text-noir-cream/60">{cUSDCAddr ?? "—"}</code><br />
            Underlying USDC mock at <code className="text-noir-cream/60">{UNDERLYING_USDC_ADDRESS}</code>
          </div>
        </div>
      </Card>

      <Card className="p-6 space-y-3">
        <div className="flex items-center gap-2">
          <Badge tone="mint">How this works</Badge>
        </div>
        <ol className="text-[13px] text-noir-cream/70 space-y-2 list-decimal list-inside leading-relaxed">
          <li>
            <span className="text-noir-cream">Mint underlying.</span> Calls{" "}
            <code className="text-noir-cream/60">mint(you, amount)</code> on the public ERC20 mock.
            Open mint, anyone can call.
          </li>
          <li>
            <span className="text-noir-cream">Approve wrapper.</span> Calls{" "}
            <code className="text-noir-cream/60">approve(cUSDCMock, max)</code> so the confidential
            wrapper can pull your underlying. Skipped on repeat mints if already approved.
          </li>
          <li>
            <span className="text-noir-cream">Wrap.</span> Calls{" "}
            <code className="text-noir-cream/60">wrap(you, amount)</code> on cUSDCMock — burns underlying,
            mints encrypted balance to you. Now you have USDCx.
          </li>
        </ol>
        <div className="text-[12px] text-noir-cream/50 pt-2 border-t border-white/[0.04]">
          USDCx is an{" "}
          <a
            href="https://github.com/OpenZeppelin/openzeppelin-confidential-contracts"
            target="_blank"
            rel="noreferrer"
            className="text-noir-accent underline decoration-dotted"
          >
            ERC-7984
          </a>{" "}
          confidential token — your balance is encrypted on-chain. Only you can decrypt it.
        </div>
      </Card>
    </div>
  );
}
