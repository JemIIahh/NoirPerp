import { useAccount } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { ReactNode } from "react";

export function WalletGate({ children }: { children: ReactNode }) {
  const { isConnected } = useAccount();
  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-24">
        <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-noir-accent2 mb-3">
          Wallet required
        </div>
        <h2 className="text-2xl md:text-3xl font-semibold tracking-tight text-noir-white mb-2">
          Connect a wallet to continue
        </h2>
        <p className="text-sm text-noir-dim max-w-md mb-8">
          Sign in to encrypt orders, view your encrypted vault state,
          and trade privately on Sepolia FHEVM.
        </p>
        <ConnectButton />
      </div>
    );
  }
  return <>{children}</>;
}
