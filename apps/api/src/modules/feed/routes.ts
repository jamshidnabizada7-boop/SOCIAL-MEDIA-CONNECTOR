import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  feedFollows,
  feedInteractions,
  feedItems,
  feedPreferences,
  feedSaved,
  feedSessions,
  feedSources,
  feedSyncState,
  socialAccounts,
  users,
} from "@aria/db";
import {
  DEFAULT_FEED_PREFERENCES,
  FEED_TOPICS,
  FEED_VIEWS,
  feedItemKey,
  mixFeed,
  type FeedPreferences,
  type FeedSourceConfig,
  type ProviderId,
  type UniversalFeedItem,
} from "@aria/shared-types";
import {
  assertPublicHost,
  feedCapabilities,
  validateFeedSource,
} from "@aria/providers-core";
import { requireAuth, requireWorkspacePermission } from "../../plugins/auth.js";

const providers = z.enum([
  "facebook",
  "instagram",
  "threads",
  "tiktok",
  "youtube",
  "x",
  "linkedin",
  "pinterest",
  "bluesky",
  "mastodon",
]);
const filters = z.object({
  view: z.enum(FEED_VIEWS).default("for_you"),
  provider: providers.optional(),
  contentType: z
    .enum(["video", "image", "carousel", "text", "link"])
    .optional(),
  search: z.string().trim().max(120).optional(),
  topic: z.string().max(60).optional(),
  cursor: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(30).default(12),
});
const sourceInput = z
  .object({
    provider: providers,
    kind: z.enum(["public", "creator", "search", "account", "url", "timeline"]),
    label: z.string().trim().min(1).max(120),
    accountId: z.string().uuid().optional(),
    topics: z.array(z.enum(FEED_TOPICS)).max(9).default([]),
    config: z
      .object({
        actor: z.string().max(300).optional(),
        instance: z.string().max(300).optional(),
        query: z.string().max(120).optional(),
        feed: z.string().max(500).optional(),
        url: z.string().max(4096).optional(),
      })
      .strict()
      .default({}),
  })
  .strict();
const preferencesInput = z
  .object({
    favoriteProviders: z.array(providers).max(10),
    topics: z.array(z.enum(FEED_TOPICS)).max(9),
    mutedSourceIds: z.array(z.string().uuid()).max(100),
    reducedSourceIds: z.array(z.string().uuid()).max(100),
    showSensitive: z.boolean(),
    allowEmbeds: z.boolean(),
  })
  .strict();
const itemInput = z.object({ itemId: z.string().uuid() }).strict();
const params = (req: FastifyRequest) =>
  req.params as { workspaceId: string; sourceId?: string; itemId?: string };
const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
type Source = typeof feedSources.$inferSelect;
const removableSource = (s: Source) =>
  s.kind !== "account" &&
  !(
    s.kind === "public" &&
    !s.accountId &&
    ((s.provider === "bluesky" &&
      s.config.feed ===
        "at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot") ||
      (s.provider === "mastodon" &&
        s.config.instance === "https://mastodon.social"))
  );

export function registerFeedRoutes(app: FastifyInstance): void {
  const db = app.database.db,
    base = "/v1/workspaces/:workspaceId/feed",
    view = { preHandler: requireWorkspacePermission(app) };
  const sourceScope = (userId: string, ws: string) =>
    and(
      eq(feedSources.userId, userId),
      or(isNull(feedSources.workspaceId), eq(feedSources.workspaceId, ws)),
    );
  const getPreferences = async (userId: string): Promise<FeedPreferences> => ({
    ...structuredClone(DEFAULT_FEED_PREFERENCES),
    ...(
      await db
        .select()
        .from(feedPreferences)
        .where(eq(feedPreferences.userId, userId))
    )[0]?.preferences,
  });
  async function addSource(
    userId: string,
    ws: string,
    input: z.infer<typeof sourceInput>,
  ): Promise<Source> {
    const account = input.accountId
      ? (
          await db
            .select()
            .from(socialAccounts)
            .where(
              and(
                eq(socialAccounts.id, input.accountId),
                eq(socialAccounts.workspaceId, ws),
              ),
            )
        )[0]
      : undefined;
    if (
      input.accountId &&
      (!account ||
        account.providerId !== input.provider ||
        account.connection !== "healthy")
    )
      throw fail(
        404,
        "not_found",
        "Connected account not found or unavailable.",
      );
    if (["account", "timeline"].includes(input.kind) && !account)
      throw fail(
        400,
        "account_required",
        "Select an authorized connected account.",
      );
    if (
      input.kind === "timeline" &&
      !["mastodon", "bluesky"].includes(input.provider)
    )
      throw fail(
        400,
        "unsupported_source",
        "This provider does not expose an enabled following timeline.",
      );
    let config: FeedSourceConfig;
    try {
      if (
        input.provider === "mastodon" &&
        account &&
        input.config.instance &&
        new URL(input.config.instance).origin !==
          new URL(account.instanceUrl || "").origin
      )
        throw new Error("Instance mismatch");
      config = validateFeedSource(input.provider, input.kind, {
        ...input.config,
        ...(input.provider === "mastodon" && account
          ? { instance: account.instanceUrl || undefined }
          : {}),
      });
    } catch {
      throw fail(
        400,
        "invalid_source",
        "Check the source URL, creator ID, instance or search term for this provider.",
      );
    }
    const key = createHash("sha256")
      .update(
        JSON.stringify([
          input.provider,
          input.kind,
          config,
          account?.id || null,
        ]),
      )
      .digest("hex");
    const existing = (
      await db
        .select()
        .from(feedSources)
        .where(
          and(eq(feedSources.userId, userId), eq(feedSources.sourceKey, key)),
        )
    )[0];
    if (existing) {
      await db
        .insert(feedSyncState)
        .values({ sourceId: existing.id })
        .onConflictDoNothing();
      return existing;
    }
    if (config.instance)
      try {
        await assertPublicHost(config.instance);
      } catch {
        throw fail(
          400,
          "invalid_source",
          "Use a publicly reachable HTTPS instance.",
        );
      }
    return db.transaction(async (tx) => {
      // Serialize subscriptions for this profile across API replicas so the
      // source cap also holds when several requests arrive together.
      await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, userId))
        .for("update");
      const [concurrent] = await tx
        .select()
        .from(feedSources)
        .where(
          and(eq(feedSources.userId, userId), eq(feedSources.sourceKey, key)),
        );
      if (concurrent) return concurrent;
      if (
        (
          await tx
            .select({ id: feedSources.id })
            .from(feedSources)
            .where(eq(feedSources.userId, userId))
            .limit(31)
        ).length >= 30
      )
        throw fail(
          409,
          "source_limit",
          "You can keep up to 30 feed sources. Remove an unused source before adding more.",
        );
      const [source] = await tx
        .insert(feedSources)
        .values({
          userId,
          workspaceId: account ? ws : null,
          accountId: account?.id || null,
          provider: input.provider,
          kind: input.kind,
          label: input.label,
          sourceKey: key,
          config,
          topics: [...new Set(input.topics)],
        })
        .onConflictDoNothing()
        .returning();
      const result =
        source ||
        (
          await tx
            .select()
            .from(feedSources)
            .where(
              and(
                eq(feedSources.userId, userId),
                eq(feedSources.sourceKey, key),
              ),
            )
        )[0];
      await tx
        .insert(feedSyncState)
        .values({ sourceId: result.id })
        .onConflictDoNothing();
      return result;
    });
  }
  async function bootstrap(userId: string, ws: string): Promise<void> {
    const subscribe = async (input: z.infer<typeof sourceInput>) => {
      try {
        await addSource(userId, ws, input);
      } catch (error) {
        if ((error as { code?: string }).code !== "source_limit") throw error;
      }
    };
    if (process.env.ARIA_FEED_DEFAULTS !== "false") {
      await subscribe({
        provider: "bluesky",
        kind: "public",
        label: "Bluesky public discovery",
        config: {},
        topics: [],
      });
      await subscribe({
        provider: "mastodon",
        kind: "public",
        label: "mastodon.social public timeline",
        config: { instance: "https://mastodon.social" },
        topics: [],
      });
    }
    const accounts = await db
      .select()
      .from(socialAccounts)
      .where(
        and(
          eq(socialAccounts.workspaceId, ws),
          eq(socialAccounts.connection, "healthy"),
        ),
      )
      .limit(20);
    for (const a of accounts) {
      if (
        !feedCapabilities()
          .find((c) => c.provider === a.providerId)
          ?.kinds.includes("account")
      )
        continue;
      try {
        await addSource(userId, ws, {
          provider: a.providerId as ProviderId,
          kind: "account",
          label: a.displayName,
          accountId: a.id,
          config: {},
          topics: [],
        });
      } catch (error) {
        if ((error as { code?: string }).code !== "source_limit") throw error;
      }
    }
  }
  async function accessibleItems(
    userId: string,
    ws: string,
    allowExpired = false,
  ) {
    const rows = await db
      .select({
        item: feedItems,
        source: feedSources,
        sync: feedSyncState,
        account: socialAccounts,
      })
      .from(feedItems)
      .innerJoin(feedSources, eq(feedItems.sourceId, feedSources.id))
      .leftJoin(feedSyncState, eq(feedSyncState.sourceId, feedSources.id))
      .leftJoin(
        socialAccounts,
        and(
          eq(socialAccounts.id, feedSources.accountId),
          eq(socialAccounts.workspaceId, ws),
        ),
      )
      .where(
        and(
          sourceScope(userId, ws),
          eq(feedSources.enabled, true),
          ...(allowExpired
            ? [
                inArray(
                  feedItems.id,
                  db
                    .select({ id: feedSaved.itemId })
                    .from(feedSaved)
                    .where(eq(feedSaved.userId, userId)),
                ),
              ]
            : [gt(feedItems.expiresAt, new Date())]),
        ),
      )
      .orderBy(desc(feedItems.fetchedAt))
      .limit(2000);
    return rows.filter(
      (r) => !r.source.accountId || r.account?.connection === "healthy",
    );
  }
  async function findItem(
    userId: string,
    ws: string,
    itemId: string,
    cleanup = false,
  ) {
    const [r] = await db
      .select({ item: feedItems, source: feedSources, account: socialAccounts })
      .from(feedItems)
      .innerJoin(feedSources, eq(feedItems.sourceId, feedSources.id))
      .leftJoin(
        socialAccounts,
        and(
          eq(socialAccounts.id, feedSources.accountId),
          eq(socialAccounts.workspaceId, ws),
        ),
      )
      .where(
        and(
          eq(feedItems.id, itemId),
          sourceScope(userId, ws),
          ...(cleanup ? [] : [eq(feedSources.enabled, true)]),
        ),
      );
    if (
      !r ||
      (!cleanup && r.source.accountId && r.account?.connection !== "healthy")
    )
      throw fail(404, "not_found", "Feed item not found.");
    return r;
  }
  app.get(`${base}/sources`, view, async (req) => {
    const ws = params(req).workspaceId;
    await bootstrap(req.user!.id, ws);
    const rows = await db
      .select({ s: feedSources, state: feedSyncState })
      .from(feedSources)
      .leftJoin(feedSyncState, eq(feedSyncState.sourceId, feedSources.id))
      .where(sourceScope(req.user!.id, ws))
      .orderBy(feedSources.createdAt);
    const accounts = await db
      .select({
        id: socialAccounts.id,
        provider: socialAccounts.providerId,
        displayName: socialAccounts.displayName,
        connection: socialAccounts.connection,
      })
      .from(socialAccounts)
      .where(eq(socialAccounts.workspaceId, ws));
    return {
      sources: rows.map(({ s, state }) => ({
        id: s.id,
        provider: s.provider,
        kind: s.kind,
        label: s.label,
        config: s.config,
        topics: s.topics,
        enabled: s.enabled,
        removable: removableSource(s),
        accountId: s.accountId,
        status: state?.status || "pending",
        lastSyncedAt: state?.lastSyncedAt?.toISOString() || null,
        nextSyncAt: state?.nextSyncAt?.toISOString() || null,
        error: state?.error || null,
      })),
      capabilities: feedCapabilities(),
      accounts,
    };
  });
  app.post(
    `${base}/sources`,
    { ...view, config: { rateLimit: { max: 12, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const s = await addSource(
        req.user!.id,
        params(req).workspaceId,
        sourceInput.parse(req.body),
      );
      return reply.code(201).send({ id: s.id });
    },
  );
  app.patch(`${base}/sources/:sourceId`, view, async (req) => {
    const p = params(req),
      { enabled } = z.object({ enabled: z.boolean() }).strict().parse(req.body);
    const id = z.string().uuid().parse(p.sourceId);
    const rows = await db
      .update(feedSources)
      .set({ enabled })
      .where(
        and(eq(feedSources.id, id), sourceScope(req.user!.id, p.workspaceId)),
      )
      .returning({ id: feedSources.id });
    if (!rows.length) throw fail(404, "not_found", "Source not found.");
    // Pausing/resuming never resets a provider retry deadline or an active lease.
    return { ok: true };
  });
  app.delete(`${base}/sources/:sourceId`, view, async (req) => {
    const p = params(req),
      id = z.string().uuid().parse(p.sourceId);
    const [source] = await db
      .select()
      .from(feedSources)
      .where(
        and(eq(feedSources.id, id), sourceScope(req.user!.id, p.workspaceId)),
      );
    if (!source) throw fail(404, "not_found", "Source not found.");
    if (!removableSource(source))
      throw fail(
        409,
        "managed_source",
        "Pause this default or connected-account source instead.",
      );
    await db.transaction(async (tx) => {
      // Read and prune the preference references under the same row lock.
      const [stored] = await tx
        .select()
        .from(feedPreferences)
        .where(eq(feedPreferences.userId, req.user!.id))
        .for("update");
      await tx
        .delete(feedSources)
        .where(
          and(eq(feedSources.id, id), sourceScope(req.user!.id, p.workspaceId)),
        );
      if (stored)
        await tx
          .update(feedPreferences)
          .set({
            preferences: {
              ...stored.preferences,
              mutedSourceIds: stored.preferences.mutedSourceIds.filter(
                (sourceId) => sourceId !== id,
              ),
              reducedSourceIds: stored.preferences.reducedSourceIds.filter(
                (sourceId) => sourceId !== id,
              ),
            },
            updatedAt: new Date(),
          })
          .where(eq(feedPreferences.userId, req.user!.id));
    });
    return { ok: true };
  });
  app.post(
    `${base}/sync`,
    { ...view, config: { rateLimit: { max: 2, timeWindow: "1 minute" } } },
    async (req) => {
      await bootstrap(req.user!.id, params(req).workspaceId);
      const sources = await db
        .select({ id: feedSources.id })
        .from(feedSources)
        .where(
          and(
            sourceScope(req.user!.id, params(req).workspaceId),
            eq(feedSources.enabled, true),
          ),
        );
      // Provider backoffs and leases are not bypassed by repeated UI refreshes.
      const due = new Date();
      for (const s of sources)
        await db
          .update(feedSyncState)
          .set({ nextSyncAt: due })
          .where(
            and(
              eq(feedSyncState.sourceId, s.id),
              eq(feedSyncState.status, "healthy"),
              isNull(feedSyncState.leaseId),
              lte(
                feedSyncState.lastSyncedAt,
                new Date(due.getTime() - 5 * 60000),
              ),
            ),
          );
      return {
        message:
          "Refresh requested. Background sources retain their rate limits and authorization checks.",
      };
    },
  );

  const list = async (
    req: FastifyRequest,
    forcedView?: "videos" | "explore" | "saved",
  ) => {
    const f = filters.parse({
        ...(req.query as object),
        ...(forcedView ? { view: forcedView } : {}),
      }),
      userId = req.user!.id,
      ws = params(req).workspaceId,
      now = new Date();
    if (!f.cursor) await bootstrap(userId, ws);
    const prefs = await getPreferences(userId);
    const filterKey = JSON.stringify([
      f.view,
      f.provider || null,
      f.contentType || null,
      f.search || null,
      f.topic || null,
    ]);
    const saved = new Set(
      (
        await db
          .select({ content: feedItems.content })
          .from(feedSaved)
          .innerJoin(feedItems, eq(feedSaved.itemId, feedItems.id))
          .where(eq(feedSaved.userId, userId))
      ).map((s) => feedItemKey(s.content)),
    );
    const follows = new Set(
      (
        await db
          .select()
          .from(feedFollows)
          .where(eq(feedFollows.userId, userId))
      ).map((s) => `${s.provider}:${s.authorId}`),
    );
    const hidden = new Set(
      (
        await db
          .select({ content: feedItems.content })
          .from(feedInteractions)
          .innerJoin(feedItems, eq(feedInteractions.itemId, feedItems.id))
          .where(
            and(
              eq(feedInteractions.userId, userId),
              eq(feedInteractions.hidden, true),
            ),
          )
      ).map((s) => feedItemKey(s.content)),
    );
    const rows = await accessibleItems(userId, ws, f.view === "saved");
    const pool = rows.flatMap((r) => {
      const item: UniversalFeedItem = {
        ...r.item.content,
        id: r.item.id,
        sourceId: r.source.id,
        sourceType: r.source.kind,
        topics: r.source.topics,
        saved: saved.has(feedItemKey(r.item.content)),
        following: follows.has(
          `${r.item.content.provider}:${r.item.content.authorId}`,
        ),
      };
      if (
        hidden.has(feedItemKey(item)) ||
        prefs.mutedSourceIds.includes(item.sourceId) ||
        (item.sensitive && !prefs.showSensitive)
      )
        return [];
      if (
        (f.view === "saved" && !item.saved) ||
        (f.view === "following" &&
          !item.following &&
          r.source.kind !== "timeline") ||
        (f.view === "my_accounts" && r.source.kind !== "account")
      )
        return [];
      if (
        (f.provider && item.provider !== f.provider) ||
        (f.contentType && item.contentType !== f.contentType) ||
        (f.view === "videos" && item.contentType !== "video") ||
        (f.view === "posts" && item.contentType === "video")
      )
        return [];
      if (
        (f.search &&
          !`${item.caption} ${item.authorName} ${item.authorHandle || ""}`
            .toLocaleLowerCase()
            .includes(f.search.toLocaleLowerCase())) ||
        (f.topic && !item.topics.includes(f.topic))
      )
        return [];
      if (r.item.expiresAt <= now) {
        if (f.view !== "saved") return [];
        return [
          {
            ...item,
            caption: "",
            images: [],
            thumbnailUrl: undefined,
            authorAvatarUrl: undefined,
            embedUrl: undefined,
            canEmbed: false,
            availability: "unavailable" as const,
            likeCount: null,
            commentCount: null,
            shareCount: null,
          },
        ];
      }
      if (item.availability === "unavailable") return [];
      return [item];
    });
    let session: typeof feedSessions.$inferSelect,
      offset = 0;
    if (f.cursor) {
      const parsed = z
        .string()
        .regex(/^[0-9a-f-]{36}:\d{1,5}$/)
        .parse(f.cursor)
        .split(":");
      const sid = z.string().uuid().parse(parsed[0]);
      offset = Number(parsed[1]);
      const [found] = await db
        .select()
        .from(feedSessions)
        .where(
          and(
            eq(feedSessions.id, sid),
            eq(feedSessions.userId, userId),
            eq(feedSessions.workspaceId, ws),
          ),
        );
      if (!found || found.expiresAt <= now)
        throw fail(
          410,
          "feed_session_expired",
          "This browsing session expired. Refresh the feed to continue.",
        );
      if (found.filterKey !== filterKey || offset > found.itemIds.length)
        throw fail(
          400,
          "invalid_cursor",
          "Start a new feed session after changing filters.",
        );
      session = found;
    } else {
      const [prior] = await db
        .select()
        .from(feedSessions)
        .where(
          and(
            eq(feedSessions.userId, userId),
            eq(feedSessions.workspaceId, ws),
          ),
        )
        .orderBy(desc(feedSessions.createdAt))
        .limit(1);
      const seed = randomUUID();
      const older = await db
        .select({ id: feedSessions.id })
        .from(feedSessions)
        .where(
          and(
            eq(feedSessions.userId, userId),
            eq(feedSessions.workspaceId, ws),
          ),
        )
        .orderBy(desc(feedSessions.createdAt))
        .offset(19);
      if (older.length)
        await db.delete(feedSessions).where(
          and(
            eq(feedSessions.userId, userId),
            inArray(
              feedSessions.id,
              older.map((s) => s.id),
            ),
          ),
        );
      let ordered: UniversalFeedItem[];
      if (f.view === "saved") {
        const unique = new Map<string, UniversalFeedItem>();
        for (const item of pool) {
          const key = feedItemKey(item),
            prior = unique.get(key);
          if (!prior || prior.availability === "unavailable")
            unique.set(key, item);
        }
        ordered = [...unique.values()].sort((a, b) => a.id.localeCompare(b.id));
      } else
        ordered = mixFeed(
          pool,
          seed,
          prefs,
          now.getTime(),
          prior?.itemIds.slice(0, 12) || [],
        );
      [session] = await db
        .insert(feedSessions)
        .values({
          userId,
          workspaceId: ws,
          filterKey,
          itemIds: ordered.slice(0, 600).map((i) => i.id),
          expiresAt: new Date(now.getTime() + 30 * 60000),
        })
        .returning();
    }
    const byId = new Map(pool.map((i) => [i.id, i]));
    const items: UniversalFeedItem[] = [];
    let position = offset;
    while (position < session.itemIds.length && items.length < f.limit) {
      const item = byId.get(session.itemIds[position++]);
      if (item) items.push(item);
    }
    const pending = await db
      .select({ id: feedSources.id })
      .from(feedSources)
      .innerJoin(feedSyncState, eq(feedSources.id, feedSyncState.sourceId))
      .where(
        and(
          sourceScope(userId, ws),
          eq(feedSources.enabled, true),
          eq(feedSyncState.status, "pending"),
        ),
      )
      .limit(1);
    return {
      items,
      nextCursor:
        position < session.itemIds.length ? `${session.id}:${position}` : null,
      sessionId: session.id,
      expiresAt: session.expiresAt.toISOString(),
      cachedAt: now.toISOString(),
      sourcesPending: !!pending.length,
    };
  };
  app.get(base, view, (req) => list(req));
  app.get(`${base}/videos`, view, (req) => list(req, "videos"));
  app.get(`${base}/discover`, view, (req) => list(req, "explore"));
  app.get(`${base}/search`, view, (req) => list(req, "explore"));
  app.get(`${base}/saved`, view, (req) => list(req, "saved"));
  app.post(`${base}/saved`, view, async (req) => {
    const { itemId } = itemInput.parse(req.body);
    await findItem(req.user!.id, params(req).workspaceId, itemId);
    await db
      .insert(feedSaved)
      .values({ userId: req.user!.id, itemId })
      .onConflictDoNothing();
    return { saved: true };
  });
  app.delete(`${base}/saved/:itemId`, view, async (req) => {
    const p = params(req),
      itemId = z.string().uuid().parse(p.itemId);
    const { item } = await findItem(req.user!.id, p.workspaceId, itemId, true);
    const samePost = db
      .select({ id: feedItems.id })
      .from(feedItems)
      .innerJoin(feedSources, eq(feedItems.sourceId, feedSources.id))
      .where(
        and(
          eq(feedSources.userId, req.user!.id),
          eq(feedSources.provider, item.content.provider),
          eq(feedItems.providerPostId, item.providerPostId),
        ),
      );
    await db
      .delete(feedSaved)
      .where(
        and(
          eq(feedSaved.userId, req.user!.id),
          inArray(feedSaved.itemId, samePost),
        ),
      );
    return { saved: false };
  });
  app.post(`${base}/hide`, view, async (req) => {
    const { itemId, report } = itemInput
      .extend({ report: z.boolean().default(false) })
      .parse(req.body);
    await findItem(req.user!.id, params(req).workspaceId, itemId);
    await db
      .insert(feedInteractions)
      .values({
        userId: req.user!.id,
        itemId,
        hidden: true,
        reportedUnavailable: report,
      })
      .onConflictDoUpdate({
        target: [feedInteractions.userId, feedInteractions.itemId],
        set: {
          hidden: true,
          reportedUnavailable: report,
          updatedAt: new Date(),
        },
      });
    return { hidden: true };
  });
  app.get(`${base}/following`, view, async (req) => ({
    following: await db
      .select({
        provider: feedFollows.provider,
        authorId: feedFollows.authorId,
        sourceId: feedFollows.sourceId,
      })
      .from(feedFollows)
      .where(eq(feedFollows.userId, req.user!.id)),
  }));
  app.post(`${base}/following`, view, async (req) => {
    const { itemId } = itemInput.parse(req.body),
      userId = req.user!.id,
      ws = params(req).workspaceId,
      { item, source } = await findItem(userId, ws, itemId);
    const content = item.content;
    if (content.availability === "preview_only")
      throw fail(
        409,
        "creator_unavailable",
        "This link does not provide a verified creator to follow. Open it on the original platform.",
      );
    let sourceId: string | null = null;
    if (
      ["bluesky", "mastodon", "youtube"].includes(content.provider) &&
      source.kind !== "account"
    ) {
      const config: FeedSourceConfig =
        content.provider === "mastodon"
          ? {
              instance:
                source.config.instance || new URL(content.originalUrl).origin,
              actor: content.authorId.split(":").at(-1),
            }
          : { actor: content.authorId };
      // An oEmbed author URL is not a verified YouTube channel ID; keep a local follow until one is available.
      if (
        content.provider !== "youtube" ||
        /^UC[\w-]{22}$/.test(content.authorId)
      )
        sourceId = (
          await addSource(userId, ws, {
            provider: content.provider,
            kind: "creator",
            label: content.authorName,
            config,
            topics: source.topics as (typeof FEED_TOPICS)[number][],
          })
        ).id;
    }
    await db
      .insert(feedFollows)
      .values({
        userId,
        provider: content.provider,
        authorId: content.authorId,
        sourceId,
      })
      .onConflictDoNothing();
    return { following: true };
  });
  app.delete(`${base}/following/:itemId`, view, async (req) => {
    const { item } = await findItem(
      req.user!.id,
      params(req).workspaceId,
      z.string().uuid().parse(params(req).itemId),
      true,
    );
    await db
      .delete(feedFollows)
      .where(
        and(
          eq(feedFollows.userId, req.user!.id),
          eq(feedFollows.provider, item.content.provider),
          eq(feedFollows.authorId, item.content.authorId),
        ),
      );
    return { following: false };
  });
  async function savePreferences(req: FastifyRequest) {
    const prefs = preferencesInput.parse(req.body),
      userId = req.user!.id;
    const ids = [
      ...new Set([...prefs.mutedSourceIds, ...prefs.reducedSourceIds]),
    ];
    if (ids.length) {
      const owned = await db
        .select({ id: feedSources.id })
        .from(feedSources)
        .where(
          and(eq(feedSources.userId, userId), inArray(feedSources.id, ids)),
        );
      if (owned.length !== ids.length)
        throw fail(404, "not_found", "One or more sources are unavailable.");
    }
    await db
      .insert(feedPreferences)
      .values({ userId, preferences: prefs })
      .onConflictDoUpdate({
        target: feedPreferences.userId,
        set: { preferences: prefs, updatedAt: new Date() },
      });
    return prefs;
  }
  app.get(`${base}/preferences`, view, (req) => getPreferences(req.user!.id));
  app.put(`${base}/preferences`, view, savePreferences);
  app.delete(`${base}/preferences`, view, async (req) => {
    await db
      .delete(feedPreferences)
      .where(eq(feedPreferences.userId, req.user!.id));
    await db
      .delete(feedInteractions)
      .where(eq(feedInteractions.userId, req.user!.id));
    return structuredClone(DEFAULT_FEED_PREFERENCES);
  });
  app.get("/v1/me/feed/preferences", { preHandler: requireAuth(app) }, (req) =>
    getPreferences(req.user!.id),
  );
  app.put(
    "/v1/me/feed/preferences",
    { preHandler: requireAuth(app) },
    savePreferences,
  );
}
