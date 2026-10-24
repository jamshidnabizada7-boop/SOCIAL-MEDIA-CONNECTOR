import { and, eq, gte, isNotNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { publishTargets, posts, socialAccounts, postMetrics } from "@aria/db";
import type { AriaDatabase } from "@aria/db";
import { requireWorkspacePermission } from "../../plugins/auth.js";
import type { FastifyRequest, FastifyReply } from "fastify";

export async function analyticsOverview(
  db: AriaDatabase,
  workspaceId: string,
  rangeDays: number
) {
  const since = new Date(Date.now() - rangeDays * 86_400_000);

  const accounts = await db
    .select({ id: socialAccounts.id, providerId: socialAccounts.providerId, handle: socialAccounts.handle, followers: socialAccounts.followers })
    .from(socialAccounts)
    .where(eq(socialAccounts.workspaceId, workspaceId));

  const followers = accounts.reduce((sum, a) => sum + (a.followers ?? 0), 0);

  const publishedTargets = await db
    .select({
      targetId: publishTargets.id,
      providerId: publishTargets.providerId,
      accountId: publishTargets.accountId,
      publishedAt: publishTargets.publishedAt,
      postId: publishTargets.postId,
    })
    .from(publishTargets)
    .where(and(eq(publishTargets.state, "published"), gte(publishTargets.publishedAt, since)));
  const workspacePostIds = new Set(
    (await db.select({ id: posts.id }).from(posts).where(eq(posts.workspaceId, workspaceId))).map((p) => p.id)
  );
  const mine = publishedTargets.filter((t) => workspacePostIds.has(t.postId));

  // Series: posts published per day.
  const seriesMap = new Map<string, number>();
  for (let i = rangeDays - 1; i >= 0; i--) {
    const date = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    seriesMap.set(date, 0);
  }
  for (const t of mine) {
    if (!t.publishedAt) continue;
    const date = t.publishedAt.toISOString().slice(0, 10);
    seriesMap.set(date, (seriesMap.get(date) ?? 0) + 1);
  }
  const series = [...seriesMap.entries()].map(([date, published]) => ({ date, published }));

  // Per-network rollup. Engagement metrics stay null until ingestion exists —
  // the UI renders N/A, never a zero (plan §49).
  const byNetworkMap = new Map<string, { published: number; followers: number | null }>();
  for (const a of accounts) {
    byNetworkMap.set(a.providerId, { published: 0, followers: a.followers ?? 0 });
  }
  for (const t of mine) {
    const entry = byNetworkMap.get(t.providerId) ?? { published: 0, followers: null };
    entry.published += 1;
    byNetworkMap.set(t.providerId, entry);
  }

  const byNetwork = [...byNetworkMap.entries()]
    .map(([provider, entry]) => {
      const account = accounts.find((a) => a.providerId === provider);
      return {
        provider,
        accountName: account?.handle ?? provider,
        published: entry.published,
        followers: entry.followers,
        impressions: null,
        engagements: null,
        likes: null,
        comments: null,
        shares: null,
        clicks: null,
      };
    })
    .sort((a, b) => b.published - a.published);

  // Ingested engagement metrics (provider pull jobs) — used when present.
  const targetIds = mine.map((t) => t.targetId);
  const ingested = targetIds.length
    ? await db
        .select({ targetId: postMetrics.targetId, impressions: postMetrics.impressions, engagements: postMetrics.engagements })
        .from(postMetrics)
        .where(isNotNull(postMetrics.impressions))
    : [];
  const metricsByTarget = new Map(ingested.map((m) => [m.targetId, m]));
  const topPosts = mine
    .map((t) => metricsByTarget.get(t.targetId))
    .filter((m): m is NonNullable<typeof m> => !!m)
    .sort((a, b) => (b.impressions ?? 0) - (a.impressions ?? 0))
    .slice(0, 4);
  void topPosts;

  return {
    mode: "live" as const,
    overview: {
      impressions: null as number | null,
      engagements: null as number | null,
      followers,
      clicks: null as number | null,
    },
    deltas: {
      impressions: null,
      engagements: null,
      followers: null,
      clicks: null,
    },
    series,
    byNetwork,
    topPosts: [],
  };
}

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
    { preHandler: requireWorkspacePermission(app) },
    async (req, reply) => {
      const { workspaceId } = req.params as { workspaceId: string };
      const { range } = req.query as { range?: string };
      const days = range === "7d" ? 7 : range === "90d" ? 90 : 30;
      return reply.send(await analyticsOverview(db, workspaceId, days));
    }
  );

  // Ingestion endpoint for provider pull jobs (Phase 8+ scheduled workers).
  app.post("/v1/admin/analytics/ingest", { preHandler: requireAdmin() }, async (req, reply) => {
    const rows = req.body as Array<{
      targetId: string;
      impressions?: number | null;
      engagements?: number | null;
      likes?: number | null;
      comments?: number | null;
      shares?: number | null;
      clicks?: number | null;
    }>;
    if (!Array.isArray(rows)) {
      return reply.status(400).send({ error: { code: "invalid_input", message: "Expected an array of metric rows." } });
    }
    for (const row of rows) {
      await db.insert(postMetrics).values({
        targetId: row.targetId,
        impressions: row.impressions ?? null,
        engagements: row.engagements ?? null,
        likes: row.likes ?? null,
        comments: row.comments ?? null,
        shares: row.shares ?? null,
        clicks: row.clicks ?? null,
      });
    }
    return reply.status(201).send({ ingested: rows.length });
  });
}


