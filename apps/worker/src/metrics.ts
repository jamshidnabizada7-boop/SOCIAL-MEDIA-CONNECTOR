import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { postMetrics, publishTargets, remotePosts, socialAccounts } from "@aria/db";
import type { AriaDatabase } from "@aria/db";
import {
  blueskyPostMetrics,
  mastodonStatusMetrics,
  METRICS_PROVIDERS,
  resolveAccessToken,
  youtubeVideoMetrics,
  type PostMetricsSnapshot,
} from "@aria/providers-core";

const DAY = 86_400_000;
/** Posts are tracked for 30 days after publishing. */
const TRACK_FOR_MS = 30 * DAY;
/** A post is re-polled at most every 6 hours. */
const MIN_INTERVAL_MS = 6 * 3_600_000;
const BATCH = 150;

/**
 * Pulls engagement for recently published posts on networks whose metrics
 * we can read (Mastodon, Bluesky, YouTube) and appends a post_metrics
 * snapshot. Analytics reads the latest snapshot per destination.
 */
export async function ingestMetrics(db: AriaDatabase, log: (msg: string, meta?: Record<string, unknown>) => void): Promise<number> {
  const since = new Date(Date.now() - TRACK_FOR_MS);
  const candidates = await db
    .select({
      targetId: publishTargets.id,
      providerId: publishTargets.providerId,
      accountId: publishTargets.accountId,
      providerPostId: remotePosts.providerPostId,
    })
    .from(publishTargets)
    .innerJoin(remotePosts, eq(remotePosts.targetId, publishTargets.id))
    .where(
      and(
        eq(publishTargets.state, "published"),
        gte(publishTargets.publishedAt, since),
        inArray(publishTargets.providerId, [...METRICS_PROVIDERS])
      )
    )
    .orderBy(desc(publishTargets.publishedAt))
    .limit(BATCH * 4);
  if (candidates.length === 0) return 0;

  const latest = await db
    .select({ targetId: postMetrics.targetId, capturedAt: postMetrics.capturedAt })
    .from(postMetrics)
    .where(inArray(postMetrics.targetId, candidates.map((c) => c.targetId)))
    .orderBy(desc(postMetrics.capturedAt));
  const lastSeen = new Map<string, number>();
  for (const m of latest) if (!lastSeen.has(m.targetId)) lastSeen.set(m.targetId, m.capturedAt.getTime());
  const due = candidates.filter((c) => Date.now() - (lastSeen.get(c.targetId) ?? 0) > MIN_INTERVAL_MS).slice(0, BATCH);

  let captured = 0;
  for (const c of due) {
    try {
      const account = (await db.select().from(socialAccounts).where(eq(socialAccounts.id, c.accountId)).limit(1))[0];
      if (!account || account.connection === "needs_reauth" || account.connection === "disconnected") continue;
      const { accessToken } = await resolveAccessToken(db, account.id);
      let snap: PostMetricsSnapshot;
      if (c.providerId === "mastodon" && account.instanceUrl) {
        snap = await mastodonStatusMetrics(account.instanceUrl, accessToken, c.providerPostId);
      } else if (c.providerId === "bluesky") {
        snap = await blueskyPostMetrics(accessToken, c.providerPostId, { instanceUrl: account.instanceUrl ?? undefined });
      } else if (c.providerId === "youtube") {
        snap = await youtubeVideoMetrics(accessToken, c.providerPostId);
      } else {
        continue;
      }
      await db.insert(postMetrics).values({
        targetId: c.targetId,
        impressions: snap.impressions,
        likes: snap.likes,
        comments: snap.comments,
        shares: snap.shares,
        engagements: snap.engagements,
      });
      captured++;
    } catch (err) {
      // One deleted post or revoked token must not stop the batch.
      log("metrics fetch failed", { targetId: c.targetId, provider: c.providerId, error: (err as Error).message });
    }
  }
  return captured;
}
