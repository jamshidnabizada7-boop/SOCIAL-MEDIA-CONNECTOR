"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CalendarClock,
  Copy,
  ExternalLink,
  FileText,
  KeyRound,
  RotateCcw,
  Send,
  Trash2,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import type { Post, PublishTarget } from "@/lib/types";
import { postsService } from "@/lib/services/posts";
import { accountsService } from "@/lib/services/accounts";
import { mediaService } from "@/lib/services/media";
import { useSubscribe } from "@/lib/services/hooks";
import { useToast } from "@/components/providers";
import { PageBody } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Avatar, Card, CardHeader, EmptyState, Progress, Skeleton } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/ui/dialog";
import { MediaThumb } from "@/components/ui/media-thumb";
import { PostStatePill, ProviderBadge, TargetStatePill } from "@/components/ui/status";
import { PROVIDERS } from "@/lib/providers";
import { cn, formatDateTime, timeUntil } from "@/lib/utils";

const STATE_EXPLAIN: Record<string, string> = {
  pending: "Waiting for its turn in the queue.",
  queued: "Queued and about to start.",
  uploading_media: "Media is uploading to the network.",
  publishing: "The post is being created at the network.",
  provider_processing: "The network is processing the upload — this can take a few minutes for video.",
  published: "Live on the network.",
  retrying: "Automatically retrying after a temporary failure.",
  failed: "This attempt failed. The fix depends on the reason below.",
  token_expired: "Stopped before publishing — the account needs to be reconnected.",
  canceled: "Canceled before publishing.",
  needs_user_action: "This network needs a step finished inside its own app.",
};

export default function PostDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  useSubscribe(postsService);
  useSubscribe(accountsService);
  const [loaded, setLoaded] = useState(false);
  const [post, setPost] = useState<Post | null | undefined>(undefined);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [showTechnical, setShowTechnical] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const p = await postsService.getAsync(id as string);
      setPost(p ?? null);
      if (p) setLoaded(true);
      else {
        const t = window.setTimeout(() => setLoaded(true), 500);
        return () => window.clearTimeout(t);
      }
    };
    void load();
  }, [id]);

  const live = useMemo(() => postsService.get(id as string) ?? post, [post, id]);

  if (!loaded) {
    return (
      <PageBody className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </PageBody>
    );
  }

  if (!live) {
    return (
      <PageBody>
        <EmptyState
          icon={<FileText className="size-5" />}
          title="Post not found"
          body="This post may have been deleted."
          action={<Link href="/posts"><Button>Back to posts</Button></Link>}
        />
      </PageBody>
    );
  }

  const p = live;
  const accounts = accountsService.list();
  const targets = p.targets;
  const publishedCount = targets.filter((t) => t.state === "published").length;
  const failedTargets = targets.filter((t) => t.state === "failed" || t.state === "token_expired");
  const inFlight = targets.some(
    (t) => !["published", "failed", "canceled", "token_expired", "needs_user_action", "pending"].includes(t.state)
  );
  const media = p.mediaIds.map((mid) => mediaService.get(mid)).filter((m): m is NonNullable<typeof m> => !!m);
  const author = accounts.length; // placate lint; author rendering below uses static map
  void author;

  const retryTarget = async (t: PublishTarget) => {
    if (t.state === "token_expired") {
      setReconnecting(t.id);
      await accountsService.reconnect(t.accountId);
      setReconnecting(null);
      toast({ title: "Account reconnected — retrying delivery", variant: "success" });
    }
    await postsService.retryTarget(p.id, t.id);
  };

  const retryAllFailed = async () => {
    for (const t of failedTargets) {
      if (t.state === "token_expired") await accountsService.reconnect(t.accountId);
    }
    await Promise.all(failedTargets.map((t) => postsService.retryTarget(p.id, t.id)));
    toast({ title: "Retrying failed destinations", description: "Successful destinations are left untouched.", variant: "info" });
  };

  return (
    <div>
      {/* Header */}
      <div className="border-b bg-paper/60 px-4 py-5 lg:px-8">
        <div className="mx-auto max-w-[1100px]">
          <Link href="/posts" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-2 hover:text-ink">
            <ArrowLeft className="size-3.5" /> All posts
          </Link>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <h1 className="font-display text-[24px] font-bold tracking-tight">{p.title}</h1>
            <PostStatePill state={p.state} />
            {p.campaign && <span className="rounded-full bg-surface-2 px-2.5 py-1 text-[12px] font-medium text-ink-2">{p.campaign}</span>}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink-3">
            <span>Created {formatDateTime(p.createdAt)}</span>
            <span className="flex items-center gap-1.5">
              <Avatar name="Maya Chen" hue={160} size="xs" /> Maya Chen
            </span>
            <span>{p.timezone}</span>
            {p.scheduledAt && p.state === "scheduled" && (
              <span className="tnum inline-flex items-center gap-1.5 font-medium text-info-ink">
                <CalendarClock className="size-3.5" /> Goes out {formatDateTime(p.scheduledAt)} ({timeUntil(p.scheduledAt)})
              </span>
            )}
            {(p.versions?.length ?? 0) > 0 && (
              <span title="An immutable snapshot of the content is frozen when publishing starts, so retries never drift.">
                Snapshot v{p.versions![p.versions!.length - 1].version} frozen {formatDateTime(p.versions![p.versions!.length - 1].frozenAt)}
              </span>
            )}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {p.state === "draft" && (
              <>
                <Link href={`/composer?draft=${p.id}`}>
                  <Button>Continue editing</Button>
                </Link>
                <Button
                  variant="secondary"
                  onClick={async () => {
                    await postsService.publish(p.id);
                    toast({ title: "Publishing…", variant: "info" });
                  }}
                >
                  <Send className="size-4" /> Publish now
                </Button>
              </>
            )}
            {p.state === "scheduled" && (
              <>
                <Button
                  variant="secondary"
                  onClick={async () => {
                    await postsService.unschedule(p.id);
                    toast({ title: "Moved back to drafts", variant: "info" });
                  }}
                >
                  Unschedule
                </Button>
                <Button
                  variant="danger-ghost"
                  onClick={() => setConfirmCancel(true)}
                >
                  Cancel schedule
                </Button>
              </>
            )}
            {(p.state === "partially_published" || p.state === "failed") && failedTargets.length > 0 && (
              <Button onClick={retryAllFailed}>
                <RotateCcw className="size-4" /> Retry {failedTargets.length} failed destination{failedTargets.length === 1 ? "" : "s"}
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={async () => {
                const copy = await postsService.duplicate(p.id);
                toast({ title: "Duplicated as a new draft", variant: "success" });
                router.push(`/composer?draft=${copy.id}`);
              }}
            >
              <Copy className="size-4" /> Duplicate
            </Button>
            {p.state === "draft" && (
              <Button variant="danger-ghost" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="size-4" /> Delete draft
              </Button>
            )}
          </div>
        </div>
      </div>

      <PageBody className="grid gap-5 py-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        {/* Universal content */}
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="Universal content" description="What every destination inherits before overrides." />
            <div className="p-5">
              {media.length > 0 && (
                <div className="grid grid-cols-2 gap-2.5">
                  {media.map((m) => (
                    <MediaThumb key={m.id} asset={m} className="aspect-video" />
                  ))}
                </div>
              )}
              <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed">{p.caption}</p>
              {p.link && (
                <p className="mt-2 truncate text-[13px] font-medium text-accent-ink">{p.link}</p>
              )}
              <div className="mt-4 flex flex-wrap gap-1.5">
                {(p.labels ?? []).map((l) => (
                  <span key={l} className="rounded-full bg-surface-2 px-2 py-0.5 text-[12px] font-medium text-ink-2">#{l}</span>
                ))}
                {p.aiDisclosed && (
                  <span className="rounded-full bg-info-soft px-2 py-0.5 text-[12px] font-medium text-info-ink">AI-assisted</span>
                )}
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <p className="text-[13px] font-semibold">Why states look different per network</p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
              Each destination is an independent delivery with its own retries. Video networks (like
              TikTok and YouTube) show “Processing” after upload while the platform encodes the
              file. A failure on one network never rolls back a network that already succeeded.
            </p>
          </Card>
        </div>

        {/* Targets */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">
              Destinations{" "}
              <span className="tnum text-ink-3">
                ({publishedCount}/{targets.length} published)
              </span>
            </p>
            {inFlight && (
              <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-info-ink">
                <span className="size-1.5 animate-pulse rounded-full bg-info motion-reduce:animate-none" />
                Live
              </span>
            )}
          </div>

          {targets.map((t) => {
            const account = accounts.find((a) => a.id === t.accountId);
            const err = t.lastError;
            return (
              <Card key={t.id} className={cn("overflow-hidden", (t.state === "failed" || t.state === "token_expired") && "border-danger/30")}>
                <div className="flex items-center gap-3 p-4">
                  <ProviderBadge provider={t.provider} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {PROVIDERS[t.provider].name}
                      <span className="ml-1.5 font-normal text-ink-3">{account?.displayName}</span>
                    </p>
                    <p className="text-[12px] text-ink-3">{STATE_EXPLAIN[t.state]}</p>
                  </div>
                  <TargetStatePill state={t.state} />
                </div>

                {(t.state === "uploading_media" || t.state === "publishing") && t.progress !== undefined && (
                  <div className="px-4 pb-4">
                    <Progress value={t.progress} tone={t.state === "publishing" ? "info" : "accent"} />
                    <p className="tnum mt-1 text-right text-[11px] text-ink-3">{t.progress}%</p>
                  </div>
                )}

                {t.state === "published" && (
                  <div className="flex items-center justify-between border-t bg-surface-2 px-4 py-2.5 text-[12.5px]">
                    <span className="text-ink-2">Published {t.publishedAt ? formatDateTime(t.publishedAt) : ""} · attempt {t.attempts}</span>
                    {t.remoteUrl && (
                      <a href={t.remoteUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-accent-ink hover:underline">
                        View on {PROVIDERS[t.provider].name} <ExternalLink className="size-3" />
                      </a>
                    )}
                  </div>
                )}

                {(t.state === "failed" || t.state === "token_expired") && err && (
                  <div className="border-t border-danger/20 bg-danger-soft/40 p-4">
                    <p className="flex items-center gap-1.5 text-[13px] font-semibold text-danger-ink">
                      <TriangleAlert className="size-4" /> {err.title}
                    </p>
                    <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{err.message}</p>
                    {err.hint && <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{err.hint}</p>}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {t.state === "token_expired" ? (
                        <Button size="sm" loading={reconnecting === t.id} onClick={() => void retryTarget(t)}>
                          <KeyRound className="size-3.5" /> Reconnect & retry
                        </Button>
                      ) : err.retryable ? (
                        <Button size="sm" variant="secondary" onClick={() => void postsService.retryTarget(p.id, t.id)}>
                          <RotateCcw className="size-3.5" /> Retry
                        </Button>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-ink-2">
                          <XCircle className="size-3.5" /> Not retryable — change the content first
                        </span>
                      )}
                      <button
                        onClick={() => setShowTechnical(showTechnical === t.id ? null : t.id)}
                        className="text-[12px] font-medium text-ink-3 underline-offset-2 hover:text-ink hover:underline"
                      >
                        {showTechnical === t.id ? "Hide details" : "Details"}
                      </button>
                      <span className="text-[11px] text-ink-3">attempt {t.attempts} · idempotency key verified</span>
                    </div>
                    {showTechnical === t.id && (
                      <pre className="mt-2 overflow-x-auto rounded-lg bg-ink/90 p-3 text-[11px] leading-relaxed text-paper">
                        {err.code}
                        {"\n"}
                        {err.technical}
                      </pre>
                    )}
                  </div>
                )}

                {t.state === "pending" && p.state === "scheduled" && (
                  <div className="border-t bg-surface-2 px-4 py-2.5 text-[12.5px] text-ink-2">
                    Scheduled for {t.scheduledAt ? formatDateTime(t.scheduledAt) : formatDateTime(p.scheduledAt!)}
                  </div>
                )}
                {t.state === "provider_processing" && (
                  <div className="border-t bg-warn-soft/40 px-4 py-2.5 text-[12.5px] text-warn-ink">
                    The platform is encoding the video. We poll and reconcile automatically — no action needed.
                  </div>
                )}
              </Card>
            );
          })}

          {targets.length === 0 && (
            <EmptyState
              icon={<FileText className="size-5" />}
              title="No destinations yet"
              body="Edit this draft and select accounts to publish to."
              action={<Link href={`/composer?draft=${p.id}`}><Button>Edit draft</Button></Link>}
            />
          )}
        </div>
      </PageBody>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          setConfirmDelete(false);
          await postsService.deletePost(p.id);
          toast({ title: "Draft deleted", variant: "info" });
          router.push("/posts");
        }}
        title="Delete this draft?"
        body="The draft and its scheduled targets are removed. Nothing has been published, so networks are unaffected."
        confirmLabel="Delete draft"
        danger
      />
      <ConfirmDialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        onConfirm={async () => {
          setConfirmCancel(false);
          await postsService.cancelScheduled(p.id);
          toast({ title: "Schedule canceled", description: "No content was published.", variant: "info" });
        }}
        title="Cancel this schedule?"
        body="All pending destinations will be canceled. Nothing has been published yet."
        confirmLabel="Cancel schedule"
        danger
      />
    </div>
  );
}
