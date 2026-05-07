import { Link } from "react-router-dom";
import { useState, useEffect } from "react";
import {
  BookOpen, Lock, ShieldCheck, Coins, EyeOff, Wallet,
  ArrowRight, ExternalLink, Eye, Cpu, Network, Sparkles,
} from "lucide-react";
import clsx from "clsx";
import { Card, SectionHeader, Badge } from "../components/ui";

export default function Docs() {
  return (
    <div className="space-y-12">
      <SectionHeader
        eyebrow={<><BookOpen size={10} /> How it works</>}
        title={<>Trade with <span className="shimmer-text">privacy</span>, in four steps.</>}
        description="Encrypted size. Encrypted collateral. Encrypted P&L. Visible mechanism, invisible state."
      />

      <Hero />

      <StepRow
        n={1}
        title="Verify your wallet"
        caption="Your address joins an on-chain Merkle allowlist. The proof reveals nothing about who else is on it."
        cta="Compliance"
        to="/compliance"
        diagram={<MerkleAnimation />}
      />

      <StepRow
        n={2}
        title="Get USDCx"
        caption="Mint, wrap, deposit. The vault holds your balance as ciphertext only you can decrypt."
        cta="Faucet"
        to="/faucet"
        diagram={<FundingAnimation />}
        flip
      />

      <StepRow
        n={3}
        title="Submit an encrypted order"
        caption="Size, collateral, and limit are encrypted in your browser before the tx is signed."
        cta="Darkpool"
        to="/darkpool"
        diagram={<EncryptAnimation />}
      />

      <StepRow
        n={4}
        title="Reveal or close"
        caption="Only your signature decrypts your positions. Closing settles encrypted P&L back to your vault."
        cta="Portfolio"
        to="/portfolio"
        diagram={<RevealAnimation />}
        flip
      />

      <PrivacyVisual />
      <PipelineFlow />
      <Resources />
    </div>
  );
}

/* ─── Hero ──────────────────────────────────────────────────────── */

function Hero() {
  return (
    <Card hero className="p-8 md:p-10 relative overflow-hidden animate-fade-up">
      <div aria-hidden className="absolute -inset-x-32 -top-40 h-80 opacity-70 pointer-events-none bg-[radial-gradient(ellipse_at_top,rgba(94,234,212,0.18),transparent_60%)] animate-drift-y" />
      <div aria-hidden className="absolute inset-0 bg-grid-dots opacity-[0.18] pointer-events-none [mask-image:radial-gradient(ellipse_at_center,black,transparent_80%)]" />
      <div aria-hidden className="absolute -right-12 -bottom-12 h-44 w-44 rounded-full bg-noir-accent/[0.08] blur-3xl pointer-events-none animate-pulse-soft" />
      <div className="relative grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-8 items-center">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-[0.22em] text-noir-cream/40 mb-3">In one line</div>
          <div className="font-display text-[28px] md:text-[34px] font-medium text-noir-cream tracking-[-0.02em] leading-snug max-w-[60ch]">
            Submit an encrypted order. The chain settles it without anyone seeing the <span className="shimmer-text">numbers</span>.
          </div>
        </div>
        <CipherIllustration />
      </div>
    </Card>
  );
}

function CipherIllustration() {
  return (
    <div className="relative w-[200px] h-[200px] hidden lg:flex items-center justify-center shrink-0">
      <div aria-hidden className="absolute inset-0 rounded-full bg-noir-accent/[0.06] blur-2xl animate-pulse-soft" />
      <div className="relative h-32 w-32 rounded-2xl bg-noir-cream/[0.04] border border-noir-cream/15 flex items-center justify-center animate-drift-y">
        <Lock size={52} className="text-noir-accent" strokeWidth={1.4} />
      </div>
      <div className="absolute top-3 right-3 font-mono text-[10px] text-noir-cream/35 tabular-nums animate-pulse-soft">0x7f3e</div>
      <div className="absolute bottom-5 left-2 font-mono text-[10px] text-noir-cream/35 tabular-nums animate-pulse-soft" style={{ animationDelay: "1.2s" }}>0xab02</div>
      <div className="absolute top-1/2 left-0 font-mono text-[10px] text-noir-cream/35 tabular-nums animate-pulse-soft" style={{ animationDelay: "0.6s" }}>0xcc91</div>
      <div className="absolute top-4 left-6 font-mono text-[10px] text-noir-cream/35 tabular-nums animate-pulse-soft" style={{ animationDelay: "1.8s" }}>0x44de</div>
      <div className="absolute bottom-2 right-4 font-mono text-[10px] text-noir-cream/35 tabular-nums animate-pulse-soft" style={{ animationDelay: "0.3s" }}>0x12a0</div>
    </div>
  );
}

/* ─── Step row — visual-first ───────────────────────────────────── */

function StepRow({
  n, title, caption, cta, to, diagram, flip,
}: {
  n: number;
  title: string; caption: string;
  cta: string; to: string;
  diagram: React.ReactNode;
  flip?: boolean;
}) {
  return (
    <div className="animate-fade-up" style={{ animationDelay: `${(n - 1) * 80}ms` }}>
      <Card className="p-6 md:p-10 group relative overflow-hidden hover:border-noir-accent/25 transition-colors duration-300">
        <div className={clsx(
          "grid grid-cols-1 lg:grid-cols-2 gap-8 items-center",
          flip && "lg:[&>*:first-child]:order-2",
        )}>
          {/* Caption side */}
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="font-display text-[80px] md:text-[100px] font-medium text-noir-cream/15 leading-none group-hover:text-noir-cream/30 transition-colors duration-500">
                {n}
              </div>
            </div>
            <div className="font-display text-[24px] md:text-[28px] font-medium text-noir-cream tracking-[-0.01em] mb-3">
              {title}
            </div>
            <div className="text-[14px] text-noir-cream/55 leading-relaxed mb-6 max-w-[40ch]">
              {caption}
            </div>
            <Link
              to={to}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-noir-cream/[0.05] border border-noir-cream/15 text-[13px] font-medium text-noir-cream hover:bg-noir-accent/[0.08] hover:border-noir-accent/40 hover:text-noir-accent transition-all duration-200"
            >
              {cta} <ArrowRight size={13} className="transition-transform duration-300 group-hover:translate-x-1" />
            </Link>
          </div>
          {/* Diagram side */}
          <div className="relative">
            {diagram}
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ─── Animation 1: Merkle proof ─────────────────────────────────── */

function MerkleAnimation() {
  return (
    <div className="relative h-[300px] flex items-center justify-center">
      <svg viewBox="0 0 360 300" className="w-full h-full max-w-[400px]">
        <defs>
          <radialGradient id="rootGlow" cx="50%" cy="50%">
            <stop offset="0%" stopColor="rgba(94,234,212,0.45)" />
            <stop offset="100%" stopColor="rgba(94,234,212,0)" />
          </radialGradient>
        </defs>

        {/* Tree edges */}
        <line x1="180" y1="50"  x2="100" y2="130" stroke="rgba(243,237,224,0.20)" strokeWidth="1" />
        <line x1="180" y1="50"  x2="260" y2="130" stroke="rgba(94,234,212,0.50)"   strokeWidth="1.6" className="animate-pulse-soft" />
        <line x1="100" y1="130" x2="60"  y2="220" stroke="rgba(243,237,224,0.15)" strokeWidth="1" />
        <line x1="100" y1="130" x2="140" y2="220" stroke="rgba(243,237,224,0.15)" strokeWidth="1" />
        <line x1="260" y1="130" x2="220" y2="220" stroke="rgba(94,234,212,0.50)"   strokeWidth="1.6" className="animate-pulse-soft" />
        <line x1="260" y1="130" x2="300" y2="220" stroke="rgba(243,237,224,0.30)" strokeWidth="1.2" />

        {/* Root */}
        <circle cx="180" cy="50" r="22" fill="url(#rootGlow)" />
        <circle cx="180" cy="50" r="14" fill="rgba(94,234,212,0.10)" stroke="rgba(94,234,212,0.65)" strokeWidth="1.4" className="animate-pulse-soft" />
        <text x="180" y="54" textAnchor="middle" fontSize="10" fill="rgba(94,234,212,0.95)" fontFamily="var(--font-mono, ui-monospace)" fontWeight="600">root</text>

        {/* Mid nodes */}
        <circle cx="100" cy="130" r="10" fill="rgba(243,237,224,0.04)" stroke="rgba(243,237,224,0.20)" strokeWidth="1" />
        <circle cx="260" cy="130" r="10" fill="rgba(94,234,212,0.08)" stroke="rgba(94,234,212,0.45)" strokeWidth="1.2" />

        {/* Leaves */}
        <circle cx="60"  cy="220" r="9" fill="rgba(243,237,224,0.04)" stroke="rgba(243,237,224,0.15)" strokeWidth="1" />
        <circle cx="140" cy="220" r="9" fill="rgba(243,237,224,0.04)" stroke="rgba(243,237,224,0.15)" strokeWidth="1" />
        <circle cx="220" cy="220" r="9" fill="rgba(94,234,212,0.10)" stroke="rgba(94,234,212,0.55)" strokeWidth="1.2" />
        <circle cx="300" cy="220" r="9" fill="rgba(243,237,224,0.04)" stroke="rgba(243,237,224,0.20)" strokeWidth="1" />

        {/* Highlighted leaf — your address */}
        <circle cx="220" cy="220" r="14" fill="none" stroke="rgba(94,234,212,0.40)" strokeWidth="1" className="animate-pulse-soft">
          <animate attributeName="r" from="11" to="20" dur="1.6s" repeatCount="indefinite" />
          <animate attributeName="opacity" from="0.6" to="0" dur="1.6s" repeatCount="indefinite" />
        </circle>
        <text x="220" y="252" textAnchor="middle" fontSize="9.5" fill="rgba(94,234,212,0.85)" fontFamily="var(--font-mono, ui-monospace)">0x87E6…6D67</text>
        <text x="220" y="266" textAnchor="middle" fontSize="8.5" fill="rgba(243,237,224,0.40)" fontFamily="var(--font-mono, ui-monospace)">you</text>

        {/* Sibling labels */}
        <text x="60"  y="252" textAnchor="middle" fontSize="8.5" fill="rgba(243,237,224,0.30)" fontFamily="var(--font-mono, ui-monospace)">·</text>
        <text x="140" y="252" textAnchor="middle" fontSize="8.5" fill="rgba(243,237,224,0.30)" fontFamily="var(--font-mono, ui-monospace)">·</text>
        <text x="300" y="252" textAnchor="middle" fontSize="8.5" fill="rgba(243,237,224,0.30)" fontFamily="var(--font-mono, ui-monospace)">·</text>

        {/* Caption */}
        <text x="180" y="290" textAnchor="middle" fontSize="10" fill="rgba(243,237,224,0.45)" fontFamily="var(--font-mono, ui-monospace)" letterSpacing="2">PROOF · 2 SIBLINGS</text>
      </svg>
    </div>
  );
}

/* ─── Animation 2: Funding flow ─────────────────────────────────── */

function FundingAnimation() {
  return (
    <div className="relative h-[300px] flex items-center justify-center">
      <svg viewBox="0 0 480 300" className="w-full h-full max-w-[480px]">
        <defs>
          <marker id="arrow-fund" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
            <path d="M0,0 L0,6 L9,3 z" fill="rgba(94,234,212,0.55)" />
          </marker>
        </defs>

        {/* Three stages: USDC → USDCx → Vault */}
        <FundStage x={20}  label="USDC"   sub="public ERC-20"  number="10,000" />
        <FundStage x={180} label="USDCx"  sub="ERC-7984"        number="🔒" mint />
        <FundStage x={340} label="Vault"  sub="encrypted state" number="🔒" mint highlight />

        {/* Connecting arrows */}
        <line x1="140" y1="150" x2="180" y2="150" stroke="rgba(94,234,212,0.55)" strokeWidth="1.4" markerEnd="url(#arrow-fund)" />
        <line x1="300" y1="150" x2="340" y2="150" stroke="rgba(94,234,212,0.55)" strokeWidth="1.4" markerEnd="url(#arrow-fund)" />

        {/* Coin moving along the path */}
        <g>
          <circle r="6" fill="rgba(94,234,212,0.85)">
            <animateMotion dur="3.5s" repeatCount="indefinite"
              path="M 140 150 L 180 150 L 300 150 L 340 150" />
            <animate attributeName="opacity" values="0;1;1;1;0" dur="3.5s" repeatCount="indefinite" />
          </circle>
        </g>

        {/* Stage labels under arrows */}
        <text x="160" y="135" textAnchor="middle" fontSize="9" fill="rgba(243,237,224,0.45)" fontFamily="var(--font-mono, ui-monospace)">wrap</text>
        <text x="320" y="135" textAnchor="middle" fontSize="9" fill="rgba(243,237,224,0.45)" fontFamily="var(--font-mono, ui-monospace)">deposit</text>

        {/* Caption */}
        <text x="240" y="285" textAnchor="middle" fontSize="10" fill="rgba(243,237,224,0.45)" fontFamily="var(--font-mono, ui-monospace)" letterSpacing="2">5 TXS · ~30 SECONDS</text>
      </svg>
    </div>
  );
}

function FundStage({
  x, label, sub, number, mint, highlight,
}: { x: number; label: string; sub: string; number: string; mint?: boolean; highlight?: boolean }) {
  const fill = mint ? "rgba(94,234,212,0.06)" : "rgba(243,237,224,0.03)";
  const stroke = mint
    ? highlight ? "rgba(94,234,212,0.65)" : "rgba(94,234,212,0.40)"
    : "rgba(243,237,224,0.15)";
  return (
    <g>
      <rect x={x} y={100} width={120} height={100} rx={12} fill={fill} stroke={stroke} strokeWidth={highlight ? 1.5 : 1}
        className={highlight ? "animate-pulse-soft" : ""} />
      <text x={x + 60} y={130} textAnchor="middle" fontSize="13" fill="rgba(243,237,224,0.95)" fontFamily="var(--font-display, sans-serif)" fontWeight="600">{label}</text>
      <text x={x + 60} y={148} textAnchor="middle" fontSize="9.5" fill="rgba(243,237,224,0.45)" fontFamily="var(--font-mono, ui-monospace)">{sub}</text>
      <text x={x + 60} y={183} textAnchor="middle" fontSize={number === "🔒" ? "22" : "16"} fill={mint ? "rgba(94,234,212,0.95)" : "rgba(243,237,224,0.85)"} fontFamily="var(--font-display, sans-serif)" fontWeight="500">{number}</text>
    </g>
  );
}

/* ─── Animation 3: Encrypt fields ───────────────────────────────── */

function EncryptAnimation() {
  // Cycles between plaintext and ciphertext views to show what encryption does.
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setPhase(p => (p + 1) % 2), 2400);
    return () => clearInterval(id);
  }, []);
  const fields = [
    { label: "size",       plain: "1",      cipher: "0x9f3e…02ab" },
    { label: "collateral", plain: "200",    cipher: "0x4c01…ee29" },
    { label: "limit",      plain: "2,600",  cipher: "0x7704…1893" },
  ];
  const encrypted = phase === 1;
  return (
    <div className="relative h-[300px] flex flex-col items-center justify-center gap-3">
      <div className="text-[10px] font-medium uppercase tracking-[0.22em] text-noir-cream/40 mb-1">
        {encrypted ? "after encrypt()" : "your input"}
      </div>
      <div className="w-full max-w-[320px] space-y-2">
        {fields.map((f, i) => (
          <div
            key={f.label}
            className={clsx(
              "flex items-baseline justify-between gap-2 px-4 py-2.5 rounded-lg border transition-all duration-500",
              encrypted
                ? "bg-noir-accent/[0.05] border-noir-accent/30"
                : "bg-noir-cream/[0.04] border-noir-cream/10",
            )}
            style={{ transitionDelay: `${i * 80}ms` }}
          >
            <span className="text-[10px] uppercase tracking-[0.14em] text-noir-cream/45">{f.label}</span>
            <span className={clsx(
              "text-[12px] font-mono transition-opacity duration-300",
              encrypted ? "text-noir-accent/85" : "text-noir-cream/85",
            )}>
              {encrypted && <Lock size={9} className="inline mr-1 -mt-0.5" />}
              {encrypted ? f.cipher : f.plain}
            </span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.22em] text-noir-cream/40 mt-2">
        <span className={clsx(!encrypted && "text-noir-cream/85")}>plaintext</span>
        <ArrowRight size={11} className={clsx("transition-transform duration-500", encrypted ? "rotate-0" : "-rotate-180")} />
        <span className={clsx(encrypted && "text-noir-accent")}>ciphertext</span>
      </div>
    </div>
  );
}

/* ─── Animation 4: Reveal ───────────────────────────────────────── */

function RevealAnimation() {
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="relative h-[300px] flex flex-col items-center justify-center gap-3">
      <div className="w-full max-w-[320px] rounded-xl bg-noir-cream/[0.025] border border-noir-cream/[0.08] p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[11px] font-display font-semibold text-noir-cream">Position #4</div>
          <Badge tone="mint">long · ETH</Badge>
        </div>
        <div className="space-y-1.5">
          {[
            { k: "size",  cipher: "0xa1b2…dd91", plain: "1.0" },
            { k: "entry", cipher: "0x55ed…02fe", plain: "2,389.00" },
            { k: "P&L",   cipher: "0xc7f0…aa12", plain: "+12.40", green: true },
          ].map((row, i) => (
            <div
              key={row.k}
              className="flex items-baseline justify-between gap-2 px-2.5 py-1.5 rounded-md bg-noir-cream/[0.02]"
              style={{ transitionDelay: `${i * 70}ms` }}
            >
              <span className="text-[10px] uppercase tracking-[0.14em] text-noir-cream/45">{row.k}</span>
              <span className={clsx(
                "text-[12px] font-mono transition-all duration-500",
                revealed
                  ? row.green ? "text-noir-accent" : "text-noir-cream/90"
                  : "text-noir-cream/55",
              )}>
                {!revealed && <Lock size={9} className="inline mr-1 -mt-0.5" />}
                {revealed ? row.plain : row.cipher}
              </span>
            </div>
          ))}
        </div>
      </div>
      <button
        type="button"
        onClick={() => setRevealed(!revealed)}
        className={clsx(
          "inline-flex items-center justify-center gap-1.5 px-5 py-2 rounded-full text-[12px] font-semibold tracking-tight transition-all duration-200",
          revealed
            ? "bg-noir-cream/[0.08] text-noir-cream border border-noir-cream/15 hover:bg-noir-cream/[0.12]"
            : "bg-noir-cream text-noir-black hover:bg-noir-accent",
        )}
      >
        {revealed ? <><Lock size={11} /> Hide</> : <><Eye size={11} /> Reveal (signs as you)</>}
      </button>
      <div className="text-[10px] font-medium uppercase tracking-[0.22em] text-noir-cream/40">
        {revealed ? "decrypted in your browser" : "ciphertext on-chain"}
      </div>
    </div>
  );
}

/* ─── Privacy split — visual icons, no paragraphs ───────────────── */

function PrivacyVisual() {
  const enc = ["size", "collateral", "limit price", "P&L", "vault balance", "LP shares"];
  const pub = ["wallet address", "market id", "side", "timestamp", "merkle proof", "oracle price"];
  return (
    <div className="space-y-3">
      <SubHeader eyebrow="What's hidden" title="Six fields encrypted, six visible. By design." />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card className="p-6 relative overflow-hidden border-noir-accent/25">
          <div aria-hidden className="absolute -inset-x-16 -top-16 h-32 opacity-60 pointer-events-none bg-[radial-gradient(ellipse_at_top,rgba(94,234,212,0.16),transparent_70%)] animate-pulse-soft" />
          <div className="relative">
            <div className="flex items-center gap-2 mb-5">
              <Lock size={14} className="text-noir-accent" />
              <div className="font-display text-[14px] font-semibold text-noir-cream">Encrypted</div>
              <Badge tone="mint">FHE</Badge>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {enc.map((f, i) => (
                <div
                  key={f}
                  className="px-3 py-2.5 rounded-lg bg-noir-accent/[0.06] border border-noir-accent/25 text-[12px] font-mono text-noir-accent/90 text-center animate-fade-up"
                  style={{ animationDelay: `${i * 60}ms` }}
                >
                  <Lock size={9} className="inline mr-1 -mt-0.5" />
                  {f}
                </div>
              ))}
            </div>
          </div>
        </Card>
        <Card className="p-6">
          <div className="flex items-center gap-2 mb-5">
            <Eye size={14} className="text-noir-cream/55" />
            <div className="font-display text-[14px] font-semibold text-noir-cream">Public</div>
            <Badge tone="neutral">on-chain</Badge>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {pub.map((f, i) => (
              <div
                key={f}
                className="px-3 py-2.5 rounded-lg bg-noir-cream/[0.04] border border-noir-cream/[0.10] text-[12px] font-mono text-noir-cream/65 text-center animate-fade-up"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                {f}
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ─── Pipeline flow — animated traveling dots ───────────────────── */

function PipelineFlow() {
  const stages = [
    { label: "Submit",   sub: "encrypted tx" },
    { label: "Compute",  sub: "FHE in engine" },
    { label: "Decrypt",  sub: "KMS quorum" },
    { label: "Callback", sub: "bot relays" },
    { label: "Settle",   sub: "positions open" },
  ];
  return (
    <div className="space-y-3">
      <SubHeader eyebrow="Async pipeline" title="Submit to settled, ~30–90 seconds." />
      <Card className="p-7 relative overflow-hidden">
        <div aria-hidden className="absolute -inset-x-32 -top-20 h-40 opacity-50 pointer-events-none bg-[radial-gradient(ellipse_at_top,rgba(94,234,212,0.10),transparent_70%)]" />
        <svg viewBox="0 0 800 160" className="w-full h-auto relative">
          <defs>
            <marker id="arrow-pipe" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
              <path d="M0,0 L0,6 L9,3 z" fill="rgba(243,237,224,0.40)" />
            </marker>
          </defs>

          {stages.map((s, i) => {
            const x = 60 + i * 170;
            const last = i === stages.length - 1;
            return (
              <g key={s.label}>
                <circle
                  cx={x} cy={60} r="22"
                  fill={last ? "rgba(94,234,212,0.10)" : "rgba(243,237,224,0.04)"}
                  stroke={last ? "rgba(94,234,212,0.55)" : "rgba(243,237,224,0.20)"}
                  strokeWidth="1.4"
                  className={last ? "animate-pulse-soft" : ""}
                />
                <text x={x} y={64} textAnchor="middle" fontSize="11" fill="rgba(243,237,224,0.85)" fontFamily="var(--font-display, sans-serif)" fontWeight="600">{i + 1}</text>
                <text x={x} y={100} textAnchor="middle" fontSize="13" fill={last ? "rgba(94,234,212,0.95)" : "rgba(243,237,224,0.85)"} fontFamily="var(--font-display, sans-serif)" fontWeight="600">{s.label}</text>
                <text x={x} y={117} textAnchor="middle" fontSize="10" fill="rgba(243,237,224,0.45)" fontFamily="var(--font-mono, ui-monospace)">{s.sub}</text>
                {i < stages.length - 1 && (
                  <line x1={x + 25} y1="60" x2={x + 145} y2="60"
                    stroke="rgba(243,237,224,0.30)" strokeWidth="1.2" markerEnd="url(#arrow-pipe)" />
                )}
              </g>
            );
          })}

          {/* A traveling dot to suggest motion through the pipeline */}
          <circle r="4" fill="rgba(94,234,212,0.95)">
            <animateMotion dur="5s" repeatCount="indefinite"
              path="M 60 60 L 230 60 L 400 60 L 570 60 L 740 60" />
            <animate attributeName="opacity" values="0;1;1;1;0" dur="5s" repeatCount="indefinite" />
          </circle>
        </svg>
      </Card>
    </div>
  );
}

/* ─── Resources ─────────────────────────────────────────────────── */

function Resources() {
  const links = [
    { label: "GitHub README",    href: "https://github.com/JemIIahh/NoirPerp",                                                              icon: BookOpen },
    { label: "Zama FHEVM docs",  href: "https://docs.zama.org/protocol",                                                                    icon: Cpu },
    { label: "Sepolia explorer", href: "https://sepolia.etherscan.io/address/0x199012e4A7Dd6D7d6B2C4bd49B31Cc9b5Fe80F84",                  icon: Network },
    { label: "ERC-7984",         href: "https://github.com/OpenZeppelin/openzeppelin-confidential-contracts",                              icon: Sparkles },
  ];
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {links.map((l, i) => {
        const Icon = l.icon;
        return (
          <a
            key={l.label}
            href={l.href}
            target="_blank"
            rel="noreferrer"
            className="group animate-fade-up"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <Card interactive className="p-4 flex items-center gap-3 hover:border-noir-accent/30 hover:-translate-y-0.5 transition-all duration-200">
              <div className="h-9 w-9 rounded-lg bg-noir-cream/[0.05] border border-noir-cream/15 flex items-center justify-center shrink-0 group-hover:bg-noir-accent/[0.08] group-hover:border-noir-accent/35 transition-colors">
                <Icon size={15} className="text-noir-cream/70 group-hover:text-noir-accent transition-colors" strokeWidth={1.6} />
              </div>
              <div className="text-[13px] font-medium text-noir-cream truncate flex-1">{l.label}</div>
              <ExternalLink size={13} className="text-noir-cream/35 group-hover:text-noir-cream/70 transition-colors shrink-0" />
            </Card>
          </a>
        );
      })}
    </div>
  );
}

/* ─── Shared sub-header ─────────────────────────────────────────── */

function SubHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="flex items-baseline gap-3 px-1">
      <span className="text-[10px] font-medium uppercase tracking-[0.22em] text-noir-cream/40">{eyebrow}</span>
      <span className="text-[14px] text-noir-cream/70">{title}</span>
    </div>
  );
}
