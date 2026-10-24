"use client";

import Link from "next/link";
import { PROVIDER_LIST } from "@/lib/providers";
import { PLAN_OFFERS } from "@/lib/services/workspace";
import { ProviderBadge } from "@/components/ui/status";
import { Button } from "@/components/ui/button";
import { FanoutDemo } from "@/components/marketing/fanout-demo";
import {
  CalendarClock,
  CircleCheckBig,
  Gauge,
  Layers,
  ScanSearch,
  ShieldCheck,
} from "lucide-react";

function Mark() {
  return (
    <svg viewBox="0 0 24 24" className="size-7" aria-hidden>
      <rect x="1" y="1" width="22" height="22" rx="6.5" className="fill-accent" />
      <circle cx="8.2" cy="8.2" r="2.1" fill="white" />
      <circle cx="16" cy="8.6" r="1.55" fill="white" opacity="0.85" />
      <circle cx="8.6" cy="16" r="1.55" fill="white" opacity="0.85" />
      <circle cx="16" cy="16" r="2.1" fill="white" opacity="0.7" />
      <path d="M9.7 9.7l4.6 4.7M15.4 10.4l-5.3 4" stroke="white" strokeWidth="1.4" strokeLinecap="round" opacity="0.6" />
    </svg>
  );
}

const FEATURES = [
  {
    icon: Layers,
    title: "One composer, every network",
    body: "Write the post once. Customize it per network only where it matters — the rest inherits automatically.",
  },
  {
    icon: ScanSearch,
    title: "Compatibility checked before you publish",
    body: "Caption limits, aspect ratios, video codecs, required fields. Problems surface in the composer with one-click safe fixes — never at the API.",
  },
  {
    icon: CircleCheckBig,
    title: "Honest delivery status",
    body: "Every destination reports its own state: publishing, processing, published, failed. One network failing never blocks the others.",
  },
  {
    icon: ShieldCheck,
    title: "Connection health, watched for you",
    body: "Expiring tokens and revoked access are flagged before your schedule breaks, with reconnection that takes a minute.",
  },
  {
    icon: CalendarClock,
    title: "Schedule without the timezone dread",
    body: "Times are stored in UTC and shown in yours. Drag posts across the calendar, set recurring queue slots, rest easy through DST.",
  },
  {
    icon: Gauge,
    title: "Media prepared, originals kept",
    body: "Crops, compressions and trims are created as derivatives. Your original upload is never modified.",
  },
];

const STEPS = [
  {
    title: "Connect your accounts",
    body: "Authorize once through the official sign-in of each network. No passwords ever touch Aria Hub.",
  },
  {
    title: "Compose once",
    body: "Upload media, write the caption, pick destinations. Previews show exactly how each network will render it.",
  },
  {
    title: "Publish or schedule everywhere",
    body: "One click fans out to every network through independent, retry-safe delivery pipelines.",
  },
];

export default function LandingPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      {/* Nav */}
      <header className="sticky top-0 z-40 border-b bg-paper/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-5">
          <Link href="/" className="flex items-center gap-2.5" aria-label="Aria Hub home">
            <Mark />
            <span className="font-display text-lg font-bold tracking-tight">
              aria<span className="text-accent">hub</span>
            </span>
          </Link>
          <nav className="ml-4 hidden items-center gap-6 text-sm text-ink-2 md:flex" aria-label="Marketing">
            <a href="#features" className="transition-colors hover:text-ink">Features</a>
            <a href="#how" className="transition-colors hover:text-ink">How it works</a>
            <a href="#pricing" className="transition-colors hover:text-ink">Pricing</a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/signin">
              <Button variant="ghost" size="sm">Sign in</Button>
            </Link>
            <Link href="/signup">
              <Button size="sm">Get started</Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-0" style={{
          background:
            "radial-gradient(70% 55% at 78% 8%, var(--accent-soft) 0%, transparent 60%), radial-gradient(45% 40% at 12% 90%, var(--accent-soft) 0%, transparent 65%)",
          opacity: 0.8,
        }} />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-5 py-16 lg:grid-cols-[1.05fr_0.95fr] lg:py-24">
          <div className="rise">
            <p className="mb-4 inline-flex items-center gap-2 rounded-full border bg-surface px-3 py-1 text-[13px] font-medium text-ink-2">
              <span className="size-1.5 rounded-full bg-accent" />
              For creators, teams and agencies
            </p>
            <h1 className="font-display text-[42px] font-extrabold leading-[1.04] tracking-tight sm:text-[56px]">
              Create once.
              <br />
              Publish everywhere.
            </h1>
            <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-ink-2">
              Connect your social accounts once. Then every post is written once, checked against
              each network&apos;s rules, previewed per platform, and delivered independently — with
              failures you can actually fix.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link href="/signup">
                <Button size="lg">Start publishing — free</Button>
              </Link>
              <Link href="/signin">
                <Button variant="secondary" size="lg">Explore the demo workspace</Button>
              </Link>
            </div>
            <p className="mt-3 text-[13px] text-ink-3">
              No credit card. The demo workspace comes pre-loaded with realistic content.
            </p>
          </div>
          <div className="rise flex justify-center lg:justify-end" style={{ animationDelay: "80ms" }}>
            <FanoutDemo />
          </div>
        </div>
      </section>

      {/* Networks strip */}
      <section className="border-y bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-8 gap-y-4 px-5 py-7">
          <p className="w-full text-center text-[13px] font-medium text-ink-3 sm:w-auto">
            Ten networks, one composer
          </p>
          {PROVIDER_LIST.map((p) => (
            <span key={p.id} className="inline-flex items-center gap-2 text-sm font-medium text-ink-2">
              <ProviderBadge provider={p.id} size="sm" />
              {p.name}
            </span>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-6xl px-5 py-20">
        <div className="max-w-2xl">
          <h2 className="font-display text-3xl font-bold tracking-tight">
            The complexity of ten APIs, hidden behind one button
          </h2>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
            Every network has its own rules — caption lengths, media ratios, privacy requirements,
            async processing. Aria Hub treats each one as an independent provider so you never have
            to think about it.
          </p>
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-xl border bg-surface p-5 transition-colors hover:border-line-strong">
              <span className="flex size-9 items-center justify-center rounded-lg bg-accent-soft text-accent-ink">
                <f.icon className="size-4.5" aria-hidden />
              </span>
              <h3 className="mt-4 text-[15px] font-semibold">{f.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="border-y bg-surface">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <h2 className="font-display text-3xl font-bold tracking-tight">How it works</h2>
          <ol className="mt-10 grid gap-8 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="relative">
                <span className="font-display text-[13px] font-bold text-accent-ink">
                  Step {i + 1}
                </span>
                <h3 className="mt-2 font-display text-xl font-semibold tracking-tight">{s.title}</h3>
                <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink-2">{s.body}</p>
                {i < STEPS.length - 1 && (
                  <span aria-hidden className="absolute -right-4 top-1 hidden text-ink-3 md:block">
                    <svg width="24" height="12" viewBox="0 0 24 12" fill="none">
                      <path d="M0 6h20m0 0-4-4m4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </span>
                )}
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="mx-auto max-w-6xl px-5 py-20">
        <div className="mx-auto max-w-xl text-center">
          <h2 className="font-display text-3xl font-bold tracking-tight">Pricing that scales with your channels</h2>
          <p className="mt-3 text-[15px] text-ink-2">Every plan includes the full composer, compatibility engine and delivery status. Upgrade when you add channels.</p>
        </div>
        <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {PLAN_OFFERS.map((plan) => (
            <div
              key={plan.id}
              className={`flex flex-col rounded-xl border bg-surface p-5 ${plan.id === "pro" ? "border-accent ring-1 ring-accent/25" : ""}`}
            >
              <div className="flex items-center justify-between">
                <h3 className="font-display text-lg font-semibold">{plan.name}</h3>
                {plan.id === "pro" && (
                  <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent-ink">Popular</span>
                )}
              </div>
              <p className="mt-1 text-[13px] text-ink-2">{plan.tagline}</p>
              <p className="mt-4">
                <span className="font-display text-3xl font-bold tracking-tight">${plan.priceMonthly}</span>
                <span className="text-sm text-ink-3"> / month</span>
              </p>
              <ul className="mt-4 flex flex-1 flex-col gap-2 text-[13px] text-ink-2">
                {plan.highlights.map((h) => (
                  <li key={h} className="flex items-start gap-2">
                    <CircleCheckBig className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden />
                    {h}
                  </li>
                ))}
              </ul>
              <Link href="/signup" className="mt-5">
                <Button variant={plan.id === "pro" ? "primary" : "secondary"} className="w-full">
                  {plan.priceMonthly === 0 ? "Start free" : `Choose ${plan.name}`}
                </Button>
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-8 text-[13px] text-ink-3">
          <span className="inline-flex items-center gap-2">
            <Mark />
            <span className="font-display font-bold text-ink">ariahub</span>
          </span>
          <nav className="flex flex-wrap gap-5" aria-label="Footer">
            <a href="#features" className="hover:text-ink">Features</a>
            <a href="#pricing" className="hover:text-ink">Pricing</a>
            <Link href="/signin" className="hover:text-ink">Sign in</Link>
          </nav>
          <span>© 2026 Aria Hub. Interface prototype — external networks are simulated.</span>
        </div>
      </footer>
    </div>
  );
}
