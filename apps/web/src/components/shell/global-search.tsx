"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

export function GlobalSearch({ onOpenPalette }: { onOpenPalette: () => void }) {
  const router = useRouter(),
    [query, setQuery] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    const term = query.trim();
    if (term.length >= 2) router.push(`/search?${new URLSearchParams({ q: term })}`);
  }
  return (
    <form
      role="search"
      aria-label="Search all platforms"
      onSubmit={submit}
      className="ml-1 hidden h-11 min-w-0 max-w-md flex-1 items-center gap-2 rounded-xl bg-surface-2 px-3 focus-within:ring-2 focus-within:ring-accent/40 lg:flex"
    >
      <Search className="size-4 shrink-0 text-ink-3" aria-hidden />
      <label className="sr-only" htmlFor="global-search">
        Search people, posts and videos
      </label>
      <input
        id="global-search"
        type="search"
        autoComplete="off"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        minLength={2}
        maxLength={120}
        placeholder="Search people, posts, videos…"
        className="h-full min-w-0 flex-1 border-0 bg-transparent text-sm outline-none placeholder:text-ink-3"
      />
      <button
        type="button"
        onClick={onOpenPalette}
        aria-label="Open command palette"
        className="min-h-9 rounded-md border px-1.5 text-[10px] text-ink-3 hover:text-ink"
      >
        ⌘K
      </button>
    </form>
  );
}
