"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  Bookmark,
  Compass,
  Play,
  RefreshCw,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import {
  DEFAULT_FEED_PREFERENCES,
  FEED_TOPICS,
  PROVIDERS,
  type FeedFilters,
  type FeedPage,
  type FeedPreferences,
  type FeedView,
  type UniversalFeedItem,
} from "@aria/shared-types";
import { useSession, useToast } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { CreatorSpotlight } from "@/components/feed/creator-spotlight";
import { FeedCard, type FeedCardActions } from "@/components/feed/feed-card";
import { VideoFeed } from "@/components/feed/video-feed";
import { FeedSourcePanel } from "@/components/feed/source-panel";
import { DATA_MODE } from "@/lib/api/client";
import { feedService, type FeedSourcesResponse } from "@/lib/services/feed";
import { cn } from "@/lib/utils";

const tabs: Array<[FeedView, string]> = [
  ["for_you", "For You"],
  ["following", "Following / Creators"],
  ["videos", "Videos"],
  ["posts", "Posts"],
  ["my_accounts", "My Accounts"],
  ["saved", "Saved"],
  ["explore", "Explore"],
];
const field =
  "min-h-11 rounded-xl border border-line-strong bg-surface px-3 py-2 text-sm";
export function FeedExperience({
  initialView = "for_you",
}: {
  initialView?: FeedView;
}) {
  const { session } = useSession();
  return session ? (
    <PersonalFeed
      key={`${session.user.id}:${session.workspace.id}:${initialView}`}
      initialView={initialView}
      ws={session.workspace.id}
      userId={session.user.id}
    />
  ) : null;
}
function PersonalFeed({
  ws,
  userId,
  initialView,
}: {
  ws: string;
  userId: string;
  initialView: FeedView;
}) {
  const toast = useToast(),
    [filters, setFilters] = useState<FeedFilters>({
      view: initialView,
      limit: 12,
    }),
    [query, setQuery] = useState(""),
    [revision, setRevision] = useState(0);
  const [page, setPage] = useState<FeedPage | null>(null),
    [sources, setSources] = useState<FeedSourcesResponse | null>(null),
    [preferences, setPreferences] = useState<FeedPreferences>(
      structuredClone(DEFAULT_FEED_PREFERENCES),
    );
  const [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [moreBusy, setMoreBusy] = useState(false),
    [actionBusy, setActionBusy] = useState(false),
    [sourcePanel, setSourcePanel] = useState(false),
    [immersive, setImmersive] = useState(initialView === "videos"),
    [playerId, setPlayerId] = useState<string | null>(null);
  const generation = useRef(0),
    moreFlight = useRef(false),
    sentinel = useRef<HTMLDivElement>(null);
  const reset = useCallback(() => {
    generation.current++;
    moreFlight.current = false;
    setMoreBusy(false);
    setLoading(true);
    setPage(null);
    setPlayerId(null);
    setError("");
    setRevision((r) => r + 1);
  }, []);
  const change = useCallback((patch: Partial<FeedFilters>) => {
    generation.current++;
    moreFlight.current = false;
    setMoreBusy(false);
    setPage(null);
    setLoading(true);
    setError("");
    setPlayerId(null);
    setFilters((f) => ({ ...f, ...patch, cursor: undefined }));
  }, []);
  useEffect(() => {
    let live = true;
    void Promise.all([
      feedService.sources(ws, userId),
      feedService.preferences(ws, userId),
    ])
      .then(([s, p]) => {
        if (live) {
          setSources(s);
          setPreferences(p);
        }
      })
      .catch((e) => {
        if (live) setError((e as Error).message);
      });
    return () => {
      live = false;
    };
  }, [ws, userId, revision]);
  useEffect(() => {
    const token = ++generation.current;
    let cancelled = false;
    void feedService
      .list(ws, userId, filters)
      .then((p) => {
        if (!cancelled && generation.current === token) {
          setPage(p);
          setError("");
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled && generation.current === token) {
          setError((e as Error).message);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [ws, userId, filters, revision]);
  useEffect(() => {
    if (!page?.sourcesPending || page.items.length || loading || error) return;
    const timer = setTimeout(() => setRevision((r) => r + 1), 5000);
    return () => clearTimeout(timer);
  }, [page, loading, error]);
  const loadMore = useCallback(() => {
    if (!page?.nextCursor || moreFlight.current || loading) return;
    const token = generation.current;
    moreFlight.current = true;
    setMoreBusy(true);
    void feedService
      .list(ws, userId, { ...filters, cursor: page.nextCursor })
      .then((next) => {
        if (generation.current !== token) return;
        setPage((old) => {
          if (!old) return next;
          const ids = new Set(old.items.map((i) => i.id));
          return {
            ...next,
            items: [...old.items, ...next.items.filter((i) => !ids.has(i.id))],
          };
        });
        setError("");
      })
      .catch((e) => {
        if (generation.current === token) setError((e as Error).message);
      })
      .finally(() => {
        if (generation.current === token) {
          moreFlight.current = false;
          setMoreBusy(false);
        }
      });
  }, [page, loading, ws, userId, filters]);
  useEffect(() => {
    const node = sentinel.current;
    if (!node || immersive || !page?.nextCursor || error) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMore();
      },
      { rootMargin: "500px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [immersive, page?.nextCursor, loadMore, error]);
  async function action(fn: () => Promise<void>) {
    if (actionBusy) return;
    setActionBusy(true);
    try {
      await fn();
    } catch (e) {
      toast({
        title: "Could not update feed",
        description: (e as Error).message,
        variant: "error",
      });
    } finally {
      setActionBusy(false);
    }
  }
  const updateItem = (
    item: UniversalFeedItem,
    patch: Partial<UniversalFeedItem>,
  ) =>
    setPage((p) =>
      p
        ? {
            ...p,
            items: p.items.map((i) =>
              i.provider === item.provider &&
              i.authorId === item.authorId &&
              "following" in patch
                ? { ...i, following: patch.following }
                : i.id === item.id
                  ? { ...i, ...patch }
                  : i,
            ),
          }
        : p,
    );
  const actions: FeedCardActions = {
    save: (item) =>
      void action(async () => {
        await feedService.save(ws, userId, item, !item.saved);
        updateItem(item, { saved: !item.saved });
        if (filters.view === "saved" && item.saved)
          setPage((p) =>
            p ? { ...p, items: p.items.filter((i) => i.id !== item.id) } : p,
          );
        toast({
          title: item.saved
            ? "Removed from Aria Hub saves"
            : "Saved to Aria Hub",
        });
      }),
    follow: (item) =>
      void action(async () => {
        await feedService.follow(ws, userId, item, !item.following);
        updateItem(item, { following: !item.following });
        toast({
          title: item.following
            ? "Unfollowed in Aria Hub"
            : "Following in Aria Hub",
          description: "Native platform following is unchanged.",
        });
      }),
    hide: (item, report) =>
      void action(async () => {
        await feedService.hide(ws, userId, item.id, report);
        setPage((p) =>
          p ? { ...p, items: p.items.filter((i) => i.id !== item.id) } : p,
        );
        if (playerId === item.id) setPlayerId(null);
        toast({
          title: report
            ? "Unavailable content reported and hidden"
            : "Hidden from your feed",
        });
      }),
    reduce: (item) =>
      void action(async () => {
        const next = {
          ...preferences,
          reducedSourceIds: [
            ...new Set([...preferences.reducedSourceIds, item.sourceId]),
          ],
        };
        setPreferences(await feedService.savePreferences(ws, userId, next));
        toast({
          title: "You'll see fewer posts from this source",
          description: "This preference applies to your next feed mix.",
        });
      }),
    copy: (item) => {
      void navigator.clipboard
        .writeText(item.originalUrl)
        .then(() => toast({ title: "Original link copied" }))
        .catch(() =>
          toast({
            title: "Could not copy the link",
            description: "Use Open original to view the post.",
            variant: "error",
          }),
        );
    },
    share: (item) => {
      if (navigator.share)
        void navigator
          .share({
            title: `${item.authorName} on ${PROVIDERS[item.provider].name}`,
            url: item.originalUrl,
          })
          .catch((e) => {
            if ((e as Error).name !== "AbortError")
              toast({ title: "Could not share the link", variant: "error" });
          });
      else actions.copy(item);
    },
  };
  function search(event: FormEvent) {
    event.preventDefault();
    change({ search: query.trim() || undefined });
  }
  const items = page?.items || [],
    view = filters.view || "for_you";
  return (
    <>
      <PageHeader
        title={
          view === "explore"
            ? "Explore & Discover"
            : view === "videos"
              ? "Video Feed"
              : "Home Feed"
        }
        actions={
          <>
            <Button
              variant="secondary"
              className="min-h-11"
              onClick={() => setSourcePanel(!sourcePanel)}
              aria-expanded={sourcePanel}
            >
              <SlidersHorizontal className="size-4" aria-hidden />
              Sources & preferences
            </Button>
            <Button
              variant="ghost"
              className="min-h-11"
              loading={actionBusy}
              onClick={() =>
                void action(async () => {
                  await feedService.sync(ws, userId);
                  reset();
                  toast({ title: "Source refresh requested" });
                })
              }
            >
              <RefreshCw className="size-4" aria-hidden />
              Refresh
            </Button>
          </>
        }
      >
        <div
          role="tablist"
          aria-label="Feed categories"
          className="flex gap-1 overflow-x-auto pb-1"
        >
          {tabs.map(([key, label]) => (
            <button
              key={key}
              role="tab"
              id={`feed-tab-${key}`}
              aria-selected={view === key}
              aria-controls="feed-results"
              tabIndex={view === key ? 0 : -1}
              onKeyDown={(e) => {
                const index = tabs.findIndex(([id]) => id === key);
                const next =
                  e.key === "Home"
                    ? 0
                    : e.key === "End"
                      ? tabs.length - 1
                      : e.key === "ArrowRight"
                        ? (index + 1) % tabs.length
                        : e.key === "ArrowLeft"
                          ? (index + tabs.length - 1) % tabs.length
                          : -1;
                if (next < 0) return;
                e.preventDefault();
                const category = tabs[next][0];
                setImmersive(category === "videos");
                change({ view: category, contentType: undefined });
                document.getElementById(`feed-tab-${category}`)?.focus();
              }}
              className={cn(
                "min-h-11 shrink-0 rounded-full px-4 py-2 text-[13px] transition-colors",
                view === key
                  ? "bg-accent font-semibold text-on-accent"
                  : "bg-surface-2 text-ink-2 hover:text-ink",
              )}
              onClick={() => {
                setImmersive(key === "videos");
                change({ view: key, contentType: undefined });
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </PageHeader>
      <PageBody className="feed-page !pt-0">
        {DATA_MODE === "mock" ? (
          <div
            role="status"
            className="mb-5 rounded-xl border bg-accent-soft px-4 py-3 text-sm text-accent-ink"
          >
            <strong>Demo feed.</strong> All posts are labelled samples. No
            social account or provider API is contacted.
          </div>
        ) : null}
        <div
          className="mb-4 flex gap-2 overflow-x-auto pb-1"
          aria-label="Network filters"
        >
          {[
            undefined,
            "instagram",
            "tiktok",
            "youtube",
            "threads",
            "x",
            "facebook",
            "bluesky",
            "mastodon",
          ].map((p) => (
            <button
              key={p || "all"}
              aria-pressed={filters.provider === p}
              onClick={() => change({ provider: p as FeedFilters["provider"] })}
              className={cn(
                "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full px-4 text-xs font-medium",
                filters.provider === p
                  ? "bg-accent text-on-accent"
                  : "bg-studio-soft text-ink-2",
              )}
            >
              <span
                aria-hidden
                className="size-2 rounded-full"
                style={{
                  backgroundColor: p
                    ? PROVIDERS[p as keyof typeof PROVIDERS].color
                    : "currentColor",
                }}
              />
              {p ? PROVIDERS[p as keyof typeof PROVIDERS].name : "All Networks"}
            </button>
          ))}
        </div>
        <details
          className="mb-5 rounded-xl bg-surface-2 p-3"
          open={view === "explore" || undefined}
        >
          <summary className="cursor-pointer text-xs font-semibold text-ink-2">
            Search & filters
          </summary>
          <div className="mt-3 flex flex-wrap gap-2">
            <form onSubmit={search} className="flex min-w-0 flex-1 gap-2">
              <label className="sr-only" htmlFor="feed-search">
                Search collected posts
              </label>
              <div className="relative min-w-44 flex-1">
                <Search
                  className="pointer-events-none absolute left-3 top-3.5 size-4 text-ink-2"
                  aria-hidden
                />
                <input
                  id="feed-search"
                  className={`${field} w-full pl-9`}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search collected posts"
                  maxLength={120}
                />
              </div>
              <Button type="submit" variant="secondary" className="min-h-11">
                Search
              </Button>
            </form>
            <label className="sr-only" htmlFor="feed-platform">
              Filter platform
            </label>
            <select
              id="feed-platform"
              className={field}
              value={filters.provider || ""}
              onChange={(e) =>
                change({
                  provider: (e.target.value ||
                    undefined) as FeedFilters["provider"],
                })
              }
            >
              <option value="">All platforms</option>
              {(Object.keys(PROVIDERS) as Array<keyof typeof PROVIDERS>).map(
                (p) => (
                  <option value={p} key={p}>
                    {PROVIDERS[p].name}
                  </option>
                ),
              )}
            </select>
            <label className="sr-only" htmlFor="feed-topic">
              Filter topic
            </label>
            <select
              id="feed-topic"
              className={field}
              value={filters.topic || ""}
              onChange={(e) => change({ topic: e.target.value || undefined })}
            >
              <option value="">All topics</option>
              {FEED_TOPICS.map((t) => (
                <option value={t} key={t}>
                  {t}
                </option>
              ))}
            </select>
            {view !== "videos" ? (
              <>
                <label className="sr-only" htmlFor="feed-type">
                  Filter content type
                </label>
                <select
                  id="feed-type"
                  className={field}
                  value={filters.contentType || ""}
                  onChange={(e) =>
                    change({
                      contentType: (e.target.value ||
                        undefined) as FeedFilters["contentType"],
                    })
                  }
                >
                  <option value="">All formats</option>
                  {["video", "image", "carousel", "text", "link"].map((t) => (
                    <option value={t} key={t}>
                      {t[0].toUpperCase() + t.slice(1)}
                    </option>
                  ))}
                </select>
              </>
            ) : null}
          </div>
        </details>
        {view === "explore" && (
          <>
            <div
              className="mb-6 flex gap-2 overflow-x-auto pb-1"
              aria-label="Discover topics"
            >
              {["All topics", ...FEED_TOPICS].map((t) => (
                <button
                  key={t}
                  onClick={() =>
                    change({ topic: t === "All topics" ? undefined : t })
                  }
                  aria-pressed={(filters.topic || "All topics") === t}
                  className={cn(
                    "min-h-11 shrink-0 rounded-full px-4 text-xs font-medium",
                    (filters.topic || "All topics") === t
                      ? "bg-accent text-on-accent"
                      : "bg-studio-soft text-ink-2",
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
            <CreatorSpotlight
              items={items}
              actions={actions}
              busy={actionBusy}
            />
            <h2 className="mb-4 font-display text-lg font-bold">
              Curated Feed
            </h2>
          </>
        )}
        <div
          className={cn(
            "grid items-start gap-6",
            sourcePanel
              ? "xl:grid-cols-[minmax(0,1fr)_300px]"
              : view === "explore" || immersive
                ? "grid-cols-1"
                : "xl:grid-cols-[minmax(0,680px)_minmax(240px,1fr)]",
          )}
        >
          <section
            id="feed-results"
            role="tabpanel"
            aria-labelledby={`feed-tab-${view}`}
            aria-busy={loading}
            className="min-w-0"
          >
            {error ? (
              <div
                role="alert"
                className="mb-5 rounded-xl border border-danger/30 bg-surface p-5"
              >
                <h2 className="text-sm font-semibold">
                  Feed could not be loaded
                </h2>
                <p className="mt-2 text-sm text-ink-2">{error}</p>
                <Button
                  variant="secondary"
                  className="mt-4 min-h-11"
                  onClick={() => {
                    if (page?.nextCursor && page.items.length) loadMore();
                    else reset();
                  }}
                >
                  Try again
                </Button>
              </div>
            ) : null}
            {loading ? (
              <div aria-label="Loading feed" className="space-y-5">
                {[0, 1, 2].map((i) => (
                  <div className="rounded-2xl border bg-surface p-4" key={i}>
                    <div className="skeleton h-10 w-48 rounded-lg" />
                    <div className="skeleton mt-4 h-64 rounded-xl" />
                    <div className="skeleton mt-4 h-4 w-3/4 rounded" />
                  </div>
                ))}
              </div>
            ) : items.length ? (
              <>
                {view === "videos" && immersive ? (
                  <VideoFeed
                    items={items}
                    actions={actions}
                    allowEmbeds={preferences.allowEmbeds}
                    explicitPlayer={playerId}
                    onActivate={setPlayerId}
                    onClose={() => setPlayerId(null)}
                    loadMore={loadMore}
                    hasMore={!!page?.nextCursor}
                    busy={moreBusy}
                    exit={() => setImmersive(false)}
                  />
                ) : (
                  <>
                    <div className="mb-4 flex items-center justify-between gap-2">
                      <p className="text-xs text-ink-2">
                        {items.length} posts loaded · A mix of your available
                        sources
                      </p>
                      {view === "videos" ? (
                        <Button
                          variant="secondary"
                          className="min-h-11"
                          onClick={() => setImmersive(true)}
                        >
                          <Play className="size-4" aria-hidden />
                          Immersive view
                        </Button>
                      ) : null}
                    </div>
                    <div
                      className={
                        view === "explore"
                          ? "columns-2 gap-3 md:columns-3"
                          : "space-y-5"
                      }
                    >
                      {items.map((item) => (
                        <FeedCard
                          item={item}
                          compact={view === "explore"}
                          key={item.id}
                          actions={actions}
                          active={playerId === item.id}
                          allowPlayer={
                            preferences.allowEmbeds || playerId === item.id
                          }
                          onActivate={() => setPlayerId(item.id)}
                          onClose={() => setPlayerId(null)}
                          busy={actionBusy}
                        />
                      ))}
                    </div>
                  </>
                )}
                <div ref={sentinel} className="py-6 text-center">
                  {page?.nextCursor ? (
                    <Button
                      variant="secondary"
                      className="min-h-11"
                      onClick={loadMore}
                      loading={moreBusy}
                    >
                      Load more
                    </Button>
                  ) : (
                    <>
                      <p className="text-xs text-ink-2">
                        You’re caught up with this mix.
                      </p>
                      <Button
                        variant="ghost"
                        className="mt-2 min-h-11"
                        onClick={reset}
                      >
                        Start a new mix
                      </Button>
                    </>
                  )}
                </div>
              </>
            ) : !error ? (
              <div className="rounded-2xl border bg-surface px-5 py-14 text-center">
                {view === "saved" ? (
                  <Bookmark
                    className="mx-auto size-9 text-accent-ink"
                    aria-hidden
                  />
                ) : (
                  <Compass
                    className="mx-auto size-9 text-accent-ink"
                    aria-hidden
                  />
                )}
                <h2 className="mt-4 text-lg font-semibold">
                  {page?.sourcesPending
                    ? "Your sources are warming up"
                    : view === "saved"
                      ? "Keep the posts worth returning to"
                      : view === "following"
                        ? "Choose the creators you want to follow"
                        : "Make room for new perspectives"}
                </h2>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-2">
                  {page?.sourcesPending
                    ? "Background synchronization is collecting permitted metadata. This view updates when content arrives."
                    : view === "saved"
                      ? "Use Save on a post to bookmark it in Aria Hub. Unavailable content may appear as a reference only."
                      : view === "following"
                        ? "Use Follow in Aria Hub on a post, or add an accessible creator source. Connected accounts do not automatically provide a native following feed."
                        : "Try another filter or add a public feed, creator, keyword source or approved post URL. Provider access limits appear with each source."}
                </p>
                <Button
                  variant="secondary"
                  className="mt-6 min-h-11"
                  onClick={() => setSourcePanel(true)}
                >
                  Choose sources
                </Button>
              </div>
            ) : null}
          </section>
          {sourcePanel ? (
            <FeedSourcePanel
              key={JSON.stringify(preferences)}
              ws={ws}
              userId={userId}
              data={sources}
              preferences={preferences}
              onPreferences={setPreferences}
              onChange={reset}
            />
          ) : (
            <aside
              className={cn(
                "hidden space-y-4 xl:block",
                (view === "explore" || immersive) && "!hidden",
              )}
            >
              <div className="rounded-2xl border bg-surface p-5">
                <Compass className="size-6 text-accent-ink" aria-hidden />
                <h2 className="mt-3 text-sm font-semibold">
                  Your curiosity. Your feed.
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-ink-2">
                  Mix public discovery, followed creators and authorized
                  accounts. You decide which sources shape your next scroll.
                </p>
                <Button
                  variant="secondary"
                  className="mt-4 min-h-11 w-full"
                  onClick={() => setSourcePanel(true)}
                >
                  Manage sources
                </Button>
              </div>
              <p className="px-2 text-xs leading-relaxed text-ink-2">
                Official players load on request. Availability and controls
                depend on the original platform. Saves stay in Aria Hub.
              </p>
            </aside>
          )}
        </div>
      </PageBody>
    </>
  );
}
