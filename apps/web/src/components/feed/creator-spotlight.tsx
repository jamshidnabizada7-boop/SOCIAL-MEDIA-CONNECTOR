"use client";
import { PROVIDERS, type UniversalFeedItem } from "@aria/shared-types";
import { type FeedCardActions } from "./feed-card";
import { FeedAvatar } from "./feed-avatar";
import { Button } from "@/components/ui/button";

/** Only creators returned by the selected, authorized sources appear here. */
export function CreatorSpotlight({
  items,
  actions,
  busy,
}: {
  items: UniversalFeedItem[];
  actions: FeedCardActions;
  busy: boolean;
}) {
  const creators = [
    ...new Map(
      items
        .filter((i) => i.availability !== "preview_only" && i.authorId)
        .map((i) => [`${i.provider}:${i.authorId}`, i]),
    ).values(),
  ].slice(0, 8);
  if (!creators.length) return null;
  return (
    <section aria-label="Creator Spotlight" className="mb-7">
      <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-bold">
        <span className="size-1.5 rounded-full bg-accent" aria-hidden />
        Creator Spotlight
      </h2>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {creators.map((item) => (
          <div
            key={`${item.provider}:${item.authorId}`}
            className="flex w-40 shrink-0 flex-col items-center rounded-xl bg-studio-soft p-3 text-center"
          >
            <FeedAvatar
              name={item.authorName}
              src={item.authorAvatarUrl}
              className="size-14 font-display text-xl font-bold"
            />
            <p className="mt-2 w-full truncate text-[13px] font-semibold">
              {item.authorName}
            </p>
            <p className="mt-0.5 w-full truncate text-[11px] text-ink-2">
              {item.authorHandle || PROVIDERS[item.provider].name}
            </p>
            <span className="mt-2 rounded-full bg-surface px-2 py-0.5 text-[10px] text-ink-2">
              {item.sample ? "Sample creator" : PROVIDERS[item.provider].name}
            </span>
            <Button
              className="mt-3 min-h-11 w-full"
              variant={item.following ? "secondary" : "primary"}
              onClick={() => actions.follow(item)}
              disabled={busy}
              aria-pressed={!!item.following}
              aria-label={`${item.following ? "Unfollow" : "Follow"} ${item.authorName} in Aria Hub`}
            >
              {item.following ? "Following" : "Follow"}
            </Button>
          </div>
        ))}
      </div>
      <p className="mt-1 text-[11px] text-ink-2">
        Follow creators in Aria Hub to shape your Following feed.
      </p>
    </section>
  );
}
