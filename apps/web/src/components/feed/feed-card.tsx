"use client";
/* eslint-disable @next/next/no-img-element -- Provider images stay on their original hosts; Next's image proxy must not rehost them. */
import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
  Bookmark,
  Check,
  ExternalLink,
  Flag,
  Heart,
  ImageIcon,
  Link2,
  MessageCircle,
  MoreHorizontal,
  Play,
  Share2,
  UserPlus,
  X,
} from "lucide-react";
import {
  PROVIDERS,
  isOfficialFeedEmbed,
  isOfficialFeedPlayback,
  type UniversalFeedItem,
} from "@aria/shared-types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { NativeFeedVideo } from "./native-feed-video";

export interface FeedCardActions {
  save: (item: UniversalFeedItem) => void;
  follow: (item: UniversalFeedItem) => void;
  hide: (item: UniversalFeedItem, report?: boolean) => void;
  share: (item: UniversalFeedItem) => void;
  copy: (item: UniversalFeedItem) => void;
  reduce: (item: UniversalFeedItem) => void;
}
export function FeedImage({
  src,
  alt,
  className,
}: {
  src?: string;
  alt: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (!src || failed)
    return (
      <div
        className={cn(
          "flex min-h-32 items-center justify-center gap-2 bg-surface-2 p-6 text-center text-sm text-ink-2",
          className,
        )}
      >
        <ImageIcon className="size-5" aria-hidden />
        <span>Preview unavailable. Open the original to view it.</span>
      </div>
    );
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
    />
  );
}
export function FeedPlayer({
  item,
  active,
  allowed,
  onActivate,
  onClose,
  immersive = false,
  autoPlay = true,
}: {
  item: UniversalFeedItem;
  active: boolean;
  allowed: boolean;
  onActivate: () => void;
  onClose: () => void;
  immersive?: boolean;
  autoPlay?: boolean;
}) {
  const node = useRef<HTMLDivElement>(null),
    [visible, setVisible] = useState(false),
    [inView, setInView] = useState(false),
    [automatic, setAutomatic] = useState(false),
    [userStarted, setUserStarted] = useState(false),
    [closed, setClosed] = useState(false);
  const direct =
    !item.sample &&
    isOfficialFeedPlayback(item.provider, item.playbackUrl, item.authorId);
  const autoActivate = useEffectEvent((entry: IntersectionObserverEntry) => {
    const showing = entry.isIntersecting && entry.intersectionRatio >= 0.6;
    setVisible(entry.isIntersecting);
    setInView(showing);
    const saveData = (
      navigator as Navigator & { connection?: { saveData?: boolean } }
    ).connection?.saveData;
    const eligible =
      autoPlay &&
      !saveData &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setAutomatic(eligible);
    if (
      showing &&
      !closed &&
      eligible &&
      !item.sample &&
      (direct || (item.provider === "facebook" && item.canEmbed)) &&
      document.visibilityState === "visible"
    )
      onActivate();
  });
  useEffect(() => {
    const el = node.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) autoActivate(entry);
      },
      { threshold: [0, 0.6] },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [direct, autoPlay]);
  const valid =
      direct ||
      (item.canEmbed && isOfficialFeedEmbed(item.provider, item.embedUrl)),
    load =
      active &&
      allowed &&
      visible &&
      valid &&
      !closed &&
      (!direct || automatic || userStarted);
  const provider = PROVIDERS[item.provider].name;
  const url = load && !direct ? new URL(item.embedUrl!) : null;
  if (url && item.provider === "youtube") {
    url.searchParams.set("playsinline", "1");
    url.searchParams.set("autoplay", "0");
  }
  if (url && item.provider === "tiktok") {
    url.searchParams.set("controls", "1");
    url.searchParams.set("autoplay", "0");
  }
  if (url && item.provider === "facebook") {
    url.searchParams.set(
      "autoplay",
      automatic || userStarted ? "true" : "false",
    );
    url.searchParams.set("mute", "true");
  }
  return (
    <div
      ref={node}
      className={cn(
        "relative overflow-hidden bg-surface-2",
        immersive
          ? "flex h-full min-h-64 items-center justify-center"
          : "min-h-64",
        !immersive && item.provider === "youtube" ? "aspect-video" : "",
      )}
    >
      {load && direct ? (
        <NativeFeedVideo
          provider={item.provider === "facebook" ? "facebook" : "bluesky"}
          key={item.playbackUrl}
          url={item.playbackUrl!}
          poster={item.thumbnailUrl}
          author={item.authorName}
          playing={active && inView && (automatic || userStarted)}
          onActivate={onActivate}
          immersive={immersive}
        />
      ) : load ? (
        <div
          className={cn(
            "relative flex w-full flex-col",
            immersive
              ? "h-full"
              : item.provider === "youtube"
                ? "aspect-video"
                : "h-[560px] max-h-[70dvh]",
          )}
        >
          {item.provider === "bluesky" ? (
            <p className="shrink-0 border-b bg-surface px-3 py-2 pr-14 text-xs leading-relaxed text-ink-2">
              Bluesky shows the full post. Scroll inside it to reach video
              controls.
            </p>
          ) : null}
          <iframe
            src={url!.href}
            title={`${provider} player: ${item.authorName}`}
            className="min-h-0 w-full flex-1 border-0"
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"
            referrerPolicy="strict-origin-when-cross-origin"
          />
          <Button
            variant="secondary"
            size="icon"
            className="absolute right-2 top-2 min-h-11 min-w-11"
            onClick={() => {
              setClosed(true);
              onClose();
            }}
            aria-label="Close player"
          >
            <X className="size-4" aria-hidden />
          </Button>
        </div>
      ) : (
        <div className="relative flex h-full min-h-64 w-full items-center justify-center">
          {item.thumbnailUrl ? (
            <FeedImage
              src={item.thumbnailUrl}
              alt={`Video preview from ${item.authorName}`}
              className={cn(
                "w-full",
                immersive
                  ? "h-full max-h-full object-cover"
                  : "max-h-[500px] object-contain",
              )}
            />
          ) : (
            <div className="grid min-h-72 w-full place-items-center bg-surface-2">
              <Play className="size-16 text-accent-ink" aria-hidden />
            </div>
          )}
          <div className="absolute inset-x-4 bottom-4 flex justify-center">
            {valid ? (
              <Button
                onClick={() => {
                  setClosed(false);
                  setUserStarted(true);
                  onActivate();
                }}
                size="lg"
                className="shadow-lg"
              >
                <Play className="size-4" aria-hidden />
                {direct ? "Play video" : `Load ${provider} player`}
              </Button>
            ) : !item.sample ? (
              <a
                href={item.originalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center gap-2 rounded-xl border bg-surface px-4 py-2 text-sm font-medium shadow-sm"
              >
                Watch on {provider}
                <ExternalLink className="size-4" aria-hidden />
              </a>
            ) : (
              <span className="rounded-lg bg-surface px-4 py-2 text-sm">
                Sample video preview
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
export function FeedCard({
  item,
  actions,
  active,
  allowPlayer,
  onActivate,
  onClose,
  immersive = false,
  busy = false,
  compact = false,
  autoPlay = true,
}: {
  item: UniversalFeedItem;
  actions: FeedCardActions;
  active: boolean;
  allowPlayer: boolean;
  onActivate: () => void;
  onClose: () => void;
  immersive?: boolean;
  busy?: boolean;
  compact?: boolean;
  autoPlay?: boolean;
}) {
  const [menu, setMenu] = useState(false),
    [expanded, setExpanded] = useState(false);
  const provider = PROVIDERS[item.provider],
    isVideo = item.contentType === "video",
    unavailable = item.availability === "unavailable";
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menu]);
  if (immersive)
    return (
      <ImmersiveFeedCard
        item={item}
        actions={actions}
        active={active}
        allowPlayer={allowPlayer}
        onActivate={onActivate}
        onClose={onClose}
        autoPlay={autoPlay}
      />
    );
  return (
    <article
      aria-label={`${provider.name} post by ${item.authorName}`}
      data-feed-id={item.id}
      className={cn(
        "feed-card relative overflow-hidden rounded-2xl bg-surface shadow-[0_2px_12px_rgba(20,27,43,.04)]",
        immersive ? "immersive-card flex h-full min-h-0 flex-col" : "",
        compact && "explore-card mb-3 break-inside-avoid border",
      )}
    >
      <header
        className={cn(
          "flex shrink-0 items-center gap-3 p-4",
          compact && "!gap-2 !p-3",
        )}
      >
        {item.authorAvatarUrl ? (
          <FeedImage
            src={item.authorAvatarUrl}
            alt=""
            className="size-10 min-h-0 shrink-0 rounded-full object-cover"
          />
        ) : (
          <span
            aria-hidden
            className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-soft text-sm font-semibold text-accent-ink"
          >
            {item.authorName.slice(0, 2).toUpperCase()}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{item.authorName}</p>
          <p className="truncate text-xs text-ink-2">
            {item.authorHandle || provider.name}
            {item.publishedAt ? (
              <>
                <span aria-hidden> · </span>
                <time dateTime={item.publishedAt}>
                  {new Date(item.publishedAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </time>
              </>
            ) : (
              <span> · Date unavailable</span>
            )}
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full bg-studio-soft px-2.5 py-1 text-[11px] font-medium",
            compact && "hidden",
          )}
        >
          {provider.name}
          {item.provider === "facebook" && item.sourceType === "account"
            ? " · Your Page"
            : ""}
        </span>
        <div
          className="relative"
          ref={menuRef}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setMenu(false);
              e.stopPropagation();
            }
          }}
        >
          <Button
            variant="ghost"
            size="icon"
            className="min-h-11 min-w-11"
            aria-label={`More actions for ${item.authorName}'s post`}
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
          >
            <MoreHorizontal className="size-5" aria-hidden />
          </Button>
          {menu ? (
            <div
              className="absolute right-0 top-full z-20 w-60 rounded-xl border bg-surface p-1 shadow-xl"
              aria-label="Post actions"
            >
              <button
                disabled={busy}
                onClick={() => {
                  actions.copy(item);
                  setMenu(false);
                }}
                className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm hover:bg-surface-2"
              >
                <Link2 className="size-4" aria-hidden />
                Copy original link
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  actions.reduce(item);
                  setMenu(false);
                }}
                className="min-h-11 w-full rounded-lg px-3 text-left text-sm hover:bg-surface-2"
              >
                See fewer from this source
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  actions.hide(item);
                  setMenu(false);
                }}
                className="min-h-11 w-full rounded-lg px-3 text-left text-sm hover:bg-surface-2"
              >
                Hide from my feed
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  actions.hide(item, true);
                  setMenu(false);
                }}
                className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm hover:bg-surface-2"
              >
                <Flag className="size-4" aria-hidden />
                Report unavailable content
              </button>
            </div>
          ) : null}
        </div>
      </header>
      {item.sample ? (
        <span className="mx-4 mb-3 w-fit rounded bg-accent-soft px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-accent-ink">
          Sample content
        </span>
      ) : null}
      {unavailable ? (
        <div className="bg-surface-2 p-6 text-sm text-ink-2">
          This saved reference is unavailable or its metadata has expired. The
          original platform controls access.
        </div>
      ) : isVideo ? (
        <div className={immersive ? "min-h-0 flex-1" : ""}>
          <FeedPlayer
            item={item}
            active={active}
            allowed={allowPlayer}
            onActivate={onActivate}
            onClose={onClose}
            immersive={immersive}
            autoPlay={autoPlay}
          />
        </div>
      ) : item.images.length || item.thumbnailUrl ? (
        <div
          className={cn(
            "grid gap-1",
            item.images.length > 1 ? "grid-cols-2" : "grid-cols-1",
          )}
        >
          {(item.images.length ? item.images : [{ url: item.thumbnailUrl! }])
            .slice(0, 4)
            .map((image, index) => (
              <FeedImage
                key={`${image.url}:${index}`}
                src={image.url}
                alt={image.alt || `Image ${index + 1} from ${item.authorName}`}
                className="max-h-[520px] w-full bg-surface-2 object-contain"
              />
            ))}
        </div>
      ) : null}
      <div className={cn("shrink-0 px-4 pb-4", item.caption ? "pt-4" : "pt-1")}>
        {compact && (
          <p className="mb-2 truncate text-xs font-semibold">
            {item.authorName}
          </p>
        )}
        {item.caption ? (
          <>
            <p
              className={cn(
                "whitespace-pre-wrap break-words text-[14px] leading-relaxed text-ink-2",
                !expanded &&
                  (immersive || compact ? "line-clamp-2" : "line-clamp-6"),
              )}
            >
              {item.caption}
            </p>
            {item.caption.length > 240 ? (
              <button
                onClick={() => setExpanded(!expanded)}
                className="min-h-9 text-xs font-medium text-accent-ink"
              >
                {expanded ? "Show less" : "Read more"}
              </button>
            ) : null}
          </>
        ) : item.availability === "preview_only" ? (
          <p className="text-sm text-ink-2">
            Public link reference. Read this post on {provider.name}.
          </p>
        ) : null}
        <div
          className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-ink-2"
          aria-label="Available engagement information"
        >
          {item.likeCount !== null ? (
            <span className="inline-flex items-center gap-1">
              <Heart className="size-3.5" aria-hidden />
              {item.likeCount.toLocaleString()} likes
            </span>
          ) : null}
          {item.commentCount !== null ? (
            <span className="inline-flex items-center gap-1">
              <MessageCircle className="size-3.5" aria-hidden />
              {item.commentCount.toLocaleString()} comments
            </span>
          ) : null}
          {item.shareCount !== null ? (
            <span>{item.shareCount.toLocaleString()} shares</span>
          ) : null}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1 border-t pt-2">
          <Button
            variant={item.saved ? "soft" : "ghost"}
            className="min-h-11"
            onClick={() => actions.save(item)}
            disabled={busy}
            aria-pressed={!!item.saved}
          >
            <Bookmark
              className="size-4"
              fill={item.saved ? "currentColor" : "none"}
              aria-hidden
            />
            {item.saved ? "Saved" : "Save"}
          </Button>
          {item.availability !== "preview_only" || item.following ? (
            <Button
              variant="ghost"
              className="min-h-11"
              onClick={() => actions.follow(item)}
              disabled={busy}
              aria-pressed={!!item.following}
              aria-label={item.following ? "Following" : "Follow in Aria Hub"}
            >
              {item.following ? (
                <Check className="size-4" aria-hidden />
              ) : (
                <UserPlus className="size-4" aria-hidden />
              )}
              {item.following
                ? "Following"
                : compact
                  ? "Follow"
                  : "Follow in Aria Hub"}
            </Button>
          ) : null}
          {!item.sample ? (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="min-h-11 min-w-11"
                onClick={() => actions.share(item)}
                aria-label="Share original link"
              >
                <Share2 className="size-4" aria-hidden />
              </Button>
              <a
                href={item.originalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto inline-flex min-h-11 items-center gap-1.5 text-xs font-medium text-accent-ink"
              >
                Open original
                <ExternalLink className="size-3.5" aria-hidden />
              </a>
            </>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function ImmersiveFeedCard({
  item,
  actions,
  active,
  allowPlayer,
  onActivate,
  onClose,
  autoPlay,
}: {
  item: UniversalFeedItem;
  actions: FeedCardActions;
  active: boolean;
  allowPlayer: boolean;
  onActivate: () => void;
  onClose: () => void;
  autoPlay: boolean;
}) {
  const provider = PROVIDERS[item.provider];
  return (
    <article
      data-feed-id={item.id}
      aria-label={`${provider.name} video by ${item.authorName}`}
      className="immersive-card relative flex h-full min-h-0 overflow-hidden rounded-2xl bg-[#0b0f12] text-white"
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center gap-2 px-4 text-xs">
          <span
            className="size-2 rounded-full"
            style={{ backgroundColor: provider.color }}
          />
          <span className="font-semibold">{provider.name}</span>
          <span className="ml-auto text-white/60">
            {item.sample ? "Sample video" : "Official player"}
          </span>
        </div>
        <div className="relative min-h-0 flex-1">
          <FeedPlayer
            item={item}
            active={active}
            allowed={allowPlayer}
            onActivate={onActivate}
            onClose={onClose}
            immersive
            autoPlay={autoPlay}
          />
        </div>
        <div className="shrink-0 bg-linear-to-t from-black/80 to-transparent p-4">
          <p className="text-sm font-bold">
            {item.authorHandle || item.authorName}
          </p>
          <p className="mt-1 line-clamp-2 break-words text-sm leading-relaxed text-white/80">
            {item.caption}
          </p>
          {item.likeCount !== null && (
            <p className="mt-2 text-[11px] text-white/60">
              {item.likeCount.toLocaleString()} likes on {provider.name}
            </p>
          )}
        </div>
      </div>
      <div
        className="flex w-16 shrink-0 flex-col items-center justify-end gap-3 bg-black/15 px-1 pb-7"
        aria-label="Video actions"
      >
        {item.availability !== "preview_only" && (
          <button
            onClick={() => actions.follow(item)}
            aria-label={
              item.following ? "Unfollow in Aria Hub" : "Follow in Aria Hub"
            }
            aria-pressed={!!item.following}
            className="flex min-h-12 w-full flex-col items-center justify-center gap-1 text-[10px]"
          >
            <span className="grid size-10 place-items-center rounded-full border border-white/60 bg-white/10">
              {item.following ? (
                <Check className="size-5" />
              ) : (
                <UserPlus className="size-5" />
              )}
            </span>
            {item.following ? "Following" : "Follow"}
          </button>
        )}
        <button
          onClick={() => actions.save(item)}
          aria-pressed={!!item.saved}
          className="flex min-h-12 w-full flex-col items-center justify-center gap-1 text-[10px]"
        >
          <Bookmark
            className="size-7"
            fill={item.saved ? "currentColor" : "none"}
          />
          {item.saved ? "Saved" : "Save"}
        </button>
        <button
          onClick={() => actions.share(item)}
          className="flex min-h-12 w-full flex-col items-center justify-center gap-1 text-[10px]"
        >
          <Share2 className="size-7" />
          Share
        </button>
        {!item.sample && (
          <a
            href={item.originalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-12 w-full flex-col items-center justify-center gap-1 text-[10px]"
            aria-label={`Open original on ${provider.name}`}
          >
            <ExternalLink className="size-6 text-emerald-300" />
            Original
          </a>
        )}
      </div>
    </article>
  );
}
