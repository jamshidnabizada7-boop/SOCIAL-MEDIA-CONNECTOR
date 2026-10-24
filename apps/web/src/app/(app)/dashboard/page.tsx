"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CalendarClock,
  CircleCheckBig,
  KeyRound,
  Plus,
  TriangleAlert,
} from "lucide-react";
import type { Post, SocialAccount } from "@/lib/types";
import { postsService } from "@/lib/services/posts";
import { accountsService } from "@/lib/services/accounts";
import { useSubscribe } from "@/lib/services/hooks";
import { useSession } from "@/components/providers";
import { PageHeader, PageBody } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, Skeleton, EmptyState } from "@/components/ui/primitives";
import { PostStatePill, ProviderStack, TargetStatePill } from "@/components/ui/status";
import { MediaDot } from "@/components/ui/media-thumb";
import { mediaService } from "@/lib/services/media";
import { formatNumber, formatTime, timeUntil } from "@/lib/utils";

function StatCard({
  label,
  value,
  sub,
  icon,
  tone = "accent",
  href,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon: React.ReactNode;
  tone?: "accent" | "info" | "success" | "warn" | "danger";
  href: string;
}) {
  const tones = {
    accent: "bg-accent-soft text-accent-ink",
    info: "bg-info-soft text-info-ink",
    success: "bg-success-soft text-success-ink",
    warn: "bg-warn-soft text-warn-ink",
    danger: "bg-danger-soft text-danger-ink",
  };
  return (
    <Link href={href} className="group rounded-xl border bg-surface p-4 transition-colors hover:border-line-strong">
      <div className="flex items-center justify-between">
        <span className={`flex size-8 items-center justify-center rounded-lg ${tones[tone]}`}>{icon}</span>
        <ArrowRight className="size-4 text-ink-3 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
      </div>
      <p className="tnum mt-3 font-display text-[26px] font-bold leading-none tracking-tight">{value}</p>
      <p className="mt-1.5 text-[13px] font-medium text-ink-2">{label}</p>
      {sub && <p className="mt-0.5 text-[12px] text-ink-3">{sub}</p>}
    </Link>
  );
}

export default function DashboardPage() {
  const { session } = useSession();
  const router = useRouter();
  useSubscribe(postsService);
  useSubscribe(accountsService);
  const [loaded, setLoaded] = useState(false);
  const [posts, setPosts] = useState<Post[]>([]);
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);

  useEffect(() => {
    const read = () => {
      setPosts(postsService.list());
      setAccounts(accountsService.list());
      setLoaded(true);
    };
    Promise.all([postsService.listAsync(), accountsService.listAsync()]).then(read);
    const unsubs = [postsService.subscribe(read), accountsService.subscribe(read)];
    return () => unsubs.forEach((u) => u());
  }, []);

  const now = Date.now();
  const scheduledToday = useMemo(
    () =>
      posts.filter(
        (p) => p.state === "scheduled" && p.scheduledAt && new Date(p.scheduledAt).toDateString() === new Date().toDateString()
      ),
    [posts]
  );
  const publishing = useMemo(() => posts.filter((p) => p.state === "processing"), [posts]);
  const publishedThisWeek = useMemo(
    () => posts.filter((p) => p.publishedAt && now - +new Date(p.publishedAt) < 7 * 86400_000),
    [posts, now]
  );
  const needsAttention = useMemo(
    () => posts.filter((p) => p.state === "partially_published" || p.state === "failed"),
    [posts]
  );
  const connectionIssues = useMemo(
    () => accounts.filter((a) => a.connection === "needs_reauth" || a.connection === "token_expiring"),
    [accounts]
  );
  const upcoming = useMemo(
    () =>
      posts
        .filter((p) => p.state === "scheduled" && p.scheduledAt)
        .sort((a, b) => +new Date(a.scheduledAt!) - +new Date(b.scheduledAt!))
        .slice(0, 5),
    [posts]
  );

  if (!loaded) {
    return (
      <div>
        <PageHeader title="Home" />
        <PageBody className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-28 rounded-xl" />
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            <Skeleton className="h-72 rounded-xl" />
            <Skeleton className="h-72 rounded-xl" />
          </div>
        </PageBody>
      </div>
    );
  }

  const firstName = session?.user.name.split(" ")[0] ?? "there";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div>
      <PageHeader
        title={`${greeting}, ${firstName}`}
        description={new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
        actions={
          <Button onClick={() => router.push("/composer")}>
            <Plus className="size-4" />
            Create post
          </Button>
        }
      />
      <PageBody className="space-y-5">
        {/* Stats */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Scheduled today"
            value={scheduledToday.length}
            sub={scheduledToday[0]?.scheduledAt ? `Next at ${formatTime(scheduledToday[0].scheduledAt)}` : "Nothing left for today"}
            icon={<CalendarClock className="size-4" />}
            tone="info"
            href="/calendar"
          />
          <StatCard
            label="Publishing now"
            value={publishing.length}
            sub={publishing.length ? "Live delivery in progress" : "Queue is idle"}
            icon={<CircleCheckBig className="size-4" />}
            tone="accent"
            href="/posts?tab=publishing"
          />
          <StatCard
            label="Published this week"
            value={publishedThisWeek.length}
            sub={`${publishedThisWeek.reduce((a, p) => a + p.targets.filter((t) => t.state === "published").length, 0)} individual deliveries`}
            icon={<CircleCheckBig className="size-4" />}
            tone="success"
            href="/posts?tab=published"
          />
          <StatCard
            label="Needs attention"
            value={needsAttention.length}
            sub={connectionIssues.length ? `${connectionIssues.length} connection issue${connectionIssues.length === 1 ? "" : "s"}` : "Connections healthy"}
            icon={<TriangleAlert className="size-4" />}
            tone={needsAttention.length || connectionIssues.length ? "danger" : "success"}
            href="/posts?tab=attention"
          />
        </div>

        {/* Connection issues */}
        {connectionIssues.length > 0 && (
          <Card className="border-warn/40">
            <CardHeader
              title="Connection health"
              description="These accounts will hold scheduled content until they're reconnected."
              actions={
                <Link href="/accounts">
                  <Button variant="secondary" size="sm">Review accounts</Button>
                </Link>
              }
            />
            <ul className="divide-y">
              {connectionIssues.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                  <KeyRound className={`size-4.5 ${a.connection === "needs_reauth" ? "text-danger" : "text-warn"}`} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">
                      {a.provider === "x" ? "X" : a.provider.charAt(0).toUpperCase() + a.provider.slice(1)} · {a.handle}
                    </p>
                    <p className="text-[13px] text-ink-2">{a.connectionNote}</p>
                  </div>
                  <Link href="/accounts">
                    <Button size="sm" variant={a.connection === "needs_reauth" ? "primary" : "secondary"}>
                      {a.connection === "needs_reauth" ? "Reconnect" : "Details"}
                    </Button>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <div className="grid gap-4 lg:grid-cols-[1.45fr_1fr]">
          {/* Upcoming schedule */}
          <Card>
            <CardHeader
              title="Upcoming"
              description="Your next scheduled posts across all brands."
              actions={
                <Link href="/calendar" className="text-[13px] font-medium text-accent-ink hover:underline">
                  Open calendar
                </Link>
              }
            />
            {upcoming.length === 0 ? (
              <EmptyState
                icon={<CalendarClock className="size-5" />}
                title="Nothing scheduled yet"
                body="Create a post and pick a time — it will show up here and in the calendar."
                action={<Button onClick={() => router.push("/composer")}>Create a post</Button>}
              />
            ) : (
              <ul className="divide-y">
                {upcoming.map((p) => {
                  const thumb = p.mediaIds[0] ? mediaService.get(p.mediaIds[0]) : undefined;
                  return (
                    <li key={p.id}>
                      <Link href={`/posts/${p.id}`} className="flex items-center gap-3.5 px-5 py-3.5 transition-colors hover:bg-surface-2">
                        {thumb ? (
                          <MediaDot asset={thumb} />
                        ) : (
                          <span className="flex size-8 items-center justify-center rounded-md border bg-surface-2 text-[10px] font-semibold text-ink-3">Aa</span>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">{p.title}</p>
                          <p className="mt-0.5 flex items-center gap-2 text-[13px] text-ink-3">
                            <ProviderStack providers={p.targets.map((t) => t.provider)} />
                            <span className="truncate">{p.targets.length} {p.targets.length === 1 ? "destination" : "destinations"}</span>
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="tnum text-[13px] font-semibold">{timeUntil(p.scheduledAt!)}</p>
                          <p className="tnum text-[12px] text-ink-3">{formatTime(p.scheduledAt!)}</p>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {/* Needs attention posts */}
          <Card>
            <CardHeader title="Needs attention" description="Failed destinations and connection problems, with the fix." />
            {needsAttention.length === 0 ? (
              <EmptyState
                icon={<CircleCheckBig className="size-5" />}
                title="All clear"
                body="No failed destinations right now. We'll notify you if anything needs a fix."
              />
            ) : (
              <ul className="divide-y">
                {needsAttention.slice(0, 4).map((p) => (
                  <li key={p.id}>
                    <Link href={`/posts/${p.id}`} className="block px-5 py-3.5 transition-colors hover:bg-surface-2">
                      <div className="flex items-center justify-between gap-3">
                        <p className="truncate text-sm font-semibold">{p.title}</p>
                        <PostStatePill state={p.state} />
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {p.targets
                          .filter((t) => t.state === "failed" || t.state === "token_expired")
                          .map((t) => (
                            <span key={t.id} className="inline-flex items-center gap-1.5">
                              <TargetStatePill state={t.state} />
                            </span>
                          ))}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* Snapshot */}
        <Card>
          <CardHeader
            title="This week at a glance"
            description="Per-destination delivery counts."
            actions={
              <Link href="/analytics" className="text-[13px] font-medium text-accent-ink hover:underline">
                Full analytics
              </Link>
            }
          />
          <div className="grid grid-cols-2 divide-x divide-y sm:grid-cols-3 lg:grid-cols-4 lg:divide-y-0">
            {accounts.slice(0, 8).map((a) => {
              const delivered = posts
                .filter((p) => p.publishedAt && now - +new Date(p.publishedAt) < 7 * 86400_000)
                .reduce((acc, p) => acc + p.targets.filter((t) => t.accountId === a.id && t.state === "published").length, 0);
              return (
                <div key={a.id} className="flex items-center gap-3 p-4">
                  <ProviderStack providers={[a.provider]} max={1} />
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold">{a.handle}</p>
                    <p className="tnum text-[12px] text-ink-3">{formatNumber(a.followers)} followers · {delivered} posts</p>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </PageBody>
    </div>
  );
}
