import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull, lt, lte, or, sql } from "drizzle-orm";
import {
  feedItems,
  feedSessions,
  feedSources,
  feedSyncState,
  socialAccounts,
  users,
  workspaceMembers,
  workspaces,
  type AriaDatabase,
} from "@aria/db";
import {
  retrieveFeed,
  resolveAccessToken,
  ProviderHttpError,
  validateFeedSource,
  type FeedContext,
} from "@aria/providers-core";
import type { ProviderId, UniversalFeedItem } from "@aria/shared-types";

export interface FeedSyncOptions {
  fetchImpl?: FeedContext["fetchImpl"];
  now?: Date;
}
/** One leased read job. Publishing and Inbox use their own queues and cannot be blocked by feed failure. */
export async function syncFeedSource(
  db: AriaDatabase,
  sourceId: string,
  options: FeedSyncOptions = {},
): Promise<boolean> {
  const now = options.now || new Date(),
    lease = randomUUID();
  const [claimed] = await db
    .update(feedSyncState)
    .set({ leaseId: lease, leaseExpiresAt: new Date(now.getTime() + 180000) })
    .where(
      and(
        eq(feedSyncState.sourceId, sourceId),
        lte(feedSyncState.nextSyncAt, now),
        or(
          isNull(feedSyncState.leaseExpiresAt),
          lte(feedSyncState.leaseExpiresAt, now),
        ),
      ),
    )
    .returning();
  if (!claimed) return false;
  const ownLease = and(
    eq(feedSyncState.sourceId, sourceId),
    eq(feedSyncState.leaseId, lease),
  );
  try {
    const [s] = await db
      .select({ source: feedSources })
      .from(feedSources)
      .innerJoin(users, eq(users.id, feedSources.userId))
      .where(
        and(
          eq(feedSources.id, sourceId),
          eq(feedSources.enabled, true),
          eq(users.status, "active"),
        ),
      );
    if (!s) {
      await db
        .update(feedSyncState)
        .set({
          leaseId: null,
          leaseExpiresAt: null,
          nextSyncAt: new Date(now.getTime() + 3600000),
        })
        .where(ownLease);
      return false;
    }
    const source = s.source;
    const ctx: FeedContext = {
      provider: source.provider as ProviderId,
      kind: source.kind,
      config: validateFeedSource(
        source.provider as ProviderId,
        source.kind,
        source.config,
      ),
      fetchImpl: options.fetchImpl,
    };
    if (source.accountId) {
      const [r] = await db
        .select({ account: socialAccounts })
        .from(socialAccounts)
        .innerJoin(
          workspaceMembers,
          and(
            eq(workspaceMembers.workspaceId, socialAccounts.workspaceId),
            eq(workspaceMembers.userId, source.userId),
            eq(workspaceMembers.status, "active"),
          ),
        )
        .innerJoin(
          workspaces,
          and(
            eq(workspaces.id, socialAccounts.workspaceId),
            isNull(workspaces.deletedAt),
          ),
        )
        .where(
          and(
            eq(socialAccounts.id, source.accountId),
            eq(socialAccounts.workspaceId, source.workspaceId!),
          ),
        );
      if (
        !r ||
        r.account.connection !== "healthy" ||
        r.account.providerId !== source.provider
      )
        throw new Error(
          "This account is unavailable or its workspace access has changed.",
        );
      ctx.account = {
        ...r.account,
        instanceUrl: r.account.instanceUrl || undefined,
      };
      ctx.accessToken = (
        await resolveAccessToken(db, r.account.id)
      ).accessToken;
      if (ctx.provider === "mastodon")
        ctx.config = {
          ...ctx.config,
          instance: r.account.instanceUrl || ctx.config.instance,
        };
    } else if (source.kind === "account" || source.kind === "timeline")
      throw new Error("An authorized account is required for this source.");
    const items = await retrieveFeed(ctx);
    await db.transaction(async (tx) => {
      const [state] = await tx
        .select()
        .from(feedSyncState)
        .where(ownLease)
        .for("update");
      if (!state) return;
      const [current] = await tx
        .select()
        .from(feedSources)
        .where(and(eq(feedSources.id, sourceId), eq(feedSources.enabled, true)))
        .for("update");
      if (!current) return;
      const seen = new Set<string>();
      for (const item of items.slice(0, 50)) {
        if (
          seen.has(item.providerPostId) ||
          item.availability === "unavailable"
        )
          continue;
        seen.add(item.providerPostId);
        const content: UniversalFeedItem = {
          ...item,
          id: "",
          sourceId,
          sourceType: source.kind,
          topics: source.topics,
        };
        await tx
          .insert(feedItems)
          .values({
            sourceId,
            providerPostId: item.providerPostId,
            content,
            publishedAt: item.publishedAt ? new Date(item.publishedAt) : null,
            fetchedAt: now,
            expiresAt: new Date(now.getTime() + 2 * 3600000),
          })
          .onConflictDoUpdate({
            target: [feedItems.sourceId, feedItems.providerPostId],
            set: {
              content,
              publishedAt: item.publishedAt ? new Date(item.publishedAt) : null,
              fetchedAt: now,
              expiresAt: new Date(now.getTime() + 2 * 3600000),
            },
          });
      }
      if (source.kind === "url" && !items.length)
        await tx
          .update(feedItems)
          .set({ expiresAt: now })
          .where(eq(feedItems.sourceId, sourceId));
      await tx
        .update(feedSyncState)
        .set({
          status: "healthy",
          failures: 0,
          error: null,
          lastSyncedAt: now,
          nextSyncAt: new Date(
            now.getTime() +
              (source.provider === "youtube" ? 3600000 : 15 * 60000),
          ),
          leaseId: null,
          leaseExpiresAt: null,
        })
        .where(ownLease);
    });
    return true;
  } catch (error) {
    const status = error instanceof ProviderHttpError ? error.status : 0,
      failures = claimed.failures + 1;
    const blocked =
      [401, 403, 422].includes(status) || !(error instanceof ProviderHttpError);
    const wait =
      error instanceof ProviderHttpError && error.retryAfterSec
        ? Math.max(60000, Math.min(86400000, error.retryAfterSec * 1000))
        : Math.min(3600000, 60000 * 2 ** Math.min(failures, 6));
    const message =
      status === 429
        ? "Provider rate limit reached. The worker will retry later."
        : [401, 403, 422].includes(status)
          ? "This source needs authorization or provider approval; public access may be disabled."
          : status === 404 || status === 410
            ? "This content is no longer available."
            : blocked
              ? "Source unavailable. Check its account, settings and provider requirements."
              : "The provider could not be reached. Cached metadata will expire and synchronization will retry.";
    await db
      .update(feedSyncState)
      .set({
        status: blocked ? "blocked" : "error",
        failures,
        error: message,
        nextSyncAt: new Date(now.getTime() + wait),
        leaseId: null,
        leaseExpiresAt: null,
      })
      .where(ownLease);
    if ([401, 403, 404, 410].includes(status))
      await db
        .update(feedItems)
        .set({ expiresAt: now })
        .where(eq(feedItems.sourceId, sourceId));
    return false;
  }
}
export async function feedTick(
  db: AriaDatabase,
  options: FeedSyncOptions = {},
): Promise<void> {
  const now = options.now || new Date();
  const due = await db
    .select({ id: feedSources.id })
    .from(feedSources)
    .innerJoin(feedSyncState, eq(feedSources.id, feedSyncState.sourceId))
    .where(
      and(
        eq(feedSources.enabled, true),
        lte(feedSyncState.nextSyncAt, now),
        or(
          isNull(feedSyncState.leaseExpiresAt),
          lte(feedSyncState.leaseExpiresAt, now),
        ),
      ),
    )
    .orderBy(asc(feedSyncState.nextSyncAt))
    .limit(4);
  await Promise.allSettled(due.map((s) => syncFeedSource(db, s.id, options)));
}
export async function retainFeed(
  db: AriaDatabase,
  now = new Date(),
): Promise<void> {
  await db.delete(feedSessions).where(lt(feedSessions.expiresAt, now));
  // Keep only a minimal bookmark after expiry, including in storage. A later
  // successful source refresh may restore current metadata under the same ID.
  await db
    .update(feedItems)
    .set({
      content: sql`(${feedItems.content} - ARRAY['thumbnailUrl','authorAvatarUrl','embedUrl','playbackUrl','authorHandle']::text[]) || jsonb_build_object('caption', '', 'images', '[]'::jsonb, 'canEmbed', false, 'availability', 'unavailable', 'likeCount', null, 'commentCount', null, 'shareCount', null)`,
    })
    .where(
      and(
        lt(feedItems.expiresAt, now),
        sql`exists (select 1 from feed_saved s where s.item_id = ${feedItems.id})`,
        sql`${feedItems.content}->>'availability' <> 'unavailable'`,
      ),
    );
  // Unsaved metadata is removed regardless of source state.
  await db
    .delete(feedItems)
    .where(
      and(
        lt(feedItems.fetchedAt, new Date(now.getTime() - 7 * 86400000)),
        sql`not exists (select 1 from feed_saved s where s.item_id = ${feedItems.id})`,
      ),
    );
}
