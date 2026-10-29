"use client";

import { useMemo } from "react";
import { AlertTriangle, KeyRound, Link2, Plus, Users, Video, Zap } from "lucide-react";
import type { SocialAccount } from "@/lib/types";
import { PROVIDERS } from "@/lib/providers";
import { cn } from "@/lib/utils";
import { ProviderBadge } from "@/components/ui/status";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/primitives";

const GROUPS: { id: string; label: string; providers: string[]; icon: React.ReactNode }[] = [
  { id: "all", label: "All socials", providers: [], icon: <Users className="size-3.5" /> },
  { id: "professional", label: "Professional", providers: ["linkedin", "x"], icon: <Zap className="size-3.5" /> },
  { id: "visual", label: "Visual", providers: ["instagram", "pinterest", "threads"], icon: <Plus className="size-3.5" /> },
  { id: "video", label: "Video platforms", providers: ["tiktok", "youtube"], icon: <Video className="size-3.5" /> },
];

export function DestinationPanel({
  accounts,
  selected,
  onToggle,
  onSelectGroup,
  onClear,
  onConnect,
  className,
}: {
  accounts: SocialAccount[];
  selected: string[];
  onToggle: (id: string) => void;
  onSelectGroup: (ids: string[]) => void;
  onClear: () => void;
  onConnect: () => void;
  className?: string;
}) {
  const grouped = useMemo(() => {
    const map = new Map<string, SocialAccount[]>();
    for (const a of accounts) {
      const list = map.get(a.provider) ?? [];
      list.push(a);
      map.set(a.provider, list);
    }
    return [...map.entries()];
  }, [accounts]);

  if (accounts.length === 0) {
    return (
      <EmptyState
        icon={<Link2 className="size-5" />}
        title="No accounts connected"
        body="Connect your first social account to start publishing."
        action={<Button onClick={onConnect}>Connect an account</Button>}
        className="py-10"
      />
    );
  }

  const groupIds = (groupId: string) => {
    const g = GROUPS.find((x) => x.id === groupId)!;
    return accounts.filter((a) => (g.providers.length === 0 ? true : g.providers.includes(a.provider))).map((a) => a.id);
  };

  return (
    <div className={cn("flex flex-col", className)}>
      <div className="flex items-center justify-between gap-2 px-1">
        <p className="font-display text-[17px] font-bold">
          Target Platforms{" "}
          <span className={cn(
            "tnum ml-1 rounded-full px-1.5 py-0.5 text-[11px] font-bold",
            selected.length > 0 ? "bg-accent-soft text-accent-ink" : "bg-surface-2 text-ink-3"
          )}>
            {selected.length}
          </span>
        </p>
        <div className="flex items-center gap-1.5 text-[12px]">
          <button
            onClick={() => onSelectGroup(groupIds("all"))}
            className="rounded-md px-1.5 py-0.5 font-medium text-accent-ink hover:bg-accent-soft"
          >
            Select all
          </button>
          <button onClick={onClear} className="rounded-md px-1.5 py-0.5 text-ink-3 hover:bg-surface-2 hover:text-ink">
            Clear
          </button>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {GROUPS.slice(1).map((g) => {
          const ids = groupIds(g.id);
          const allSelected = ids.length > 0 && ids.every((id) => selected.includes(id));
          return (
            <button
              key={g.id}
              onClick={() => (allSelected ? onClear() : onSelectGroup(ids))}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors",
                allSelected ? "border-accent bg-accent-soft text-accent-ink" : "bg-surface text-ink-2 hover:border-line-strong"
              )}
            >
              {g.icon}
              {g.label}
            </button>
          );
        })}
      </div>

      <ul className="mt-3 flex flex-col gap-1 overflow-y-auto pb-2">
        {grouped.map(([providerId, list]) => (
          <li key={providerId}>
            <p className="flex items-center gap-1.5 px-1 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
              <ProviderBadge provider={providerId as SocialAccount["provider"]} size="xs" />
              {PROVIDERS[providerId as SocialAccount["provider"]].name}
            </p>
            <ul className="flex flex-col gap-2">
              {list.map((a) => {
                const isSel = selected.includes(a.id);
                const unhealthy = a.connection === "needs_reauth" || a.connection === "disconnected";
                return (
                  <li key={a.id}>
                    <button
                      role="checkbox"
                      aria-checked={isSel}
                      onClick={() => onToggle(a.id)}
                      className={cn(
                        "flex min-h-20 w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors",
                        isSel ? "bg-studio-soft ring-1 ring-accent/10" : "bg-surface-2 hover:bg-studio-soft"
                      )}
                    >
                      <span
                        className={cn(
                          "order-last flex size-6 shrink-0 items-center justify-center rounded-full border transition-colors",
                          isSel ? "border-accent bg-accent text-on-accent" : "border-line-strong bg-surface"
                        )}
                        aria-hidden
                      >
                        {isSel && (
                          <svg viewBox="0 0 12 12" className="size-3 fill-none stroke-current stroke-[2.5]">
                            <path d="M2 6.5 4.5 9 10 3" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </span>
                      <span className="grid size-11 shrink-0 place-items-center rounded-full bg-surface"><ProviderBadge provider={a.provider} size="sm" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold leading-tight">{a.displayName}</span>
                        <span className="mt-1 block truncate text-xs leading-tight text-ink-2">{a.handle}</span>
                      </span>
                      {unhealthy ? (
                        <KeyRound className="size-4 shrink-0 text-danger" aria-label="Needs reauthorization" />
                      ) : a.connection === "token_expiring" ? (
                        <AlertTriangle className="size-4 shrink-0 text-warn" aria-label="Token expiring" />
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>

      <button
        onClick={onConnect}
        className="mt-1 flex items-center gap-2 rounded-lg px-2 py-2 text-[13px] font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
      >
        <Plus className="size-4" />
        Connect another account
      </button>
    </div>
  );
}
