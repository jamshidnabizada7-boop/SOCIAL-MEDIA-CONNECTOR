"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Inbox, Plus } from "lucide-react";
import type { Post, ProviderId } from "@/lib/types";
import { postsService } from "@/lib/services/posts";
import { useSubscribe } from "@/lib/services/hooks";
import { useSession, useToast } from "@/components/providers";
import { PageHeader, PageBody } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, Segmented, Select, Skeleton } from "@/components/ui/primitives";
import { Drawer } from "@/components/ui/dialog";
import { MediaThumb } from "@/components/ui/media-thumb";
import { PostStatePill, ProviderStack, TargetStatePill } from "@/components/ui/status";
import { mediaService } from "@/lib/services/media";
import { PROVIDERS } from "@/lib/providers";
import { cn, formatTime, isoDay } from "@/lib/utils";

type View = "month" | "week" | "day" | "agenda";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function startOfWeek(d: Date): Date {
  const date = new Date(d);
  const day = (date.getDay() + 6) % 7; // Monday-first
  date.setDate(date.getDate() - day);
  date.setHours(0, 0, 0, 0);
  return date;
}

export default function CalendarPage() {
  useSubscribe(postsService);
  const { session } = useSession();
  const toast = useToast();
  const [loaded, setLoaded] = useState(false);
  const [posts, setPosts] = useState<Post[]>([]);
  const [view, setView] = useState<View>("month");
  const [cursor, setCursor] = useState(() => new Date());
  const [brandFilter, setBrandFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("scheduled");
  const [dragPost, setDragPost] = useState<Post | null>(null);
  const [selected, setSelected] = useState<Post | null>(null);

  useEffect(() => {
    const read = () => setPosts(postsService.list());
    postsService
      .listAsync()
      .then(read)
      .finally(() => setLoaded(true));
    return postsService.subscribe(read);
  }, []);

  const schedulable = useMemo(
    () => posts.filter((p) => p.scheduledAt && (p.state === "scheduled" || p.state === "processing")),
    [posts]
  );
  const drafts = useMemo(() => posts.filter((p) => p.state === "draft"), [posts]);

  const filtered = useMemo(
    () =>
      schedulable.filter((p) => {
        if (brandFilter !== "all" && p.brandId !== brandFilter) return false;
        if (statusFilter !== "all" && statusFilter === "scheduled" && p.state !== "scheduled") return false;
        if (statusFilter === "all") return true;
        return statusFilter === "processing" ? p.state === "processing" : true;
      }),
    [schedulable, brandFilter, statusFilter]
  );

  const byDay = useMemo(() => {
    const map = new Map<string, Post[]>();
    for (const p of filtered) {
      const key = isoDay(new Date(p.scheduledAt!));
      map.set(key, [...(map.get(key) ?? []), p]);
    }
    for (const list of map.values()) {
      list.sort((a, b) => +new Date(a.scheduledAt!) - +new Date(b.scheduledAt!));
    }
    return map;
  }, [filtered]);

  const dropOn = (date: Date) => {
    if (!dragPost) return;
    const prev = new Date(dragPost.scheduledAt!);
    const next = new Date(date);
    next.setHours(prev.getHours(), prev.getMinutes(), 0, 0);
    void postsService.schedule(dragPost.id, next.toISOString());
    toast({
      title: "Rescheduled",
      description: `“${dragPost.title}” moved to ${next.toLocaleString()}.`,
      variant: "success",
    });
    setDragPost(null);
  };

  const shift = (dir: 1 | -1) => {
    const d = new Date(cursor);
    if (view === "month") d.setMonth(d.getMonth() + dir);
    else if (view === "week") d.setDate(d.getDate() + 7 * dir);
    else d.setDate(d.getDate() + dir);
    setCursor(d);
  };

  const monthCells = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const start = startOfWeek(first);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [cursor]);

  const weekDays = useMemo(() => {
    const start = startOfWeek(cursor);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [cursor]);

  const agenda = useMemo(
    () =>
      [...filtered]
        .sort((a, b) => +new Date(a.scheduledAt!) - +new Date(b.scheduledAt!))
        .filter((p) => +new Date(p.scheduledAt!) >= Date.now() - 86400_000),
    [filtered]
  );

  if (!loaded) {
    return (
      <div>
        <PageHeader title="Calendar" />
        <PageBody>
          <Skeleton className="h-[560px] rounded-xl" />
        </PageBody>
      </div>
    );
  }

  const chip = (p: Post) => {
    const thumb = p.mediaIds[0] ? mediaService.get(p.mediaIds[0]) : undefined;
    return (
      <button
        key={p.id}
        draggable
        onDragStart={() => setDragPost(p)}
        onClick={() => setSelected(p)}
        className={cn(
          "flex w-full items-center gap-1.5 rounded-md border px-1.5 py-1 text-left transition-colors",
          "border-line bg-surface hover:border-accent/60 hover:bg-accent-soft/40"
        )}
      >
        {thumb ? <MediaThumb asset={thumb} showKind={false} showDuration={false} className="size-5 shrink-0 rounded-[5px]" /> : <span className="size-5 shrink-0 rounded-[5px] border bg-surface-2 text-center text-[9px] font-bold leading-5 text-ink-3">Aa</span>}
        <span className="tnum shrink-0 text-[10px] font-semibold text-ink-2">{formatTime(p.scheduledAt!)}</span>
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium">{p.title}</span>
        <ProviderStack providers={p.targets.map((t) => t.provider)} max={3} />
      </button>
    );
  };

  const brands = session?.workspace.brands ?? [];

  return (
    <div>
      <PageHeader
        title="Calendar"
        description="Drag posts between days to reschedule. Times show in your workspace time zone."
        actions={
          <>
            <Segmented
              value={view}
              onChange={setView}
              options={[
                { value: "month", label: "Month" },
                { value: "week", label: "Week" },
                { value: "day", label: "Day" },
                { value: "agenda", label: "Agenda" },
              ]}
            />
            <Link href="/composer">
              <Button size="sm">
                <Plus className="size-4" /> Create post
              </Button>
            </Link>
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1">
            <Button variant="secondary" size="icon-sm" onClick={() => shift(-1)} aria-label="Previous">
              <ChevronLeft className="size-4" />
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setCursor(new Date())}>
              Today
            </Button>
            <Button variant="secondary" size="icon-sm" onClick={() => shift(1)} aria-label="Next">
              <ChevronRight className="size-4" />
            </Button>
          </div>
          <p className="min-w-40 font-display text-[17px] font-bold tracking-tight">
            {view === "day"
              ? cursor.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
              : cursor.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
          </p>
          <div className="ml-auto flex items-center gap-2">
            <Select value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)} className="h-8 w-40 text-[13px]" aria-label="Filter by brand">
              <option value="all">All brands</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </Select>
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-8 w-36 text-[13px]" aria-label="Filter by status">
              <option value="scheduled">Scheduled only</option>
              <option value="processing">Publishing only</option>
              <option value="all">All</option>
            </Select>
          </div>
        </div>
      </PageHeader>

      <PageBody>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_220px]">
          <Card className="overflow-hidden">
            {view === "month" && (
              <div>
                <div className="grid grid-cols-7 border-b bg-surface-2">
                  {DAY_LABELS.map((d) => (
                    <div key={d} className="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                      {d}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7">
                  {monthCells.map((d, i) => {
                    const inMonth = d.getMonth() === cursor.getMonth();
                    const isToday = isoDay(d) === isoDay(new Date());
                    const dayPosts = byDay.get(isoDay(d)) ?? [];
                    return (
                      <div
                        key={i}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => dropOn(d)}
                        className={cn(
                          "min-h-24 border-b border-r p-1.5 last:border-r-0",
                          !inMonth && "bg-surface-2/60",
                          isToday && "bg-accent-soft/40"
                        )}
                      >
                        <p className={cn("tnum mb-1 px-0.5 text-[11px] font-semibold", inMonth ? "text-ink-2" : "text-ink-3/60", isToday && "flex size-5 items-center justify-center rounded-full bg-accent text-on-accent")}>
                          {d.getDate()}
                        </p>
                        <div className="flex flex-col gap-1">
                          {dayPosts.slice(0, 3).map(chip)}
                          {dayPosts.length > 3 && (
                            <p className="px-1 text-[10px] font-medium text-ink-3">+{dayPosts.length - 3} more</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {view === "week" && (
              <div className="grid grid-cols-7">
                {weekDays.map((d) => {
                  const isToday = isoDay(d) === isoDay(new Date());
                  return (
                    <div
                      key={isoDay(d)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => dropOn(d)}
                      className={cn("min-h-72 border-r p-2 last:border-r-0", isToday && "bg-accent-soft/40")}
                    >
                      <p className="text-[11px] font-semibold text-ink-3">{DAY_LABELS[(d.getDay() + 6) % 7]}</p>
                      <p className={cn("tnum mb-2 text-[15px] font-bold", isToday && "text-accent-ink")}>{d.getDate()}</p>
                      <div className="flex flex-col gap-1.5">{(byDay.get(isoDay(d)) ?? []).map(chip)}</div>
                    </div>
                  );
                })}
              </div>
            )}

            {view === "day" && (
              <div className="p-4">
                {(byDay.get(isoDay(cursor)) ?? []).length === 0 ? (
                  <EmptyState
                    icon={<CalendarDays className="size-5" />}
                    title="Nothing scheduled this day"
                    body="Drag a post here from the month view, or create a new one."
                    action={<Link href="/composer"><Button>Create a post</Button></Link>}
                  />
                ) : (
                  <ul className="flex flex-col gap-2">
                    {(byDay.get(isoDay(cursor)) ?? []).map((p) => (
                      <li key={p.id}>
                        <button onClick={() => setSelected(p)} className="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:border-accent/60">
                          <span className="tnum w-14 shrink-0 font-display text-[15px] font-bold">{formatTime(p.scheduledAt!)}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold">{p.title}</span>
                            <span className="mt-0.5 block"><ProviderStack providers={p.targets.map((t) => t.provider)} /></span>
                          </span>
                          <PostStatePill state={p.state} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {view === "agenda" && (
              <div>
                {agenda.length === 0 ? (
                  <EmptyState
                    icon={<CalendarDays className="size-5" />}
                    title="Nothing scheduled yet"
                    body="Your upcoming posts will line up here."
                    action={<Link href="/composer"><Button>Create a post</Button></Link>}
                  />
                ) : (
                  <ul className="divide-y">
                    {agenda.map((p) => (
                      <li key={p.id}>
                        <button onClick={() => setSelected(p)} className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-surface-2">
                          <span className="w-28 shrink-0">
                            <span className="block text-[13px] font-semibold">
                              {new Date(p.scheduledAt!).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                            </span>
                            <span className="tnum block text-[12px] text-ink-3">{formatTime(p.scheduledAt!)}</span>
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold">{p.title}</span>
                          </span>
                          <ProviderStack providers={p.targets.map((t) => t.provider)} />
                          <PostStatePill state={p.state} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Card>

          {/* Drafts tray */}
          <Card className="h-fit p-3">
            <p className="flex items-center gap-1.5 px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
              <Inbox className="size-3.5" /> Unscheduled drafts
            </p>
            {drafts.length === 0 ? (
              <p className="px-1 py-3 text-[12px] leading-relaxed text-ink-3">
                Drafts you save without a date appear here — drag one onto a day to schedule it.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {drafts.map((d) => (
                  <li
                    key={d.id}
                    draggable
                    onDragStart={() => setDragPost(d)}
                    className="cursor-grab rounded-lg border bg-surface p-2 text-[12px] font-medium shadow-xs hover:border-accent/60 active:cursor-grabbing"
                  >
                    <p className="truncate">{d.title}</p>
                    <p className="mt-0.5 text-[10px] text-ink-3">drag onto a day →</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </PageBody>

      {/* Post drawer */}
      <Drawer open={!!selected} onClose={() => setSelected(null)} title={selected?.title ?? ""}>
        {selected && (
          <div className="flex flex-col gap-5 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <PostStatePill state={selected.state} />
              <span className="text-[13px] text-ink-2">
                {new Date(selected.scheduledAt!).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
              </span>
              {selected.campaign && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[12px] font-medium text-ink-2">{selected.campaign}</span>}
            </div>

            <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-2">{selected.caption}</p>

            {selected.mediaIds.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {selected.mediaIds.map((id) => {
                  const m = mediaService.get(id);
                  return m ? <MediaThumb key={id} asset={m} className="aspect-square" /> : null;
                })}
              </div>
            )}

            <div>
              <p className="text-[13px] font-semibold">Destinations</p>
              <ul className="mt-2 flex flex-col gap-1.5">
                {selected.targets.map((t) => (
                  <li key={t.id} className="flex items-center gap-2.5 rounded-lg border px-3 py-2">
                    <ProviderStack providers={[t.provider]} max={1} />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                      {PROVIDERS[t.provider].name}
                    </span>
                    <TargetStatePill state={t.state} />
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex gap-2">
              <Link href={`/posts/${selected.id}`} className="flex-1">
                <Button className="w-full">Open post</Button>
              </Link>
              <Button
                variant="secondary"
                onClick={() => {
                  void postsService.unschedule(selected.id);
                  toast({ title: "Moved back to drafts", variant: "info" });
                  setSelected(null);
                }}
              >
                Unschedule
              </Button>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
