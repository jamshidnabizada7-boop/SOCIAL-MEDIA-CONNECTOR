"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Clock3,
  FileEdit,
  FolderOpen,
  KeyRound,
  Plus,
  Sparkles,
  Users,
} from "lucide-react";
import type { Post, SocialAccount } from "@/lib/types";
import type { AnalyticsSeed } from "@/lib/mock/data";
import { useSession } from "@/components/providers";
import { postsService } from "@/lib/services/posts";
import { accountsService } from "@/lib/services/accounts";
import { analyticsService } from "@/lib/services/analytics";
import { mediaService } from "@/lib/services/media";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/primitives";
import { MediaDot } from "@/components/ui/media-thumb";
import { PostStatePill, ProviderStack } from "@/components/ui/status";
import { PROVIDERS } from "@/lib/providers";
import { cn, formatNumber, formatTime } from "@/lib/utils";
import { DATA_MODE } from "@/lib/api/client";
const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const modules = [
  ["/content", "Content Library", "Your media, ready to create", FolderOpen],
  ["/calendar", "Calendar Grid", "Your full publishing plan", CalendarDays],
  ["/team", "Team & Approvals", "Create together", Users],
  ["/analytics", "Analytics", "Performance across networks", BarChart3],
] as const;
export default function DashboardPage() {
  const { session } = useSession();
  const [posts, setPosts] = useState<Post[]>([]),
    [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [metrics, setMetrics] = useState<AnalyticsSeed | null>(null),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState("");
  const [selectedDay, setSelectedDay] = useState(() => dayKey(new Date()));
  const [weekOffset, setWeekOffset] = useState(0);
  const [today] = useState(() => new Date());
  useEffect(() => {
    let live = true;
    const read = () => {
      if (live) {
        setPosts(postsService.list());
        setAccounts(accountsService.list());
      }
    };
    const unsubs = [
      postsService.subscribe(read),
      accountsService.subscribe(read),
    ];
    void Promise.all([
      postsService.listAsync(),
      accountsService.listAsync(),
      mediaService.listAsync(),
    ])
      .then(() => {
        read();
        if (live) setLoaded(true);
      })
      .catch((e) => {
        if (live) {
          setError((e as Error).message);
          setLoaded(true);
        }
      });
    void analyticsService
      .overview("7d")
      .then((m) => {
        if (live) setMetrics(m);
      })
      .catch(() => {});
    return () => {
      live = false;
      unsubs.forEach((u) => u());
    };
  }, [session?.workspace.id]);
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7) + weekOffset * 7);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
  const scheduled = posts.filter(
    (p) => p.state === "scheduled" && p.scheduledAt,
  );
  const dayPosts = scheduled
    .filter((p) => dayKey(new Date(p.scheduledAt!)) === selectedDay)
    .sort((a, b) => +new Date(a.scheduledAt!) - +new Date(b.scheduledAt!));
  const draft = posts.find((p) => p.state === "draft");
  const attention = posts.filter((p) =>
    ["failed", "partially_published"].includes(p.state),
  );
  const connections = accounts.filter((a) => a.connection !== "healthy");
  const published = posts.filter(
    (p) =>
      p.publishedAt && today.getTime() - +new Date(p.publishedAt) < 7 * 86400000,
  );
  const networkImpressions =
    metrics?.byNetwork.filter((n) => n.metrics.impressions !== null) || [];
  const reachTotal = networkImpressions.reduce(
    (sum, n) => sum + (n.metrics.impressions || 0),
    0,
  );
  return (
    <div className="studio-page">
      <PageHeader
        title="Creator Studio"
        description={
          DATA_MODE === "mock"
            ? "Demo workspace · Sample content and analytics"
            : "Your next idea. Every channel. One place."
        }
      />
      <PageBody className="!pt-0 space-y-6">
        {error && (
          <div
            role="alert"
            className="rounded-xl bg-danger-soft p-4 text-sm text-danger-ink"
          >
            Studio could not refresh: {error}{" "}
            <Button
              variant="secondary"
              onClick={() => window.location.reload()}
            >
              Try again
            </Button>
          </div>
        )}
        {!loaded ? (
          <div role="status" aria-label="Loading studio" className="space-y-4">
            <Skeleton className="h-48 rounded-2xl" />
            <Skeleton className="h-64 rounded-2xl" />
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="inline-flex items-center gap-2 rounded-full bg-accent-soft px-3 py-1.5 font-semibold text-accent-ink">
                <span className="size-1.5 rounded-full bg-accent" />
                {session?.workspace.name}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 text-ink-2">
                <CalendarDays className="size-3.5" />
                {today.toLocaleDateString(undefined, {
                  month: "long",
                  year: "numeric",
                })}
              </span>
            </div>
            <section className="rounded-2xl bg-linear-to-br from-studio-soft via-surface to-surface-2 p-4 shadow-xs lg:p-6">
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-ink-3">
                    What to launch next?
                  </p>
                  <h2 className="mt-1 font-display text-[22px] font-bold tracking-tight">
                    Let’s craft the feed
                  </h2>
                </div>
                <span className="grid size-10 place-items-center rounded-xl bg-accent-soft text-accent-ink">
                  <Sparkles className="size-5" />
                </span>
              </div>
              <Link
                href="/composer"
                className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-on-accent shadow-sm hover:bg-accent-hover"
              >
                <Plus className="size-5" />
                New Post / Campaign
              </Link>
              {draft && (
                <Link
                  href={`/composer?draft=${draft.id}`}
                  className="mt-3 flex items-center gap-3 rounded-xl bg-surface p-3 shadow-xs"
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-ink-2">
                    <FileEdit className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {draft.title || "Untitled post"}
                    </span>
                    <span className="text-xs text-ink-2">
                      Draft · Continue creating
                    </span>
                  </span>
                  <span className="rounded-lg bg-accent-soft px-3 py-2 text-xs font-semibold text-accent-ink">
                    Resume
                  </span>
                </Link>
              )}
            </section>
            <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
              <section aria-label="Publishing Schedule" className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="flex items-center gap-2 font-display text-[17px] font-bold">
                    <Clock3 className="size-5 text-accent-ink" />
                    Publishing Schedule
                  </h2>
                  <div className="flex rounded-lg bg-surface-2 p-1 text-xs">
                    <span className="rounded-md bg-surface px-3 py-1 font-semibold shadow-xs">
                      Week
                    </span>
                    <Link href="/calendar" className="px-3 py-1 text-ink-2">
                      Month
                    </Link>
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs text-ink-2">
                  <button
                    aria-label="Previous week"
                    onClick={() => {
                      setWeekOffset((n) => n - 1);
                      const d = new Date(monday);
                      d.setDate(d.getDate() - 7);
                      setSelectedDay(dayKey(d));
                    }}
                    className="min-h-11 px-2"
                  >
                    ← Previous
                  </button>
                  <button
                    onClick={() => {
                      setWeekOffset(0);
                      setSelectedDay(dayKey(today));
                    }}
                    className="min-h-11 px-2 font-semibold text-accent-ink"
                  >
                    Today
                  </button>
                  <button
                    aria-label="Next week"
                    onClick={() => {
                      setWeekOffset((n) => n + 1);
                      const d = new Date(monday);
                      d.setDate(d.getDate() + 7);
                      setSelectedDay(dayKey(d));
                    }}
                    className="min-h-11 px-2"
                  >
                    Next →
                  </button>
                </div>
                <div className="grid grid-cols-7 gap-1 rounded-xl bg-studio-soft p-1.5">
                  {days.map((d) => (
                    <button
                      key={dayKey(d)}
                      aria-pressed={selectedDay === dayKey(d)}
                      aria-label={d.toLocaleDateString(undefined, {
                        weekday: "long",
                        month: "long",
                        day: "numeric",
                      })}
                      onClick={() => setSelectedDay(dayKey(d))}
                      className={cn(
                        "flex min-h-16 flex-col items-center justify-center gap-1 rounded-lg text-xs",
                        selectedDay === dayKey(d)
                          ? "bg-accent text-on-accent shadow-sm"
                          : "text-ink-2 hover:bg-surface",
                      )}
                    >
                      <span className="text-[10px]">
                        {d.toLocaleDateString(undefined, { weekday: "narrow" })}
                      </span>
                      <span className="font-semibold">{d.getDate()}</span>
                      <span
                        className={cn(
                          "size-1 rounded-full",
                          scheduled.some(
                            (p) =>
                              dayKey(new Date(p.scheduledAt!)) === dayKey(d),
                          )
                            ? "bg-current"
                            : "bg-transparent",
                        )}
                      />
                    </button>
                  ))}
                </div>
                <div className="space-y-2" aria-live="polite">
                  {dayPosts.length ? (
                    dayPosts.map((p) => {
                      const media = p.mediaIds[0]
                        ? mediaService.get(p.mediaIds[0])
                        : undefined;
                      return (
                        <Link
                          key={p.id}
                          href={`/posts/${p.id}`}
                          className="flex items-center gap-3 rounded-xl bg-studio-soft p-3 transition-colors hover:bg-accent-soft"
                        >
                          {media ? (
                            <MediaDot asset={media} />
                          ) : (
                            <span className="grid size-12 shrink-0 place-items-center rounded-lg bg-surface">
                              <FileEdit className="size-5 text-ink-3" />
                            </span>
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="mb-1 flex items-center justify-between gap-2">
                              <span className="text-xs text-ink-2">
                                {formatTime(p.scheduledAt!)}
                              </span>
                              <PostStatePill state={p.state} />
                            </span>
                            <span className="block truncate text-sm font-semibold">
                              {p.title}
                            </span>
                            <span className="mt-1 flex items-center gap-2 text-[11px] text-ink-2">
                              <ProviderStack
                                providers={p.targets.map((t) => t.provider)}
                              />
                              {p.targets.length} destinations
                            </span>
                          </span>
                        </Link>
                      );
                    })
                  ) : (
                    <div className="rounded-xl border border-dashed px-4 py-8 text-center">
                      <CalendarDays className="mx-auto size-7 text-ink-3" />
                      <p className="mt-2 text-sm font-semibold">
                        Nothing scheduled for this day
                      </p>
                      <Link
                        href="/composer"
                        className="mt-2 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-accent-ink"
                      >
                        Create a post <ArrowRight className="size-4" />
                      </Link>
                    </div>
                  )}
                </div>
                <Link
                  href="/queue"
                  className="inline-flex min-h-11 items-center gap-2 text-xs font-semibold text-accent-ink"
                >
                  View publishing queue <ArrowRight className="size-3" />
                </Link>
              </section>
              <div className="space-y-6">
                <section aria-label="Weekly Traction">
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="flex items-center gap-2 font-display text-[17px] font-bold">
                      <BarChart3 className="size-5 text-accent-ink" />
                      Weekly Traction
                    </h2>
                    <span className="text-xs text-ink-2">Past 7 days</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      ["Published", published.length, "Posts delivered"],
                      [
                        "Impressions",
                        metrics?.overview.impressions ?? null,
                        "Reported by networks",
                      ],
                      [
                        "Engagements",
                        metrics?.overview.engagements ?? null,
                        "Reported by networks",
                      ],
                    ].map(([name, value, hint]) => (
                      <div
                        key={String(name)}
                        className="rounded-xl bg-surface-2 p-3"
                      >
                        <p className="text-[11px] text-ink-2">{name}</p>
                        <p className="mt-2 font-display text-xl font-bold">
                          {typeof value === "number"
                            ? formatNumber(value)
                            : "—"}
                        </p>
                        <p className="mt-1 text-[10px] text-ink-2">{hint}</p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 rounded-xl bg-studio-soft p-4">
                    <div className="flex justify-between text-xs font-semibold">
                      <span>Impressions by platform</span>
                      <Link href="/analytics" className="text-accent-ink">
                        View analytics ↗
                      </Link>
                    </div>
                    {reachTotal > 0 ? (
                      <>
                        <div className="mt-4 flex h-2 overflow-hidden rounded-full">
                          {networkImpressions.map((n, i) => (
                            <span
                              key={`${n.provider}:${i}`}
                              style={{
                                width: `${((n.metrics.impressions || 0) / reachTotal) * 100}%`,
                                backgroundColor: PROVIDERS[n.provider].color,
                              }}
                            />
                          ))}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-ink-2">
                          {networkImpressions.map((n, i) => (
                            <span key={`${n.provider}:${i}`}>
                              {PROVIDERS[n.provider].name}{" "}
                              {Math.round(
                                ((n.metrics.impressions || 0) / reachTotal) *
                                  100,
                              )}
                              %
                            </span>
                          ))}
                        </div>
                      </>
                    ) : (
                      <p className="mt-3 text-xs leading-relaxed text-ink-2">
                        No provider impression data is available for this
                        period. Published deliveries remain visible in Posts.
                      </p>
                    )}
                    {metrics?.mode === "demo" && (
                      <p className="mt-2 text-[10px] font-semibold text-info-ink">
                        Demo analytics · Sample metrics
                      </p>
                    )}
                  </div>
                </section>
                {(connections.length > 0 || attention.length > 0) && (
                  <section className="rounded-xl border border-warn/30 bg-warn-soft p-4">
                    <h2 className="flex items-center gap-2 text-sm font-semibold text-warn-ink">
                      <KeyRound className="size-4" />
                      Needs attention
                    </h2>
                    <p className="mt-2 text-xs leading-relaxed text-ink-2">
                      {connections.length} connections to review ·{" "}
                      {attention.length} posts need a delivery fix.
                    </p>
                    <div className="mt-2 flex gap-4">
                      <Link
                        href="/accounts"
                        className="inline-flex min-h-11 items-center text-xs font-semibold text-warn-ink"
                      >
                        Review channels ↗
                      </Link>
                      <Link
                        href="/posts?tab=attention"
                        className="inline-flex min-h-11 items-center text-xs font-semibold text-warn-ink"
                      >
                        Review posts ↗
                      </Link>
                    </div>
                  </section>
                )}
                {!connections.length && !attention.length && (
                  <div className="flex items-center gap-2 rounded-xl bg-accent-soft p-4 text-xs text-accent-ink">
                    <CheckCircle2 className="size-4" />
                    No connection or delivery issues reported.
                  </div>
                )}
              </div>
            </div>
            <section>
              <h2 className="mb-3 font-display text-[17px] font-bold">
                Studio Modules
              </h2>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {modules.map(([href, title, sub, Icon]) => (
                  <Link
                    key={href}
                    href={href}
                    className="rounded-xl bg-surface-2 p-4 transition-colors hover:bg-studio-soft"
                  >
                    <Icon className="mb-3 size-6 text-accent-ink" />
                    <h3 className="text-sm font-semibold">{title}</h3>
                    <p className="mt-1 text-xs text-ink-2">{sub}</p>
                  </Link>
                ))}
              </div>
            </section>
          </>
        )}
      </PageBody>
    </div>
  );
}
