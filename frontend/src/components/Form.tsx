import { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import clsx from "clsx";
import { Spinner } from "./ui";

// ---------- Field --------------------------------------------------------

export function Field({
  label, hint, children, trailing,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <label className="block">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-noir-mute">
          {label}
        </span>
        {trailing && <span className="text-[10px] text-noir-dim">{trailing}</span>}
      </div>
      <div>{children}</div>
      {hint && <div className="text-xs text-noir-dim mt-1.5">{hint}</div>}
    </label>
  );
}

// ---------- Input --------------------------------------------------------

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  prefix?: ReactNode;
  suffix?: ReactNode;
  invalid?: boolean;
};

export function Input({ prefix, suffix, invalid, className, ...rest }: InputProps) {
  // Wrap in a container only if a prefix/suffix is supplied — keeps
  // the bare input case clean.
  const inputEl = (
    <input
      {...rest}
      className={clsx(
        "w-full bg-noir-black border rounded-lg px-3 py-2.5 font-mono text-sm",
        "text-noir-white placeholder:text-noir-mute/70",
        "focus:outline-none focus:border-noir-accent focus:shadow-glow-soft",
        "transition-colors duration-150",
        invalid ? "border-noir-red/50" : "border-noir-line hover:border-noir-edge",
        prefix && "pl-10",
        suffix && "pr-12",
        className,
      )}
    />
  );

  if (!prefix && !suffix) return inputEl;

  return (
    <div className="relative">
      {prefix && (
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-noir-mute">
          {prefix}
        </div>
      )}
      {inputEl}
      {suffix && (
        <div className="absolute inset-y-0 right-0 flex items-center pr-3 text-noir-mute text-xs font-medium">
          {suffix}
        </div>
      )}
    </div>
  );
}

// ---------- Select -------------------------------------------------------

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={clsx(
        "w-full bg-noir-black border border-noir-line rounded-lg px-3 py-2.5 text-sm",
        "text-noir-white",
        "focus:outline-none focus:border-noir-accent focus:shadow-glow-soft",
        "hover:border-noir-edge transition-colors duration-150 cursor-pointer",
        // Native arrow can be ugly on Linux/Win; keep but tone it down.
        "appearance-none bg-no-repeat bg-[right_0.75rem_center]",
        props.className,
      )}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b6b7a' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")",
        paddingRight: "2.25rem",
        ...(props.style ?? {}),
      }}
    />
  );
}

// ---------- Button -------------------------------------------------------

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success";
type ButtonSize = "sm" | "md" | "lg";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
};

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    "bg-noir-accent text-white border-noir-accent2/40 font-semibold " +
    "hover:bg-noir-violet hover:shadow-glow-violet " +
    "active:translate-y-px",
  secondary:
    "bg-noir-raised text-noir-white border-noir-edge " +
    "hover:bg-noir-hover hover:border-noir-accent/40",
  ghost:
    "bg-transparent text-noir-dim border-transparent " +
    "hover:bg-noir-raised hover:text-noir-white",
  danger:
    "bg-noir-red/10 text-noir-red border-noir-red/40 " +
    "hover:bg-noir-red/20 hover:border-noir-red/60",
  success:
    "bg-noir-green/15 text-noir-green border-noir-green/40 " +
    "hover:bg-noir-green/25 hover:border-noir-green/60",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2.5 text-sm",
  lg: "px-5 py-3 text-sm",
};

export function Button({
  variant = "primary",
  size = "md",
  loading,
  leadingIcon,
  trailingIcon,
  children,
  disabled,
  className,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-lg border font-medium",
        "transition-all duration-150",
        "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none",
        VARIANT[variant],
        SIZE[size],
        className,
      )}
    >
      {loading ? <Spinner size={14} /> : leadingIcon}
      {children}
      {!loading && trailingIcon}
    </button>
  );
}
