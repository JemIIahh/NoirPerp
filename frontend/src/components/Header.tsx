import { Link, NavLink } from "react-router-dom";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { LineChart, Droplets, EyeOff, Wallet, ShieldCheck } from "lucide-react";
import clsx from "clsx";

const NAV = [
  { to: "/trade",      label: "Trade",      icon: LineChart },
  { to: "/liquidity",  label: "Liquidity",  icon: Droplets },
  { to: "/darkpool",   label: "Darkpool",   icon: EyeOff },
  { to: "/portfolio",  label: "Portfolio",  icon: Wallet },
  { to: "/compliance", label: "Compliance", icon: ShieldCheck },
];

export function Header() {
  return (
    <header className="sticky top-0 z-30 backdrop-blur-xl bg-noir-black/80 border-b border-noir-line">
      {/* Hairline accent strip — gives the header a premium product feel. */}
      <div className="h-px bg-gradient-to-r from-transparent via-noir-accent/40 to-transparent" />

      <div className="w-full px-6 h-16 flex items-center justify-between gap-6">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2.5 group">
          <LogoMark />
          <span className="text-[15px] font-semibold tracking-tight text-noir-white">
            Noir<span className="text-noir-accent2">Perp</span>
          </span>
          <span className="hidden lg:inline text-[10px] font-medium uppercase tracking-[0.14em] text-noir-mute border border-noir-line rounded px-1.5 py-0.5">
            FHEVM · Sepolia
          </span>
        </Link>

        {/* Nav */}
        <nav className="flex items-center gap-0.5">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                clsx(
                  "relative inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium",
                  "transition-colors duration-150",
                  isActive
                    ? "text-noir-white bg-noir-raised"
                    : "text-noir-mute hover:text-noir-white hover:bg-noir-panel",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <n.icon size={14} className={clsx(isActive ? "text-noir-accent2" : "opacity-70")} />
                  <span>{n.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Connect */}
        <div className="flex items-center">
          <ConnectButton showBalance={false} chainStatus="icon" accountStatus="address" />
        </div>
      </div>
    </header>
  );
}

// Inline SVG mark — small, no external asset, has subtle gradient.
function LogoMark() {
  return (
    <span className="relative inline-flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-noir-accent2 via-noir-accent to-noir-violet shadow-glow-soft">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-4 w-4 text-white"
      >
        {/* Stylized "N" with a lock keyhole — privacy + perps in one mark. */}
        <path d="M5 19V5l14 14V5" />
        <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      </svg>
    </span>
  );
}
