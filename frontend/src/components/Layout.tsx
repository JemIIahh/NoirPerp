import { Outlet } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { Header } from "./Header";

export function Layout() {
  return (
    <div className="min-h-screen flex flex-col bg-noir-black relative">
      {/* Ambient violet glow at the top of the viewport — sits behind the
          header to give the entire app a subtle product depth. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[480px] bg-noir-radial opacity-60"
      />

      <Header />

      <main className="flex-1 max-w-7xl mx-auto w-full px-6 py-10 relative">
        <Outlet />
      </main>

      <footer className="relative border-t border-noir-line">
        <div className="max-w-7xl mx-auto px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-noir-mute">
          <div className="flex items-center gap-2">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-noir-green animate-pulse-soft" />
            <span>NoirPerp · privacy-preserving perpetuals on Zama FHEVM · Sepolia testnet</span>
          </div>
          <div className="flex items-center gap-4">
            <a
              href="https://docs.zama.ai/protocol"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 hover:text-noir-white transition-colors"
            >
              FHEVM docs <ExternalLink size={11} />
            </a>
            <span className="text-noir-line">·</span>
            <span className="font-mono">v0.1.0</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
