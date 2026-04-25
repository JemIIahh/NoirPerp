// Shared UI primitives for the NoirPerp redesign. Kept intentionally
// small — Card / StatCard / Badge / Pill / SectionHeader / Spinner.
// Form primitives live in `Form.tsx`. Encrypted handle reveal lives in
// `EncryptedValue.tsx`. Anything page-specific stays inline on the page.

import { ReactNode } from "react";
import clsx from "clsx";
import { Loader2 } from "lucide-react";

// ---------- Card ----------------------------------------------------------

type CardProps = {
  children: ReactNode;
  className?: string;
  /** Adds a subtle violet accent ring on hover. */
  interactive?: boolean;
  /** Promotes the surface one level (raised cards inside panels). */
  raised?: boolean;
};

export function Card({ children, className, interactive, raised }: CardProps) {
  return (
    <div
      className={clsx(
        "rounded-xl border border-noir-line shadow-inset-line",
        raised ? "bg-noir-raised" : "bg-noir-panel",
        interactive && "transition-all duration-200 hover:border-noir-edge hover:shadow-glow-soft",
        className,
      )}
    >
      {children}
    </div>
  );
}

// ---------- Stat ----------------------------------------------------------

type StatProps = {
  label: string;
  value?: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  accent?: "violet" | "green" | "red" | "amber" | "neutral";
  className?: string;
};

const STAT_ACCENT: Record<NonNullable<StatProps["accent"]>, string> = {
  violet:  "text-noir-accent",
  green:   "text-noir-green",
  red:     "text-noir-red",
  amber:   "text-noir-amber",
  neutral: "text-noir-white",
};

export function Stat({ label, value, hint, icon, accent = "neutral", className }: StatProps) {
  return (
    <Card className={clsx("p-5", className)}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-noir-mute">
          {label}
        </span>
        {icon && <span className={clsx("opacity-70", STAT_ACCENT[accent])}>{icon}</span>}
      </div>
      <div className={clsx("text-2xl font-semibold font-mono leading-none", STAT_ACCENT[accent])}>
        {value ?? <span className="text-noir-mute">—</span>}
      </div>
      {hint && <div className="mt-2 text-xs text-noir-dim">{hint}</div>}
    </Card>
  );
}

// ---------- Badge / Pill --------------------------------------------------

type BadgeTone = "neutral" | "violet" | "green" | "red" | "amber" | "encrypted";

const BADGE_TONE: Record<BadgeTone, string> = {
  neutral:   "bg-noir-line/60 text-noir-dim border-noir-edge",
  violet:    "bg-noir-accent/15 text-noir-accent2 border-noir-accent/40",
  green:     "bg-noir-green/15 text-noir-green border-noir-green/40",
  red:       "bg-noir-red/15 text-noir-red border-noir-red/40",
  amber:     "bg-noir-amber/15 text-noir-amber border-noir-amber/40",
  encrypted: "bg-noir-accent/10 text-noir-accent2 border-noir-accent/30",
};

export function Badge({
  children, tone = "neutral", icon, className,
}: { children: ReactNode; tone?: BadgeTone; icon?: ReactNode; className?: string }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-xs font-medium",
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
  return (
    <div className="flex items-end justify-between gap-6 mb-6">
      <div className="min-w-0">
        {eyebrow && (
          <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-noir-accent2 mb-2">
            {eyebrow}
          </div>
        )}
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-noir-white">
          {title}
        </h1>
        {description && (
          <p className="text-sm text-noir-dim mt-1.5 max-w-2xl">{description}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
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
    <Card className="p-10 flex flex-col items-center text-center">
      {icon && <div className="text-noir-mute mb-3">{icon}</div>}
      <div className="text-sm font-medium text-noir-white">{title}</div>
      {description && <div className="text-xs text-noir-dim mt-1 max-w-sm">{description}</div>}
      {action && <div className="mt-4">{action}</div>}
    </Card>
  );
}
