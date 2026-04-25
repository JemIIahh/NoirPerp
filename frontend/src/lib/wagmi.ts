import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { http } from "wagmi";
import { hardhat, sepolia } from "wagmi/chains";

const network = import.meta.env.VITE_DEPLOYMENT_NETWORK ?? "local";
const rpcUrl = import.meta.env.VITE_RPC_URL ?? "http://127.0.0.1:8545";
const wcProjectId = import.meta.env.VITE_WC_PROJECT_ID ?? "demo";

const chain = network === "sepolia" ? sepolia : hardhat;

export const wagmiConfig = getDefaultConfig({
  appName: "NoirPerp",
  projectId: wcProjectId,
  chains: [chain],
  transports: { [chain.id]: http(rpcUrl) },
  ssr: false,
});
