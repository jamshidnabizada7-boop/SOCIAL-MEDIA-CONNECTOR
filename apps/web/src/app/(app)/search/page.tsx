"use client";
/* eslint-disable @next/next/no-img-element -- Public provider avatars load from their original hosts without rehosting. */
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ExternalLink,
  Hash,
  Search,
  Users,
  Play,
  Layers,
  Plus,
  Check,
  RefreshCw,
} from "lucide-react";
import {
  PROVIDERS,
  type ProviderId,
  type SearchKind,
  type SearchPerson,
  type UniversalSearchResponse,
} from "@aria/shared-types";
import { useSession, useToast } from "@/components/providers";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { FeedImage, FeedPlayer } from "@/components/feed/feed-card";
import { Button } from "@/components/ui/button";
import { feedService } from "@/lib/services/feed";
import { universalSearch } from "@/lib/services/search";
import { cn } from "@/lib/utils";

const kinds: Array<[SearchKind, string, typeof Search]> = [
  ["all", "All results", Layers],
  ["people", "People & accounts", Users],
  ["posts", "Posts", Search],
  ["videos", "Videos", Play],
  ["topics", "Topics", Hash],
];
const networkIds = Object.keys(PROVIDERS) as ProviderId[];
const field =
  "min-h-12 min-w-0 flex-1 rounded-xl border border-line-strong bg-surface px-4 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

function PersonCard({
  person,
  workspace,
  user,
  sample,
}: {
  person: SearchPerson;
  workspace: string;
  user: string;
  sample?: boolean;
}) {
  const toast = useToast(),
    [adding, setAdding] = useState(false),
    [added, setAdded] = useState(false);
  async function add() {
    if (!person.creator) return;
    setAdding(true);
    try {
      await feedService.addSource(workspace, user, {
        provider: person.provider,
        kind: "creator",
        label: person.name.slice(0, 120),
        config: {
          actor: person.creator.actor,
          instance: person.creator.instance,
        },
        topics: [],
      });
      setAdded(true);
      toast({
        title: "Creator added to your Aria Hub Feed",
        description: "New posts will appear after the source synchronizes.",
      });
    } catch (error) {
      toast({
        title: "Could not add this creator",
        description: (error as Error).message,
        variant: "error",
      });
    } finally {
      setAdding(false);
    }
  }
  return (
    <article
      className="min-w-0 rounded-2xl border bg-surface p-4"
      aria-label={`${PROVIDERS[person.provider].name} account ${person.name}`}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span
          className="relative grid size-12 shrink-0 place-items-center overflow-hidden rounded-full bg-studio-soft font-display font-bold text-accent-ink"
          aria-hidden
        >
          {person.name.slice(0, 1)}
          {person.avatarUrl && (
            <img
              src={person.avatarUrl}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              className="absolute inset-0 size-full object-cover"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <a
            href={person.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block break-words font-display font-bold text-ink hover:text-accent-ink [overflow-wrap:anywhere]"
          >
            {person.name}
          </a>
          <p className="break-words text-xs text-ink-2 [overflow-wrap:anywhere]">
            {person.handle}
          </p>
          <span className="mt-1 inline-block text-xs font-medium text-accent-ink">
            {PROVIDERS[person.provider].name}
          </span>
        </div>
      </div>
      {person.description && (
        <p className="mt-3 line-clamp-3 break-words text-sm leading-relaxed text-ink-2 [overflow-wrap:anywhere]">
          {person.description}
        </p>
      )}
      <p className="mt-3 text-xs text-ink-3">
        {sample
          ? "Sample account"
          : person.origin === "connected"
            ? "Your connected account"
            : person.origin === "live"
              ? "Platform search result"
              : "Creator in your collected content"}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <a
          href={person.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-accent-ink hover:bg-accent-soft"
        >
          {sample ? "View sample" : "Open profile"}
          <ExternalLink className="size-3.5" aria-hidden />
        </a>
        {person.creator && person.provider !== "mastodon" && !sample && (
          <Button
            variant="secondary"
            className="min-h-11"
            onClick={() => void add()}
            loading={adding}
            disabled={added}
          >
            {added ? <Check className="size-4" /> : <Plus className="size-4" />}
            {added ? "Added to Feed" : "Add to Feed"}
          </Button>
        )}
      </div>
    </article>
  );
}

function SearchContent({
  query,
  kind,
  provider,
}: {
  query: string;
  kind: SearchKind;
  provider: ProviderId | "all";
}) {
  const { session } = useSession(),
    router = useRouter();
  const [draft, setDraft] = useState(query),
    [data, setData] = useState<UniversalSearchResponse | null>(null),
    [error, setError] = useState("");
  const [loading, setLoading] = useState(query.length >= 2),
    [revision, setRevision] = useState(0),
    [activePlayer, setActivePlayer] = useState<string | null>(null);
  const workspace = session?.workspace.id,
    user = session?.user.id;
  useEffect(() => {
    if (!workspace || !user || query.length < 2) return;
    let current = true;
    void universalSearch(workspace, user, query)
      .then((result) => {
        if (current) setData(result);
      })
      .catch((e) => {
        if (current) setError((e as Error).message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [workspace, user, query, revision]);
  function refresh() {
    setLoading(true);
    setError("");
    setRevision((v) => v + 1);
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    const q = draft.trim();
    if (q.length < 2) return;
    if (q === query) refresh();
    else router.push(`/search?${new URLSearchParams({ q })}`);
  }
  function filter(nextKind = kind, nextProvider = provider) {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (nextKind !== "all") params.set("type", nextKind);
    if (nextProvider !== "all") params.set("platform", nextProvider);
    setActivePlayer(null);
    router.replace(`/search?${params}`, { scroll: false });
  }
  const people =
    data?.people.filter((p) => provider === "all" || p.provider === provider) ||
    [];
  const posts =
    data?.posts.filter(
      (p) => provider === "all" || p.item.provider === provider,
    ) || [];
  const topics =
    data?.topics.filter((t) => provider === "all" || t.provider === provider) ||
    [];
  const videos = posts.filter((p) => p.item.contentType === "video");
  const count = people.length + posts.length + topics.length;
  const visiblePosts = kind === "videos" ? videos : posts;
  const selectedCount =
    kind === "people"
      ? people.length
      : kind === "topics"
        ? topics.length
        : kind === "videos"
          ? videos.length
          : kind === "posts"
            ? posts.length
            : count;
  return (
    <>
      <PageHeader
        title="Universal Search"
        description="Find people, accounts, posts, videos and topics across your available platforms."
      />
      <PageBody className="!pt-0">
        <form
          role="search"
          aria-label="Universal social search"
          onSubmit={submit}
          className="flex min-w-0 gap-2"
        >
          <label htmlFor="universal-search" className="sr-only">
            Search people and content
          </label>
          <input
            id="universal-search"
            type="search"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="A name, @handle, topic or anything else…"
            autoComplete="off"
            minLength={2}
            maxLength={120}
            autoFocus={!query}
            className={field}
          />
          <Button
            type="submit"
            className="!min-h-12 !rounded-xl !px-4"
            aria-label="Submit universal search"
          >
            <Search className="size-5" />
            <span className="hidden sm:inline">Search</span>
          </Button>
        </form>
        <p className="mt-2 text-xs leading-relaxed text-ink-3">
          Available public and authorized content appears here. Other searches
          open on the original platform.
        </p>
        <div
          role="group"
          aria-label="Search result types"
          className="mt-6 flex gap-2 overflow-x-auto pb-2"
        >
          {kinds.map(([value, label, Icon]) => (
            <button
              key={value}
              onClick={() => filter(value)}
              aria-pressed={kind === value}
              className={cn(
                "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-3 text-sm font-medium",
                kind === value
                  ? "bg-accent text-on-accent"
                  : "bg-surface text-ink-2 hover:bg-surface-2",
              )}
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </button>
          ))}
        </div>
        <div
          role="group"
          aria-label="Search platforms"
          className="mt-2 flex gap-2 overflow-x-auto pb-2"
        >
          <button
            onClick={() => filter(kind, "all")}
            aria-pressed={provider === "all"}
            className={cn(
              "min-h-11 shrink-0 rounded-full border px-3 text-xs font-medium",
              provider === "all"
                ? "border-accent bg-accent-soft text-accent-ink"
                : "bg-surface text-ink-2",
            )}
          >
            All platforms
          </button>
          {networkIds.map((id) => (
            <button
              key={id}
              onClick={() => filter(kind, id)}
              aria-pressed={provider === id}
              className={cn(
                "min-h-11 shrink-0 rounded-full border px-3 text-xs font-medium",
                provider === id
                  ? "border-accent bg-accent-soft text-accent-ink"
                  : "bg-surface text-ink-2",
              )}
            >
              {PROVIDERS[id].name}
            </button>
          ))}
        </div>
        {data?.sample && (
          <p className="mt-4 rounded-xl bg-studio-soft p-3 text-sm text-ink-2">
            Demo search · Sample accounts and posts. Search your connected
            platforms in the live app.
          </p>
        )}
        {query.length < 2 && (
          <div className="my-10 rounded-2xl bg-studio-soft px-5 py-10 text-center sm:px-10">
            <Search
              className="mx-auto mb-4 size-9 text-accent-ink"
              aria-hidden
            />
            <h2 className="font-display text-xl font-bold">
              One search, more perspectives
            </h2>
            <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-ink-2">
              Look up a creator, find an account by its handle, or explore posts
              and videos about a topic. Each result tells you where it came
              from.
            </p>
            <p className="mt-4 text-xs text-ink-3">
              Use at least two characters. Platform access and search coverage
              vary.
            </p>
          </div>
        )}
        {loading && (
          <div role="status" className="mt-6 space-y-3">
            <p className="flex items-center gap-2 text-sm text-ink-2">
              <RefreshCw className="size-4 animate-spin motion-reduce:animate-none" />
              Searching available platforms…
            </p>
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-28 animate-pulse rounded-2xl bg-surface-2 motion-reduce:animate-none"
              />
            ))}
          </div>
        )}
        {error && (
          <div
            role="alert"
            className="mt-5 rounded-xl border border-danger/20 bg-danger-soft p-4"
          >
            <p className="text-sm text-danger">{error}</p>
            <Button
              variant="secondary"
              className="mt-3 min-h-11"
              onClick={refresh}
            >
              Try search again
            </Button>
          </div>
        )}
        {data && !loading && !error && (
          <>
            <div className="my-5 flex flex-wrap items-center justify-between gap-2">
              <p
                role="status"
                className="break-words text-sm text-ink-2 [overflow-wrap:anywhere]"
              >
                {selectedCount} results loaded for{" "}
                <strong className="text-ink">“{data.query}”</strong>
              </p>
              <button
                className="min-h-11 text-sm text-accent-ink"
                onClick={refresh}
              >
                Refresh results
              </button>
            </div>
            {!selectedCount && (
              <div className="mb-5 rounded-2xl border bg-surface p-6">
                <h2 className="font-display font-bold">
                  No matching results in these sources
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-ink-2">
                  Try another name or handle, choose another filter, or continue
                  with the original platform search below.
                </p>
                {(kind !== "all" || provider !== "all") && (
                  <Button
                    className="mt-3 min-h-11"
                    variant="secondary"
                    onClick={() => filter("all", "all")}
                  >
                    Show all sources and result types
                  </Button>
                )}
              </div>
            )}
            {(kind === "all" || kind === "people") && people.length > 0 && (
              <section aria-label="People and account results" className="mb-7">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="font-display text-lg font-bold">
                    People & accounts{" "}
                    <span className="text-sm font-normal text-ink-3">
                      {people.length}
                    </span>
                  </h2>
                  {kind === "all" && people.length > 8 && (
                    <button
                      className="min-h-11 text-sm text-accent-ink"
                      onClick={() => filter("people")}
                    >
                      See all accounts
                    </button>
                  )}
                </div>
                <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {people.slice(0, kind === "all" ? 8 : 40).map((p) => (
                    <PersonCard
                      key={`${p.provider}:${p.id}`}
                      person={p}
                      workspace={workspace!}
                      user={user!}
                      sample={data.sample}
                    />
                  ))}
                </div>
              </section>
            )}
            {(kind === "all" || kind === "topics") && topics.length > 0 && (
              <section aria-label="Topic results" className="mb-7">
                <h2 className="mb-3 font-display text-lg font-bold">Topics</h2>
                <div className="flex flex-wrap gap-2">
                  {topics.map((t) => (
                    <a
                      key={`${t.provider}:${t.name}`}
                      href={t.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-11 max-w-full items-center gap-2 break-all rounded-xl border bg-surface px-3 text-sm text-accent-ink"
                    >
                      <Hash className="size-4 shrink-0" />
                      {t.name}
                      <span className="text-xs text-ink-3">
                        {PROVIDERS[t.provider].name}
                      </span>
                    </a>
                  ))}
                </div>
              </section>
            )}
            {(kind === "all" || kind === "posts" || kind === "videos") &&
              visiblePosts.length > 0 && (
                <section aria-label="Content results" className="mb-7">
                  <h2 className="mb-3 font-display text-lg font-bold">
                    {kind === "videos" ? "Videos" : "Posts & videos"}
                  </h2>
                  <div className="grid min-w-0 grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {visiblePosts
                      .slice(0, kind === "all" ? 18 : 48)
                      .map(({ item, origin }) => (
                        <article
                          key={`${item.provider}:${item.providerPostId}`}
                          className="min-w-0 overflow-hidden rounded-2xl border bg-surface"
                          aria-label={`${PROVIDERS[item.provider].name} search result by ${item.authorName}`}
                        >
                          <div className="p-4">
                            <p className="text-xs font-medium text-accent-ink">
                              {PROVIDERS[item.provider].name} ·{" "}
                              {data.sample
                                ? "Sample"
                                : origin === "live"
                                  ? "Platform result"
                                  : "From your collected content"}
                            </p>
                            <h3 className="mt-2 break-words font-display font-bold [overflow-wrap:anywhere]">
                              {item.authorName}
                            </h3>
                            <p className="mt-2 line-clamp-5 whitespace-pre-wrap break-words text-sm leading-relaxed text-ink-2 [overflow-wrap:anywhere]">
                              {item.caption}
                            </p>
                          </div>
                          {item.contentType === "video" ? (
                            <FeedPlayer
                              item={item}
                              active={activePlayer === item.id}
                              allowed={!data.sample}
                              onActivate={() => setActivePlayer(item.id)}
                              onClose={() => setActivePlayer(null)}
                            />
                          ) : item.thumbnailUrl ? (
                            <FeedImage
                              src={item.thumbnailUrl}
                              alt={`Preview from ${item.authorName}`}
                              className="max-h-64 w-full object-cover"
                            />
                          ) : null}
                          <a
                            className="m-3 inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-medium text-accent-ink hover:bg-accent-soft"
                            href={item.originalUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {data.sample ? "View sample" : "Open original"}
                            <ExternalLink className="size-3.5" aria-hidden />
                          </a>
                        </article>
                      ))}
                  </div>
                </section>
              )}
            <details
              open={!selectedCount}
              className="mt-6 rounded-2xl border bg-surface p-4"
            >
              <summary className="cursor-pointer font-display font-bold">
                Platform coverage & more places to search
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-ink-2">
                Platform results, your collected content and external searches
                are labelled separately. An unavailable platform does not
                prevent the others from returning results.
              </p>
              <div className="mt-3 divide-y">
                {data.coverage
                  .filter((c) => provider === "all" || c.provider === provider)
                  .map((c) => (
                    <div
                      key={c.provider}
                      className="flex min-w-0 flex-wrap items-start justify-between gap-3 py-4"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">
                          {PROVIDERS[c.provider].name}{" "}
                          <span className="ml-2 text-xs font-normal text-ink-3">
                            {c.status === "rate_limited"
                              ? "Rate limited"
                              : c.status === "unavailable"
                                ? "Unavailable"
                                : c.mode === "live"
                                  ? c.status === "partial"
                                    ? "Partial results"
                                    : "Platform search"
                                  : c.mode === "collected"
                                    ? "Your collected content"
                                    : "External search"}
                          </span>
                        </p>
                        <p className="mt-1 text-xs leading-relaxed text-ink-2">
                          {c.message}
                          {c.retryAfterSec
                            ? ` Try again in about ${Math.ceil(c.retryAfterSec / 60)} minute(s).`
                            : ""}
                        </p>
                      </div>
                      <a
                        className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium text-accent-ink"
                        href={c.externalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Search on {PROVIDERS[c.provider].name}
                        <ExternalLink className="size-3.5" aria-hidden />
                      </a>
                    </div>
                  ))}
              </div>
            </details>
          </>
        )}
      </PageBody>
    </>
  );
}

function SearchRoute() {
  const params = useSearchParams(),
    { session } = useSession();
  const query = (params.get("q") || "").trim().slice(0, 120),
    type = params.get("type") as SearchKind,
    network = params.get("platform") as ProviderId;
  const kind = kinds.some(([id]) => id === type) ? type : "all",
    provider = networkIds.includes(network) ? network : "all";
  return (
    <SearchContent
      key={`${session?.workspace.id}:${session?.user.id}:${query}`}
      query={query}
      kind={kind}
      provider={provider}
    />
  );
}
export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <div role="status" className="p-8">
          Loading search…
        </div>
      }
    >
      <SearchRoute />
    </Suspense>
  );
}
