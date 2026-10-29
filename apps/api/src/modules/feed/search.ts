import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import {
  feedInteractions,
  feedItems,
  feedSources,
  socialAccounts,
} from "@aria/db";
import {
  feedItemKey,
  platformSearchUrl,
  PROVIDERS,
  type FeedPreferences,
  type FeedSourceKind,
  type ProviderId,
  type SearchPerson,
  type UniversalFeedItem,
  type UniversalSearchResponse,
  type SearchCoverage,
} from "@aria/shared-types";
import {
  ProviderHttpError,
  loadDecryptedCredential,
  safeFeedUrl,
  searchNetwork,
  type FeedContext,
  type NetworkSearchResult,
} from "@aria/providers-core";
import { requireWorkspacePermission } from "../../plugins/auth.js";

interface Dependencies {
  bootstrap(user: string, workspace: string): Promise<void>;
  preferences(user: string): Promise<FeedPreferences>;
  items(
    user: string,
    workspace: string,
  ): Promise<
    Array<{
      item: { id: string; content: UniversalFeedItem };
      source: { id: string; kind: FeedSourceKind; topics: string[] };
    }>
  >;
}
type Batch = {
  context: Pick<FeedContext, "provider">;
  data: NetworkSearchResult;
  coverage: Pick<SearchCoverage, "status" | "message" | "retryAfterSec">;
};
const empty = (): NetworkSearchResult => ({
  people: [],
  posts: [],
  topics: [],
  partial: false,
});
const liveCache = new Map<string, { until: number; value: Promise<Batch[]> }>();
const backoffs = new Map<string, number>();
const networkKey = (ctx: FeedContext) =>
  `${ctx.provider}:${ctx.config.instance || "official"}:${ctx.accessToken ? ctx.account?.externalAccountId || "account" : "public"}`;

function profileUrl(
  provider: ProviderId,
  id: string,
  handle: string,
  original?: string,
): string | undefined {
  const clean = handle.replace(/^@/, "");
  if (provider === "bluesky" && /^did:/.test(id))
    return `https://bsky.app/profile/${encodeURIComponent(id)}`;
  if (provider === "youtube" && /^UC[\w-]{22}$/.test(id))
    return `https://www.youtube.com/channel/${id}`;
  if (provider === "facebook" && /^\d+$/.test(id))
    return `https://www.facebook.com/profile.php?id=${id}`;
  if (
    (provider === "instagram" || provider === "threads") &&
    /^[\w.]{1,80}$/.test(clean)
  )
    return provider === "instagram"
      ? `https://www.instagram.com/${encodeURIComponent(clean)}/`
      : `https://www.threads.com/@${encodeURIComponent(clean)}`;
  const explicit = safeFeedUrl(
    /^https:/.test(handle) ? handle : `https://${handle}`,
  );
  if (
    explicit &&
    /^(?:www\.)?(?:facebook\.com|instagram\.com|youtube\.com|threads\.com|bsky\.app)$/.test(
      new URL(explicit).hostname,
    )
  )
    return explicit;
  if (provider === "mastodon" && original) {
    const url = safeFeedUrl(original);
    if (url) {
      const parsed = new URL(url);
      parsed.pathname = parsed.pathname.replace(/\/\d+\/?$/, "");
      return parsed.href;
    }
  }
  if (provider === "mastodon") {
    const match = /^([\w.-]+)@([a-z0-9.-]+)$/i.exec(clean);
    if (match) return safeFeedUrl(`https://${match[2]}/@${match[1]}`);
  }
  return undefined;
}

async function run(context: FeedContext, query: string): Promise<Batch> {
  const identity = { provider: context.provider };
  const key = networkKey(context),
    remaining = (backoffs.get(key) || 0) - Date.now();
  if (remaining > 0)
    return {
      context: identity,
      data: empty(),
      coverage: {
        status: "rate_limited",
        message: "This platform asked us to wait before searching again.",
        retryAfterSec: Math.ceil(remaining / 1000),
      },
    };
  try {
    const data = await searchNetwork(context, query);
    if (data.retryAfterSec) {
      if (backoffs.size >= 100) backoffs.delete(backoffs.keys().next().value!);
      backoffs.set(
        key,
        Date.now() + Math.min(86400, Math.max(60, data.retryAfterSec)) * 1000,
      );
    }
    return {
      context: identity,
      data,
      coverage: {
        status: data.partial ? "partial" : "searched",
        retryAfterSec: data.retryAfterSec,
        message:
          context.provider === "mastodon"
            ? "Searches public profiles and topics on up to three servers. Post results depend on each server's access."
            : data.partial
              ? "Some platform results were unavailable; the available matches are shown."
              : "Searched public accounts and content on this platform.",
      },
    };
  } catch (error) {
    const limited = error instanceof ProviderHttpError && error.status === 429;
    const wait = limited
      ? Math.min(86400, Math.max(60, error.retryAfterSec || 60))
      : 0;
    if (limited) {
      if (backoffs.size >= 100) backoffs.delete(backoffs.keys().next().value!);
      backoffs.set(key, Date.now() + wait * 1000);
    }
    return {
      context: identity,
      data: empty(),
      coverage: {
        status: limited ? "rate_limited" : "unavailable",
        retryAfterSec: wait || undefined,
        message: limited
          ? "This platform's search limit was reached. Other results remain available."
          : "The platform could not complete this search. Check its access or try its own search.",
      },
    };
  }
}

export function registerUniversalSearch(
  app: FastifyInstance,
  dependencies: Dependencies,
): void {
  app.post(
    "/v1/workspaces/:workspaceId/feed/search/all",
    {
      preHandler: requireWorkspacePermission(app),
      config: { rateLimit: { max: 8, timeWindow: "1 minute" } },
    },
    async (req): Promise<UniversalSearchResponse> => {
      const input = z
        .object({
          query: z
            .string()
            .trim()
            .max(120)
            .refine(
              (v) => !/[\p{Cc}\p{Cs}]/u.test(v),
              "Use printable text for your search.",
            )
            .transform((v) => v.normalize("NFKC"))
            .pipe(z.string().min(2).max(120)),
        })
        .strict()
        .parse(req.body);
      const query = input.query,
        needle = query.replace(/^[@#]/, "").toLocaleLowerCase();
      const user = req.user!.id,
        workspace = (req.params as { workspaceId: string }).workspaceId,
        db = app.database.db;
      await dependencies.bootstrap(user, workspace);
      const [prefs, cached, accounts, sources, hiddenRows] = await Promise.all([
        dependencies.preferences(user),
        dependencies.items(user, workspace),
        db
          .select()
          .from(socialAccounts)
          .where(
            and(
              eq(socialAccounts.workspaceId, workspace),
              eq(socialAccounts.connection, "healthy"),
            ),
          ),
        db
          .select()
          .from(feedSources)
          .where(
            and(eq(feedSources.userId, user), eq(feedSources.enabled, true)),
          ),
        db
          .select({ content: feedItems.content })
          .from(feedInteractions)
          .innerJoin(feedItems, eq(feedItems.id, feedInteractions.itemId))
          .where(
            and(
              eq(feedInteractions.userId, user),
              eq(feedInteractions.hidden, true),
            ),
          ),
      ]);
      const hidden = new Set(hiddenRows.map((r) => feedItemKey(r.content)));
      const visible = cached.filter(
        (r) =>
          !prefs.mutedSourceIds.includes(r.source.id) &&
          !hidden.has(feedItemKey(r.item.content)) &&
          (!r.item.content.sensitive || prefs.showSensitive) &&
          r.item.content.availability !== "unavailable",
      );
      const contexts: FeedContext[] = [
        { provider: "bluesky", kind: "search", config: { query } },
      ];
      if (process.env.YOUTUBE_DATA_API_KEY)
        contexts.push({
          provider: "youtube",
          kind: "search",
          config: { query },
        });
      const instances = new Map<
        string,
        (typeof accounts)[number] | undefined
      >();
      for (const account of accounts.filter(
        (a) => a.providerId === "mastodon" && a.instanceUrl,
      ))
        instances.set(new URL(account.instanceUrl!).origin, account);
      for (const source of sources.filter(
        (s) =>
          s.provider === "mastodon" &&
          (!s.workspaceId || s.workspaceId === workspace) &&
          s.config.instance &&
          !prefs.mutedSourceIds.includes(s.id),
      )) {
        const origin = new URL(source.config.instance!).origin;
        if (!instances.has(origin)) instances.set(origin, undefined);
      }
      if (!instances.size) instances.set("https://mastodon.social", undefined);
      for (const [instance, account] of [...instances].slice(0, 3)) {
        const ctx: FeedContext = {
          provider: "mastodon",
          kind: "search",
          config: { query, instance },
        };
        if (
          account &&
          account.scopes.some((s) => s === "read" || s === "read:search")
        ) {
          try {
            const credential = await loadDecryptedCredential(db, account.id);
            if (
              credential &&
              (!credential.expiresAt || credential.expiresAt > new Date()) &&
              credential.scopes.some((s) => s === "read" || s === "read:search")
            ) {
              ctx.accessToken = credential.accessToken;
              ctx.account = {
                ...account,
                instanceUrl: account.instanceUrl || undefined,
              };
            }
          } catch {
            /* Search the public index without sending unusable credentials. */
          }
        }
        contexts.push(ctx);
      }
      const cacheKey = createHash("sha256")
        .update(
          JSON.stringify([
            user,
            workspace,
            query,
            contexts.map((c) => [networkKey(c), c.account?.scopes]),
          ]),
        )
        .digest("hex");
      const existing = liveCache.get(cacheKey);
      let batches: Batch[];
      if (existing && existing.until > Date.now())
        batches = await existing.value;
      else {
        if (liveCache.size >= 40)
          liveCache.delete(liveCache.keys().next().value!);
        const value = Promise.all(contexts.map((ctx) => run(ctx, query)));
        liveCache.set(cacheKey, { until: Date.now() + 45000, value });
        batches = await value;
      }
      const response: UniversalSearchResponse = {
        query,
        people: [],
        posts: [],
        topics: [],
        coverage: [],
        searchedAt: new Date().toISOString(),
        autoplayVideos: prefs.autoplayVideos !== false,
      };
      const people = new Map<string, SearchPerson>(),
        posts = new Map<string, (typeof response.posts)[number]>(),
        topics = new Map<string, (typeof response.topics)[number]>();
      const matches = (...values: Array<string | undefined>) =>
        values.some((v) => v?.toLocaleLowerCase().includes(needle));
      for (const account of accounts) {
        const provider = account.providerId as ProviderId;
        if (
          !PROVIDERS[provider] ||
          !matches(account.displayName, account.handle)
        )
          continue;
        const url = profileUrl(
          provider,
          account.externalAccountId,
          account.handle,
        );
        if (url)
          people.set(`${provider}:${account.externalAccountId}`, {
            provider,
            id: account.externalAccountId,
            name: account.displayName,
            handle: account.handle,
            description: "Connected to this workspace",
            url,
            origin: "connected",
          });
      }
      for (const row of visible) {
        const item = {
          ...row.item.content,
          id: row.item.id,
          sourceId: row.source.id,
          sourceType: row.source.kind,
          topics: row.source.topics,
        };
        if (
          matches(
            item.caption,
            item.authorName,
            item.authorHandle,
            item.originalUrl,
            ...item.topics,
          )
        )
          posts.set(feedItemKey(item), { item, origin: "collected" });
        if (matches(item.authorName, item.authorHandle) && item.authorId) {
          const url = profileUrl(
              item.provider,
              item.authorId,
              item.authorHandle || "",
              item.originalUrl,
            ),
            key = `${item.provider}:${item.authorId}`;
          if (url && !people.has(key))
            people.set(key, {
              provider: item.provider,
              id: item.authorId,
              name: item.authorName,
              handle: item.authorHandle || "",
              description: "Creator in your collected content",
              avatarUrl: item.authorAvatarUrl,
              url,
              origin: "collected",
            });
        }
        for (const topic of item.topics.filter((t) => matches(t)))
          topics.set(`${item.provider}:${topic}`, {
            provider: item.provider,
            name: topic,
            url: `/search?q=${encodeURIComponent(topic)}`,
          });
      }
      for (const batch of batches) {
        for (const person of batch.data.people)
          if (!person.sensitive || prefs.showSensitive) {
            const key = `${person.provider}:${person.id}`;
            if (!people.has(key)) people.set(key, person);
          }
        for (const post of batch.data.posts)
          if (
            (!post.sensitive || prefs.showSensitive) &&
            !hidden.has(feedItemKey(post))
          ) {
            const key = feedItemKey(post);
            if (!posts.has(key))
              posts.set(key, {
                origin: "live",
                item: {
                  ...post,
                  id: `search:${key}`,
                  sourceId: "search",
                  sourceType: "search",
                  topics: [],
                },
              });
          }
        for (const topic of batch.data.topics)
          topics.set(`${topic.provider}:${topic.name}`, topic);
      }
      for (const provider of Object.keys(PROVIDERS) as ProviderId[]) {
        const live = batches.filter((b) => b.context.provider === provider);
        if (live.length) {
          const successful = live.filter(
            (b) =>
              b.coverage.status === "searched" ||
              b.coverage.status === "partial",
          );
          response.coverage.push({
            provider,
            mode: "live",
            ...(successful.length
              ? {
                  ...successful[0].coverage,
                  status:
                    successful.length < live.length
                      ? ("partial" as const)
                      : successful[0].coverage.status,
                }
              : live[0].coverage),
            externalUrl: platformSearchUrl(provider, query),
          });
        } else if (provider === "youtube")
          response.coverage.push({
            provider,
            mode: "external",
            status: "setup_required",
            message:
              "In-app YouTube search needs administrator setup. You can still search on YouTube below.",
            externalUrl: platformSearchUrl(provider, query),
          });
        else {
          const collected = ["facebook", "instagram", "threads"].includes(
            provider,
          );
          response.coverage.push({
            provider,
            mode: collected ? "collected" : "external",
            status: collected ? "searched" : "setup_required",
            message: collected
              ? "Searches your available account content. For a wider search, continue on the platform."
              : "In-app search is not enabled for this platform. Open its own search for more accounts and content.",
            externalUrl: platformSearchUrl(provider, query),
          });
        }
      }
      response.people = [...people.values()].slice(0, 40);
      response.posts = [...posts.values()].slice(0, 48);
      response.topics = [...topics.values()].slice(0, 15);
      return response;
    },
  );
}
