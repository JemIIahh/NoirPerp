// Shared UI primitives for the NoirPerp redesign. Glass surfaces, varied
// tonal accents (mint / violet / amber / rose), motion on hover.

import { CSSProperties, ReactNode } from "react";
import clsx from "clsx";
import { Loader2 } from "lucide-react";

// ---------- Card ----------------------------------------------------------

type CardProps = {
  children: ReactNode;
  className?: string;
  /** Adds the glass-hover lift+border treatment. */
  interactive?: boolean;
  /** Stronger glass — used for hero cards above the rest of the grid. */
  hero?: boolean;
  style?: CSSProperties;
};

export function Card({ children, className, interactive, hero, style }: CardProps) {
  return (
    <div
      style={style}
      className={clsx(
        "relative rounded-2xl",
        hero ? "glass-strong" : "glass",
        interactive && "glass-hover cursor-default",
        className,
      )}
    >
      {children}
    </div>
  );
}

// ---------- Stat ----------------------------------------------------------

// Cream + mint only — matches the landing page. Amber is reserved for
// semantic warnings (e.g. "stale", "request access"), not decorative.
type StatAccent = "mint" | "neutral" | "amber";

type StatProps = {
  label: string;
  value?: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  accent?: StatAccent;
  className?: string;
};

const ACCENT_TEXT: Record<StatAccent, string> = {
  mint:    "text-noir-accent",
  neutral: "text-noir-cream",
  amber:   "text-noir-amber",
};

// Halo intensity stays low — these compound on top of the SceneBackdrop
// aurora, and the landing palette is noir + cream-first.
const ACCENT_HALO: Record<StatAccent, string> = {
  mint:    "bg-noir-accent/[0.06]",
  neutral: "bg-noir-cream/[0.04]",
  amber:   "bg-noir-amber/[0.06]",
};

const ACCENT_BORDER: Record<StatAccent, string> = {
  mint:    "border-noir-accent/30",
  neutral: "border-noir-cream/15",
  amber:   "border-noir-amber/25",
};

export function Stat({ label, value, hint, icon, accent = "neutral", className }: StatProps) {
  return (
    <Card interactive className={clsx("p-5 group overflow-hidden", className)}>
      {/* tonal halo bleeds in on hover */}
      <div
        aria-hidden
        className={clsx(
          "absolute -top-16 -right-16 w-48 h-48 rounded-full blur-3xl opacity-50 group-hover:opacity-90 transition-opacity duration-500 pointer-events-none",
          ACCENT_HALO[accent],
        )}
      />
      <div className="relative">
        <div className="flex items-start justify-between gap-3 mb-5">
          <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-noir-cream/45">
            {label}
          </span>
          {icon && (
            <span className={clsx(
              "h-8 w-8 rounded-xl border bg-white/[0.03] flex items-center justify-center backdrop-blur-md",
              ACCENT_BORDER[accent],
              ACCENT_TEXT[accent],
            )}>
              {icon}
            </span>
          )}
        </div>
        <div className={clsx(
          "text-[28px] font-semibold font-display tabular-nums leading-none tracking-[-0.02em]",
          accent === "neutral" ? "text-noir-cream" : ACCENT_TEXT[accent],
        )}>
          {value ?? <span className="text-noir-cream/30">—</span>}
        </div>
        {hint && <div className="mt-3 text-[11px] text-noir-cream/45 leading-relaxed">{hint}</div>}
      </div>
    </Card>
  );
}

// ---------- StatStripCell -------------------------------------------------

// Console-mode counterpart to <Stat>. Same anatomy (label, icon, value,
// hint) but flat — no Card, no halo, no hover lift. Designed to live
// inside a `.console` strip with hairline dividers between cells. Use
// when stats sit in a dense data row instead of a marketing grid.
export function StatStripCell({
  label, value, hint, icon, accent = "neutral", className,
}: StatProps) {
  return (
    <div className={clsx("p-5 min-w-0", className)}>
      <div className="flex items-start justify-between gap-3 mb-4">
        <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-noir-cream/45">
          {label}
        </span>
        {icon && (
          <span className={clsx(
            "h-7 w-7 rounded-md border bg-white/[0.02] flex items-center justify-center",
            ACCENT_BORDER[accent],
            ACCENT_TEXT[accent],
          )}>
            {icon}
          </span>
        )}
      </div>
      <div className={clsx(
        "text-[24px] font-semibold font-display tabular-nums leading-none tracking-[-0.02em] truncate",
        accent === "neutral" ? "text-noir-cream" : ACCENT_TEXT[accent],
      )}>
        {value ?? <span className="text-noir-cream/30">—</span>}
      </div>
      {hint && <div className="mt-3 text-[11px] text-noir-cream/45 leading-relaxed">{hint}</div>}
    </div>
  );
}

// ---------- Badge / Pill --------------------------------------------------

type BadgeTone = "neutral" | "mint" | "green" | "red" | "amber" | "encrypted";

const BADGE_TONE: Record<BadgeTone, string> = {
  neutral:   "bg-white/[0.04] text-noir-cream/65 border-white/10",
  // The "mint" name is historical — the noir.accent token now resolves
  // to Zama yellow (#5eead4) since the 2026-05-07 brand swap.
  mint:      "bg-noir-accent/[0.10] text-noir-accent border-noir-accent/30",
  // green/red/amber kept for SEMANTIC use only:
  //   green = long position
  //   red   = short position
  //   amber = warning state
  green:     "bg-noir-green/[0.10] text-noir-green border-noir-green/30",
  red:       "bg-noir-red/[0.10] text-noir-red border-noir-red/35",
  amber:     "bg-noir-amber/[0.10] text-noir-amber border-noir-amber/30",
  encrypted: "bg-noir-accent/[0.08] text-noir-accent border-noir-accent/25",
};

export function Badge({
  children, tone = "neutral", icon, className,
}: { children: ReactNode; tone?: BadgeTone; icon?: ReactNode; className?: string }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-medium tracking-tight backdrop-blur-md",
        BADGE_TONE[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

// ---------- Section header ------------------------------------------------

export function SectionHeader({
  title, eyebrow, description, action,
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  // Eyebrow is text-only in cream/dim. Mint chip pulled out — mint is
  // reserved for encrypted-state, primary CTA, focus, and live indicators.
  // The shimmer-text on the heading itself carries the mint accent at
  // section-header altitude.
  return (
    <div className="flex items-start justify-between gap-6 animate-fade-up">
      <div className="min-w-0 flex-1">
        {eyebrow && (
          <div className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.26em] text-noir-cream/45 mb-5">
            {eyebrow}
          </div>
        )}
        <h1 className="font-display text-[30px] md:text-[38px] font-medium tracking-[-0.025em] leading-[1.05] text-noir-cream">
          {title}
        </h1>
        {description && (
          <p className="text-[13px] text-noir-cream/55 mt-3 max-w-xl leading-relaxed">{description}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

// ---------- Key/Value row -------------------------------------------------

export function KeyValue({
  label, value, mono, accent, hint,
}: {
  label: ReactNode;
  value: ReactNode;
  mono?: boolean;
  accent?: boolean;
  hint?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-[10px] uppercase tracking-[0.16em] text-noir-cream/40 font-medium">
        {label}
      </span>
      <span className={clsx(
        mono && "font-mono tabular-nums",
        hint ? "text-noir-cream/55 text-[12px]" : "text-noir-cream text-[13px]",
        accent && "text-noir-accent",
      )}>
        {value}
      </span>
    </div>
  );
}

// ---------- Toggle Pills (Long/Short) -------------------------------------

type ToggleOption<T extends string | number> = {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  tone?: "green" | "red" | "violet" | "neutral";
};

// `violet` kept as a key but rendered with mint styling — keeps the API
// stable while honoring the cream + mint landing palette.
const TOGGLE_TONE: Record<NonNullable<ToggleOption<string>["tone"]>, string> = {
  green:   "bg-noir-green/[0.10] text-noir-green border-noir-green/40 shadow-[0_0_30px_-8px_rgba(61,220,132,0.5)]",
  red:     "bg-noir-red/[0.10] text-noir-red border-noir-red/40 shadow-[0_0_30px_-8px_rgba(255,92,92,0.5)]",
  violet:  "bg-noir-accent/[0.12] text-noir-accent border-noir-accent/40 shadow-[0_0_30px_-8px_rgba(94,234,212,0.5)]",
  neutral: "bg-noir-cream/[0.06] text-noir-cream border-noir-cream/20",
};

export function TogglePills<T extends string | number>({
  value, options, onChange, className,
}: {
  value: T;
  options: ToggleOption<T>[];
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        "grid gap-1 p-1 rounded-2xl bg-black/30 border border-white/[0.05] backdrop-blur-md",
        className,
      )}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={String(opt.value)}
            type="button"
            onClick={() => onChange(opt.value)}
            className={clsx(
              "flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-200",
              active
                ? `border ${TOGGLE_TONE[opt.tone ?? "neutral"]}`
                : "border border-transparent text-noir-cream/40 hover:text-noir-cream hover:bg-white/[0.03]",
            )}
          >
            {opt.icon}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------- Spinner -------------------------------------------------------

export function Spinner({ className, size = 14 }: { className?: string; size?: number }) {
  return <Loader2 size={size} className={clsx("animate-spin", className)} />;
}

// ---------- Empty state ---------------------------------------------------

export function EmptyState({
  icon, title, description, action,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Card className="p-12 flex flex-col items-center text-center relative overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-0 bg-grid-dots opacity-[0.18] pointer-events-none [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]"
      />
      {/* Conic ring around the icon — quiet motion. */}
      {icon && (
        <div className="relative mb-5 h-14 w-14 rounded-2xl flex items-center justify-center">
          <div className="absolute inset-0 rounded-2xl conic-ring opacity-40" />
          <div className="absolute inset-[1px] rounded-2xl bg-noir-black/80 backdrop-blur-md flex items-center justify-center text-noir-cream/60">
            {icon}
          </div>
        </div>
      )}
      <div className="relative font-display text-[16px] font-medium text-noir-cream tracking-tight">{title}</div>
      {description && <div className="relative text-[12px] text-noir-cream/50 mt-2 max-w-sm leading-relaxed">{description}</div>}
      {action && <div className="relative mt-5">{action}</div>}
    </Card>
  );
}
