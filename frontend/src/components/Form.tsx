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
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-noir-mute">
          {label}
        </span>
        {trailing && <span className="text-[10px] text-noir-cream/50 font-medium">{trailing}</span>}
      </div>
      <div>{children}</div>
      {hint && <div className="text-[11px] text-noir-cream/45 mt-2 leading-relaxed">{hint}</div>}
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
        "w-full bg-black/30 border rounded-xl px-3.5 py-3.5 font-mono text-[15px]",
        "text-noir-cream placeholder:text-noir-cream/25",
        "backdrop-blur-md",
        "focus:outline-none focus:border-noir-accent/70 focus:shadow-[0_0_0_3px_rgba(94,234,212,0.10)] focus:bg-black/50",
        "transition-all duration-200",
        invalid ? "border-noir-red/50" : "border-white/[0.07] hover:border-white/15",
        prefix && "pl-11",
        suffix && "pr-16",
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
        <div className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-noir-cream/45 text-[11px] font-medium uppercase tracking-[0.1em]">
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
        "w-full bg-black/30 border border-white/[0.07] rounded-xl px-3.5 py-3.5 text-[14px]",
        "text-noir-cream backdrop-blur-md",
        "focus:outline-none focus:border-noir-accent/70 focus:shadow-[0_0_0_3px_rgba(94,234,212,0.10)]",
        "hover:border-white/15 transition-colors duration-200 cursor-pointer",
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
    "bg-noir-cream text-noir-black border-noir-cream font-semibold " +
    "hover:bg-noir-accent hover:border-noir-accent " +
    "hover:shadow-[0_8px_28px_-6px_rgba(94,234,212,0.5)] " +
    "active:translate-y-px",
  secondary:
    "bg-white/[0.05] text-noir-cream border-white/10 backdrop-blur-md " +
    "hover:bg-white/[0.10] hover:border-white/20",
  ghost:
    "bg-transparent text-noir-cream/55 border-transparent " +
    "hover:bg-white/[0.05] hover:text-noir-cream",
  danger:
    "bg-noir-red/[0.10] text-noir-red border-noir-red/35 backdrop-blur-md " +
    "hover:bg-noir-red/[0.18] hover:border-noir-red/55",
  success:
    "bg-noir-accent/[0.10] text-noir-accent border-noir-accent/35 backdrop-blur-md " +
    "hover:bg-noir-accent/[0.18] hover:border-noir-accent/55 " +
    "hover:shadow-[0_8px_28px_-6px_rgba(94,234,212,0.4)]",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-xs rounded-lg",
  md: "px-4 py-2.5 text-sm rounded-xl",
  lg: "px-5 py-3.5 text-[14px] rounded-xl",
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
        "inline-flex items-center justify-center gap-2 border font-medium",
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
