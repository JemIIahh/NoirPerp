import { ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";
import { wagmiConfig } from "./lib/wagmi";

const queryClient = new QueryClient();

// RainbowKit chrome — cream-on-noir matching the hero CTA. Mint is
// reserved as the secondary cue (orbits, encrypted-state badges,
// hover states), so the connect button stays in the same typographic
// "voice" color as the hero ("Open trading" button + headline).
const noirRainbowTheme = darkTheme({
  accentColor:           "#f3ede0",
  accentColorForeground: "#050507",
  borderRadius:          "medium",
  fontStack:             "system",
  overlayBlur:           "small",
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
