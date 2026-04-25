import { useAccount } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Wallet } from "lucide-react";
import { ReactNode } from "react";
import { Card } from "./ui";

export function WalletGate({ children }: { children: ReactNode }) {
  const { isConnected } = useAccount();
  if (!isConnected) {
    return (
      <div className="flex items-center justify-center py-20">
        <Card className="px-10 py-12 flex flex-col items-center text-center max-w-md">
          <div className="h-12 w-12 rounded-xl bg-noir-accent/15 border border-noir-accent/30 flex items-center justify-center mb-4">
            <Wallet size={20} className="text-noir-accent2" />
          </div>
          <h2 className="text-lg font-semibold text-noir-white mb-1.5">Connect a wallet</h2>
          <p className="text-sm text-noir-dim mb-6 max-w-xs">
            Sign in to encrypt orders, view your encrypted vault state, and trade privately.
          </p>
          <ConnectButton />
        </Card>
      </div>
    );
  }
  return <>{children}</>;
}
