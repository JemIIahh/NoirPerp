import { Link } from "react-router-dom";
import { ArrowUpRight, ShieldCheck } from "lucide-react";
import { SpinningGlobe } from "../components/SpinningGlobe";

// Single-screen landing. One column. One color. One typeface for the
// headline. Globe centerpiece, headline, two buttons, four chips.
export default function Home() {
  return (
    // Natural-flow layout. No forced height, no flex-1 spacer — those
    // collapsed on shorter viewports and pushed the chip strip flush
    // against the buttons. Explicit vertical rhythm via margins makes
    // the spacing predictable on every viewport.
    <section className="relative flex flex-col items-center text-center pt-6 pb-2">
      <div className="mb-10">
        <SpinningGlobe size={240} />
      </div>

      <h1 className="font-display text-5xl md:text-7xl font-medium tracking-[-0.03em] leading-[1.02] text-noir-cream max-w-4xl">
        Perpetual futures
        <br />
        <span className="text-noir-cream/70">that nobody can see.</span>
      </h1>

      <p className="font-display mt-6 text-base md:text-lg text-noir-cream/55 max-w-xl tracking-tight">
        FHE-encrypted positions on Zama's Sepolia testnet.
        <br className="hidden sm:inline" />
        Only you hold the key to your own state.
      </p>

      <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
        <Link
          to="/trade"
          className="group inline-flex items-center gap-2 px-7 py-3.5 rounded-full bg-noir-cream text-noir-black font-semibold text-sm tracking-tight hover:bg-noir-accent transition-colors duration-200"
        >
          Open trading
          <ArrowUpRight
            size={15}
            className="transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
          />
        </Link>
        <Link
          to="/compliance"
          className="inline-flex items-center gap-2 px-7 py-3.5 rounded-full bg-transparent border border-noir-cream/20 text-noir-cream font-medium text-sm tracking-tight hover:border-noir-cream/40 hover:bg-noir-cream/5 transition-colors duration-200"
        >
          <ShieldCheck size={14} />
          Check allowlist
        </Link>
      </div>

      {/* Big intentional gap below the CTAs — the chip strip is the
          last beat before the footer hairline, and needs to read as
          a separate "section" rather than a button caption. */}
      <div className="mt-48 w-full flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-[10px] uppercase tracking-[0.22em] text-noir-cream/35 font-display">
        <span>Encrypted size</span>
        <Dot />
        <span>Encrypted collateral</span>
        <Dot />
        <span>Dark batch orders</span>
        <Dot />
        <span>KYC merkle proofs</span>
      </div>
    </section>
  );
}

function Dot() {
  return (
    <span
      aria-hidden
      className="inline-block w-[3px] h-[3px] rounded-full bg-noir-cream/25"
    />
  );
}
