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
// Cream-warm noir canvas. Mirrors the landing page: deep noir base, a
// barely-there cream warmth, dotted grid in cream, and one small mint
// orb tucked off-screen the way the landing globe carries a single mint
// orbital ring. No mint background washes — the canvas should read as
// noir + cream first, accents second.
function SceneBackdrop() {
  return (
    <div aria-hidden className="fixed inset-0 z-0 pointer-events-none">
      {/* Cream warmth from the top — replaces the prior mint top-wash. */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(243,237,224,0.04),transparent_60%)]" />

      {/* Aurora — cream-dominant, animated. */}
      <div className="absolute inset-0 aurora opacity-80" />

      {/* Floating orbs — two cream + one small dimmed mint, mirroring
          the landing globe's quiet mint orbital accent against its
          predominantly cream/noir presence. */}
      <div className="orb orb-cream     orb-float-1 -top-40 -left-32 w-[520px] h-[520px]" />
      <div className="orb orb-cream-dim orb-float-2  top-1/3 -right-32 w-[460px] h-[460px]" />
      <div className="orb orb-mint      orb-float-3 -bottom-24 left-1/2 w-[260px] h-[260px] opacity-50" />

      {/* Faint cream grid, masked to fade. */}
      <div
        className="absolute inset-0 bg-grid-dots opacity-[0.4] [mask-image:radial-gradient(ellipse_at_center,black_25%,transparent_80%)]"
      />

      {/* Vignette so content reads against the canvas. */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_30%,rgba(5,5,7,0.6)_85%)]" />
    </div>
  );
}
