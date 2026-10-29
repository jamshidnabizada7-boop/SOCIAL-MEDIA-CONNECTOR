"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Maximize, Rows3 } from "lucide-react";
import type { UniversalFeedItem } from "@aria/shared-types";
import { Button } from "@/components/ui/button";
import { FeedCard, type FeedCardActions } from "./feed-card";
import { cn } from "@/lib/utils";

export function VideoFeed({
  items,
  actions,
  allowEmbeds,
  explicitPlayer,
  onActivate,
  onClose,
  loadMore,
  hasMore,
  busy,
  exit,
  fullBleed = false,
}: {
  items: UniversalFeedItem[];
  actions: FeedCardActions;
  allowEmbeds: boolean;
  explicitPlayer: string | null;
  onActivate: (id: string) => void;
  onClose: () => void;
  loadMore: () => void;
  hasMore: boolean;
  busy: boolean;
  exit: () => void;
  fullBleed?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null),
    nodes = useRef(new Map<string, HTMLDivElement>()),
    [activeId, setActiveId] = useState<string | null>(null);
  const index = Math.max(
      0,
      items.findIndex((i) => i.id === activeId),
    ),
    active = items[index]?.id;
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.intersectionRatio >= 0.6)
            setActiveId((entry.target as HTMLElement).dataset.videoId || null);
      },
      { root: root.current, threshold: [0.6] },
    );
    for (const node of nodes.current.values()) observer.observe(node);
    return () => observer.disconnect();
  }, [items]);
  useEffect(() => {
    if (hasMore && !busy && items.length > 0 && index >= items.length - 2)
      loadMore();
  }, [index, items.length, hasMore, busy, loadMore]);
  function move(direction: number) {
    const next = items[index + direction];
    if (next) {
      nodes.current.get(next.id)?.scrollIntoView({
        block: "nearest",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
    } else if (direction > 0 && hasMore && !busy) loadMore();
  }
  return (
    <section
      className="video-experience min-w-0"
      aria-label="Immersive video browsing"
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <p className={cn("mr-auto text-xs text-ink-2", fullBleed && "sr-only")}>
          Swipe or scroll · ↑ / ↓ to browse · Native player controls
        </p>
        <Button
          variant="secondary"
          size="icon"
          className="min-h-11 min-w-11"
          aria-label="Previous video"
          disabled={!index}
          onClick={() => move(-1)}
        >
          <ArrowUp className="size-4" aria-hidden />
        </Button>
        <Button
          variant="secondary"
          size="icon"
          className="min-h-11 min-w-11"
          aria-label="Next video"
          disabled={!hasMore && index >= items.length - 1}
          onClick={() => move(1)}
        >
          <ArrowDown className="size-4" aria-hidden />
        </Button>
        <Button
          variant="secondary"
          size="icon"
          className="min-h-11 min-w-11"
          aria-label="Full screen video feed"
          onClick={() => {
            void root.current
              ?.requestFullscreen?.()
              .catch(() => root.current?.focus());
          }}
        >
          <Maximize className="size-4" aria-hidden />
        </Button>
        <Button variant="ghost" className="min-h-11" onClick={exit}>
          <Rows3 className="size-4" aria-hidden />
          Cards
        </Button>
      </div>
      <div
        ref={root}
        role="region"
        tabIndex={0}
        aria-label="Video feed"
        className={cn("mx-auto max-w-[650px] snap-y snap-mandatory overflow-y-auto overscroll-contain bg-[#0b0f12] p-1 focus-visible:outline-2 focus-visible:outline-accent", fullBleed ? "h-[calc(100dvh-128px-env(safe-area-inset-bottom,0px))] min-h-64" : "h-[calc(100dvh-230px)] min-h-[480px] max-h-[1000px] rounded-2xl")}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            move(e.key === "ArrowDown" ? 1 : -1);
          }
        }}
      >
        {items.map((item) => (
          <div
            key={item.id}
            data-video-id={item.id}
            ref={(el) => {
              if (el) nodes.current.set(item.id, el);
              else nodes.current.delete(item.id);
            }}
            className="h-full snap-start snap-always"
          >
            <FeedCard
              item={item}
              actions={actions}
              active={active === item.id}
              allowPlayer={allowEmbeds || explicitPlayer === item.id}
              onActivate={() => {
                setActiveId(item.id);
                onActivate(item.id);
              }}
              onClose={onClose}
              immersive
            />
          </div>
        ))}
      </div>
      <p className={cn("mt-2 text-center text-xs text-ink-2", fullBleed && "sr-only")}>
        {items.length
          ? `${index + 1} of ${items.length} loaded`
          : "No videos yet"}
        {busy ? " · Loading more…" : ""}
      </p>
    </section>
  );
}
