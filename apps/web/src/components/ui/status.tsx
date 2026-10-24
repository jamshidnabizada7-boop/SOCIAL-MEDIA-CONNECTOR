import type { ConnectionState, PostState, ProviderId, TargetState } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  Ban,
  CalendarClock,
  CheckCircle2,
  CircleDashed,
  Clock,
  FileText,
  Hand,
  KeyRound,
  Loader2,
  PackageCheck,
  RefreshCw,
  ShieldAlert,
  TriangleAlert,
  Unlink,
  XCircle,
} from "lucide-react";
import { ProviderIcon } from "./icons";

type Tone = "success" | "info" | "warn" | "danger" | "muted" | "accent";

const toneClasses: Record<Tone, string> = {
  success: "bg-success-soft text-success-ink border-success/20",
  info: "bg-info-soft text-info-ink border-info/20",
  warn: "bg-warn-soft text-warn-ink border-warn/25",
  danger: "bg-danger-soft text-danger-ink border-danger/25",
  muted: "bg-surface-2 text-ink-2 border-line",
  accent: "bg-accent-soft text-accent-ink border-accent/20",
};

function Pill({
  tone,
  icon,
  label,
  spin,
  className,
}: {
  tone: Tone;
  icon: React.ReactNode;
  label: string;
  spin?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[12px] font-medium",
        toneClasses[tone],
        className
      )}
    >
      <span className={cn("shrink-0", spin && "animate-spin motion-reduce:animate-none")} aria-hidden>
        {icon}
      </span>
      {label}
    </span>
  );
}

/* ------------------------------ Target states ----------------------------- */

const TARGET_META: Record<TargetState, { label: string; tone: Tone; icon: React.ReactNode; spin?: boolean }> = {
  pending: { label: "Waiting", tone: "muted", icon: <CircleDashed className="size-3.5" /> },
  validating: { label: "Validating", tone: "info", icon: <Loader2 className="size-3.5" />, spin: true },
  queued: { label: "Queued", tone: "muted", icon: <Clock className="size-3.5" /> },
  uploading_media: { label: "Uploading", tone: "info", icon: <Loader2 className="size-3.5" />, spin: true },
  publishing: { label: "Publishing", tone: "info", icon: <Loader2 className="size-3.5" />, spin: true },
  provider_processing: { label: "Processing", tone: "warn", icon: <Loader2 className="size-3.5" />, spin: true },
  published: { label: "Published", tone: "success", icon: <CheckCircle2 className="size-3.5" /> },
  retrying: { label: "Retrying", tone: "info", icon: <RefreshCw className="size-3.5" />, spin: true },
  needs_user_action: { label: "Needs your action", tone: "warn", icon: <Hand className="size-3.5" /> },
  failed: { label: "Failed", tone: "danger", icon: <XCircle className="size-3.5" /> },
  token_expired: { label: "Reconnect required", tone: "danger", icon: <KeyRound className="size-3.5" /> },
  canceled: { label: "Canceled", tone: "muted", icon: <Ban className="size-3.5" /> },
};

export function TargetStatePill({ state, className }: { state: TargetState; className?: string }) {
  const m = TARGET_META[state];
  return (
    <Pill tone={m.tone} icon={m.icon} spin={m.spin} label={m.label} className={className} />
  );
}

/* ------------------------------- Post states ------------------------------ */

const POST_META: Record<PostState, { label: string; tone: Tone; icon: React.ReactNode; spin?: boolean }> = {
  draft: { label: "Draft", tone: "muted", icon: <FileText className="size-3.5" /> },
  ready: { label: "Ready", tone: "accent", icon: <CircleDashed className="size-3.5" /> },
  scheduled: { label: "Scheduled", tone: "info", icon: <CalendarClock className="size-3.5" /> },
  queued: { label: "In queue", tone: "info", icon: <Clock className="size-3.5" /> },
  processing: { label: "Publishing", tone: "info", icon: <Loader2 className="size-3.5" />, spin: true },
  partially_published: { label: "Partially published", tone: "warn", icon: <TriangleAlert className="size-3.5" /> },
  published: { label: "Published", tone: "success", icon: <CheckCircle2 className="size-3.5" /> },
  failed: { label: "Failed", tone: "danger", icon: <XCircle className="size-3.5" /> },
  canceled: { label: "Canceled", tone: "muted", icon: <Ban className="size-3.5" /> },
  archived: { label: "Archived", tone: "muted", icon: <PackageCheck className="size-3.5" /> },
};

export function PostStatePill({ state, className }: { state: PostState; className?: string }) {
  const m = POST_META[state];
  return <Pill tone={m.tone} icon={m.icon} spin={m.spin} label={m.label} className={className} />;
}

/* ---------------------------- Connection states --------------------------- */

const CONN_META: Record<ConnectionState, { label: string; tone: Tone; icon: React.ReactNode }> = {
  healthy: { label: "Connected", tone: "success", icon: <CheckCircle2 className="size-3.5" /> },
  needs_reauth: { label: "Needs reauthorization", tone: "danger", icon: <KeyRound className="size-3.5" /> },
  token_expiring: { label: "Token expiring", tone: "warn", icon: <Clock className="size-3.5" /> },
  permission_missing: { label: "Permission missing", tone: "warn", icon: <ShieldAlert className="size-3.5" /> },
  disconnected: { label: "Disconnected", tone: "muted", icon: <Unlink className="size-3.5" /> },
};

export function ConnectionPill({ state, className }: { state: ConnectionState; className?: string }) {
  const m = CONN_META[state];
  return <Pill tone={m.tone} icon={m.icon} label={m.label} className={className} />;
}

/* ------------------------------ Provider badge ---------------------------- */

export function ProviderBadge({
  provider,
  size = "md",
  className,
}: {
  provider: ProviderId;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}) {
  const sizes = {
    xs: "size-4.5 rounded-[5px]",
    sm: "size-5.5 rounded-md",
    md: "size-7 rounded-lg",
    lg: "size-9 rounded-xl",
  };
  const iconSizes = { xs: "size-2.5", sm: "size-3", md: "size-4", lg: "size-5" };
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center text-white", sizes[size], className)}
      style={{ backgroundColor: providerColor(provider) }}
      title={providerLabel(provider)}
    >
      <ProviderIcon id={provider} className={iconSizes[size]} />
    </span>
  );
}

/* --------------------------- Stacked provider row -------------------------- */

export function ProviderStack({ providers, max = 4 }: { providers: ProviderId[]; max?: number }) {
  const shown = providers.slice(0, max);
  const rest = providers.length - shown.length;
  return (
    <span className="inline-flex items-center -space-x-1">
      {shown.map((p, i) => (
        <span key={`${p}-${i}`} className="rounded-md ring-2 ring-surface">
          <ProviderBadge provider={p} size="sm" />
        </span>
      ))}
      {rest > 0 && (
        <span className="tnum inline-flex size-5.5 items-center justify-center rounded-md bg-surface-2 text-[10px] font-semibold text-ink-2 ring-2 ring-surface">
          +{rest}
        </span>
      )}
    </span>
  );
}

import { PROVIDERS } from "@/lib/providers";
import type { ProviderInfo } from "@/lib/types";

function providerColor(id: ProviderId): string {
  const c = PROVIDERS[id]?.color;
  return c ?? "#555";
}
function providerLabel(id: ProviderId): string {
  return PROVIDERS[id]?.name ?? id;
}
export type { ProviderInfo };
