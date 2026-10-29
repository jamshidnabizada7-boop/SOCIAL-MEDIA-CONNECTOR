import type { ProviderId } from "@aria/shared-types";
import { assertSafeUrlShape } from "../net-guard.js";

export function safeFeedUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 4096) return;
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.username || u.password || u.port) return;
    assertSafeUrlShape(u);
    return u.href;
  } catch {
    return;
  }
}
export function canonicalFeedUrl(provider: ProviderId, input: string): string {
  const safe = safeFeedUrl(input);
  if (!safe)
    throw new Error(
      "Use a public HTTPS post URL without credentials or a custom port.",
    );
  const u = new URL(safe),
    host = u.hostname.toLowerCase().replace(/^www\./, ""),
    p = u.pathname;
  let valid = false;
  switch (provider) {
    case "youtube": {
      const id =
        host === "youtu.be"
          ? p.slice(1)
          : ["youtube.com", "m.youtube.com"].includes(host)
            ? u.searchParams.get("v") ||
              p.match(/^\/(?:shorts|embed)\/([\w-]{11})\/?$/)?.[1]
            : null;
      if (!id || !/^[\w-]{11}$/.test(id))
        throw new Error("Use a YouTube video, watch or Shorts URL.");
      return `https://www.youtube.com/watch?v=${id}`;
    }
    case "tiktok":
      valid =
        host === "tiktok.com" && /^\/@[\w.-]+\/video\/\d{10,30}\/?$/.test(p);
      break;
    case "instagram":
      valid =
        host === "instagram.com" && /^\/(?:p|reel|tv)\/[\w-]+\/?$/.test(p);
      break;
    case "bluesky":
      valid =
        host === "bsky.app" &&
        /^\/profile\/[^/]+\/post\/[a-zA-Z0-9]+\/?$/.test(p);
      break;
    case "threads":
      valid =
        ["threads.net", "threads.com"].includes(host) &&
        /^\/@[\w.]+\/post\/[\w-]+\/?$/.test(p);
      break;
    case "x":
      valid =
        ["x.com", "twitter.com"].includes(host) &&
        /^\/[\w]+\/status\/\d+\/?$/.test(p);
      break;
    case "pinterest":
      valid = host === "pinterest.com" && /^\/pin\/\d+\/?$/.test(p);
      break;
    case "linkedin":
      valid =
        host === "linkedin.com" &&
        /^\/(?:posts\/.+|feed\/update\/urn:li:[\w:]+)\/?$/.test(p);
      break;
    case "facebook":
      valid =
        ["facebook.com", "m.facebook.com"].includes(host) &&
        (/\/(?:posts|videos)\/[\w]+/.test(p) ||
          /^\/reel\/\d+\/?$/.test(p) ||
          (p === "/watch/" && /^\d+$/.test(u.searchParams.get("v") || "")) ||
          /^\/(?:permalink|story)\.php$/.test(p));
      break;
    case "mastodon":
      valid = /^\/(?:@[^/]+\/\d+|users\/[^/]+\/statuses\/\d+)\/?$/.test(p);
      break;
  }
  if (!valid)
    throw new Error(
      "This is not a supported post URL for the selected platform.",
    );
  u.hash = "";
  if (provider !== "facebook") u.search = "";
  else
    for (const key of [...u.searchParams.keys()])
      if (!["id", "story_fbid", "v"].includes(key)) u.searchParams.delete(key);
  return u.href;
}
