"use client";
/* eslint-disable @next/next/no-img-element -- Provider photos load directly without rehosting. */
import { useState } from "react";
import { cn } from "@/lib/utils";

export function FeedAvatar({
  name,
  src,
  className,
}: {
  name: string;
  src?: string;
  className?: string;
}) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const initials =
    name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => Array.from(part)[0])
      .join("")
      .toLocaleUpperCase() || "?";
  return (
    <span
      aria-hidden
      className={cn(
        "relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-full bg-accent-soft text-sm font-semibold text-accent-ink",
        className,
      )}
    >
      {initials}
      {src && failedSource !== src && (
        <img
          data-author-avatar
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="absolute inset-0 size-full object-cover"
          onError={() => setFailedSource(src)}
        />
      )}
    </span>
  );
}
