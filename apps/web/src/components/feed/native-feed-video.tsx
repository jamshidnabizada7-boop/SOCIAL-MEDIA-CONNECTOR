"use client";
import { useEffect, useRef, useState } from "react";
import type Hls from "hls.js";
import { Play } from "lucide-react";
import { cn } from "@/lib/utils";

/** Only mounted for the visible, selected video; no server proxy or downloaded originals. */
export function NativeFeedVideo({
  provider,
  url,
  poster,
  author,
  playing,
  onActivate,
  immersive = false,
}: {
  provider: "bluesky" | "facebook";
  url: string;
  poster?: string;
  author: string;
  playing: boolean;
  onActivate: () => void;
  immersive?: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null),
    hls = useRef<Hls | null>(null);
  const [blocked, setBlocked] = useState(false),
    [failed, setFailed] = useState(false);
  const wantPlay = useRef(false);
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    let current = true;
    async function setup() {
      if (
        provider === "facebook" ||
        el!.canPlayType("application/vnd.apple.mpegurl")
      ) {
        el!.src = url;
        return;
      }
      const { default: Hls } = await import("hls.js");
      if (!current) return;
      if (!Hls.isSupported()) {
        setFailed(true);
        return;
      }
      const engine = new Hls({
        enableWorker: false,
        autoStartLoad: false,
        capLevelToPlayerSize: true,
        maxBufferLength: 10,
        maxMaxBufferLength: 20,
        backBufferLength: 5,
        xhrSetup(xhr, requestUrl) {
          if (new URL(requestUrl).origin !== "https://video.bsky.app")
            throw Error("Unexpected video origin");
          xhr.withCredentials = false;
        },
      });
      hls.current = engine;
      engine.on(Hls.Events.ERROR, (_event, data) => {
        if (current && data.fatal) {
          engine.stopLoad();
          setFailed(true);
        }
      });
      engine.on(Hls.Events.MANIFEST_PARSED, () => {
        if (wantPlay.current) {
          engine.startLoad();
          void el!.play().catch(() => {
            if (current) setBlocked(true);
          });
        }
      });
      engine.loadSource(url);
      engine.attachMedia(el!);
      if (wantPlay.current) engine.startLoad();
    }
    void setup().catch(() => {
      if (current) setFailed(true);
    });
    return () => {
      current = false;
      wantPlay.current = false;
      el.pause();
      hls.current?.destroy();
      hls.current = null;
      el.removeAttribute("src");
      el.load();
    };
  }, [url, provider]);
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    const update = () => {
      wantPlay.current = playing && document.visibilityState === "visible";
      if (wantPlay.current) {
        hls.current?.startLoad();
        if (el.src) void el.play().catch(() => setBlocked(true));
      } else {
        el.pause();
        hls.current?.stopLoad();
      }
    };
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, [playing]);
  return (
    <div
      className={cn(
        "relative w-full bg-black",
        immersive && "flex h-full min-h-0 items-center justify-center",
      )}
    >
      <video
        ref={video}
        aria-label={`${provider === "facebook" ? "Facebook" : "Bluesky"} video by ${author}`}
        data-aria-video={provider}
        poster={poster}
        muted
        playsInline
        controls
        loop
        preload="none"
        crossOrigin={provider === "bluesky" ? "anonymous" : undefined}
        className={cn(
          "w-full object-contain",
          immersive ? "h-full min-h-0" : "max-h-[70dvh] min-h-64",
        )}
        onPlay={() => {
          onActivate();
          setBlocked(false);
        }}
        onError={() => setFailed(true)}
      />
      {blocked && !failed && (
        <button
          className="absolute bottom-14 left-1/2 flex min-h-11 -translate-x-1/2 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-black"
          onClick={() => {
            const el = video.current;
            if (!el) return;
            onActivate();
            hls.current?.startLoad();
            void el
              .play()
              .then(() => setBlocked(false))
              .catch(() => setBlocked(true));
          }}
        >
          <Play className="size-4" />
          Play video
        </button>
      )}
      {failed && (
        <p
          role="status"
          className="absolute inset-x-0 bottom-0 bg-black/80 px-4 py-3 text-center text-sm text-white"
        >
          This video could not play. Open the original post below.
        </p>
      )}
    </div>
  );
}
