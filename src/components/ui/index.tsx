import type { ReactNode } from "react";

/** 공통 UI 조각 — 프로젝트 전반의 여백·모서리·색을 한곳에서 맞춘다. */

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`card rounded-2xl border border-[var(--border)] bg-[var(--surface)] ${className}`}
    >
      {children}
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "brand" | "warn";
}) {
  const tones = {
    neutral: "bg-slate-500/10 text-[var(--muted)]",
    brand: "bg-teal-500/15 text-teal-700 dark:text-teal-300",
    warn: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  } as const;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-semibold">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-[var(--muted)]">{hint}</p>}
    </div>
  );
}

export const inputClass =
  "w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-sm outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20";

export function Spinner({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-4 py-16" role="status" aria-live="polite">
      <div className="h-10 w-10 animate-spin rounded-full border-3 border-[var(--border)] border-t-teal-500" />
      <p className="text-sm text-[var(--muted)]">{label}</p>
    </div>
  );
}
