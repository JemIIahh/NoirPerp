import { Link } from "react-router-dom";

export default function Home() {
  return (
    <div className="text-center py-20">
      <h1 className="text-6xl font-bold tracking-tight mb-4">Noir<span className="text-noir-accent">Perp</span></h1>
      <p className="text-xl text-noir-mute mb-12">Privacy-preserving perpetuals on Zama FHEVM.</p>
      <div className="flex justify-center gap-4">
        <Link to="/trade" className="px-6 py-3 bg-noir-accent text-noir-black rounded font-medium hover:opacity-90">Open Trade</Link>
        <Link to="/portfolio" className="px-6 py-3 border border-noir-line rounded hover:bg-noir-gray">View Portfolio</Link>
      </div>
    </div>
  );
}
