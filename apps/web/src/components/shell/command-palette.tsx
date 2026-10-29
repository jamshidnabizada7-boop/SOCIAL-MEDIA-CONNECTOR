"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  CalendarDays,
  FolderOpen,
  PenSquare,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { postsService } from "@/lib/services/posts";
import { accountsService } from "@/lib/services/accounts";

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: React.ReactNode;
  keywords?: string;
  run: (router: ReturnType<typeof useRouter>) => void;
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [posts, setPosts] = useState<{ id: string; title: string }[]>([]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setIndex(0);
      setPosts(postsService.list().slice(0, 8).map((p) => ({ id: p.id, title: p.title })));
    }
  }, [open]);

  const commands: Command[] = useMemo(() => {
    const nav = (href: string, label: string, icon: React.ReactNode, keywords?: string): Command => ({
      id: href,
      label,
      icon,
      keywords,
      run: (r) => r.push(href),
    });
    return [
      {
        id: "create",
        label: "Create post",
        hint: "Composer",
        icon: <PenSquare className="size-4" />,
        keywords: "new publish compose write",
        run: (r) => r.push("/composer"),
      },
      {
        id: "connect",
        label: "Connect a social account",
        icon: <ShieldCheck className="size-4" />,
        keywords: "oauth facebook instagram tiktok youtube linkedin",
        run: (r) => r.push("/accounts?connect=1"),
      },
      nav("/feed", "Go to Home Feed", <ArrowRight className="size-4" />, "social discovery perspectives"),
      nav("/explore", "Go to Explore", <Search className="size-4" />, "creators discover"),
      nav("/dashboard", "Go to Creator Studio", <ArrowRight className="size-4" />, "overview publishing"),
      nav("/calendar", "Go to Calendar", <CalendarDays className="size-4" />, "schedule month"),
      nav("/posts", "Go to Posts", <FolderOpen className="size-4" />, "history drafts"),
      nav("/analytics", "Go to Analytics", <ArrowRight className="size-4" />, "stats metrics"),
      nav("/team", "Go to Team", <UserRound className="size-4" />, "members invite roles"),
      nav("/admin", "Go to Admin", <ShieldCheck className="size-4" />, "internal providers jobs"),
    ];
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const cmds = commands.filter(
      (c) => !q || c.label.toLowerCase().includes(q) || c.keywords?.includes(q)
    );
    const postHits = posts
      .filter((p) => q && p.title.toLowerCase().includes(q))
      .slice(0, 4)
      .map<Command>((p) => ({
        id: p.id,
        label: p.title,
        hint: "Post",
        icon: <Sparkles className="size-4" />,
        run: (r) => r.push(`/posts/${p.id}`),
      }));
    return [...cmds, ...postHits];
  }, [commands, posts, query]);

  const runAt = useCallback(
    (i: number) => {
      const cmd = results[i];
      if (!cmd) return;
      onClose();
      cmd.run(router);
    },
    [results, router, onClose]
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setIndex((i) => Math.min(results.length - 1, i + 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setIndex((i) => Math.max(0, i - 1));
      }
      if (e.key === "Enter") {
        e.preventDefault();
        runAt(index);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, results, index, runAt, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[95] flex items-start justify-center px-4 pt-[12vh]">
      <div className="absolute inset-0 bg-ink/45 backdrop-blur-[2px] dark:bg-black/60" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="pop-in relative w-full max-w-xl overflow-hidden rounded-2xl border bg-surface shadow-pop"
      >
        <div className="flex items-center gap-3 border-b px-4">
          <Search className="size-4 text-ink-3" aria-hidden />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            placeholder="Search posts or jump to a page…"
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-3"
          />
          <kbd className="rounded-md border bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-ink-3">ESC</kbd>
        </div>
        <div className="max-h-[46vh] overflow-y-auto p-2">
          {results.length === 0 && (
            <p className="px-3 py-8 text-center text-sm text-ink-3">Nothing matches “{query}”.</p>
          )}
          {results.map((c, i) => (
            <button
              key={c.id}
              onMouseEnter={() => setIndex(i)}
              onClick={() => runAt(i)}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm",
                i === index ? "bg-accent-soft text-accent-ink" : "text-ink"
              )}
            >
              <span className={cn(i === index ? "text-accent-ink" : "text-ink-3")}>{c.icon}</span>
              <span className="flex-1 font-medium">{c.label}</span>
              {c.hint && <span className="text-xs text-ink-3">{c.hint}</span>}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 border-t bg-surface-2 px-4 py-2 text-[11px] text-ink-3">
          <span className="inline-flex items-center gap-1"><Plus className="size-3" /> Create</span>
          <span className="inline-flex items-center gap-1"><ArrowRight className="size-3" /> Navigate</span>
          <span className="ml-auto">↑↓ to move · ↵ to open</span>
        </div>
      </div>
    </div>
  );
}
