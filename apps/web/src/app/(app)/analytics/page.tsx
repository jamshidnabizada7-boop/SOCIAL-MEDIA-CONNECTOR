"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Download, Info, TrendingDown, TrendingUp } from "lucide-react";
import type { TopPost } from "@/lib/types";
import { analyticsService, type AnalyticsRange } from "@/lib/services/analytics";
import type { AnalyticsSeed } from "@/lib/mock/data";
import { PageHeader, PageBody } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, Segmented, Skeleton, Tooltip } from "@/components/ui/primitives";
import { AreaChart, BarList, Sparkline } from "@/components/ui/charts";
import { ProviderBadge } from "@/components/ui/status";
import { PROVIDERS } from "@/lib/providers";
import { useToast } from "@/components/providers";
import { formatNumber, timeAgo } from "@/lib/utils";

function Delta({ value }: { value: number }) {
  const up = value >= 0;
  return (
    <span className={`inline-flex items-center gap-1 text-[12px] font-semibold ${up ? "text-success-ink" : "text-danger-ink"}`}>
      {up ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
      {up ? "+" : ""}{value}%
    </span>
  );
}

export default function AnalyticsPage() {
  const toast = useToast();
  const [range, setRange] = useState<AnalyticsRange>("30d");
  const [data, setData] = useState<AnalyticsSeed | null>(null);
  const [metric, setMetric] = useState<"impressions" | "engagements">("impressions");

  useEffect(() => {
    setData(null);
    analyticsService
      .overview(range)
      .then(setData)
      .catch((err: Error) => toast({ title: "Couldn't load analytics", description: err.message, variant: "error" }));
  }, [range, toast]);

  const series = useMemo(() => (data ? data.series.map((p) => ({ date: p.date, value: p[metric] })) : []), [data, metric]);

  if (!data) {
    return (
      <div>
        <PageHeader title="Analytics" description="Performance across every connected network." />
        <PageBody className="space-y-4">
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </PageBody>
      </div>
    );
  }

  const live = data.mode === "live";

  /** CSV of the visible period: one row per day, then one per network. */
  const exportCsv = () => {
    const esc = (v: unknown) => {
      const text = v === null || v === undefined ? "" : String(v);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const lines = [
      live ? "date,posts_published,engagements" : "date,impressions,engagements",
      ...data.series.map((p) => [p.date, p.impressions, p.engagements].map(esc).join(",")),
      "",
      "network,account,posts_published,impressions,engagements,likes,comments,shares,clicks",
      ...data.byNetwork.map((n) =>
        [
          PROVIDERS[n.provider].name,
          n.accountName,
          (n as { published?: number }).published ?? "",
          n.metrics.impressions,
          n.metrics.engagements,
          n.metrics.likes,
          n.metrics.comments,
          n.metrics.shares,
          n.metrics.clicks,
        ]
          .map(esc)
          .join(",")
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `aria-hub-analytics-${range}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Analytics exported", variant: "success" });
  };
  const stat = (label: string, value: number | null, delta: number, spark: number[]) => (
    <Card className="flex items-center justify-between p-4">
      <div>
        <p className="text-[13px] font-medium text-ink-2">{label}</p>
        <p className="tnum mt-1 font-display text-[26px] font-bold leading-none tracking-tight">
          {value === null ? <span className="text-ink-3">N/A</span> : formatNumber(value)}
        </p>
        <div className="mt-1.5"><Delta value={delta} /></div>
      </div>
      <Sparkline values={spark} className="h-10 w-28" color="var(--accent)" />
    </Card>
  );

  return (
    <div>
      <PageHeader
        title="Analytics"
        description="Normalized metrics alongside provider-native ones. Where a network doesn't report a metric, you'll see N/A — never a fake zero."
        actions={
          <>
            <Segmented
              value={range}
              onChange={setRange}
              size="sm"
              options={[
                { value: "7d", label: "7 days" },
                { value: "30d", label: "30 days" },
                { value: "90d", label: "90 days" },
              ]}
            />
            <Button variant="secondary" size="sm" onClick={exportCsv}>
              <Download className="size-4" /> Export
            </Button>
          </>
        }
      />
      <PageBody className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {stat(live ? "Posts published" : "Impressions", live ? data.series.reduce((a, p) => a + p.impressions, 0) : data.overview.impressions, data.deltas.impressions, data.series.slice(-14).map((p) => p.impressions))}
          {!live && stat("Engagements", data.overview.engagements, data.deltas.engagements, data.series.slice(-14).map((p) => p.engagements))}
          {stat("Total followers", data.overview.followers, data.deltas.followers, live ? [] : data.series.slice(-14).map((p) => Math.round(p.impressions * 12.4)))}
          {!live && stat("Link clicks", data.overview.clicks, data.deltas.clicks, data.series.slice(-14).map((p) => Math.round(p.engagements * 0.6)))}
          {live && stat("Engagements", data.overview.engagements, data.deltas.engagements, data.series.slice(-14).map((p) => p.engagements))}
        </div>

        <Card>
          <CardHeader
            title={live ? "Posts published" : "Trend"}
            description={live ? "Your publishing volume per day, straight from the delivery engine." : "Daily totals across all connected accounts."}
            actions={
              live ? undefined : (
              <Segmented
                value={metric}
                onChange={setMetric}
                size="sm"
                options={[
                  { value: "impressions", label: "Impressions" },
                  { value: "engagements", label: "Engagements" },
                ]}
              />
              )
            }
          />
          <div className="p-5">
            {live ? (
              <p className="mb-4 rounded-lg border border-info/25 bg-info-soft p-3 text-[13px] leading-relaxed text-info-ink">
                Engagement (likes, replies, reposts, views) is collected automatically every few hours for Mastodon, Bluesky and
                YouTube. Other networks report it once their analytics permissions are approved. Delivery data is live.
              </p>
            ) : null}
            <AreaChart points={series} height={220} formatValue={(n) => formatNumber(n)} />
          </div>
        </Card>

        <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <Card>
            <CardHeader
              title="By network"
              description={live ? "Deliveries per platform." : "Impressions per platform."}
              actions={
                live ? undefined : (
                <Tooltip label="Each network defines impressions differently. Compare trends, not absolute values.">
                  <span className="inline-flex">
                    <Info className="size-4 text-ink-3" />
                  </span>
                </Tooltip>
                )
              }
            />
            <div className="px-5 py-2">
              <BarList
                rows={data.byNetwork.map((n) => {
                  const published = (n as { published?: number }).published ?? 0;
                  return {
                    label: PROVIDERS[n.provider].name,
                    icon: <ProviderBadge provider={n.provider} size="xs" />,
                    value: live ? published : n.metrics.impressions,
                    display: live
                      ? `${formatNumber(published)} posts${n.metrics.engagements === null ? "" : ` · ${formatNumber(n.metrics.engagements)} engagements`}`
                      : n.metrics.impressions === null
                        ? "N/A"
                        : formatNumber(n.metrics.impressions),
                    color: PROVIDERS[n.provider].color,
                  };
                })}
              />
              <p className="mt-2 text-[11.5px] leading-relaxed text-ink-3">
                Bluesky and Mastodon don&apos;t expose impression counts through their APIs — engagement totals are still collected.
              </p>
            </div>
          </Card>

          {(!live || data.topPosts.length > 0) && (
          <Card>
            <CardHeader title="Top posts" description="Best performers in this period." />
            <ul className="divide-y">
              {data.topPosts.map((tp: TopPost) => (
                <li key={tp.postId}>
                  <Link href={`/posts/${tp.postId}`} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-2">
                    <span
                      className="flex size-9 shrink-0 items-center justify-center rounded-lg font-display text-[11px] font-bold text-white"
                      style={{ background: `linear-gradient(135deg, hsl(${tp.hue} 45% 62%), hsl(${(tp.hue + 40) % 360} 50% 44%))` }}
                      aria-hidden
                    >
                      {tp.title.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-semibold">{tp.title}</span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-[12px] text-ink-3">
                        <ProviderBadge provider={tp.provider} size="xs" />
                        {PROVIDERS[tp.provider].name} · {timeAgo(tp.publishedAt)}
                      </span>
                    </span>
                    <span className="tnum text-right">
                      <span className="block text-[13px] font-semibold">{tp.impressions === null ? "N/A" : formatNumber(tp.impressions)}</span>
                      <span className="block text-[11px] text-ink-3">{tp.engagements === null ? "" : `${formatNumber(tp.engagements)} engagements`}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
          )}
        </div>

        {!live && (
        <Card>
          <CardHeader title="Engagement quality by network" description="Engagements relative to impressions where both are reported." />
          <div className="grid gap-x-6 gap-y-3 p-5 sm:grid-cols-2 lg:grid-cols-3">
            {data.byNetwork
              .filter((n) => n.metrics.impressions !== null && n.metrics.engagements !== null && (n.metrics.impressions ?? 0) > 0)
              .map((n) => {
                const rate = ((n.metrics.engagements ?? 0) / (n.metrics.impressions ?? 1)) * 100;
                return (
                  <div key={n.provider}>
                    <div className="flex items-center justify-between text-[13px]">
                      <span className="inline-flex items-center gap-1.5 font-medium">
                        <ProviderBadge provider={n.provider} size="xs" />
                        {PROVIDERS[n.provider].name}
                      </span>
                      <span className="tnum font-semibold">{rate.toFixed(1)}%</span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full border border-line bg-surface-2">
                      <div className="h-full rounded-full" style={{ width: `${Math.min(100, rate * 12)}%`, backgroundColor: PROVIDERS[n.provider].color }} />
                    </div>
                  </div>
                );
              })}
          </div>
        </Card>
        )}
      </PageBody>
    </div>
  );
}
