import { ReactNode } from "react";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-wider text-noir-mute">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input {...props}
      className={"w-full bg-noir-black border border-noir-line rounded px-3 py-2 font-mono focus:outline-none focus:border-noir-accent " + (props.className ?? "")} />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props}
      className={"w-full bg-noir-black border border-noir-line rounded px-3 py-2 focus:outline-none focus:border-noir-accent " + (props.className ?? "")} />
  );
}

export function Button({ children, variant = "primary", ...rest }: any) {
  const cls = variant === "danger"
    ? "bg-noir-red/20 text-noir-red border-noir-red/40 hover:bg-noir-red/30"
    : "bg-noir-accent text-noir-black hover:opacity-90";
  return (
    <button {...rest} className={`px-4 py-2 rounded border border-transparent disabled:opacity-50 ${cls} ${rest.className ?? ""}`}>
      {children}
    </button>
  );
}
