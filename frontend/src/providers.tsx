import { ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";
import { wagmiConfig } from "./lib/wagmi";

const queryClient = new QueryClient();

// Match RainbowKit's chrome to the NoirPerp violet so the Connect button,
// modal, and chain switcher feel native to the app.
const noirRainbowTheme = darkTheme({
  accentColor:        "#7c5cff",
  accentColorForeground: "#ffffff",
  borderRadius:       "medium",
  fontStack:          "system",
  overlayBlur:        "small",
});

export function Providers({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={noirRainbowTheme}>
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
