import type { AnalyticsSeed } from "../mock/data";
import type { TopPost } from "../types";
import { DATA_MODE } from "@/lib/api/client";
import { ApiAnalyticsService } from "@/lib/services/analytics-api";
import { ANALYTICS_30D } from "../mock/data";
import { latency } from "./core";

export type AnalyticsRange = "7d" | "30d" | "90d";

/**
 * Analytics.
 *
 * Normalized metrics are stored alongside provider-native metrics; when a
 * provider does not report a metric the value is `null` and the UI shows N/A —
 * it is never coerced to zero. Cross-network comparisons carry a caveat.
 */
export interface AnalyticsService {
  overview(range: AnalyticsRange): Promise<AnalyticsSeed>;
}

function scaleRange(seed: AnalyticsSeed, range: AnalyticsRange): AnalyticsSeed {
  if (range === "30d") return seed;
  const factor = range === "7d" ? 7 / 30 : 90 / 30;
  const series = seed.series.slice(range === "7d" ? -7 : -90);
  const scale = (n: number | null) => (n === null ? null : Math.round(n * factor));
  return {
    overview: {
      impressions: scale(seed.overview.impressions),
      engagements: scale(seed.overview.engagements),
      followers: seed.overview.followers,
      clicks: scale(seed.overview.clicks),
    },
    deltas: seed.deltas,
    series,
    byNetwork: seed.byNetwork.map((n) => ({
      ...n,
      metrics: Object.fromEntries(
        Object.entries(n.metrics).map(([k, v]) => [k, scale(v as number | null)])
      ) as AnalyticsSeed["byNetwork"][number]["metrics"],
    })),
    topPosts: seed.topPosts.map((p) => ({
      ...p,
      impressions: p.impressions === null ? null : Math.round(p.impressions * factor),
      engagements: p.engagements === null ? null : Math.round(p.engagements * factor),
    })) as TopPost[],
  };
}

class MockAnalyticsService implements AnalyticsService {
  async overview(range: AnalyticsRange): Promise<AnalyticsSeed> {
    await latency("slow");
    return scaleRange(ANALYTICS_30D, range);
  }
}

export const analyticsService: AnalyticsService =
  DATA_MODE === "api" ? new ApiAnalyticsService() : new MockAnalyticsService();
