import { Link, NavLink } from "react-router-dom";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { LineChart, Droplets, EyeOff, Wallet, ShieldCheck, AlertTriangle } from "lucide-react";
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
    <header className="sticky top-0 z-30 backdrop-blur-xl bg-noir-black/75 border-b border-noir-line/60">
      <div className="w-full px-6 h-16 flex items-center justify-between gap-6">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2.5 group">
          <LogoMark />
          <span className="font-display text-[15px] font-semibold tracking-[-0.02em] text-noir-cream">
            NoirPerp
          </span>
          <span className="hidden lg:inline text-[10px] font-medium uppercase tracking-[0.18em] text-noir-cream/40 border border-noir-cream/15 rounded-full px-2 py-0.5">
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
                  "relative inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-medium",
                  "transition-colors duration-150 font-display tracking-tight",
                  isActive
                    ? "text-noir-cream bg-noir-cream/[0.06]"
                    : "text-noir-cream/45 hover:text-noir-cream",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <n.icon size={14} className={clsx(isActive ? "text-noir-cream" : "opacity-60")} />
                  <span>{n.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Connect — custom render so all three RainbowKit states
            (not-connected, wrong-network, connected) share the same
            compact cream-pill language as the rest of the header. */}
        <div className="flex items-center">
          <ConnectPill />
        </div>
      </div>
    </header>
  );
}

// Compact connect-state pill. Matches the header's typography (font-display,
// tracking-tight, sm/text-xs) and the hero's primary-CTA color (cream on
// noir). All three RainbowKit states render at the same height so the
// header chrome doesn't jump.
function ConnectPill() {
  return (
    <ConnectButton.Custom>
      {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
        const ready     = mounted;
        const connected = ready && !!account && !!chain;

        const pillBase =
          "inline-flex items-center gap-1.5 h-9 px-4 rounded-full text-[13px] font-medium font-display tracking-tight transition-colors duration-150";

        if (!ready) {
          // Reserve space without flashing default chrome.
          return <div aria-hidden className="w-[140px] h-9" />;
        }

        if (!connected) {
          return (
            <button
              type="button"
              onClick={openConnectModal}
              className={clsx(pillBase, "bg-noir-cream text-noir-black hover:bg-noir-accent")}
            >
              <Wallet size={14} />
              Connect Wallet
            </button>
          );
        }

        if (chain.unsupported) {
          return (
            <button
              type="button"
              onClick={openChainModal}
              className={clsx(pillBase, "bg-noir-red/15 text-noir-red border border-noir-red/40 hover:bg-noir-red/25")}
            >
              <AlertTriangle size={13} />
              Wrong network
            </button>
          );
        }

        return (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={openChainModal}
              className={clsx(
                pillBase,
                "bg-noir-cream/[0.06] text-noir-cream/75 hover:text-noir-cream hover:bg-noir-cream/[0.10]",
              )}
            >
              {chain.hasIcon && chain.iconUrl ? (
                <img
                  src={chain.iconUrl}
                  alt={chain.name ?? "chain"}
                  className="w-4 h-4 rounded-full"
                />
              ) : (
                <span className="w-1.5 h-1.5 rounded-full bg-noir-accent" />
              )}
              <span className="hidden md:inline">{chain.name}</span>
            </button>
            <button
              type="button"
              onClick={openAccountModal}
              className={clsx(pillBase, "bg-noir-cream text-noir-black hover:bg-noir-accent")}
            >
              {account.displayName}
            </button>
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}

// Inline SVG mark — flat cream square with a noir glyph. No gradient,
// no glow; the brand mark is meant to be quiet so the page hero owns
// the visual weight.
function LogoMark() {
  return (
    <span className="relative inline-flex h-7 w-7 items-center justify-center rounded-lg bg-noir-cream">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-4 w-4 text-noir-black"
      >
        <path d="M5 19V5l14 14V5" />
        <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      </svg>
    </span>
  );
}
