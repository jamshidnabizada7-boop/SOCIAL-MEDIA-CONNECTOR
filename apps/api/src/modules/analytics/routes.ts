import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { postMetrics, posts, publishTargets, socialAccounts } from "@aria/db";
import type { AriaDatabase } from "@aria/db";
import { requireWorkspacePermission } from "../../plugins/auth.js";

type MetricKey = "impressions" | "engagements" | "likes" | "comments" | "shares" | "clicks";
const METRIC_KEYS: MetricKey[] = ["impressions", "engagements", "likes", "comments", "shares", "clicks"];

/** Sums that stay null when no destination reported the metric (the UI shows N/A, never a fake zero). */
function addMetric(acc: number | null, value: number | null | undefined): number | null {
  return typeof value === "number" ? (acc ?? 0) + value : acc;
}

async function publishedInWindow(db: AriaDatabase, workspaceId: string, from: Date, to: Date) {
  return db
    .select({
      targetId: publishTargets.id,
      providerId: publishTargets.providerId,
      accountId: publishTargets.accountId,
      publishedAt: publishTargets.publishedAt,
      postId: publishTargets.postId,
      remoteUrl: publishTargets.remoteUrl,
      title: posts.title,
      caption: posts.caption,
    })
    .from(publishTargets)
    .innerJoin(posts, eq(posts.id, publishTargets.postId))
    .where(
      and(
        eq(posts.workspaceId, workspaceId),
        eq(publishTargets.state, "published"),
        gte(publishTargets.publishedAt, from),
        lt(publishTargets.publishedAt, to)
      )
    );
}

/** Latest snapshot per destination. */
async function latestMetrics(db: AriaDatabase, targetIds: string[]) {
  if (targetIds.length === 0) return new Map<string, typeof postMetrics.$inferSelect>();
  const rows = await db
    .select()
    .from(postMetrics)
    .where(inArray(postMetrics.targetId, targetIds))
    .orderBy(desc(postMetrics.capturedAt));
  const latest = new Map<string, typeof postMetrics.$inferSelect>();
  for (const r of rows) if (!latest.has(r.targetId)) latest.set(r.targetId, r);
  return latest;
}

function pctDelta(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export async function analyticsOverview(db: AriaDatabase, workspaceId: string, rangeDays: number) {
  const now = new Date();
  const since = new Date(now.getTime() - rangeDays * 86_400_000);
  const prevSince = new Date(since.getTime() - rangeDays * 86_400_000);

  const accounts = await db
    .select({ id: socialAccounts.id, providerId: socialAccounts.providerId, handle: socialAccounts.handle, followers: socialAccounts.followers })
    .from(socialAccounts)
    .where(eq(socialAccounts.workspaceId, workspaceId));
  const followers = accounts.reduce((sum, a) => sum + (a.followers ?? 0), 0);

  const [mine, previous] = await Promise.all([
    publishedInWindow(db, workspaceId, since, now),
    publishedInWindow(db, workspaceId, prevSince, since),
  ]);
  const [metrics, prevMetrics] = await Promise.all([
    latestMetrics(db, mine.map((t) => t.targetId)),
    latestMetrics(db, previous.map((t) => t.targetId)),
  ]);

  // Series: posts published per day, plus engagements credited to the publish day.
  const seriesMap = new Map<string, { published: number; engagements: number | null }>();
  for (let i = rangeDays - 1; i >= 0; i--) {
    seriesMap.set(new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10), { published: 0, engagements: null });
  }
  for (const t of mine) {
    if (!t.publishedAt) continue;
    const day = seriesMap.get(t.publishedAt.toISOString().slice(0, 10));
    if (!day) continue;
    day.published += 1;
    day.engagements = addMetric(day.engagements, metrics.get(t.targetId)?.engagements);
  }
  const series = [...seriesMap.entries()].map(([date, v]) => ({ date, published: v.published, engagements: v.engagements }));

  const totals = (rows: typeof mine, m: typeof metrics) => {
    const out: Record<MetricKey, number | null> = { impressions: null, engagements: null, likes: null, comments: null, shares: null, clicks: null };
    for (const t of rows) {
      const snap = m.get(t.targetId);
      if (!snap) continue;
      for (const k of METRIC_KEYS) out[k] = addMetric(out[k], snap[k]);
    }
    return out;
  };
  const current = totals(mine, metrics);
  const before = totals(previous, prevMetrics);

  const byNetworkMap = new Map<string, { published: number; followers: number | null } & Record<MetricKey, number | null>>();
  const blank = () => ({ published: 0, followers: null, impressions: null, engagements: null, likes: null, comments: null, shares: null, clicks: null });
  for (const a of accounts) {
    const entry = byNetworkMap.get(a.providerId) ?? blank();
    entry.followers = (entry.followers ?? 0) + (a.followers ?? 0);
    byNetworkMap.set(a.providerId, entry);
  }
  for (const t of mine) {
    const entry = byNetworkMap.get(t.providerId) ?? blank();
    entry.published += 1;
    const snap = metrics.get(t.targetId);
    if (snap) for (const k of METRIC_KEYS) entry[k] = addMetric(entry[k], snap[k]);
    byNetworkMap.set(t.providerId, entry);
  }
  const byNetwork = [...byNetworkMap.entries()]
    .map(([provider, entry]) => ({
      provider,
      accountName: accounts.find((a) => a.providerId === provider)?.handle ?? provider,
      ...entry,
    }))
    .sort((a, b) => b.published - a.published);

  const topPosts = mine
    .map((t) => ({ t, m: metrics.get(t.targetId) }))
    .filter((x) => x.m && (x.m.engagements ?? 0) + (x.m.impressions ?? 0) > 0)
    .sort((a, b) => (b.m!.engagements ?? 0) - (a.m!.engagements ?? 0) || (b.m!.impressions ?? 0) - (a.m!.impressions ?? 0))
    .slice(0, 5)
    .map(({ t, m }) => ({
      postId: t.postId,
      title: t.title || t.caption.slice(0, 60),
      caption: t.caption,
      provider: t.providerId,
      publishedAt: t.publishedAt!.toISOString(),
      impressions: m!.impressions,
      engagements: m!.engagements,
      url: t.remoteUrl,
      hue: [...t.postId].reduce((a, c) => a + c.charCodeAt(0), 0) % 360,
    }));

  return {
    mode: "live" as const,
    published: mine.length,
    overview: { impressions: current.impressions, engagements: current.engagements, followers, clicks: current.clicks },
    deltas: {
      impressions: pctDelta(current.impressions, before.impressions),
      engagements: pctDelta(current.engagements, before.engagements),
      followers: null,
      clicks: pctDelta(current.clicks, before.clicks),
      published: pctDelta(mine.length, previous.length),
    },
    series,
    byNetwork,
    topPosts,
    /** Networks whose engagement is collected automatically. */
    metricsNetworks: ["mastodon", "bluesky", "youtube"],
  };
}

const ingestSchema = z
  .array(
    z.object({
      targetId: z.string().uuid(),
      impressions: z.number().int().min(0).nullable().optional(),
      engagements: z.number().int().min(0).nullable().optional(),
      likes: z.number().int().min(0).nullable().optional(),
      comments: z.number().int().min(0).nullable().optional(),
      shares: z.number().int().min(0).nullable().optional(),
      clicks: z.number().int().min(0).nullable().optional(),
    })
  )
  .max(1000);

export function registerAnalyticsRoutes(app: FastifyInstance): void {
  const db = app.database.db;

  function requireAdmin() {
    return async (req: FastifyRequest, reply: FastifyReply) => {
      if (!req.user) {
        return reply.status(401).send({ error: { code: "unauthenticated", message: "Sign in to continue." } });
      }
      if (!req.user.isPlatformAdmin) {
        return reply.status(403).send({ error: { code: "forbidden", message: "Platform admin access required." } });
      }
    };
  }

  app.get(
    "/v1/workspaces/:workspaceId/analytics/overview",
    { preHandler: requireWorkspacePermission(app, "view_analytics") },
    async (req, reply) => {
      const { workspaceId } = req.params as { workspaceId: string };
      const { range } = req.query as { range?: string };
      const days = range === "7d" ? 7 : range === "90d" ? 90 : 30;
      return reply.send(await analyticsOverview(db, workspaceId, days));
    }
  );

  /** Manual/backfill ingestion for operators; the worker ingests automatically. */
  app.post("/v1/admin/analytics/ingest", { preHandler: requireAdmin() }, async (req, reply) => {
    const parsed = ingestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Expected an array of metric rows." } });
    }
    if (parsed.data.length > 0) {
      await db.insert(postMetrics).values(
        parsed.data.map((row) => ({
          targetId: row.targetId,
          impressions: row.impressions ?? null,
          engagements: row.engagements ?? null,
          likes: row.likes ?? null,
          comments: row.comments ?? null,
          shares: row.shares ?? null,
          clicks: row.clicks ?? null,
        }))
      );
    }
    return reply.status(201).send({ ingested: parsed.data.length });
  });
}
