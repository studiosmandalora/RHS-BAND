import { useEffect, type ReactNode, type SelectHTMLAttributes } from "react";
import { Loader2, X } from "lucide-react";

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/* ---------------------------------- Card --------------------------------- */

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl bg-white ring-1 ring-black/5 shadow-sm dark:bg-zinc-900 dark:ring-white/10",
        className
      )}
    >
      {children}
    </div>
  );
}

/* --------------------------------- Button -------------------------------- */

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "gold" | "outline" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-colors select-none disabled:opacity-50 disabled:pointer-events-none";
  const sizes = {
    sm: "min-h-9 px-4 text-sm",
    md: "min-h-11 px-5 text-sm",
    lg: "min-h-13 px-6 text-base",
  };
  const variants = {
    primary:
      "bg-forest text-white hover:bg-mid active:bg-forest-deep dark:hover:bg-mid/90",
    gold: "bg-gold text-forest-deep hover:bg-gold/90 active:bg-gold-deep dark:text-ink",
    outline:
      "ring-1 ring-forest/30 text-forest hover:bg-moss dark:ring-white/20 dark:text-moss dark:hover:bg-zinc-800",
    ghost:
      "text-forest hover:bg-moss dark:text-moss dark:hover:bg-zinc-800",
    danger: "bg-red-50 text-red-700 ring-1 ring-red-200 hover:bg-red-100 dark:bg-red-950/50 dark:text-red-300 dark:ring-red-900",
  };
  return (
    <button
      className={cn(base, sizes[size], variants[variant], className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

/* ------------------------------- Form fields ------------------------------ */

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
      </span>
      {children}
      {hint && (
        <span className="mt-1 block text-xs text-zinc-400 dark:text-zinc-500">
          {hint}
        </span>
      )}
    </label>
  );
}

const inputBase =
  // text-base (16px) prevents iOS Safari from auto-zooming into fields on
  // focus — anything smaller than 16px triggers the zoom on phones/tablets.
  "w-full min-h-11 rounded-xl bg-cream px-4 text-base text-ink placeholder:text-zinc-400 ring-1 ring-black/10 focus:outline-none focus:ring-2 focus:ring-mid dark:bg-zinc-800 dark:text-zinc-100 dark:ring-white/10 dark:focus:ring-mid";

export function Input(
  props: React.InputHTMLAttributes<HTMLInputElement>
) {
  return <input {...props} className={cn(inputBase, props.className)} />;
}

export function Select({
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={cn(inputBase, props.className)}>
      {children}
    </select>
  );
}

/* ---------------------------------- Modal -------------------------------- */

export function Modal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        aria-label="Close"
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-sm rounded-t-3xl bg-white p-5 pb-8 shadow-2xl dark:bg-zinc-900 sm:rounded-3xl sm:pb-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-bold text-ink dark:text-zinc-100">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="rounded-full p-2 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="size-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* -------------------------------- Badge/chip ------------------------------ */

export function Badge({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold",
        className
      )}
    >
      {children}
    </span>
  );
}

/* ---------------------------------- Alert -------------------------------- */

export function Alert({
  tone,
  children,
  className,
}: {
  tone: "success" | "error" | "info";
  children: ReactNode;
  className?: string;
}) {
  const tones = {
    success:
      "bg-moss text-forest dark:bg-forest/30 dark:text-moss",
    error: "bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300",
    info: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  };
  return (
    <div
      className={cn(
        "rounded-xl px-4 py-3 text-sm font-medium",
        tones[tone],
        className
      )}
    >
      {children}
    </div>
  );
}

/* --------------------------------- Spinner -------------------------------- */

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-5 animate-spin", className)} />;
}

/* ---------------------------------- Toggle -------------------------------- */

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label ?? "toggle"}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-7 w-12 shrink-0 rounded-full transition-colors",
        checked ? "bg-forest dark:bg-mid" : "bg-zinc-300 dark:bg-zinc-700"
      )}
    >
      <span
        className={cn(
          "absolute top-1 size-5 rounded-full bg-white shadow transition-all",
          checked ? "left-6" : "left-1"
        )}
      />
    </button>
  );
}

/* ------------------------------- Empty state ------------------------------ */

export function EmptyState({
  icon,
  title,
  subtitle,
}: {
  icon?: ReactNode;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5 py-10 text-center">
      {icon && (
        <div className="mb-1 flex size-12 items-center justify-center rounded-full bg-moss text-forest dark:bg-forest/40 dark:text-moss">
          {icon}
        </div>
      )}
      <p className="text-sm font-semibold text-ink dark:text-zinc-200">
        {title}
      </p>
      {subtitle && (
        <p className="max-w-60 text-xs text-zinc-500 dark:text-zinc-400">
          {subtitle}
        </p>
      )}
    </div>
  );
}