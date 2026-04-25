import { useAccount } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { ReactNode } from "react";

export function WalletGate({ children }: { children: ReactNode }) {
  const { isConnected } = useAccount();
  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <p className="text-noir-mute">Connect a wallet to continue.</p>
        <ConnectButton />
      </div>
    );
  }
  return <>{children}</>;
}
