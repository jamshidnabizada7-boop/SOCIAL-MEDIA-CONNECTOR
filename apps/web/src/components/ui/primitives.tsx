"use client";

import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/* ---------------------------------- Field --------------------------------- */

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
  className,
}: {
  label?: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <label htmlFor={htmlFor} className="text-[13px] font-medium text-ink">
          {label}
        </label>
      )}
      {children}
      {error ? (
        <p className="text-[13px] text-danger">{error}</p>
      ) : hint ? (
        <p className="text-[13px] text-ink-3">{hint}</p>
      ) : null}
    </div>
  );
}

/* ---------------------------------- Input --------------------------------- */

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          "h-9.5 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink",
          "transition-colors placeholder:text-ink-3",
          "focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25",
          "disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-3",
          "aria-[invalid=true]:border-danger aria-[invalid=true]:ring-danger/20",
          className
        )}
        {...props}
      />
    );
  }
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(
          "w-full rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-sm leading-relaxed text-ink",
          "transition-colors placeholder:text-ink-3",
          "focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25",
          "resize-none",
          className
        )}
        {...props}
      />
    );
  }
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <select
        ref={ref}
        className={cn(
          "h-9.5 w-full appearance-none rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink",
          "bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%238a938e%22%20stroke-width%3D%222.5%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-[position:right_0.65rem_center] bg-no-repeat pr-8",
          "focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25",
          className
        )}
        {...props}
      >
        {children}
      </select>
    );
  }
);

/* ---------------------------------- Switch -------------------------------- */

export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-5.5 w-9.5 shrink-0 rounded-full border transition-colors",
        checked ? "border-accent bg-accent" : "border-line-strong bg-surface-2",
        disabled && "cursor-not-allowed opacity-50"
      )}
    >
      <span
        className={cn(
          "absolute top-1/2 size-4 -translate-y-1/2 rounded-full bg-white shadow-sm transition-all dark:bg-ink",
          checked ? "left-[calc(100%-1.125rem)]" : "left-0.5"
        )}
      />
    </button>
  );
}

/* --------------------------------- Checkbox ------------------------------- */

export function Checkbox({
  checked,
  onChange,
  label,
  className,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  className?: string;
}) {
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-2 text-sm", className)}>
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "flex size-4.5 shrink-0 items-center justify-center rounded-[5px] border transition-colors",
          checked ? "border-accent bg-accent text-on-accent" : "border-line-strong bg-surface"
        )}
      >
        {checked && <Check className="size-3" strokeWidth={3} aria-hidden />}
      </button>
      {label && <span>{label}</span>}
      <input type="checkbox" className="sr-only" checked={checked} onChange={() => onChange(!checked)} tabIndex={-1} />
    </label>
  );
}

/* ----------------------------------- Card --------------------------------- */

export function Card({
  children,
  className,
  as: As = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "article";
}) {
  return (
    <As className={cn("rounded-xl border bg-surface", className)}>{children}</As>
  );
}

export function CardHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4", className)}>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold">{title}</h3>
        {description && <p className="mt-0.5 text-[13px] text-ink-2">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/* --------------------------------- Skeleton ------------------------------- */

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("skeleton", className)} />;
}

/* --------------------------------- Spinner -------------------------------- */

export function Spinner({ className }: { className?: string }) {
  return <div className={cn("skeleton size-full", className)} />;
}

/* ------------------------------- Empty state ------------------------------ */

export function EmptyState({
  icon,
  title,
  body,
  action,
  className,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-14 text-center", className)}>
      <div className="flex size-11 items-center justify-center rounded-xl bg-accent-soft text-accent-ink">
        {icon}
      </div>
      <h3 className="mt-4 text-[15px] font-semibold">{title}</h3>
      <p className="mt-1 max-w-sm text-sm leading-relaxed text-ink-2">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/* --------------------------------- Segmented ------------------------------ */

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = "md",
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; badge?: number }[];
  size?: "sm" | "md";
}) {
  return (
    <div role="tablist" className="inline-flex items-center gap-0.5 rounded-lg border bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md font-medium transition-colors",
            size === "sm" ? "h-6.5 px-2 text-xs" : "h-7.5 px-3 text-[13px]",
            value === o.value
              ? "bg-surface text-ink shadow-xs"
              : "text-ink-2 hover:text-ink"
          )}
        >
          {o.label}
          {o.badge !== undefined && (
            <span className={cn("tnum rounded-full px-1.5 text-[11px]", value === o.value ? "bg-accent-soft text-accent-ink" : "bg-surface-2 text-ink-3")}>
              {o.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/* ----------------------------------- Tabs --------------------------------- */

export function Tabs<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; count?: number }[];
}) {
  return (
    <div role="tablist" className="flex items-center gap-1 overflow-x-auto border-b">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "relative flex shrink-0 items-center gap-1.5 px-3 pb-2.5 pt-2 text-sm font-medium transition-colors",
            "after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full",
            value === o.value
              ? "text-ink after:bg-accent"
              : "text-ink-2 hover:text-ink after:bg-transparent"
          )}
        >
          {o.label}
          {o.count !== undefined && (
            <span className="tnum rounded-full bg-surface-2 px-1.5 py-0.5 text-[11px] text-ink-2">{o.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

/* --------------------------------- Progress ------------------------------- */

export function Progress({ value, className, tone = "accent" }: { value: number; className?: string; tone?: "accent" | "info" }) {
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-surface-2 border border-line", className)} role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <div
        className={cn("h-full rounded-full transition-all duration-300", tone === "accent" ? "bg-accent" : "bg-info")}
        style={{ width: `${Math.min(100, value)}%` }}
      />
    </div>
  );
}

/* ---------------------------------- Avatar -------------------------------- */

export function Avatar({
  name,
  hue,
  size = "md",
  className,
}: {
  name: string;
  hue: number;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}) {
  const sizes = { xs: "size-5 text-[9px]", sm: "size-6.5 text-[10px]", md: "size-8 text-xs", lg: "size-11 text-sm" };
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white",
        sizes[size],
        className
      )}
      style={{
        background: `linear-gradient(135deg, hsl(${hue} 52% 52%), hsl(${(hue + 40) % 360} 58% 38%))`,
      }}
    >
      {name
        .split(/\s+/)
        .slice(0, 2)
        .map((p) => p[0]?.toUpperCase())
        .join("")}
    </span>
  );
}

/* --------------------------------- Tooltip -------------------------------- */

export function Tooltip({ label, children, side = "top" }: { label: string; children: ReactNode; side?: "top" | "bottom" }) {
  return (
    <span className="group/tt relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-[11px] font-medium text-paper opacity-0 transition-opacity group-hover/tt:opacity-100 group-focus-within/tt:opacity-100",
          side === "top" ? "bottom-[calc(100%+6px)]" : "top-[calc(100%+6px)]"
        )}
      >
        {label}
      </span>
    </span>
  );
}

/* ---------------------------------- Meter --------------------------------- */

export function Meter({ used, limit, label }: { used: number; limit: number | "unlimited"; label: string }) {
  const pct = limit === "unlimited" ? 12 : Math.min(100, (used / limit) * 100);
  const near = limit !== "unlimited" && used / limit > 0.85;
  return (
    <div>
      <div className="flex items-baseline justify-between text-[13px]">
        <span className="text-ink-2">{label}</span>
        <span className="tnum font-medium">
          {used.toLocaleString()}
          <span className="text-ink-3"> / {limit === "unlimited" ? "∞" : limit.toLocaleString()}</span>
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2 border border-line">
        <div
          className={cn("h-full rounded-full transition-all", near ? "bg-warn" : "bg-accent")}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
