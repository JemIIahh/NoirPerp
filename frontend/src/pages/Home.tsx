import { Link } from "react-router-dom";
import {
  ArrowUpRight, Lock, ShieldCheck, EyeOff, Bot, Database,
  Sparkles, LineChart,
} from "lucide-react";
import { Card, Badge } from "../components/ui";
import { MARKETS } from "../lib/markets";

export default function Home() {
  return (
    <div className="space-y-20">
      <Hero />
      <Markets />
      <Features />
      <HowItWorks />
      <FinalCta />
    </div>
  );
}

// ---------- Hero ----------------------------------------------------------

function Hero() {
  return (
    <section className="relative pt-12 md:pt-16 pb-8">
      {/* Faint dotted-grid texture sitting only behind the hero block. */}
      <div
        aria-hidden
        className="absolute inset-0 -top-10 bg-grid-dots opacity-50 [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_70%)]"
      />

      <div className="relative text-center max-w-3xl mx-auto">
        <Badge tone="violet" icon={<Sparkles size={11} />} className="mb-6">
          Live on Sepolia · Zama FHEVM v0.12
        </Badge>

        <h1 className="text-5xl md:text-7xl font-semibold tracking-[-0.025em] leading-[1.05] mb-6 text-noir-white">
          Perpetual futures
          <span
            className="block text-noir-accent2"
            style={{ textShadow: "0 0 40px rgba(124, 92, 255, 0.45)" }}
          >
            that nobody can see.
          </span>
        </h1>

        <p className="text-lg md:text-xl text-noir-dim leading-relaxed mb-10 max-w-2xl mx-auto">
          Encrypted size, encrypted collateral, encrypted dark orders.
          Every position is an FHE ciphertext on-chain — only you hold the
          key to decrypt your own state.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            to="/trade"
            className="group inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-noir-accent text-white font-semibold border border-noir-accent2/40 shadow-glow-violet hover:bg-noir-violet transition-all duration-200"
          >
            Open trading
            <ArrowUpRight
              size={16}
              className="transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
            />
          </Link>
          <Link
            to="/compliance"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-noir-raised border border-noir-edge text-noir-white font-medium hover:bg-noir-hover hover:border-noir-accent/40 transition-all duration-200"
          >
            <ShieldCheck size={16} className="text-noir-accent2" />
            Check allowlist
          </Link>
        </div>

        {/* Inline meta strip — gives the hero anchor weight without
            overcommitting to specific stats. */}
        <div className="mt-12 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-xs text-noir-mute">
          <MetaItem icon={<Lock size={11} />} label="FHE-encrypted positions" />
          <MetaItem icon={<EyeOff size={11} />} label="Dark batch orders" />
          <MetaItem icon={<Bot size={11} />} label="Async settlement bot" />
          <MetaItem icon={<ShieldCheck size={11} />} label="KYC merkle allowlist" />
        </div>
      </div>
    </section>
  );
}

function MetaItem({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-noir-accent2 opacity-80">{icon}</span>
      {label}
    </span>
  );
}

// ---------- Markets strip -------------------------------------------------

function Markets() {
  // Plaintext "base" prices come from the Markets table. The Oracle on
  // Sepolia provides live prices — we surface a static reference here on
  // the landing page so the hero feels concrete without a wallet
  // connection.
  return (
    <section>
      <div className="flex items-end justify-between mb-4">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-noir-accent2 mb-1.5">
            Markets
          </div>
          <h2 className="text-xl font-semibold text-noir-white">
            Three perps. One private venue.
          </h2>
        </div>
        <Link
          to="/trade"
          className="hidden sm:inline-flex items-center gap-1 text-xs font-medium text-noir-dim hover:text-noir-white transition-colors"
        >
          Open trading <ArrowUpRight size={12} />
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {MARKETS.map((m) => (
          <Card key={m.id} interactive className="p-5">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-noir-raised border border-noir-edge flex items-center justify-center text-[11px] font-semibold tracking-wide text-noir-white">
                  {m.symbol}
                </div>
                <div>
                  <div className="text-sm font-medium text-noir-white">{m.symbol}-USD</div>
                  <div className="text-[11px] text-noir-mute">{m.name} perp</div>
                </div>
              </div>
              <Badge tone="violet" icon={<Lock size={10} />}>encrypted</Badge>
            </div>
            <div className="flex items-end justify-between">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-noir-mute mb-0.5">
                  reference
                </div>
                <div className="text-xl font-semibold font-mono text-noir-white tabular-nums">
                  ${m.base.toLocaleString()}
                </div>
              </div>
              <div className="text-[10px] text-noir-dim font-mono">
                marketId={m.id}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}

// ---------- Features grid -------------------------------------------------

function Features() {
  const features = [
    {
      icon: Lock,
      title: "Encrypted by default",
      body: "Size, collateral, and entry price are stored as FHE ciphertexts in the Vault. The chain computes on encrypted state — nobody, including the engine, sees your numbers.",
    },
    {
      icon: EyeOff,
      title: "Dark pool batch orders",
      body: "Submit limit orders with encrypted size, collateral, and price. The matcher fills batches without revealing individual intent — front-running has nothing to read.",
    },
    {
      icon: Bot,
      title: "Async settlement",
      body: "Decrypt callbacks land via Zama's KMS, then a relayer bot finalizes withdrawals and matches. You sign the encrypt; the bot pays the gas to settle.",
    },
    {
      icon: ShieldCheck,
      title: "KYC, off-chain. Allowlist, on-chain.",
      body: "A merkle-root commits the allowlist. You include a sibling proof in every order — the engine verifies you, but learns nothing about who else is on the list.",
    },
    {
      icon: Database,
      title: "ERC-7984 confidential token",
      body: "USDCx balances are themselves ciphertexts. The Vault holds them via OpenZeppelin's confidential ERC-7984 standard — no plaintext anywhere in the deposit path.",
    },
    {
      icon: LineChart,
      title: "Three perps, BTC · ETH · SOL",
      body: "Plaintext oracle prices feed the engine; positions stay encrypted on settle. Two-of-three relayer quorum commits prices. Stale prices are rejected.",
    },
  ];

  return (
    <section>
      <div className="mb-8">
        <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-noir-accent2 mb-1.5">
          Why FHE
        </div>
        <h2 className="text-2xl md:text-3xl font-semibold tracking-tight text-noir-white max-w-2xl">
          Privacy you can verify, not a promise you can't.
        </h2>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {features.map((f) => (
          <Card key={f.title} interactive className="p-6">
            <div className="h-9 w-9 rounded-lg bg-noir-accent/10 border border-noir-accent/30 flex items-center justify-center mb-4">
              <f.icon size={16} className="text-noir-accent2" />
            </div>
            <h3 className="text-sm font-semibold text-noir-white mb-1.5">{f.title}</h3>
            <p className="text-[13px] text-noir-dim leading-relaxed">{f.body}</p>
          </Card>
        ))}
      </div>
    </section>
  );
}

// ---------- How it works --------------------------------------------------

function HowItWorks() {
  const steps = [
    {
      n: "01",
      title: "Encrypt locally",
      body: "The relayer SDK encrypts size and collateral in your browser, producing an FHE ciphertext + zero-knowledge input proof.",
    },
    {
      n: "02",
      title: "Submit on-chain",
      body: "PerpEngine.openPosition consumes the ciphertext, verifies the input proof + your KYC merkle proof, and stores the position in the Vault.",
    },
    {
      n: "03",
      title: "Settle async",
      body: "Closes and dark-pool matches request decryption via the Zama KMS. The settlement bot finalizes once the cleartext callback lands.",
    },
  ];
  return (
    <section>
      <div className="mb-8">
        <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-noir-accent2 mb-1.5">
          The flow
        </div>
        <h2 className="text-2xl md:text-3xl font-semibold tracking-tight text-noir-white max-w-2xl">
          Three steps, fully on-chain, fully private.
        </h2>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {steps.map((s) => (
          <Card key={s.n} className="p-6 relative overflow-hidden">
            <div className="text-[11px] font-mono font-semibold text-noir-accent2 mb-3">
              {s.n}
            </div>
            <h3 className="text-base font-semibold text-noir-white mb-1.5">{s.title}</h3>
            <p className="text-[13px] text-noir-dim leading-relaxed">{s.body}</p>
          </Card>
        ))}
      </div>
    </section>
  );
}

// ---------- Final CTA -----------------------------------------------------

function FinalCta() {
  return (
    <section className="relative">
      <Card className="relative overflow-hidden p-10 md:p-14">
        <div
          aria-hidden
          className="absolute -inset-x-20 -top-32 h-64 bg-noir-radial opacity-60"
        />
        <div className="relative flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="max-w-xl">
            <h2 className="text-2xl md:text-3xl font-semibold tracking-tight text-noir-white mb-2">
              Trade like nobody is watching.
            </h2>
            <p className="text-sm text-noir-dim">
              Open the trade panel, encrypt your first position, and decrypt
              your own state with one click.
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <Link
              to="/trade"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-noir-accent text-white font-semibold border border-noir-accent2/40 shadow-glow-violet hover:bg-noir-violet transition-all"
            >
              Open trading
              <ArrowUpRight size={14} />
            </Link>
            <Link
              to="/portfolio"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg border border-noir-edge text-noir-white font-medium hover:bg-noir-raised transition-all"
            >
              View portfolio
            </Link>
          </div>
        </div>
      </Card>
    </section>
  );
}
