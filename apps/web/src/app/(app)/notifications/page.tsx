"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Bell, CheckCheck, CircleAlert, CircleCheckBig, Info, KeyRound, PartyPopper, Trash2, TriangleAlert, UserPlus } from "lucide-react";
import type { Notification, NotificationType } from "@/lib/types";
import { notificationsService } from "@/lib/services/notifications";
import { useSubscribe } from "@/lib/services/hooks";
import { PageHeader, PageBody } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, Segmented, Skeleton } from "@/components/ui/primitives";
import { cn, timeAgo } from "@/lib/utils";

type Filter = "all" | "unread" | "action";

const TYPE_ICON: Record<NotificationType, React.ReactNode> = {
  post_failed: <CircleAlert className="size-4" />,
  post_published: <CircleCheckBig className="size-4" />,
  account_disconnected: <KeyRound className="size-4" />,
  needs_reauth: <KeyRound className="size-4" />,
  needs_action: <TriangleAlert className="size-4" />,
  schedule_conflict: <Info className="size-4" />,
  retry_succeeded: <CircleCheckBig className="size-4" />,
  team_invite: <UserPlus className="size-4" />,
  billing: <Info className="size-4" />,
};

function toneFor(n: Notification) {
  switch (n.severity) {
    case "error":
      return "bg-danger-soft text-danger-ink";
    case "warning":
      return "bg-warn-soft text-warn-ink";
    case "success":
      return "bg-success-soft text-success-ink";
    default:
      return "bg-info-soft text-info-ink";
  }
}

export default function NotificationsPage() {
  useSubscribe(notificationsService);
  const [loaded, setLoaded] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    const read = () => {
      setItems(notificationsService.list());
      setLoaded(true);
    };
    notificationsService.listAsync().then(read);
    return notificationsService.subscribe(read);
  }, []);

  const visible = useMemo(() => {
    if (filter === "unread") return items.filter((n) => !n.read);
    if (filter === "action")
      return items.filter((n) => ["post_failed", "needs_reauth", "needs_action", "schedule_conflict"].includes(n.type));
    return items;
  }, [items, filter]);

  const unread = items.filter((n) => !n.read).length;

  if (!loaded) {
    return (
      <div>
        <PageHeader title="Notifications" />
        <PageBody className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </PageBody>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Notifications"
        description="Actionable events only — failures, connection problems, approvals and billing. Routine successes stay quiet unless you opt in."
        actions={
          unread > 0 ? (
            <Button variant="secondary" onClick={() => { notificationsService.markAllRead(); setItems(notificationsService.list()); }}>
              <CheckCheck className="size-4" /> Mark all read
            </Button>
          ) : undefined
        }
      >
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All" },
            { value: "unread", label: "Unread", badge: unread },
            { value: "action", label: "Needs action" },
          ]}
        />
      </PageHeader>

      <PageBody>
        <Card>
          {visible.length === 0 ? (
            <EmptyState
              icon={<Bell className="size-5" />}
              title={filter === "unread" ? "You're all caught up" : "Nothing here"}
              body={filter === "action" ? "No action needed right now — nice." : "Notifications about your publishing and connections will appear here."}
            />
          ) : (
            <ul className="divide-y">
              {visible.map((n) => {
                const href = n.postId ? `/posts/${n.postId}` : n.accountId ? "/accounts" : "/billing";
                return (
                  <li key={n.id} className={cn("group relative", !n.read && "bg-accent-soft/30")}>
                    <Link href={href} onClick={() => { notificationsService.markRead(n.id); setItems(notificationsService.list()); }} className="flex items-start gap-3.5 px-5 py-4 transition-colors hover:bg-surface-2">
                      <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg", toneFor(n))}>
                        {TYPE_ICON[n.type]}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={cn("block text-sm leading-snug", n.read ? "font-medium text-ink-2" : "font-semibold")}>
                          {n.title}
                        </span>
                        <span className="mt-0.5 block text-[13px] leading-relaxed text-ink-2">{n.body}</span>
                        <span className="mt-1 block text-[12px] text-ink-3">{timeAgo(n.createdAt)}</span>
                      </span>
                      {!n.read && <span className="mt-2 size-2 shrink-0 rounded-full bg-accent" aria-label="Unread" />}
                    </Link>
                    <button
                      onClick={() => { notificationsService.remove(n.id); setItems(notificationsService.list()); }}
                      className="absolute right-3 top-3 rounded-lg p-1.5 text-ink-3 opacity-0 transition-opacity hover:bg-surface-2 hover:text-danger group-hover:opacity-100"
                      aria-label="Dismiss notification"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <p className="mt-3 flex items-center gap-1.5 text-[12px] text-ink-3">
          <PartyPopper className="size-3.5" />
          Success notifications are off by default — change it in Settings → Notifications.
        </p>
      </PageBody>
    </div>
  );
}
