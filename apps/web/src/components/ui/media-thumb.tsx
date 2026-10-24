"use client";

import type { MediaAsset } from "@/lib/types";
import { cn, formatDuration, hueGradient } from "@/lib/utils";
import { FileText, ImageIcon, Video } from "lucide-react";
import { useState } from "react";
import { API_URL, DATA_MODE } from "@/lib/api/client";

/** Deterministic gradient placeholder standing in for object-storage media. */
export function MediaThumb({
  asset,
  className,
  showKind = true,
  showDuration = true,
  rounded = "rounded-lg",
}: {
  asset: MediaAsset;
  className?: string;
  showKind?: boolean;
  showDuration?: boolean;
  rounded?: string;
}) {
  const [err, setErr] = useState(false);
  const realSrc =
    DATA_MODE === "api" && asset.url ? `${API_URL}${asset.url}` : null;
  const kindIcon =
    asset.kind === "video" ? (
      <Video className="size-5 text-white/85" aria-hidden />
    ) : asset.kind === "document" ? (
      <FileText className="size-5 text-white/85" aria-hidden />
    ) : (
      <ImageIcon className="size-5 text-white/85" aria-hidden />
    );

  return (
    <div
      className={cn("relative overflow-hidden border border-black/5 dark:border-white/10", rounded, className)}
      style={{ background: hueGradient(asset.hue, asset.kind) }}
    >
      <div
        aria-hidden
        className="absolute inset-0 opacity-40"
        style={{
          background: `radial-gradient(120% 90% at 20% 10%, hsl(${(asset.hue + 200) % 360} 60% 90% / 0.35), transparent 55%)`,
        }}
      />
      {realSrc && !err && (
        <img
          src={realSrc}
          alt={asset.altText ?? ""}
          className="absolute inset-0 size-full object-cover"
          onError={() => setErr(true)}
          loading="lazy"
        />
      )}
      <div aria-hidden className="absolute inset-0 flex items-center justify-center">
        {(asset.kind === "document" && !realSrc) || err ? (
          <FileText className="size-6 text-white/70" />
        ) : realSrc ? null : (
          <div className="flex flex-col items-center gap-1 text-white/80">
            <span className="font-display text-xl font-bold tracking-tight drop-shadow-sm">
              {asset.filename.slice(0, 2).toUpperCase()}
            </span>
          </div>
        )}
      </div>
      {showKind && (
        <span className="absolute left-1.5 top-1.5 rounded-md bg-black/35 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white backdrop-blur-sm">
          {asset.kind}
        </span>
      )}
      {showDuration && asset.durationSec !== undefined && (
        <span className="tnum absolute bottom-1.5 right-1.5 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold text-white">
          {formatDuration(asset.durationSec)}
        </span>
      )}
    </div>
  );
}

/** Small square thumb used in lists and calendar chips. */
export function MediaDot({ asset, className }: { asset: MediaAsset; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-8 shrink-0 rounded-md border border-black/5 dark:border-white/10", className)}
      style={{ background: hueGradient(asset.hue, asset.kind) }}
    />
  );
}
