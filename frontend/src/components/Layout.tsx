import { Outlet, useLocation } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { Header } from "./Header";

export function Layout() {
  const { pathname } = useLocation();
  const isHome = pathname === "/";

  return (
    <div className="min-h-screen flex flex-col bg-noir-black relative overflow-x-hidden">
      {/* ================================================================
          AMBIENT SCENE — fixed-position aurora + floating orbs sit
          behind every page so the whole app reads as one living canvas
          rather than a flat panel.
          ================================================================ */}
      {!isHome && <SceneBackdrop />}

      <Header />

      <main className="flex-1 max-w-7xl mx-auto w-full px-6 py-10 relative z-10">
        <Outlet />
      </main>

      <footer className="relative z-10 border-t border-white/[0.04] backdrop-blur-md bg-noir-black/40">
        <div className="max-w-7xl mx-auto px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-noir-cream/45">
          <div className="flex items-center gap-2">
            <span className="relative inline-flex w-1.5 h-1.5">
              <span className="absolute inset-0 rounded-full bg-noir-accent pulse-dot" />
              <span className="relative inline-block w-1.5 h-1.5 rounded-full bg-noir-accent" />
            </span>
            <span>NoirPerp · privacy-preserving perpetuals on Zama FHEVM · Sepolia testnet</span>
          </div>
          <div className="flex items-center gap-4">
            <a
              href="https://docs.zama.ai/protocol"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 hover:text-noir-cream transition-colors"
            >
              FHEVM docs <ExternalLink size={11} />
            </a>
            <span className="text-noir-cream/15">·</span>
            <span className="font-mono">v0.1.0</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

// ---------- Scene backdrop ------------------------------------------------
// Subpages run quieter than the landing. Replaced the previous
// aurora/cream-orb backdrop with a dim starfield + cosmic fade — three
// very-low-opacity nebula gradients give a sense of depth, ~60 static
// pinpoints scatter the field, and 5 brighter stars twinkle slowly on
// top. Vignette stays so foreground content reads against the canvas.
function SceneBackdrop() {
  return (
    <div aria-hidden className="fixed inset-0 z-0 pointer-events-none">
      {/* Dim cosmic fade + scattered stars. */}
      <div className="absolute inset-0 starfield" />

      {/* A handful of brighter twinkling stars layered on top. */}
      <div className="absolute inset-0 starfield-twinkle" />

      {/* Vignette so content reads against the canvas. */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_35%,rgba(5,5,7,0.7)_88%)]" />
    </div>
  );
}
