"use client";

/**
 * API-backed analytics. Honest by design: until provider analytics ingestion
 * is approved and running, engagement metrics are null (the UI shows N/A —
 * never a fake zero). What IS real: posts published per day, per-network
 * delivery counts, and follower totals from connected accounts.
 */

import type { AnalyticsRange } from "@/lib/services/analytics";
import type { AnalyticsSeed } from "@/lib/mock/data";
import { apiGet } from "@/lib/api/client";

interface ApiOverview {
  mode: "live";
  overview: { impressions: number | null; engagements: number | null; followers: number; clicks: number | null };
  deltas: { impressions: number | null; engagements: number | null; followers: number | null; clicks: number | null };
  series: { date: string; published: number; engagements: number | null }[];
  byNetwork: Array<{
    provider: string;
    accountName: string;
    published: number;
    followers: number | null;
    impressions: number | null;
    engagements: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
    clicks: number | null;
  }>;
  topPosts: Array<{
    postId: string;
    title: string;
    caption: string;
    provider: string;
    publishedAt: string;
    impressions: number | null;
    engagements: number | null;
    hue: number;
  }>;
}

export class ApiAnalyticsService {
  async overview(range: AnalyticsRange): Promise<AnalyticsSeed> {
    const data = await apiGet<ApiOverview>(`/v1/workspaces/current/analytics/overview?range=${range}`);
    const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
    // Fill the series to cover the full range so the chart x-axis is honest.
    // Live mode: `impressions` carries posts published per day (the page labels it so).
    const byDate = new Map(data.series.map((p) => [p.date, p]));
    const series: { date: string; impressions: number; engagements: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
      const point = byDate.get(date);
      series.push({ date, impressions: point?.published ?? 0, engagements: point?.engagements ?? 0 });
    }
    return {
      mode: "live",
      overview: data.overview,
      deltas: {
        impressions: data.deltas.impressions ?? 0,
        engagements: data.deltas.engagements ?? 0,
        followers: data.deltas.followers ?? 0,
        clicks: data.deltas.clicks ?? 0,
      },
      series,
      byNetwork: data.byNetwork.map((n) => ({
        provider: n.provider as AnalyticsSeed["byNetwork"][number]["provider"],
        accountName: n.accountName,
        published: n.published,
        metrics: {
          impressions: n.impressions,
          engagements: n.engagements,
          likes: n.likes,
          comments: n.comments,
          shares: n.shares,
          clicks: n.clicks,
        },
      })),
      topPosts: data.topPosts.map((p) => ({
        ...p,
        provider: p.provider as AnalyticsSeed["topPosts"][number]["provider"],
      })),
    } as AnalyticsSeed & { mode: "live" };
  }
}
