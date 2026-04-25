import { Link, NavLink } from "react-router-dom";
import { ConnectButton } from "@rainbow-me/rainbowkit";

const NAV = [
  { to: "/trade", label: "Trade" },
  { to: "/liquidity", label: "Liquidity" },
  { to: "/darkpool", label: "Darkpool" },
  { to: "/portfolio", label: "Portfolio" },
  { to: "/compliance", label: "Compliance" },
];

export function Header() {
  return (
    <header className="border-b border-noir-line bg-noir-gray">
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
        <Link to="/" className="text-xl font-semibold tracking-tight text-noir-white">
          Noir<span className="text-noir-accent">Perp</span>
        </Link>
        <nav className="flex items-center gap-6">
          {NAV.map((n) => (
            <NavLink
              key={n.to} to={n.to}
              className={({ isActive }) =>
                `text-sm ${isActive ? "text-noir-white" : "text-noir-mute hover:text-noir-white"}`}
            >{n.label}</NavLink>
          ))}
        </nav>
        <ConnectButton showBalance={false} />
      </div>
    </header>
  );
}
