import type { ProviderId } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Provider glyphs, drawn as simple geometric marks so they render everywhere
 * without external assets. They are recognizable stand-ins, not pixel-perfect
 * brand reproductions.
 */
export function ProviderIcon({ id, className }: { id: ProviderId; className?: string }) {
  const cls = cn("shrink-0", className);
  switch (id) {
    case "facebook":
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={cls} aria-hidden>
          <path d="M13.4 21v-8.1h2.72l.41-3.16H13.4V7.72c0-.91.25-1.53 1.56-1.53h1.67V3.36c-.29-.04-1.28-.12-2.43-.12-2.4 0-4.05 1.46-4.05 4.16v2.34H7.42v3.16h2.73V21h3.25z" />
        </svg>
      );
    case "instagram":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={cls} aria-hidden>
          <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
          <circle cx="12" cy="12" r="3.6" />
          <circle cx="17" cy="7" r="1.15" fill="currentColor" stroke="none" />
        </svg>
      );
    case "threads":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={cls} aria-hidden>
          <circle cx="12" cy="12" r="3.4" />
          <path d="M15.4 12.2v1.6a2.7 2.7 0 0 0 5.4-.1v-1.7a8.8 8.8 0 1 0-3.6 7" />
        </svg>
      );
    case "linkedin":
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={cls} aria-hidden>
          <path d="M4.98 3.5a2.5 2.5 0 1 1-.02 5 2.5 2.5 0 0 1 .02-5zM3 9h4v12H3zM9.5 9h3.8v1.7h.06c.53-1 1.83-2.05 3.77-2.05 4.03 0 4.77 2.65 4.77 6.1V21h-4v-5.5c0-1.31-.02-3-1.83-3-1.83 0-2.11 1.43-2.11 2.9V21h-4z" />
        </svg>
      );
    case "tiktok":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className={cls} aria-hidden>
          <path d="M14.5 4v9.3a4.2 4.2 0 1 1-3.1-4.06" />
          <path d="M14.5 5.2c.6 2.6 2.4 4.1 5 4.4" />
        </svg>
      );
    case "youtube":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={cls} aria-hidden>
          <rect x="2.5" y="5.5" width="19" height="13" rx="4" stroke="currentColor" strokeWidth="2" />
          <path d="M10.4 9.4l4.8 2.6-4.8 2.6z" fill="currentColor" />
        </svg>
      );
    case "x":
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={cls} aria-hidden>
          <path d="M17.2 3h2.9l-6.4 7.3L21.2 21h-5.9l-4.6-6-5.3 6H2.5l6.9-7.8L2.8 3h6l4.1 5.5L17.2 3zm-1 16.2h1.6L7.7 4.7H6z" />
        </svg>
      );
    case "pinterest":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={cls} aria-hidden>
          <path d="M8.5 21.5 11 9.5" />
          <path d="M8.2 12.8a5.6 5.6 0 1 1 8.8 1.4c-1.9 1.9-4.6 1.5-5.5-.3" />
        </svg>
      );
    case "bluesky":
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={cls} aria-hidden>
          <path d="M12 10.6C10.7 8 7.2 4.6 4.4 4.6c-1.3 0-1.9.8-1.9 2.2 0 3.6 1.7 6.8 4.9 7.6-1.8.4-2.9 1.2-2.9 2.4 0 1.9 3.1 2.8 4.9 1L12 15.4l2.6 2.4c1.8 1.8 4.9.9 4.9-1 0-1.2-1.1-2-2.9-2.4 3.2-.8 4.9-4 4.9-7.6 0-1.4-.6-2.2-1.9-2.2-2.8 0-6.3 3.4-7.6 6z" />
        </svg>
      );
    case "mastodon":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className={cls} aria-hidden>
          <path d="M4.5 19v-8.2a7.5 7.5 0 0 1 15 0V17" />
          <path d="M8.5 19v-6.2a3.5 3.5 0 0 1 7 0V19" />
        </svg>
      );
  }
}
