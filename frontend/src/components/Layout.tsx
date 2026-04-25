import { Outlet } from "react-router-dom";
import { Header } from "./Header";

export function Layout() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 max-w-7xl mx-auto w-full px-6 py-8">
        <Outlet />
      </main>
      <footer className="border-t border-noir-line py-4 text-center text-xs text-noir-mute">
        NoirPerp · Privacy-preserving perpetuals on Zama FHEVM · Sepolia testnet
      </footer>
    </div>
  );
}
