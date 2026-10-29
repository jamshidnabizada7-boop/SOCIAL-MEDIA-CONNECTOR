"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Check, Plus, Radio, Settings2 } from "lucide-react";
import {
  FEED_TOPICS,
  PROVIDERS,
  type FeedPreferences,
  type FeedSourceKind,
  type ProviderId,
} from "@aria/shared-types";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/providers";
import {
  feedService,
  type FeedSourceInput,
  type FeedSourcesResponse,
} from "@/lib/services/feed";

const field =
  "min-h-11 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm";
export function FeedSourcePanel({
  ws,
  userId,
  data,
  preferences,
  onPreferences,
  onChange,
}: {
  ws: string;
  userId: string;
  data: FeedSourcesResponse | null;
  preferences: FeedPreferences;
  onPreferences: (p: FeedPreferences) => void;
  onChange: () => void;
}) {
  const toast = useToast(),
    [provider, setProvider] = useState<ProviderId>("bluesky"),
    [kind, setKind] = useState<FeedSourceKind>("public"),
    [busy, setBusy] = useState(false),
    [draft, setDraft] = useState(preferences);
  const capability = data?.capabilities.find((c) => c.provider === provider),
    kinds = capability?.kinds || ["public"];
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast({
        title: "Could not update feed",
        description: (e as Error).message,
        variant: "error",
      });
    } finally {
      setBusy(false);
    }
  }
  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget,
      values = new FormData(form);
    const config: FeedSourceInput["config"] = {};
    for (const key of ["actor", "query", "instance", "feed", "url"] as const) {
      const value = String(values.get(key) || "").trim();
      if (value) config[key] = value;
    }
    const accountId = String(values.get("accountId") || "");
    const topic = String(values.get("topic") || "");
    await run(async () => {
      await feedService.addSource(ws, userId, {
        provider,
        kind,
        label: String(
          values.get("label") || `${PROVIDERS[provider].name} ${kind}`,
        ),
        config,
        topics: topic ? [topic] : [],
        ...(accountId ? { accountId } : {}),
      });
      form.reset();
      onChange();
      toast({
        title: "Source added",
        description:
          "Its permitted content will appear after background synchronization.",
      });
    });
  }
  const toggleProvider = (p: ProviderId) =>
    setDraft((d) => ({
      ...d,
      favoriteProviders: d.favoriteProviders.includes(p)
        ? d.favoriteProviders.filter((v) => v !== p)
        : [...d.favoriteProviders, p],
    }));
  return (
    <aside className="space-y-4" aria-label="Feed sources and preferences">
      <section className="rounded-2xl border bg-surface p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Radio className="size-4 text-accent-ink" aria-hidden />
          Your sources
        </h2>
        <p className="mt-2 text-xs leading-relaxed text-ink-2">
          Public discovery and the creators you choose. Connected accounts add
          their own accessible posts.
        </p>
        {!data ? (
          <p className="mt-4 text-xs text-ink-2">
            Source status is unavailable until the server responds.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {data.sources.map((source) => (
              <li
                key={source.id}
                className="border-b pb-3 last:border-0 last:pb-0"
              >
                <div className="flex items-start gap-2">
                  <span
                    aria-hidden
                    className={`mt-1.5 size-1.5 shrink-0 rounded-full ${source.enabled && source.status === "healthy" ? "bg-accent" : "bg-ink-3"}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-xs font-medium">
                      {source.label}
                    </p>
                    <p className="mt-1 text-[11px] capitalize text-ink-2">
                      {PROVIDERS[source.provider].name} ·{" "}
                      {source.enabled ? source.status : "paused"}
                    </p>
                    {source.error && source.enabled ? (
                      <p className="mt-2 text-xs leading-relaxed text-ink-2">
                        {source.error}
                      </p>
                    ) : null}
                  </div>
                  <button
                    className="min-h-11 shrink-0 text-xs text-accent-ink"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await feedService.setSource(
                          ws,
                          userId,
                          source.id,
                          !source.enabled,
                        );
                        onChange();
                      })
                    }
                  >
                    {source.enabled ? "Pause" : "Resume"}
                  </button>
                  {source.removable ? (
                    <button
                      className="min-h-11 shrink-0 text-xs text-danger"
                      disabled={busy}
                      aria-label={`Remove ${source.label}`}
                      onClick={() => {
                        if (
                          !window.confirm(
                            "Remove this source and its cached posts, Aria Hub bookmarks and associated creator follow? Original platform content is unaffected.",
                          )
                        )
                          return;
                        void run(async () => {
                          await feedService.removeSource(ws, userId, source.id);
                          onChange();
                        });
                      }}
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        <details className="mt-4 border-t pt-3">
          <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium">
            <Plus className="size-4" aria-hidden />
            Add a source
          </summary>
          <form className="mt-3 space-y-3" onSubmit={(e) => void add(e)}>
            <label className="block text-xs font-medium">
              Platform
              <select
                className={`${field} mt-1`}
                value={provider}
                onChange={(e) => {
                  const next = e.target.value as ProviderId;
                  setProvider(next);
                  setKind(
                    data?.capabilities.find((c) => c.provider === next)
                      ?.kinds[0] || "url",
                  );
                }}
              >
                {(Object.keys(PROVIDERS) as ProviderId[]).map((p) => (
                  <option value={p} key={p}>
                    {PROVIDERS[p].name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-medium">
              Source type
              <select
                className={`${field} mt-1`}
                value={kind}
                onChange={(e) => setKind(e.target.value as FeedSourceKind)}
              >
                {kinds.map((k) => (
                  <option value={k} key={k}>
                    {
                      {
                        public: "Public discovery",
                        creator: "Creator",
                        search: "Search / topic",
                        account: "My connected account",
                        url: "Public post URL",
                        timeline: "Authorized following timeline",
                      }[k]
                    }
                  </option>
                ))}
              </select>
            </label>
            {capability ? (
              <p className="text-xs leading-relaxed text-ink-2">
                {capability.discovery} {capability.requirements}
              </p>
            ) : null}
            {kind === "url" ? (
              <label className="block text-xs font-medium">
                Public post URL
                <input
                  required
                  type="url"
                  name="url"
                  className={`${field} mt-1`}
                  placeholder="https://…"
                />
              </label>
            ) : null}
            {kind === "creator" ? (
              <label className="block text-xs font-medium">
                {provider === "bluesky"
                  ? "Creator handle or DID"
                  : provider === "youtube"
                    ? "Channel ID (UC…)"
                    : "Creator account ID"}
                <input required name="actor" className={`${field} mt-1`} />
              </label>
            ) : null}
            {kind === "search" ? (
              <label className="block text-xs font-medium">
                {provider === "mastodon"
                  ? "Hashtag (without #)"
                  : "Search keywords"}
                <input
                  required
                  name="query"
                  maxLength={120}
                  className={`${field} mt-1`}
                />
              </label>
            ) : null}
            {provider === "mastodon" && kind !== "url" ? (
              <label className="block text-xs font-medium">
                Mastodon instance
                <input
                  type="url"
                  name="instance"
                  defaultValue="https://mastodon.social"
                  className={`${field} mt-1`}
                />
              </label>
            ) : null}
            {provider === "bluesky" && kind === "public" ? (
              <label className="block text-xs font-medium">
                Feed-generator URI (optional)
                <input
                  name="feed"
                  placeholder="at://did:…/app.bsky.feed.generator/…"
                  className={`${field} mt-1`}
                />
              </label>
            ) : null}
            {kind === "account" ||
            kind === "timeline" ||
            (provider === "mastodon" && kind !== "url") ? (
              <label className="block text-xs font-medium">
                Connected account
                <select
                  name="accountId"
                  required={kind === "account" || kind === "timeline"}
                  className={`${field} mt-1`}
                >
                  <option value="">
                    {kind === "account" || kind === "timeline"
                      ? "Select account"
                      : "No authorization (public only)"}
                  </option>
                  {data?.accounts
                    .filter(
                      (a) =>
                        a.provider === provider && a.connection === "healthy",
                    )
                    .map((a) => (
                      <option value={a.id} key={a.id}>
                        {a.displayName}
                      </option>
                    ))}
                </select>
              </label>
            ) : null}
            <label className="block text-xs font-medium">
              Topic (optional)
              <select name="topic" className={`${field} mt-1`}>
                <option value="">No topic label</option>
                {FEED_TOPICS.map((t) => (
                  <option value={t} key={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-medium">
              Source name (optional)
              <input name="label" maxLength={120} className={`${field} mt-1`} />
            </label>
            <Button
              type="submit"
              className="min-h-11 w-full"
              loading={busy}
              disabled={!data}
            >
              Add source
            </Button>
          </form>
        </details>
      </section>
      <details className="rounded-2xl border bg-surface p-4">
        <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-semibold">
          <Settings2 className="size-4" aria-hidden />
          Feed preferences
        </summary>
        <form
          className="mt-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              onPreferences(
                await feedService.savePreferences(ws, userId, draft),
              );
              onChange();
              toast({ title: "Feed preferences saved" });
            });
          }}
        >
          <fieldset>
            <legend className="mb-2 text-xs font-medium">
              Favorite platforms
            </legend>
            <div className="grid grid-cols-2 gap-1">
              {(Object.keys(PROVIDERS) as ProviderId[]).map((p) => (
                <label
                  className="flex min-h-11 items-center gap-2 text-xs"
                  key={p}
                >
                  <input
                    type="checkbox"
                    checked={draft.favoriteProviders.includes(p)}
                    onChange={() => toggleProvider(p)}
                  />
                  {PROVIDERS[p].name}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-2 text-xs font-medium">Interests</legend>
            <div className="flex flex-wrap gap-1">
              {FEED_TOPICS.map((t) => (
                <label
                  className="flex min-h-10 items-center gap-1 rounded-lg border px-2 text-xs"
                  key={t}
                >
                  <input
                    type="checkbox"
                    checked={draft.topics.includes(t)}
                    onChange={() =>
                      setDraft((d) => ({
                        ...d,
                        topics: d.topics.includes(t)
                          ? d.topics.filter((v) => v !== t)
                          : [...d.topics, t],
                      }))
                    }
                  />
                  {t}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="flex min-h-11 items-start gap-2 text-xs leading-relaxed">
            <input type="checkbox" className="mt-1" checked={draft.autoplayVideos !== false}
              onChange={(e) => setDraft((d) => ({...d,autoplayVideos:e.target.checked}))}/>
            Autoplay supported videos muted while in view. Reduced-motion and data-saving settings are respected.
          </label>
          <label className="flex min-h-11 items-start gap-2 text-xs leading-relaxed">
            <input
              type="checkbox"
              className="mt-1"
              checked={draft.allowEmbeds}
              onChange={(e) =>
                setDraft((d) => ({ ...d, allowEmbeds: e.target.checked }))
              }
            />
            Load official players for the active video. Providers receive a
            request when their player loads.
          </label>
          <label className="flex min-h-11 items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={draft.showSensitive}
              onChange={(e) =>
                setDraft((d) => ({ ...d, showSensitive: e.target.checked }))
              }
            />
            Include content marked sensitive
          </label>
          <Button type="submit" className="min-h-11 w-full" loading={busy}>
            <Check className="size-4" aria-hidden />
            Save preferences
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="min-h-11 w-full whitespace-normal"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const next = await feedService.resetPreferences(ws, userId);
                setDraft(next);
                onPreferences(next);
                onChange();
                toast({ title: "Preferences and hidden items reset" });
              })
            }
          >
            Reset preferences and hidden items
          </Button>
        </form>
      </details>
      <details className="rounded-2xl border bg-surface p-4">
        <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold">
          Platform availability
        </summary>
        <ul className="space-y-4 pt-3">
          {data?.capabilities.map((c) => (
            <li key={c.provider}>
              <h3 className="text-xs font-semibold">
                {PROVIDERS[c.provider].name}
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-ink-2">
                {c.discovery} {c.embeds}
              </p>
            </li>
          ))}
        </ul>
      </details>
      <p className="px-2 text-xs leading-relaxed text-ink-2">
        Saves and follows belong to your Aria Hub profile. Manage native likes
        and comments on the original platform.{" "}
        <Link href="/accounts" className="underline underline-offset-2">
          Manage connected accounts
        </Link>
      </p>
    </aside>
  );
}
