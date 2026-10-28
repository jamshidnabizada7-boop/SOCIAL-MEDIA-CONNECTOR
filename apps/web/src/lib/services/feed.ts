"use client";
import {
  DEFAULT_FEED_PREFERENCES,
  FEED_TOPICS,
  PROVIDERS,
  mixFeed,
  type FeedCapability,
  type FeedFilters,
  type FeedPage,
  type FeedPreferences,
  type FeedSource,
  type FeedSourceConfig,
  type FeedSourceKind,
  type ProviderId,
  type UniversalFeedItem,
} from "@aria/shared-types";
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  apiPut,
  DATA_MODE,
} from "@/lib/api/client";

export interface FeedSourceInput {
  provider: ProviderId;
  kind: FeedSourceKind;
  label: string;
  config: FeedSourceConfig;
  topics: string[];
  accountId?: string;
}
export interface FeedSourcesResponse {
  sources: FeedSource[];
  capabilities: FeedCapability[];
  accounts: Array<{
    id: string;
    provider: ProviderId;
    displayName: string;
    connection: string;
  }>;
}
export interface FeedService {
  list(ws: string, userId: string, filters: FeedFilters): Promise<FeedPage>;
  sources(ws: string, userId: string): Promise<FeedSourcesResponse>;
  preferences(ws: string, userId: string): Promise<FeedPreferences>;
  savePreferences(
    ws: string,
    userId: string,
    value: FeedPreferences,
  ): Promise<FeedPreferences>;
  resetPreferences(ws: string, userId: string): Promise<FeedPreferences>;
  save(
    ws: string,
    userId: string,
    item: UniversalFeedItem,
    saved: boolean,
  ): Promise<void>;
  follow(
    ws: string,
    userId: string,
    item: UniversalFeedItem,
    follow: boolean,
  ): Promise<void>;
  hide(
    ws: string,
    userId: string,
    itemId: string,
    report?: boolean,
  ): Promise<void>;
  addSource(ws: string, userId: string, value: FeedSourceInput): Promise<void>;
  setSource(
    ws: string,
    userId: string,
    id: string,
    enabled: boolean,
  ): Promise<void>;
  removeSource(ws: string, userId: string, id: string): Promise<void>;
  sync(ws: string, userId: string): Promise<void>;
}
const path = (ws: string) => `/v1/workspaces/${encodeURIComponent(ws)}/feed`;
class ApiFeed implements FeedService {
  list(ws: string, _userId: string, filters: FeedFilters) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(filters))
      if (v !== undefined && v !== "") q.set(k, String(v));
    return apiGet<FeedPage>(`${path(ws)}?${q}`);
  }
  sources(ws: string) {
    return apiGet<FeedSourcesResponse>(`${path(ws)}/sources`);
  }
  preferences(ws: string) {
    return apiGet<FeedPreferences>(`${path(ws)}/preferences`);
  }
  savePreferences(ws: string, _userId: string, value: FeedPreferences) {
    return apiPut<FeedPreferences>(`${path(ws)}/preferences`, value);
  }
  resetPreferences(ws: string) {
    return apiDelete<FeedPreferences>(`${path(ws)}/preferences`);
  }
  async save(
    ws: string,
    _userId: string,
    item: UniversalFeedItem,
    saved: boolean,
  ) {
    if (saved) await apiPost(`${path(ws)}/saved`, { itemId: item.id });
    else await apiDelete(`${path(ws)}/saved/${encodeURIComponent(item.id)}`);
  }
  async follow(
    ws: string,
    _userId: string,
    item: UniversalFeedItem,
    follow: boolean,
  ) {
    if (follow) await apiPost(`${path(ws)}/following`, { itemId: item.id });
    else
      await apiDelete(`${path(ws)}/following/${encodeURIComponent(item.id)}`);
  }
  async hide(ws: string, _userId: string, itemId: string, report = false) {
    await apiPost(`${path(ws)}/hide`, { itemId, report });
  }
  async addSource(ws: string, _userId: string, value: FeedSourceInput) {
    await apiPost(`${path(ws)}/sources`, value);
  }
  async setSource(ws: string, _userId: string, id: string, enabled: boolean) {
    await apiPatch(`${path(ws)}/sources/${encodeURIComponent(id)}`, {
      enabled,
    });
  }
  async sync(ws: string) {
    await apiPost(`${path(ws)}/sync`, {});
  }
  async removeSource(ws: string, _userId: string, id: string) {
    await apiDelete(`${path(ws)}/sources/${encodeURIComponent(id)}`);
  }
}
interface DemoState {
  preferences: FeedPreferences;
  saved: string[];
  hidden: string[];
  following: string[];
  sources: FeedSource[];
}
class DemoFeed implements FeedService {
  private states = new Map<string, DemoState>();
  private sessions = new Map<
    string,
    { key: string; filter: string; ids: string[] }
  >();
  private key(ws: string, userId: string) {
    return `aria-mock:feed:v1:${userId}:${ws}`;
  }
  private state(ws: string, userId: string): DemoState {
    const key = this.key(ws, userId);
    if (this.states.has(key)) return this.states.get(key)!;
    let stored: DemoState | null = null;
    try {
      stored = JSON.parse(
        localStorage.getItem(key) || "null",
      ) as DemoState | null;
    } catch {
      /* Demo storage may be blocked. */
    }
    const state = stored || {
      preferences: structuredClone(DEFAULT_FEED_PREFERENCES),
      saved: [],
      hidden: [],
      following: [],
      sources: Object.keys(PROVIDERS).map((provider, index) => ({
        id: `sample-source-${provider}`,
        provider: provider as ProviderId,
        kind: "public" as const,
        label: `${PROVIDERS[provider as ProviderId].name} sample source`,
        config: {},
        topics: [FEED_TOPICS[index % FEED_TOPICS.length]],
        enabled: true,
        removable: false,
        accountId: null,
        status: "healthy" as const,
        lastSyncedAt: null,
        nextSyncAt: null,
        error: null,
      })),
    };
    this.states.set(key, state);
    return state;
  }
  private persist(ws: string, userId: string) {
    try {
      localStorage.setItem(
        this.key(ws, userId),
        JSON.stringify(this.state(ws, userId)),
      );
    } catch {
      /* Demo remains usable in memory. */
    }
  }
  private items(ws: string, userId: string): UniversalFeedItem[] {
    const s = this.state(ws, userId),
      providers = Object.keys(PROVIDERS) as ProviderId[];
    return Array.from({ length: 70 }, (_, i) => {
      const provider = providers[i % providers.length],
        source = s.sources.find((x) => x.provider === provider)!,
        authorId = `sample-creator-${i % 17}`;
      const contentType =
        i % 3 === 0 ? "video" : i % 3 === 1 ? "image" : "text";
      return {
        id: `sample-feed-${i}`,
        provider,
        providerPostId: `sample-${provider}-${i}`,
        authorId,
        authorName: `Sample creator ${(i % 17) + 1}`,
        authorHandle: `creator${(i % 17) + 1}`,
        contentType,
        caption: `${FEED_TOPICS[i % FEED_TOPICS.length]} · A sample perspective from ${PROVIDERS[provider].name}. Discover different ideas in one continuous feed. This is demonstration content.`,
        thumbnailUrl: contentType !== "text" ? "/feed-demo.svg" : undefined,
        images:
          contentType === "image"
            ? [
                {
                  url: "/feed-demo.svg",
                  alt: "Abstract sample artwork for Aria Hub's demo feed",
                },
              ]
            : [],
        originalUrl: `https://example.com/aria-feed-demo/${i}`,
        publishedAt: new Date(
          Date.UTC(2026, 9, 28, 12) - i * 3600000,
        ).toISOString(),
        likeCount: null,
        commentCount: null,
        shareCount: null,
        sourceType: i % 8 === 0 ? "account" : "public",
        sourceId: source.id,
        topics: [FEED_TOPICS[i % FEED_TOPICS.length]],
        canEmbed: false,
        availability: "available",
        sensitive: false,
        saved: s.saved.includes(`sample-feed-${i}`),
        following: s.following.includes(`${provider}:${authorId}`),
        sample: true,
      } as UniversalFeedItem;
    }).filter(
      (i) =>
        !s.hidden.includes(i.id) &&
        s.sources.find((x) => x.id === i.sourceId)?.enabled,
    );
  }
  async list(ws: string, userId: string, f: FeedFilters): Promise<FeedPage> {
    const s = this.state(ws, userId),
      key = this.key(ws, userId),
      filter = JSON.stringify([
        f.view || "for_you",
        f.provider || null,
        f.contentType || null,
        f.search || null,
        f.topic || null,
      ]);
    const pool = this.items(ws, userId).filter(
      (i) =>
        (!f.provider || i.provider === f.provider) &&
        (!f.contentType || i.contentType === f.contentType) &&
        (!f.topic || i.topics.includes(f.topic)) &&
        (!f.search ||
          `${i.caption} ${i.authorName}`
            .toLowerCase()
            .includes(f.search.toLowerCase())) &&
        (f.view !== "videos" || i.contentType === "video") &&
        (f.view !== "posts" || i.contentType !== "video") &&
        (f.view !== "saved" || i.saved) &&
        (f.view !== "following" || i.following) &&
        (f.view !== "my_accounts" || i.sourceType === "account"),
    );
    let sessionId: string,
      offset = 0,
      ids: string[];
    if (f.cursor) {
      const parts = f.cursor.split(":");
      sessionId = parts[0];
      offset = Number(parts[1]);
      const session = this.sessions.get(sessionId);
      if (!session || session.key !== key || session.filter !== filter)
        throw new Error(
          "This demo browsing session expired. Refresh the feed.",
        );
      ids = session.ids;
    } else {
      sessionId = crypto.randomUUID();
      ids = mixFeed(
        pool,
        sessionId,
        s.preferences,
        Date.UTC(2026, 9, 28, 12),
      ).map((i) => i.id);
      this.sessions.set(sessionId, { key, filter, ids });
    }
    const byId = new Map(pool.map((i) => [i.id, i]));
    const items: UniversalFeedItem[] = [];
    let position = offset;
    while (position < ids.length && items.length < (f.limit || 12)) {
      const item = byId.get(ids[position++]);
      if (item) items.push(item);
    }
    return {
      items,
      nextCursor: position < ids.length ? `${sessionId}:${position}` : null,
      sessionId,
      expiresAt: new Date(Date.now() + 1800000).toISOString(),
      cachedAt: new Date().toISOString(),
      sourcesPending: false,
    };
  }
  async sources(ws: string, userId: string): Promise<FeedSourcesResponse> {
    return {
      sources: structuredClone(this.state(ws, userId).sources),
      accounts: [],
      capabilities: (Object.keys(PROVIDERS) as ProviderId[]).map(
        (provider) => ({
          provider,
          kinds: ["public", "creator", "search", "url"],
          discovery:
            "Sample content only. No provider request is made in demo mode.",
          embeds: "Demo previews do not play external media.",
          requirements:
            "Switch explicitly to API mode and configure a permitted source for real content.",
          configured: false,
        }),
      ),
    };
  }
  async preferences(ws: string, userId: string) {
    return structuredClone(this.state(ws, userId).preferences);
  }
  async savePreferences(ws: string, userId: string, value: FeedPreferences) {
    this.state(ws, userId).preferences = structuredClone(value);
    this.persist(ws, userId);
    return structuredClone(value);
  }
  async resetPreferences(ws: string, userId: string) {
    const s = this.state(ws, userId);
    s.hidden = [];
    s.preferences = structuredClone(DEFAULT_FEED_PREFERENCES);
    this.persist(ws, userId);
    return this.preferences(ws, userId);
  }
  async save(
    ws: string,
    userId: string,
    item: UniversalFeedItem,
    saved: boolean,
  ) {
    const s = this.state(ws, userId);
    s.saved = s.saved.filter((id) => id !== item.id);
    if (saved) s.saved.push(item.id);
    this.persist(ws, userId);
  }
  async follow(
    ws: string,
    userId: string,
    item: UniversalFeedItem,
    follow: boolean,
  ) {
    const s = this.state(ws, userId),
      key = `${item.provider}:${item.authorId}`;
    s.following = s.following.filter((id) => id !== key);
    if (follow) s.following.push(key);
    this.persist(ws, userId);
  }
  async hide(ws: string, userId: string, itemId: string) {
    const s = this.state(ws, userId);
    if (!s.hidden.includes(itemId)) s.hidden.push(itemId);
    this.persist(ws, userId);
  }
  async addSource(ws: string, userId: string, value: FeedSourceInput) {
    this.state(ws, userId).sources.push({
      id: crypto.randomUUID(),
      ...value,
      accountId: null,
      enabled: true,
      removable: true,
      status: "healthy",
      lastSyncedAt: null,
      nextSyncAt: null,
      error: null,
    });
    this.persist(ws, userId);
  }
  async setSource(ws: string, userId: string, id: string, enabled: boolean) {
    const source = this.state(ws, userId).sources.find((s) => s.id === id);
    if (!source) throw new Error("Source not found.");
    source.enabled = enabled;
    this.persist(ws, userId);
  }
  async sync() {
    /* Demo never contacts providers. */
  }
  async removeSource(ws: string, userId: string, id: string) {
    const state = this.state(ws, userId);
    state.sources = state.sources.filter((s) => s.id !== id || !s.removable);
    this.persist(ws, userId);
  }
}
export const feedService: FeedService =
  DATA_MODE === "api" ? new ApiFeed() : new DemoFeed();
