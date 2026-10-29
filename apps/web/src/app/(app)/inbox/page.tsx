"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ExternalLink,
  Inbox,
  Info,
  SlidersHorizontal,
  MessageCircle,
  CheckCheck,
  RefreshCw,
  Search,
  Send,
} from "lucide-react";
import {
  INBOX_EVENT_TYPES,
  PROVIDERS,
  roleHasPermission,
  type InboxAccount,
  type InboxCounts,
  type InboxDetail,
  type InboxFilters,
  type InboxPreferences,
} from "@aria/shared-types";
import { useSession, useToast } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Avatar } from "@/components/ui/primitives";
import { PageHeader } from "@/components/shell/page-header";
import { apiGet, DATA_MODE } from "@/lib/api/client";
import {
  inboxService,
  type InboxList,
  type InboxMember,
  type InboxOperation,
} from "@/lib/services/inbox";
import { cn, timeAgo } from "@/lib/utils";

const field = "min-h-11 w-full rounded-lg border bg-surface px-3 py-2 text-sm";
const views: Array<
  [NonNullable<InboxFilters["view"]>, string, keyof InboxCounts | null]
> = [
  ["all", "All interactions", "all"],
  ["unread", "Unread", "unread"],
  ["needs_reply", "Needs reply", "needsReply"],
  ["assigned", "Assigned to me", "assigned"],
  ["unassigned", "Unassigned", null],
  ["unresolved", "Unresolved", "unresolved"],
  ["resolved", "Resolved", "resolved"],
  ["archived", "Archived", "archived"],
];
const label = (value: string) => value.replaceAll("_", " ");

export default function InboxPage() {
  const { session } = useSession();
  // Remount on workspace changes so drafts, selections and pending requests never cross tenants.
  return session ? (
    <WorkspaceInbox
      key={session.workspace.id}
      workspaceId={session.workspace.id}
      userId={session.user.id}
      name={session.user.name}
      role={session.user.role}
    />
  ) : null;
}
function WorkspaceInbox({
  workspaceId: ws,
  userId,
  name,
  role,
}: {
  workspaceId: string;
  userId: string;
  name: string;
  role: Parameters<typeof roleHasPermission>[0];
}) {
  const toast = useToast();
  const canManage = roleHasPermission(role, "manage_inbox"),
    canReply = roleHasPermission(role, "reply_inbox");
  const [accounts, setAccounts] = useState<InboxAccount[]>([]),
    [members, setMembers] = useState<InboxMember[]>([]);
  const [prefs, setPrefs] = useState<InboxPreferences | null>(null),
    [counts, setCounts] = useState<InboxCounts | null>(null);
  const [filters, setFilters] = useState<InboxFilters>({
    view: "all",
    page: 1,
    limit: 30,
  });
  const [search, setSearch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [list, setList] = useState<InboxList | null>(null),
    [selected, setSelected] = useState<string | null>(null);
  const [checked, setChecked] = useState<string[]>([]),
    [detail, setDetail] = useState<InboxDetail | null>(null);
  const [error, setError] = useState<string | null>(null),
    [detailError, setDetailError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0);
  const [draft, setDraft] = useState("");
  const requestKey = useRef<{
    text: string;
    itemId: string;
    key: string;
  } | null>(null);
  const generation = useRef(0);
  const updateFilters = (patch: Partial<InboxFilters>) => {
    setFilters((f) => ({ ...f, ...patch, page: patch.page ?? 1 }));
    setChecked([]);
  };
  useEffect(() => {
    const timer = setTimeout(
      () => setFilters((f) => ({ ...f, search: search.trim(), page: 1 })),
      300,
    );
    return () => clearTimeout(timer);
  }, [search]);
  const load = useCallback(async () => {
    const run = ++generation.current;
    try {
      const [a, m, p, c] = await Promise.all([
        inboxService.accounts(ws),
        inboxService.members(ws, userId, name),
        inboxService.preferences(ws),
        inboxService.counts(ws, userId),
      ]);
      const types = filters.types?.length
        ? filters.types.filter((t) => p.enabledTypes.includes(t))
        : p.enabledTypes;
      const result = types.length
        ? await inboxService.list(ws, { ...filters, types }, userId)
        : { items: [], total: 0, page: filters.page || 1, limit: 30 };
      if (generation.current !== run) return;
      setAccounts(a);
      setMembers(m);
      setPrefs((previous) => previous ?? p);
      setCounts(c);
      setList(result);
      setError(null);
      setChecked((previous) =>
        previous.filter((id) => result.items.some((i) => i.id === id)),
      );
    } catch (e) {
      if (generation.current === run)
        setError(e instanceof Error ? e.message : "Could not load the inbox.");
    }
  }, [ws, userId, name, filters]);
  useEffect(() => {
    const kickoff = setTimeout(() => void load(), 0);
    return () => {
      clearTimeout(kickoff);
      generation.current++;
    };
  }, [load, refresh]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") setRefresh((n) => n + 1);
    }, 20000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    let cancelled = false;
    if (!selected) return;
    inboxService
      .detail(ws, selected)
      .then((value) => {
        if (!cancelled) {
          setDetail(value);
          setDetailError(null);
        }
      })
      .catch((e) => {
        if (!cancelled)
          setDetailError(
            e instanceof Error ? e.message : "Could not load conversation.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [selected, ws, refresh]);
  const choose = (id: string) => {
    setSelected(id);
    setDetail(null);
    setDetailError(null);
    setDraft("");
    requestKey.current = null;
  };
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      setRefresh((n) => n + 1);
    } catch (e) {
      toast({
        title: e instanceof Error ? e.message : "The operation failed.",
        variant: "error",
      });
    } finally {
      setBusy(false);
    }
  };
  const change = (
    ids: string[],
    operation: InboxOperation,
    assignedTo?: string | null,
  ) => run(() => inboxService.change(ws, ids, operation, assignedTo));
  const selectedAccount = accounts.find((a) => a.id === detail?.item.accountId);
  const blockedReply = !!detail?.actions.some((a) =>
    ["queued", "sending", "unknown"].includes(a.state),
  );
  const max =
    detail?.item.replyCharacterLimit ??
    selectedAccount?.capability.maxReplyLength ??
    0;
  const filteredCount = useMemo(
    () =>
      list
        ? `${list.total} interaction${list.total === 1 ? "" : "s"}`
        : "Loading interactions…",
    [list],
  );
  return (
    <div className="inbox-page">
      <PageHeader
        title="Social Inbox"
        actions={
          <>
            <span className="mr-2 rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold text-accent-ink">
              {counts?.unread ?? "—"} unread
            </span>
            <Link
              href="/notifications"
              className="hidden text-sm text-accent-ink underline sm:block"
            >
              System alerts
            </Link>
            <Button
              variant="secondary"
              aria-label="Sync now"
              loading={busy}
              disabled={!canManage}
              onClick={() =>
                void run(async () => {
                  const message = await inboxService.sync(ws);
                  toast({ title: message, variant: "info" });
                })
              }
            >
              <RefreshCw className="size-4" aria-hidden />
              <span className="hidden sm:inline">Sync now</span>
            </Button>
          </>
        }
      />
      {DATA_MODE === "mock" && (
        <p className="mb-3 bg-info-soft px-4 py-2 text-xs text-info-ink">
          Demo inbox · Sample interactions. Replies stay in this browser.
        </p>
      )}
      {error && (
        <div
          role="alert"
          className="m-4 rounded-lg bg-danger-soft p-4 text-danger-ink"
        >
          {error}{" "}
          <Button variant="secondary" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      )}
      <div className="inbox-grid grid items-start gap-5 px-4 pb-6 lg:px-8 xl:grid-cols-[320px_minmax(0,1fr)] 2xl:grid-cols-[350px_minmax(0,1fr)_270px]">
        <section
          aria-label="Interactions"
          className={cn(
            "inbox-list min-w-0 overflow-hidden rounded-2xl bg-surface shadow-[0_1px_8px_rgba(0,0,0,.025)]",
            selected && "hidden xl:block",
          )}
        >
          <div className="border-b p-4">
            <label className="relative block">
              <Search
                className="absolute left-3 top-3.5 size-4 text-ink-3"
                aria-hidden
              />
              <input
                type="search"
                aria-label="Search interactions"
                placeholder="Search people or messages"
                className={`${field} border-0 bg-surface-2 pl-9`}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <div
              className="mt-3 flex gap-1 overflow-x-auto rounded-xl bg-surface-2 p-1"
              aria-label="Quick inbox views"
            >
              {(
                [
                  ["all", "All"],
                  ["unread", "Unread"],
                  ["needs_reply", "Needs reply"],
                ] as const
              ).map(([v, title]) => (
                <button
                  key={v}
                  aria-pressed={filters.view === v}
                  onClick={() => updateFilters({ view: v })}
                  className={cn(
                    "min-h-11 shrink-0 rounded-lg px-3 text-xs",
                    filters.view === v
                      ? "bg-surface font-semibold text-accent-ink shadow-xs"
                      : "text-ink-2",
                  )}
                >
                  {title}
                  {v === "unread" && counts ? " (" + counts.unread + ")" : ""}
                </button>
              ))}
            </div>
            <div
              className="mt-3 flex gap-1.5 overflow-x-auto pb-1"
              aria-label="Channel filters"
            >
              <button
                onClick={() => updateFilters({ provider: undefined })}
                aria-pressed={!filters.provider}
                className={cn(
                  "min-h-11 shrink-0 rounded-full px-3 text-[11px] font-semibold",
                  !filters.provider
                    ? "bg-accent text-on-accent"
                    : "bg-surface-2 text-ink-2",
                )}
              >
                All Channels
              </button>
              {[...new Set(accounts.map((a) => a.provider))].map((p) => (
                <button
                  key={p}
                  aria-pressed={filters.provider === p}
                  onClick={() => updateFilters({ provider: p })}
                  className={cn(
                    "flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-[11px] font-medium",
                    filters.provider === p
                      ? "bg-accent text-on-accent"
                      : "bg-surface-2 text-ink-2",
                  )}
                >
                  <span
                    className="size-1.5 rounded-full"
                    style={{ backgroundColor: PROVIDERS[p].color }}
                  />
                  {PROVIDERS[p].name}
                </button>
              ))}
            </div>
            <p className="mt-3 text-xs text-ink-3" aria-live="polite">
              {filteredCount}
            </p>
          </div>
          <div className="border-b px-4 pb-3" aria-label="Inbox filters">
            <details
              open={filtersOpen}
              onToggle={(e) => setFiltersOpen(e.currentTarget.open)}
              className="group"
            >
              <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-xs font-semibold text-ink-2">
                <SlidersHorizontal className="size-4" aria-hidden /> Advanced
                filters
              </summary>
              <nav aria-label="Inbox views" className="grid grid-cols-2 gap-1">
                {views.map(([value, text, key]) => (
                  <button
                    key={value}
                    aria-current={filters.view === value ? "page" : undefined}
                    className={cn(
                      "flex min-h-11 items-center justify-between rounded-lg px-3 text-left text-sm",
                      filters.view === value
                        ? "bg-accent-soft font-semibold text-accent-ink"
                        : "hover:bg-surface-2",
                    )}
                    onClick={() => updateFilters({ view: value })}
                  >
                    {text}
                    {key && typeof counts?.[key] === "number" && (
                      <span className="ml-2 text-xs tabular-nums">
                        {counts[key] as number}
                      </span>
                    )}
                  </button>
                ))}
              </nav>
              <label className="mt-5 block text-xs font-semibold">
                Interaction type
                <select
                  aria-label="Interaction type"
                  className={`${field} mt-2`}
                  value={filters.types?.[0] || ""}
                  onChange={(e) =>
                    updateFilters({
                      types: e.target.value
                        ? [e.target.value as (typeof INBOX_EVENT_TYPES)[number]]
                        : undefined,
                    })
                  }
                >
                  <option value="">All enabled types</option>
                  {INBOX_EVENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {label(t)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="mt-4 block text-xs font-semibold">
                Provider
                <select
                  aria-label="Provider"
                  className={`${field} mt-2`}
                  value={filters.provider || ""}
                  onChange={(e) =>
                    updateFilters({
                      provider:
                        (e.target.value as InboxFilters["provider"]) ||
                        undefined,
                    })
                  }
                >
                  <option value="">All providers</option>
                  {Object.values(PROVIDERS).map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <fieldset className="mt-5">
                <legend className="text-xs font-semibold">
                  Accounts · unread
                </legend>
                {accounts.map((a) => (
                  <label
                    key={a.id}
                    className="flex min-h-11 items-center gap-2 text-xs"
                  >
                    <input
                      type="checkbox"
                      checked={filters.accountIds?.includes(a.id) || false}
                      onChange={(e) =>
                        updateFilters({
                          accountIds: e.target.checked
                            ? [...(filters.accountIds || []), a.id]
                            : filters.accountIds?.filter((id) => id !== a.id),
                        })
                      }
                    />
                    <span className="min-w-0 flex-1 truncate">{a.name}</span>
                    {counts?.byAccount[a.id] || 0}
                  </label>
                ))}
                {!accounts.length && (
                  <Link
                    href="/accounts"
                    className="mt-2 block text-xs underline"
                  >
                    Connect an account
                  </Link>
                )}
              </fieldset>
              <label className="mt-4 block text-xs font-semibold">
                From
                <input
                  aria-label="From date"
                  type="date"
                  className={`${field} mt-1`}
                  onChange={(e) =>
                    updateFilters({
                      from: e.target.value
                        ? `${e.target.value}T00:00:00.000Z`
                        : undefined,
                    })
                  }
                />
              </label>
              <label className="mt-3 block text-xs font-semibold">
                Through
                <input
                  aria-label="Through date"
                  type="date"
                  className={`${field} mt-1`}
                  onChange={(e) =>
                    updateFilters({
                      to: e.target.value
                        ? `${e.target.value}T23:59:59.999Z`
                        : undefined,
                    })
                  }
                />
              </label>
            </details>
          </div>

          {!!checked.length && (
            <div className="flex flex-wrap items-center gap-2 border-b bg-surface-2 p-3">
              <span className="text-xs">{checked.length} selected</span>
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => void change(checked, "read")}
              >
                Read
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => void change(checked, "unread")}
              >
                Unread
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={busy || !canManage}
                onClick={() => void change(checked, "resolve")}
              >
                Resolve
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={busy || !canManage}
                onClick={() => void change(checked, "archive")}
              >
                Archive
              </Button>
              <select
                aria-label="Bulk assign"
                className={field}
                disabled={busy || !canManage}
                value=""
                onChange={(e) => {
                  if (e.target.value)
                    void change(
                      checked,
                      "assign",
                      e.target.value === "none" ? null : e.target.value,
                    );
                }}
              >
                <option value="">Assign selected…</option>
                <option value="none">Unassigned</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {!list && !error && (
            <div role="status" className="space-y-3 p-4">
              Loading inbox…
              {[1, 2, 3].map((n) => (
                <div
                  key={n}
                  className="h-20 animate-pulse rounded-xl bg-surface-2 motion-reduce:animate-none"
                />
              ))}
            </div>
          )}
          {list && !list.items.length && (
            <div className="px-6 py-12 text-center">
              <Inbox className="mx-auto mb-3 size-8 text-ink-3" aria-hidden />
              <h2 className="font-semibold">No interactions here</h2>
              <p className="mt-2 text-sm text-ink-2">
                Try another filter, enable categories below, or check account
                sync health.
              </p>
            </div>
          )}
          <ul className="space-y-1 p-2 xl:max-h-[calc(100dvh-420px)] xl:overflow-y-auto">
            {list?.items.map((i) => (
              <li
                key={i.id}
                className={cn(
                  "relative flex items-start gap-2 rounded-xl px-3 transition-colors hover:bg-surface-2",
                  selected === i.id &&
                    "bg-accent-soft/60 before:absolute before:inset-y-3 before:left-0 before:w-1 before:rounded-full before:bg-accent",
                )}
              >
                <input
                  aria-label={`Select interaction from ${i.sender.name}`}
                  className="mt-6 size-4 shrink-0"
                  type="checkbox"
                  checked={checked.includes(i.id)}
                  onChange={(e) =>
                    setChecked((c) =>
                      e.target.checked
                        ? [...c, i.id]
                        : c.filter((id) => id !== i.id),
                    )
                  }
                />
                <button
                  className="min-w-0 flex-1 py-4 text-left"
                  onClick={() => choose(i.id)}
                >
                  <span className="flex items-center gap-2">
                    <Avatar name={i.sender.name} hue={170} size="sm" />
                    <span
                      className={cn(
                        "truncate text-sm",
                        !i.readAt && "font-bold",
                      )}
                    >
                      {i.sender.name}
                    </span>
                    {!i.readAt && (
                      <span
                        className="size-2 shrink-0 rounded-full bg-accent"
                        aria-label="Unread"
                      />
                    )}
                    <time className="ml-auto shrink-0 text-[11px] text-ink-3">
                      {timeAgo(i.occurredAt)}
                    </time>
                  </span>
                  <span className="mt-1 block truncate text-[11px] text-ink-3">
                    {PROVIDERS[i.provider].name} · {i.accountName} ·{" "}
                    {label(i.type)}
                  </span>
                  <span className="mt-2 line-clamp-2 block break-words text-[13px] text-ink-2">
                    {i.text}
                  </span>
                  <span className="mt-2 flex flex-wrap gap-2 text-[10px] font-medium text-ink-3">
                    {prefs?.priorityTypes.includes(i.type) && (
                      <span className="text-accent-ink">Priority</span>
                    )}
                    {i.resolvedAt && <span>Resolved</span>}
                    {i.repliedAt && <span>Replied</span>}
                    {i.replyState && <span>Reply {i.replyState}</span>}
                    {i.assignedTo && (
                      <span>
                        {members.find((m) => m.id === i.assignedTo)?.name ||
                          "Assigned member"}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {list && list.total > list.limit && (
            <div className="flex items-center justify-between gap-2 border-t p-3">
              <Button
                variant="secondary"
                disabled={list.page === 1}
                onClick={() => updateFilters({ page: list.page - 1 })}
              >
                Previous
              </Button>
              <span className="text-xs">
                {list.page} / {Math.ceil(list.total / list.limit)}
              </span>
              <Button
                variant="secondary"
                disabled={list.page * list.limit >= list.total}
                onClick={() => updateFilters({ page: list.page + 1 })}
              >
                Next
              </Button>
            </div>
          )}
        </section>
        <section
          aria-label="Conversation"
          className={cn(
            "conversation-pane min-w-0 overflow-hidden rounded-2xl bg-surface p-4 lg:p-5",
            !selected && "hidden xl:block",
          )}
        >
          {selected && (
            <Button
              variant="ghost"
              className="mb-3 xl:hidden"
              onClick={() => setSelected(null)}
            >
              <ArrowLeft className="size-4" /> Back to inbox
            </Button>
          )}
          {detailError && (
            <p
              role="alert"
              className="rounded-lg bg-danger-soft p-4 text-danger-ink"
            >
              {detailError}{" "}
              <button
                className="underline"
                onClick={() => setRefresh((n) => n + 1)}
              >
                Retry conversation
              </button>
            </p>
          )}
          {!selected && (
            <div className="py-24 text-center text-ink-3">
              <Inbox className="mx-auto mb-4 size-8" aria-hidden />
              <p>Select an interaction to open its conversation.</p>
            </div>
          )}
          {selected && !detail && !detailError && (
            <p role="status" className="py-12 text-center text-ink-3">
              Loading conversation…
            </p>
          )}
          {detail && selected && (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={detail.item.sender.name} hue={170} size="md" />
                  <div>
                    <h2 className="font-display text-lg font-semibold">
                      {detail.item.sender.name}
                    </h2>
                    <p className="mt-1 text-xs text-ink-3">
                      {PROVIDERS[detail.item.provider].name} ·{" "}
                      {detail.item.accountName} · {label(detail.item.type)}
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Conversation details"
                  className="min-h-11 min-w-11 2xl:hidden"
                  onClick={() => setContextOpen(true)}
                >
                  <Info className="size-5" />
                </Button>
                {detail.item.nativeUrl && (
                  <a
                    href={detail.item.nativeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-h-11 items-center gap-1 text-xs text-accent-ink underline"
                  >
                    Open on platform <ExternalLink className="size-3" />
                  </a>
                )}
              </div>
              <div className="my-4 flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void change(
                      [selected],
                      detail.item.readAt ? "unread" : "read",
                    )
                  }
                >
                  {detail.item.readAt ? "Mark unread" : "Mark read"}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy || !canManage}
                  onClick={() =>
                    void change(
                      [selected],
                      detail.item.resolvedAt ? "reopen" : "resolve",
                    )
                  }
                >
                  {detail.item.resolvedAt ? "Reopen" : "Resolve"}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy || !canManage}
                  onClick={() =>
                    void change(
                      [selected],
                      detail.item.archivedAt ? "unarchive" : "archive",
                    )
                  }
                >
                  {detail.item.archivedAt ? "Unarchive" : "Archive"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={
                    busy || selectedAccount?.capability.status !== "available"
                  }
                  onClick={() =>
                    void run(async () => {
                      await inboxService.refreshThread(ws, selected);
                      toast({
                        title:
                          "Thread refresh queued. Stored history updates after synchronization.",
                        variant: "info",
                      });
                    })
                  }
                >
                  Refresh thread
                </Button>
              </div>
              <label className="block text-xs font-semibold">
                Assigned to
                <select
                  aria-label="Assigned to"
                  disabled={!canManage || busy}
                  className={`${field} mt-1 max-w-xs`}
                  value={detail.item.assignedTo || ""}
                  onChange={(e) =>
                    void change([selected], "assign", e.target.value || null)
                  }
                >
                  <option value="">Unassigned</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
              {detail.item.post && (
                <div className="mt-4 rounded-xl border bg-surface-2 p-3 text-xs text-ink-2">
                  <p className="font-semibold">Original post</p>
                  <p className="mt-1 break-words">
                    {detail.item.post.text || detail.item.post.id}
                  </p>
                  {detail.item.post.url && (
                    <a
                      href={detail.item.post.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-block underline"
                    >
                      View original post
                    </a>
                  )}
                </div>
              )}
              <ol
                aria-label="Conversation messages"
                className="conversation-messages my-5 max-h-[48dvh] space-y-4 overflow-y-auto rounded-xl bg-paper p-3"
              >
                {detail.messages.map((m) => (
                  <li
                    key={m.id}
                    className={cn(
                      "w-fit max-w-[94%] rounded-2xl rounded-bl-sm bg-surface p-4 shadow-xs",
                      m.direction === "outgoing" &&
                        "ml-auto rounded-bl-2xl rounded-br-sm !bg-accent text-on-accent",
                    )}
                  >
                    <p className="flex justify-between gap-2 text-xs font-semibold">
                      <span>
                        {m.sender.name}
                        {m.direction === "outgoing" ? " · Sent" : ""}
                      </span>
                      <time
                        className={cn(
                          "font-normal",
                          m.direction === "outgoing"
                            ? "text-on-accent/70"
                            : "text-ink-3",
                        )}
                      >
                        {timeAgo(m.occurredAt)}
                      </time>
                    </p>
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed">
                      {m.deleted ? "This message was removed." : m.text}
                    </p>
                  </li>
                ))}
              </ol>
              {!!detail.actions.length && (
                <div aria-label="Reply delivery" className="mb-4 space-y-2">
                  {detail.actions.map((a) => (
                    <div
                      key={a.id}
                      className={cn(
                        "rounded-lg border p-3 text-xs",
                        ["unknown", "failed"].includes(a.state) &&
                          "border-warn bg-warn-soft text-warn-ink",
                      )}
                    >
                      <p className="font-semibold">
                        Reply {a.state}
                        {DATA_MODE === "mock" ? " (demo)" : ""}
                      </p>
                      {a.state !== "confirmed" && (
                        <p className="mt-1 break-words">{a.text}</p>
                      )}
                      {a.errorMessage && (
                        <p className="mt-1">{a.errorMessage}</p>
                      )}
                      {a.state === "failed" &&
                        detail.item.replyAllowed &&
                        canReply &&
                        !blockedReply && (
                          <Button
                            variant="secondary"
                            size="sm"
                            className="mt-2"
                            disabled={busy || Array.from(a.text).length > max}
                            onClick={() =>
                              void run(async () => {
                                await inboxService.reply(
                                  ws,
                                  selected,
                                  a.text,
                                  crypto.randomUUID(),
                                  userId,
                                );
                                toast({
                                  title: "Retry queued as a new tracked reply.",
                                  variant: "info",
                                });
                              })
                            }
                          >
                            Retry failed reply
                          </Button>
                        )}
                      {a.state === "unknown" && (
                        <p className="mt-1">
                          Check the native conversation. Resending is disabled
                          to prevent duplicates.
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {detail.item.replyAllowed && canReply && !blockedReply ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const text = draft.trim();
                    if (!text || Array.from(text).length > max) return;
                    if (
                      requestKey.current?.text !== text ||
                      requestKey.current.itemId !== selected
                    )
                      requestKey.current = {
                        text,
                        itemId: selected,
                        key: crypto.randomUUID(),
                      };
                    const key = requestKey.current.key;
                    void run(async () => {
                      await inboxService.reply(ws, selected, text, key, userId);
                      setDraft("");
                      requestKey.current = null;
                      toast({
                        title:
                          DATA_MODE === "mock"
                            ? "Demo reply saved locally."
                            : "Reply queued. Delivery is confirmed by the provider.",
                        variant: "info",
                      });
                    });
                  }}
                >
                  <label
                    htmlFor="inbox-reply"
                    className="text-sm font-semibold"
                  >
                    {detail.item.type === "direct_message"
                      ? "Private reply"
                      : "Reply"}
                  </label>
                  <textarea
                    id="inbox-reply"
                    rows={4}
                    className={`${field} mt-2 resize-y border-0 bg-surface-2 !p-4`}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Write a reply…"
                    disabled={busy}
                  />
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <p className="text-xs text-ink-3">
                      {Array.from(draft).length} / {max}
                      {detail.item.provider === "mastodon"
                        ? " plus recipient mentions"
                        : ""}
                    </p>
                    <Button
                      type="submit"
                      loading={busy}
                      disabled={!draft.trim() || Array.from(draft).length > max}
                    >
                      <Send className="size-4" />
                      {DATA_MODE === "mock" ? "Save demo reply" : "Send reply"}
                    </Button>
                  </div>
                </form>
              ) : (
                <p className="rounded-lg bg-surface-2 p-4 text-sm text-ink-2">
                  {blockedReply
                    ? "A reply is pending or needs verification on the native platform."
                    : !canReply
                      ? "Your workspace role can view this conversation but cannot send replies."
                      : detail.item.replyReason ||
                        "Use the native platform for this interaction."}
                </p>
              )}
              {detail.activity.length > 0 && (
                <details className="mt-6 text-xs text-ink-3">
                  <summary className="min-h-11 cursor-pointer py-3">
                    Handling history
                  </summary>
                  <ul className="space-y-2">
                    {detail.activity.map((a, i) => (
                      <li key={`${a.at}-${i}`}>
                        {label(a.action.replace("inbox.", ""))} ·{" "}
                        {members.find((m) => m.id === a.actorId)?.name ||
                          "Former member"}{" "}
                        · {timeAgo(a.at)}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </section>
        <aside
          aria-label="Creator context"
          className="hidden space-y-4 2xl:block"
        >
          {detail && selected ? (
            <ConversationContext detail={detail} account={selectedAccount} />
          ) : (
            <div className="rounded-2xl bg-surface p-5 text-sm text-ink-2">
              <MessageCircle className="mb-3 size-7 text-accent-ink" />
              Conversation details appear here when you select an interaction.
            </div>
          )}
        </aside>
      </div>
      <Dialog
        open={contextOpen && !!selected}
        onClose={() => setContextOpen(false)}
        title="Conversation details"
        width="sm"
      >
        {detail && (
          <ConversationContext detail={detail} account={selectedAccount} />
        )}
      </Dialog>
      <div className="border-t p-4 lg:px-8">
        <details>
          <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold">
            Account health, provider coverage and preferences
          </summary>
          <div className="grid gap-6 py-4 lg:grid-cols-2">
            <div className="space-y-4">
              {accounts.map((a) => (
                <div key={a.id} className="rounded-xl border p-4 text-xs">
                  <p className="font-semibold">
                    {a.name} · {PROVIDERS[a.provider].name}
                  </p>
                  <p className="mt-1">{a.capability.reason}</p>
                  <p className="mt-2 text-ink-3">
                    Sync: {a.syncStatus} · Last success:{" "}
                    {a.lastSyncedAt ? timeAgo(a.lastSyncedAt) : "never"}
                  </p>
                  {a.nextSyncAt && (
                    <p className="mt-1 text-ink-3">
                      Next attempt: {new Date(a.nextSyncAt).toLocaleString()}
                    </p>
                  )}
                  {a.syncError && (
                    <p className="mt-2 text-danger-ink">{a.syncError}</p>
                  )}
                  {a.capability.missingScopes.length +
                    a.capability.missingReplyScopes.length >
                    0 && (
                    <p className="mt-2 break-words">
                      Missing:{" "}
                      {[
                        ...a.capability.missingScopes,
                        ...a.capability.missingReplyScopes,
                      ].join(", ")}
                    </p>
                  )}
                  {a.capability.approvalNote && (
                    <p className="mt-2 text-ink-3">
                      {a.capability.approvalNote}
                    </p>
                  )}
                  {DATA_MODE === "api" &&
                    ["youtube", "facebook", "instagram"].includes(a.provider) &&
                    a.capability.status !== "not_implemented" && (
                      <Button
                        className="mt-3"
                        variant="secondary"
                        size="sm"
                        disabled={
                          busy || !roleHasPermission(role, "connect_accounts")
                        }
                        onClick={() =>
                          void run(async () => {
                            const result = await apiGet<{ url: string }>(
                              `/v1/oauth/${a.provider}/authorize?workspaceId=${ws}&format=json&access=inbox`,
                            );
                            window.location.assign(result.url);
                          })
                        }
                      >
                        Review inbox permissions
                      </Button>
                    )}
                </div>
              ))}
              <p className="text-xs text-ink-3">
                Background polling covers Bluesky notifications, Mastodon
                notifications including private mentions, YouTube comment
                threads, and comments on recent Facebook Page posts and
                Instagram professional media. History imports are bounded.
                Refreshing a thread fetches additional context.
              </p>
              <table className="w-full text-left text-xs">
                <caption className="mb-2 text-left font-semibold">
                  Provider coverage
                </caption>
                <thead>
                  <tr>
                    <th className="py-2">Network</th>
                    <th>Inbox integration</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.values(PROVIDERS).map((p) => (
                    <tr className="border-t" key={p.id}>
                      <td className="py-2 pr-3">{p.name}</td>
                      <td>
                        {[
                          "bluesky",
                          "mastodon",
                          "youtube",
                          "facebook",
                          "instagram",
                        ].includes(p.id)
                          ? "Implemented; live verification pending"
                          : "Not implemented; use native platform"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {prefs && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    await inboxService.savePreferences(ws, prefs);
                    toast({
                      title: "Inbox preferences saved.",
                      variant: "success",
                    });
                  });
                }}
              >
                <h3 className="text-sm font-semibold">Your categories</h3>
                <p className="mt-2 text-xs text-ink-3">
                  Enabled categories control your list. Priority categories
                  receive a badge. Workspace ingestion continues for your team.
                </p>
                <div className="mt-3 grid grid-cols-[1fr_auto_auto] items-center gap-x-3 text-xs">
                  <span>Category</span>
                  <span>Show</span>
                  <span>Priority</span>
                  {INBOX_EVENT_TYPES.map((t) => (
                    <Category
                      key={t}
                      type={t}
                      prefs={prefs}
                      onChange={setPrefs}
                    />
                  ))}
                </div>
                <Button className="mt-4" type="submit" loading={busy}>
                  Save preferences
                </Button>
              </form>
            )}
          </div>
        </details>
      </div>
    </div>
  );
}
function ConversationContext({
  detail,
  account,
}: {
  detail: InboxDetail;
  account?: InboxAccount;
}) {
  const item = detail.item;
  return (
    <div className="space-y-4">
      <section className="rounded-2xl bg-surface p-4 text-center shadow-xs">
        <div className="mx-auto w-fit rounded-full bg-accent-soft p-3">
          <Avatar name={item.sender.name} hue={170} size="lg" />
        </div>
        <h3 className="mt-4 font-display text-lg font-bold">
          {item.sender.name}
        </h3>
        <p className="mt-1 text-xs text-ink-2">
          {PROVIDERS[item.provider].name} · {label(item.type)}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-studio-soft p-3">
          <div>
            <p className="font-display text-lg font-bold">
              {detail.messages.length}
            </p>
            <p className="mt-1 text-[10px] uppercase text-ink-2">
              Stored messages
            </p>
          </div>
          <div>
            <CheckCheck className="mx-auto size-5 text-accent-ink" />
            <p className="mt-1 text-[10px] uppercase text-ink-2">
              {item.resolvedAt ? "Resolved" : "Open"}
            </p>
          </div>
        </div>
        {item.nativeUrl && (
          <a
            href={item.nativeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 flex min-h-11 items-center justify-center gap-2 rounded-xl bg-surface-2 text-xs font-medium"
          >
            Open on platform <ExternalLink className="size-3.5" />
          </a>
        )}
      </section>
      <section className="rounded-2xl bg-surface p-4 shadow-xs">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-ink-2">
          Connection & delivery
        </h3>
        <p className="mt-3 text-sm font-semibold">{item.accountName}</p>
        <p className="mt-2 text-xs leading-relaxed text-ink-2">
          {account?.capability.reason ||
            "Provider availability is checked before replying."}
        </p>
        <dl className="mt-3 space-y-2 text-xs">
          <div className="flex justify-between gap-3">
            <dt className="text-ink-2">Sync</dt>
            <dd className="capitalize">
              {account?.syncStatus || "Unavailable"}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-2">Last success</dt>
            <dd>
              {account?.lastSyncedAt
                ? timeAgo(account.lastSyncedAt)
                : "Not recorded"}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-2">Reply</dt>
            <dd>{item.replyAllowed ? "Available" : "On native platform"}</dd>
          </div>
        </dl>
        {item.replyReason && (
          <p className="mt-3 rounded-lg bg-studio-soft p-3 text-xs leading-relaxed text-ink-2">
            {item.replyReason}
          </p>
        )}
      </section>
      {item.post && (
        <section className="rounded-2xl bg-surface p-4 shadow-xs">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-ink-2">
            Referenced post
          </h3>
          <p className="mt-3 line-clamp-5 break-words text-sm leading-relaxed">
            {item.post.text || item.post.id}
          </p>
          {item.post.url && (
            <a
              href={item.post.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex min-h-11 items-center gap-2 text-xs font-semibold text-accent-ink"
            >
              View original <ExternalLink className="size-3" />
            </a>
          )}
        </section>
      )}
    </div>
  );
}

function Category({
  type,
  prefs,
  onChange,
}: {
  type: (typeof INBOX_EVENT_TYPES)[number];
  prefs: InboxPreferences;
  onChange: (p: InboxPreferences) => void;
}) {
  return (
    <>
      <span className="py-3 capitalize">{label(type)}</span>
      {(["enabledTypes", "priorityTypes"] as const).map((key) => (
        <label
          key={key}
          className="flex min-h-11 min-w-11 items-center justify-center"
        >
          <input
            type="checkbox"
            aria-label={`${label(type)} ${key === "enabledTypes" ? "show" : "priority"}`}
            checked={prefs[key].includes(type)}
            onChange={(e) =>
              onChange({
                ...prefs,
                [key]: e.target.checked
                  ? [...prefs[key], type]
                  : prefs[key].filter((t) => t !== type),
              })
            }
          />
        </label>
      ))}
    </>
  );
}
