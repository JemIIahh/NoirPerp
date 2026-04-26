import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { hardhat, sepolia } from "wagmi/chains";

const network     = import.meta.env.VITE_DEPLOYMENT_NETWORK ?? "local";
const rpcUrl      = import.meta.env.VITE_RPC_URL            ?? "http://127.0.0.1:8545";
const wcProjectId = import.meta.env.VITE_WC_PROJECT_ID as string | undefined;

const hasRealWcProjectId =
  typeof wcProjectId === "string" && wcProjectId.length > 0 && wcProjectId !== "demo";

// Explicit injected connectors per wallet. Each targets its own
// browser-extension provider (window.okxwallet for OKX,
// window.ethereum + isMetaMask for MetaMask, plain window.ethereum
// for everything else) so RainbowKit's modal shows them as separate,
// pickable options. Pure wagmi connectors — no RainbowKit/wallets
// abstraction, so we avoid RainbowKit's hard projectId requirement
// and never call WalletConnect's API.
function localConnectors() {
  return [
    injected({
      target() {
        return {
          id:   "okxWallet",
          name: "OKX Wallet",
          provider: (w) => (w as { okxwallet?: unknown } | undefined)?.okxwallet as never,
        };
      },
      shimDisconnect: true,
    }),
    injected({ target: "metaMask",       shimDisconnect: true }),
    injected({ target: "coinbaseWallet", shimDisconnect: true }),
    injected({ shimDisconnect: true }),
  ];
}

// Branch on (network × hasRealWcProjectId) so each path uses a single
// literal chain — TypeScript needs that to narrow `transports`.
function buildConfig() {
  if (network === "sepolia" && hasRealWcProjectId) {
    return getDefaultConfig({
      appName:    "NoirPerp",
      projectId:  wcProjectId!,
      chains:     [sepolia],
      transports: { [sepolia.id]: http(rpcUrl) },
      ssr:        false,
    });
  }
  if (network === "sepolia") {
    return createConfig({
      chains:     [sepolia],
      connectors: localConnectors(),
      transports: { [sepolia.id]: http(rpcUrl) },
      ssr:        false,
    });
  }
  return createConfig({
    chains:     [hardhat],
    connectors: localConnectors(),
    transports: { [hardhat.id]: http(rpcUrl) },
    ssr:        false,
  });
}

export const wagmiConfig = buildConfig();
