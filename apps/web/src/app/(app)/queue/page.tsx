"use client";

import { useEffect, useMemo, useState } from "react";
import { Clock, ListOrdered, Plus, Trash2 } from "lucide-react";
import type { ProviderId, QueueSlot } from "@/lib/types";
import { queueService } from "@/lib/services/queue";
import { postsService } from "@/lib/services/posts";
import { useSubscribe } from "@/lib/services/hooks";
import { useToast } from "@/components/providers";
import { PageHeader, PageBody } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, Checkbox, EmptyState, Field, Input, Select, Skeleton, Switch } from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/dialog";
import { ProviderBadge, ProviderStack } from "@/components/ui/status";
import { PROVIDERS, PROVIDER_LIST } from "@/lib/providers";
import { formatTime, timeUntil } from "@/lib/utils";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export default function QueuePage() {
  useSubscribe(queueService);
  useSubscribe(postsService);
  const toast = useToast();
  const [loaded, setLoaded] = useState(false);
  const [slots, setSlots] = useState<QueueSlot[]>([]);
  const [posts, setPosts] = useState<ReturnType<typeof postsService.list>>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [newDay, setNewDay] = useState("1");
  const [newTime, setNewTime] = useState("09:00");
  const [newProviders, setNewProviders] = useState<ProviderId[]>([]);

  useEffect(() => {
    const read = () => {
      setSlots(queueService.slots());
      setPosts(postsService.list());
      setLoaded(true);
    };
    Promise.all([queueService.listAsync(), postsService.listAsync()]).then(read);
    const unsubs = [queueService.subscribe(read), postsService.subscribe(read)];
    return () => unsubs.forEach((u) => u());
  }, []);

  const nextSlots = useMemo(() => {
    // Show the next few upcoming queue windows relative to now.
    const result: { slot: QueueSlot; at: Date }[] = [];
    const now = new Date();
    for (let i = 0; i < 8; i++) {
      const d = new Date(now);
      d.setDate(now.getDate() + i);
      const daySlots = slots.filter((s) => s.enabled && s.dayOfWeek === d.getDay());
      for (const s of daySlots) {
        const [h, m] = s.time.split(":").map(Number);
        const at = new Date(d);
        at.setHours(h, m, 0, 0);
        if (at > now) result.push({ slot: s, at });
      }
    }
    return result.sort((a, b) => +a.at - +b.at).slice(0, 5);
  }, [slots]);

  const queuedPosts = useMemo(() => posts.filter((p) => p.state === "scheduled"), [posts]);

  const addSlot = async () => {
    if (newProviders.length === 0 || !newTime) {
      toast({ title: "Pick a time and at least one network", variant: "warning" });
      return;
    }
    await queueService.addSlot({ dayOfWeek: Number(newDay), time: newTime, providerIds: newProviders, enabled: true });
    setSlots(queueService.slots());
    setAddOpen(false);
    setNewProviders([]);
    toast({ title: "Queue slot added", description: `${DAY_NAMES[Number(newDay)]} at ${newTime}.`, variant: "success" });
  };

  if (!loaded) {
    return (
      <div>
        <PageHeader title="Queue" />
        <PageBody className="space-y-4">
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-96 rounded-xl" />
        </PageBody>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Queue"
        description="Recurring posting windows. New posts added to the queue publish in the next open slot for their channels."
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="size-4" /> Add slot
          </Button>
        }
      />
      <PageBody className="space-y-5">
        {/* Next windows */}
        <Card>
          <CardHeader title="Next open windows" description="When a post enters the queue, this is when it goes out." />
          {nextSlots.length === 0 ? (
            <EmptyState
              icon={<Clock className="size-5" />}
              title="No active slots"
              body="Add recurring windows below — for example weekday mornings at 09:00."
              action={<Button onClick={() => setAddOpen(true)}>Add your first slot</Button>}
            />
          ) : (
            <ul className="divide-y">
              {nextSlots.map(({ slot, at }) => (
                <li key={`${slot.id}-${at.toISOString()}`} className="flex items-center gap-3 px-5 py-3">
                  <span className="tnum w-36 shrink-0 text-[13px] font-semibold">
                    {at.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} · {formatTime(at.toISOString())}
                  </span>
                  <ProviderStack providers={slot.providerIds} />
                  <span className="ml-auto text-[12px] text-ink-3">{timeUntil(at.toISOString())}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Weekly slots */}
        <Card>
          <CardHeader title="Weekly schedule" description="Toggle a window off without deleting it." />
          <div className="divide-y">
            {WEEK_ORDER.map((day) => {
              const daySlots = slots.filter((s) => s.dayOfWeek === day);
              return (
                <div key={day} className="px-5 py-4">
                  <p className="text-[13px] font-semibold">{DAY_NAMES[day]}</p>
                  {daySlots.length === 0 ? (
                    <p className="mt-1 text-[12.5px] text-ink-3">No windows.</p>
                  ) : (
                    <ul className="mt-2 flex flex-col gap-1.5">
                      {daySlots.map((s) => (
                        <li key={s.id} className="flex items-center gap-3 rounded-lg border bg-surface-2 px-3 py-2">
                          <span className="tnum w-16 font-display text-[15px] font-bold">{s.time}</span>
                          <span className="flex flex-wrap gap-1">
                            {s.providerIds.map((p) => (
                              <ProviderBadge key={p} provider={p} size="sm" />
                            ))}
                          </span>
                          <Switch
                            checked={s.enabled}
                            label={`Toggle ${DAY_NAMES[day]} ${s.time} slot`}
                            onChange={async (v) => {
                              await queueService.updateSlot(s.id, { enabled: v });
                              setSlots(queueService.slots());
                            }}
                          />
                          <button
                            onClick={async () => {
                              await queueService.removeSlot(s.id);
                              setSlots(queueService.slots());
                              toast({ title: "Slot removed", variant: "info" });
                            }}
                            className="ml-auto rounded-lg p-1.5 text-ink-3 hover:bg-danger-soft hover:text-danger"
                            aria-label={`Remove ${DAY_NAMES[day]} ${s.time} slot`}
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </Card>

        {/* Scheduled through the queue */}
        <Card>
          <CardHeader title="In the queue" description={`${queuedPosts.length} post${queuedPosts.length === 1 ? "" : "s"} waiting to publish.`} />
          {queuedPosts.length === 0 ? (
            <EmptyState
              icon={<ListOrdered className="size-5" />}
              title="Queue is empty"
              body="Scheduled posts appear here with the window they'll use."
              action={<Button variant="secondary" onClick={() => (window.location.href = "/composer")}>Create a post</Button>}
            />
          ) : (
            <ul className="divide-y">
              {queuedPosts.slice(0, 6).map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-5 py-3">
                  <span className="tnum w-36 shrink-0 text-[13px] font-semibold">
                    {p.scheduledAt ? new Date(p.scheduledAt).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "—"}{" "}
                    {p.scheduledAt ? formatTime(p.scheduledAt) : ""}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.title}</span>
                  <ProviderStack providers={p.targets.map((t) => t.provider)} max={4} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </PageBody>

      <Dialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add a queue slot"
        description="Choose when and where this recurring window publishes."
        footer={
          <>
            <Button variant="secondary" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={addSlot}>Add slot</Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Day" htmlFor="qs-day">
              <Select id="qs-day" value={newDay} onChange={(e) => setNewDay(e.target.value)}>
                {WEEK_ORDER.map((d) => (
                  <option key={d} value={String(d)}>{DAY_NAMES[d]}</option>
                ))}
              </Select>
            </Field>
            <Field label="Time" htmlFor="qs-time">
              <Input id="qs-time" type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} />
            </Field>
          </div>
          <Field label="Networks" hint="Posts queued without an explicit time use the next open slot for these networks.">
            <div className="flex flex-wrap gap-1.5">
              {PROVIDER_LIST.map((p) => (
                <button
                  key={p.id}
                  onClick={() =>
                    setNewProviders((prev) => (prev.includes(p.id) ? prev.filter((x) => x !== p.id) : [...prev, p.id]))
                  }
                  className={
                    newProviders.includes(p.id)
                      ? "inline-flex items-center gap-1.5 rounded-full border border-accent bg-accent-soft px-2.5 py-1 text-[12px] font-medium text-accent-ink"
                      : "inline-flex items-center gap-1.5 rounded-full border bg-surface px-2.5 py-1 text-[12px] font-medium text-ink-2 hover:border-line-strong"
                  }
                >
                  <ProviderBadge provider={p.id} size="xs" />
                  {p.name}
                </button>
              ))}
            </div>
          </Field>
        </div>
      </Dialog>
    </div>
  );
}
