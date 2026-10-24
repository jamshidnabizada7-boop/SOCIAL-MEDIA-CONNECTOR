"use client";

import Link from "next/link";
import { PROVIDER_LIST } from "@/lib/providers";
import { ProviderBadge } from "@/components/ui/status";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      {/* Form column */}
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <Link href="/" className="flex items-center gap-2.5" aria-label="Aria Hub home">
          <svg viewBox="0 0 24 24" className="size-7" aria-hidden>
            <rect x="1" y="1" width="22" height="22" rx="6.5" className="fill-accent" />
            <circle cx="8.2" cy="8.2" r="2.1" fill="white" />
            <circle cx="16" cy="8.6" r="1.55" fill="white" opacity="0.85" />
            <circle cx="8.6" cy="16" r="1.55" fill="white" opacity="0.85" />
            <circle cx="16" cy="16" r="2.1" fill="white" opacity="0.7" />
          </svg>
          <span className="font-display text-lg font-bold tracking-tight">
            aria<span className="text-accent">hub</span>
          </span>
        </Link>
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm">{children}</div>
        </div>
        <p className="text-center text-[13px] text-ink-3">
          Interface prototype — no data leaves your browser.
        </p>
      </div>

      {/* Brand column */}
      <div className="relative hidden flex-col justify-between overflow-hidden border-l bg-surface p-12 lg:flex">
        <div aria-hidden className="pointer-events-none absolute inset-0" style={{
          background:
            "radial-gradient(80% 60% at 80% 0%, var(--accent-soft) 0%, transparent 55%), radial-gradient(60% 50% at 10% 100%, var(--accent-soft) 0%, transparent 60%)",
        }} />
        <div className="relative">
          <p className="font-display text-[26px] font-bold leading-snug tracking-tight">
            One caption in.
            <br />
            Ten networks out.
          </p>
          <p className="mt-3 max-w-md text-[15px] leading-relaxed text-ink-2">
            Aria Hub checks each network&apos;s rules before you publish, shows you a preview per
            platform, and delivers to every destination independently.
          </p>
        </div>

        {/* Fan-out motif */}
        <div className="relative my-10 flex flex-1 items-center" aria-hidden>
          <svg viewBox="0 0 420 220" className="w-full max-w-md">
            {[0, 1, 2, 3, 4, 5].map((i) => {
              const y = 24 + i * 34;
              return (
                <g key={i}>
                  <path
                    d={`M70 110 C 150 110, 190 ${y + 12}, 300 ${y + 12}`}
                    fill="none"
                    stroke="var(--accent)"
                    strokeOpacity={0.35}
                    strokeWidth="1.5"
                    strokeDasharray="4 5"
                  />
                  <circle cx="308" cy={y + 12} r="11" fill="var(--surface)" stroke="var(--accent)" strokeOpacity="0.5" />
                  <circle cx="308" cy={y + 12} r="4" fill="var(--accent)" />
                </g>
              );
            })}
            <rect x="14" y="86" width="56" height="48" rx="12" className="fill-accent" />
            <circle cx="30" cy="102" r="4" fill="white" />
            <circle cx="54" cy="102" r="4" fill="white" opacity="0.8" />
            <circle cx="30" cy="118" r="4" fill="white" opacity="0.8" />
            <circle cx="54" cy="118" r="4" fill="white" opacity="0.6" />
            <text x="250" y="216" className="fill-[var(--ink-3)]" fontSize="11">
              every destination, independently delivered
            </text>
          </svg>
        </div>

        <div className="relative">
          <div className="flex flex-wrap gap-2.5">
            {PROVIDER_LIST.slice(0, 8).map((p) => (
              <span key={p.id} className="inline-flex items-center gap-1.5 rounded-full border bg-surface px-2.5 py-1 text-[12px] font-medium text-ink-2">
                <ProviderBadge provider={p.id} size="xs" />
                {p.name}
              </span>
            ))}
            <span className="inline-flex items-center rounded-full border bg-surface px-2.5 py-1 text-[12px] font-medium text-ink-3">
              +2 more
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
