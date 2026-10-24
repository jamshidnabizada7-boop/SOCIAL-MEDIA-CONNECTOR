"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Sparkles } from "lucide-react";
import type { ProviderId } from "@/lib/types";
import { PROVIDERS } from "@/lib/providers";
import { ProviderBadge } from "@/components/ui/status";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The signature moment: one post fanning out to every network, each network
 * finishing on its own clock — exactly how the publishing engine behaves.
 */
const DEMO_TARGETS: { provider: ProviderId; delay: number; async?: boolean }[] = [
  { provider: "facebook", delay: 500 },
  { provider: "instagram", delay: 900 },
  { provider: "linkedin", delay: 1300 },
  { provider: "threads", delay: 1700 },
  { provider: "youtube", delay: 2100, async: true },
  { provider: "tiktok", delay: 2600, async: true },
];

export function FanoutDemo() {
  const [phase, setPhase] = useState<"idle" | "running" | "done">("idle");
  const [states, setStates] = useState<Record<string, "waiting" | "uploading" | "processing" | "published">>({});
  const timers = useRef<number[]>([]);

  const clearTimers = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };

  useEffect(() => clearTimers, []);

  const run = () => {
    clearTimers();
    setPhase("running");
    const next: Record<string, "waiting" | "uploading" | "processing" | "published"> = {};
    DEMO_TARGETS.forEach((t) => (next[t.provider] = "waiting"));
    setStates(next);
    DEMO_TARGETS.forEach((t) => {
      timers.current.push(
        window.setTimeout(() => {
          setStates((s) => ({ ...s, [t.provider]: t.async ? "processing" : "uploading" }));
        }, t.delay)
      );
      timers.current.push(
        window.setTimeout(() => {
          setStates((s) => ({ ...s, [t.provider]: "published" }));
          if (t === DEMO_TARGETS[DEMO_TARGETS.length - 1]) {
            setPhase("done");
          }
        }, t.delay + (t.async ? 1900 : 1100))
      );
    });
  };

  return (
    <div className="w-full max-w-md rounded-2xl border bg-surface p-4 shadow-pop sm:p-5">
      <div className="flex items-center gap-2.5 border-b pb-3">
        <div
          className="size-9 rounded-lg"
          style={{ background: "linear-gradient(135deg, hsl(162 45% 45%), hsl(200 50% 30%))" }}
        />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold leading-tight">Spring launch film</p>
          <p className="text-[12px] text-ink-3">video · 0:31 · 6 destinations</p>
        </div>
        <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent-ink">
          Ready
        </span>
      </div>

      <div className="py-3.5">
        <div
          className="relative mb-3 h-36 overflow-hidden rounded-xl border border-black/5 dark:border-white/10"
          style={{ background: "linear-gradient(135deg, hsl(162 42% 84%) 0%, hsl(205 45% 62%) 100%)" }}
        >
          <div aria-hidden className="absolute inset-0 flex items-center justify-center">
            <span className="font-display text-4xl font-bold text-white/85 drop-shadow">AH</span>
          </div>
          <span className="tnum absolute bottom-2 right-2 rounded-md bg-black/50 px-1.5 py-0.5 text-[11px] font-semibold text-white">0:31</span>
        </div>
        <p className="text-[13px] leading-relaxed text-ink-2">
          It&apos;s here. Plan a week of content in one sitting, publish it everywhere in one
          click. <span className="text-accent-ink">#CreateOnce</span>{" "}
          <span className="text-accent-ink">#PublishEverywhere</span>
        </p>
      </div>

      <div className="flex flex-col gap-1.5 border-t pt-3.5">
        {DEMO_TARGETS.map(({ provider }) => {
          const state = states[provider] ?? "waiting";
          return (
            <div key={provider} className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5">
              <ProviderBadge provider={provider} size="sm" />
              <span className="flex-1 text-[13px] font-medium">{PROVIDERS[provider].name}</span>
              {state === "waiting" && (
                <span className="text-[12px] text-ink-3">Waiting</span>
              )}
              {state === "uploading" && (
                <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-info-ink">
                  <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
                  Publishing…
                </span>
              )}
              {state === "processing" && (
                <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-warn-ink">
                  <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
                  Processing
                </span>
              )}
              {state === "published" && (
                <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-success-ink">
                  <Check className="size-3.5" />
                  Published
                </span>
              )}
            </div>
          );
        })}
      </div>

      <Button
        onClick={run}
        disabled={phase === "running"}
        className="mt-4 w-full"
        size="lg"
      >
        {phase === "idle" ? (
          <>
            <Sparkles className="size-4" />
            Publish everywhere
          </>
        ) : phase === "running" ? (
          "Publishing to 6 destinations…"
        ) : (
          "6 of 6 published — run again"
        )}
      </Button>
      <p className={cn("mt-2 text-center text-[11px] text-ink-3", phase === "idle" && "opacity-0")}>
        Each network publishes independently — one failure never blocks the rest.
      </p>
    </div>
  );
}
