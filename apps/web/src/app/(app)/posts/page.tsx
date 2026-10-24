"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Copy, MoreHorizontal, Plus, Search, Send, Trash2, XCircle } from "lucide-react";
import type { Post } from "@/lib/types";
import { postsService } from "@/lib/services/posts";
import { useSubscribe } from "@/lib/services/hooks";
import { useSession, useToast } from "@/components/providers";
import { PageHeader, PageBody } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Avatar, Card, EmptyState, Input, Segmented, Select, Skeleton } from "@/components/ui/primitives";
import { DropdownMenu } from "@/components/ui/dialog";
import { MediaDot } from "@/components/ui/media-thumb";
import { PostStatePill, ProviderStack } from "@/components/ui/status";
import { mediaService } from "@/lib/services/media";
import { cn, formatDate, formatTime, timeAgo, timeUntil } from "@/lib/utils";

type Tab = "all" | "drafts" | "scheduled" | "publishing" | "published" | "attention";

const TAB_META: { id: Tab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "drafts", label: "Drafts" },
  { id: "scheduled", label: "Scheduled" },
  { id: "publishing", label: "Publishing" },
  { id: "published", label: "Published" },
  { id: "attention", label: "Needs attention" },
];

function matchesTab(p: Post, tab: Tab): boolean {
  switch (tab) {
    case "all":
      return true;
    case "drafts":
      return p.state === "draft" || p.state === "ready";
    case "scheduled":
      return p.state === "scheduled" || p.state === "queued";
    case "publishing":
      return p.state === "processing";
    case "published":
      return p.state === "published";
    case "attention":
      return p.state === "partially_published" || p.state === "failed";
  }
}

function PostsInner() {
  useSubscribe(postsService);
  const router = useRouter();
  const params = useSearchParams();
  const { session } = useSession();
  const toast = useToast();
  const [loaded, setLoaded] = useState(false);
  const [posts, setPosts] = useState<Post[]>([]);
  const [tab, setTab] = useState<Tab>((params.get("tab") as Tab) || "all");
  const [query, setQuery] = useState("");
  const [brandFilter, setBrandFilter] = useState("all");

  useEffect(() => {
    const read = () => {
      setPosts(postsService.list());
      setLoaded(true);
    };
    postsService.listAsync().then(read);
    return postsService.subscribe(read);
  }, []);

  const counts = useMemo(() => {
    const c = Object.fromEntries(TAB_META.map((t) => [t.id, 0])) as Record<Tab, number>;
    for (const p of posts) for (const t of TAB_META) if (matchesTab(p, t.id)) c[t.id] += 1;
    return c;
  }, [posts]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return posts
      .filter((p) => matchesTab(p, tab))
      .filter((p) => brandFilter === "all" || p.brandId === brandFilter)
      .filter(
        (p) =>
          !q ||
          p.title.toLowerCase().includes(q) ||
          p.caption.toLowerCase().includes(q) ||
          (p.campaign ?? "").toLowerCase().includes(q)
      )
      .sort((a, b) => {
        const ta = a.scheduledAt ?? a.publishedAt ?? a.updatedAt;
        const tb = b.scheduledAt ?? b.publishedAt ?? b.updatedAt;
        return +new Date(tb) - +new Date(ta);
      });
  }, [posts, tab, query, brandFilter]);

  const timeLabel = (p: Post) => {
    if (p.state === "scheduled" && p.scheduledAt) return timeUntil(p.scheduledAt);
    if (p.publishedAt) return timeAgo(p.publishedAt);
    return `edited ${timeAgo(p.updatedAt)}`;
  };

  if (!loaded) {
    return (
      <div>
        <PageHeader title="Posts" />
        <PageBody className="space-y-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </PageBody>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Posts"
        description="Every post with its per-network delivery state. Nothing is hidden behind a single 'published' flag."
        actions={
          <Link href="/composer">
            <Button>
              <Plus className="size-4" /> Create post
            </Button>
          </Link>
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-56 flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by title, caption or campaign…"
              className="pl-9"
              aria-label="Search posts"
            />
          </div>
          <Select value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)} className="w-44 text-[13px]" aria-label="Filter by brand">
            <option value="all">All brands</option>
            {(session?.workspace.brands ?? []).map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </Select>
        </div>
        <div className="mt-3 -mb-px">
          <div role="tablist" className="flex gap-1 overflow-x-auto">
            {TAB_META.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "relative flex shrink-0 items-center gap-1.5 px-3 pb-2.5 pt-1.5 text-sm font-medium transition-colors",
                  "after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full",
                  tab === t.id ? "text-ink after:bg-accent" : "text-ink-2 hover:text-ink"
                )}
              >
                {t.label}
                <span className={cn("tnum rounded-full px-1.5 py-0.5 text-[11px]", tab === t.id ? "bg-accent-soft text-accent-ink" : "bg-surface-2 text-ink-3")}>
                  {counts[t.id]}
                </span>
              </button>
            ))}
          </div>
        </div>
      </PageHeader>

      <PageBody>
        <Card>
          {visible.length === 0 ? (
            <EmptyState
              icon={<Search className="size-5" />}
              title={query ? `No posts match “${query}”` : "Nothing here yet"}
              body={
                query
                  ? "Try a different search or clear the filters."
                  : tab === "attention"
                    ? "No failed destinations — enjoy the quiet."
                    : "Create a post and it will show up here with full delivery status."
              }
              action={query ? <Button variant="secondary" onClick={() => setQuery("")}>Clear search</Button> : <Link href="/composer"><Button>Create a post</Button></Link>}
            />
          ) : (
            <ul className="divide-y">
              {visible.map((p) => {
                const thumb = p.mediaIds[0] ? mediaService.get(p.mediaIds[0]) : undefined;
                const author = p.authorId;
                const failedCount = p.targets.filter((t) => t.state === "failed" || t.state === "token_expired").length;
                return (
                  <li key={p.id} className="group relative">
                    <Link
                      href={`/posts/${p.id}`}
                      className="flex items-center gap-3.5 px-4 py-3.5 transition-colors hover:bg-surface-2 sm:px-5"
                    >
                      {thumb ? (
                        <MediaDot asset={thumb} className="size-11 rounded-lg" />
                      ) : (
                        <span className="flex size-11 shrink-0 items-center justify-center rounded-lg border bg-surface-2 text-[11px] font-bold text-ink-3">Aa</span>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-semibold">{p.title}</p>
                          {p.campaign && (
                            <span className="hidden shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-ink-2 sm:inline">
                              {p.campaign}
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 truncate text-[13px] text-ink-3">{p.caption.replace(/\n/g, " ")}</p>
                        <div className="mt-1.5 flex items-center gap-2.5">
                          <ProviderStack providers={p.targets.map((t) => t.provider)} />
                          <span className="text-[12px] text-ink-3">{p.targets.length} {p.targets.length === 1 ? "destination" : "destinations"}</span>
                          {failedCount > 0 && (
                            <span className="inline-flex items-center gap-1 text-[12px] font-medium text-danger">
                              <XCircle className="size-3.5" /> {failedCount} failed
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="hidden w-32 shrink-0 flex-col items-end gap-1 sm:flex">
                        <PostStatePill state={p.state} />
                        <span className="tnum text-[12px] text-ink-3">
                          {p.state === "draft" ? "" : p.scheduledAt || p.publishedAt ? `${formatDate(p.scheduledAt ?? p.publishedAt!)} ${formatTime(p.scheduledAt ?? p.publishedAt!)}` : ""}
                        </span>
                        <span className="text-[11px] text-ink-3">{timeLabel(p)}</span>
                      </div>
                      <div className="flex shrink-0 items-center gap-1 sm:hidden">
                        <PostStatePill state={p.state} />
                      </div>
                      <div className="hidden lg:block">
                        <Avatar name={author === "usr_maya" ? "Maya Chen" : author === "usr_ines" ? "Inés Rojas" : author === "usr_devon" ? "Devon Park" : "Tomás Weber"} hue={200} size="sm" />
                      </div>
                    </Link>
                    <div className="absolute right-3 top-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                      <DropdownMenu
                        items={[
                          { label: "Open post", icon: <MoreHorizontal className="size-4" />, onSelect: () => router.push(`/posts/${p.id}`) },
                          {
                            label: "Duplicate",
                            icon: <Copy className="size-4" />,
                            onSelect: async () => {
                              await postsService.duplicate(p.id);
                              toast({ title: "Post duplicated as a draft", variant: "success" });
                            },
                          },
                          ...(p.state === "scheduled"
                            ? [
                                {
                                  label: "Cancel schedule",
                                  icon: <XCircle className="size-4" />,
                                  danger: true,
                                  onSelect: async () => {
                                    await postsService.cancelScheduled(p.id);
                                    toast({ title: "Schedule canceled", variant: "info" });
                                  },
                                },
                              ]
                            : []),
                          ...(p.state === "draft"
                            ? [
                                {
                                  separatorBefore: true,
                                  label: "Delete draft",
                                  icon: <Trash2 className="size-4" />,
                                  danger: true,
                                  onSelect: async () => {
                                    await postsService.deletePost(p.id);
                                    toast({ title: "Draft deleted", variant: "info" });
                                  },
                                },
                              ]
                            : []),
                        ]}
                        trigger={({ toggle }) => (
                          <button onClick={toggle} aria-label="Post actions" className="rounded-lg p-2 text-ink-3 hover:bg-surface-2 hover:text-ink">
                            <MoreHorizontal className="size-4" />
                          </button>
                        )}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <p className="mt-3 flex items-center gap-1.5 text-[12px] text-ink-3">
          <Send className="size-3.5" />
          Retries are idempotent — a destination is never published twice.
        </p>
      </PageBody>
    </div>
  );
}

export default function PostsPage() {
  return (
    <Suspense fallback={
      <div>
        <PageHeader title="Posts" />
        <PageBody className="space-y-3">
          <Skeleton className="h-20 rounded-xl" />
          <Skeleton className="h-20 rounded-xl" />
        </PageBody>
      </div>
    }>
      <PostsInner />
    </Suspense>
  );
}
