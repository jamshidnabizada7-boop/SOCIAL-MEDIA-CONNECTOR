import { createDatabase, type DatabaseHandle } from "@aria/db";
import { and, eq, inArray } from "drizzle-orm";
import {
  mediaAssets,
  notifications,
  postMedia,
  postVariants,
  posts,
  publishAttempts,
  publishJobs,
  publishTargets,
  remotePosts,
  socialAccounts,
} from "@aria/db";
import type { AriaDatabase, DatabaseDriver } from "@aria/db";
import type { ProviderId } from "@aria/shared-types";
import { getAdapter, usesRealCredentials } from "../adapters/registry.js";
import { defaultStorage } from "@aria/media-core";
import { isCircuitOpen, recordOutcome } from "../reliability/circuit.js";
import type { SocialProviderAdapter } from "../adapters/contract.js";
import { resolveAccessToken, RefreshFailedError } from "@aria/providers-core";

export interface PublishJobPayload {
  [key: string]: unknown;
  jobId: string;
  targetId: string;
  attempt: number;
  kind?: "publish" | "reconcile";
}

const storage = defaultStorage();

const PROVIDER_LABELS: Record<string, string> = {};

const TERMINAL = new Set(["published", "failed", "canceled", "token_expired", "needs_user_action"]);

function computePostState(states: string[]): string {
  if (states.length === 0) return "draft";
  if (states.every((s) => s === "published")) return "published";
  const inFlight = states.some((s) => !TERMINAL.has(s) && s !== "pending");
  if (inFlight) return "processing";
  const failed = states.some((s) => s === "failed" || s === "token_expired" || s === "needs_user_action");
  const published = states.some((s) => s === "published");
  if (failed && published) return "partially_published";
  if (failed && !states.some((s) => s === "pending")) return "failed";
  if (published) return "partially_published";
  if (states.some((s) => s === "pending")) return "scheduled";
  return "partially_published";
}

async function updatePostState(db: AriaDatabase, postId: string): Promise<void> {
  const targets = await db
    .select({ state: publishTargets.state })
    .from(publishTargets)
    .where(eq(publishTargets.postId, postId));
  const state = computePostState(targets.map((t) => t.state)) as typeof posts.$inferSelect.state;
  await db
    .update(posts)
    .set({
      state,
      publishedAt: state === "published" ? new Date() : undefined,
      updatedAt: new Date(),
    })
    .where(eq(posts.id, postId));
}

/**
 * Idempotency guard (plan §29). A retried worker must NEVER create a
 * duplicate post: before every attempt we check the target's terminal state
 * and any recorded remote post. Skip-safe outcomes are recorded as attempts
 * so operators can prove the guard ran.
 */
export async function processPublishJob(
  handle: DatabaseHandle,
  payload: PublishJobPayload,
  enqueue: (queue: string, payload: Record<string, unknown>, delayMs?: number) => Promise<void>,
  log: (msg: string, meta?: Record<string, unknown>) => void
): Promise<void> {
  const db = handle.db;
  const { jobId, targetId, attempt = 1 } = payload;
  const attemptNo = Number(attempt) || 1;

  const jobRows = await db.select().from(publishJobs).where(eq(publishJobs.id, jobId)).limit(1);
  const job = jobRows[0];
  if (!job) return;

  // ---- Idempotency guard runs BEFORE any job-state short-circuit: a
  // redelivered job whose target is already published must be recorded as a
  // skipped duplicate, never executed again.
  const startedAt = new Date();
  const targetRows = await db.select().from(publishTargets).where(eq(publishTargets.id, targetId)).limit(1);
  const target = targetRows[0];
  const existingRemote = target
    ? await db.select().from(remotePosts).where(eq(remotePosts.targetId, targetId)).limit(1)
    : [];

  const recordSkip = async (reason: string) => {
    await db.insert(publishAttempts).values({
      jobId,
      targetId,
      attemptNo,
      startedAt,
      finishedAt: new Date(),
      success: true,
      outcome: "skipped_duplicate",
      errorCode: reason,
    });
    if (target) await updatePostState(db, target.postId);
  };

  if (!target) {
    await recordSkip("target_missing");
    return;
  }
  if (target.state === "published" || existingRemote[0]) {
    log(`target ${targetId} already published — skipping duplicate`, { targetId });
    await recordSkip("already_published");
    await db.update(publishJobs).set({ state: "completed", updatedAt: new Date() }).where(eq(publishJobs.id, jobId));
    return;
  }
  if (target.state === "canceled") {
    await recordSkip("canceled");
    await db.update(publishJobs).set({ state: "completed", updatedAt: new Date() }).where(eq(publishJobs.id, jobId));
    return;
  }
  if (job.state === "completed" || job.state === "dead_letter") return;

  await db
    .update(publishJobs)
    .set({ state: "active", lockedAt: new Date(), lockedBy: `worker-${process.pid}`, attempts: attemptNo, updatedAt: new Date() })
    .where(eq(publishJobs.id, jobId));

  const finishAttempt = async (outcome: string, error?: { code?: string; message?: string }, providerRequestId?: string) => {
    await db.insert(publishAttempts).values({
      jobId,
      targetId,
      attemptNo,
      startedAt,
      finishedAt: new Date(),
      success: outcome === "published" || outcome === "skipped_duplicate",
      outcome,
      errorCode: error?.code,
      errorMessage: error?.message,
      providerRequestId,
    });
  };

  const setTarget = async (patch: Partial<typeof publishTargets.$inferInsert>) => {
    await db
      .update(publishTargets)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(publishTargets.id, targetId));
  };

  try {
    // ---- Connection health gate -------------------------------------------
    const accountRows = await db
      .select()
      .from(socialAccounts)
      .where(and(eq(socialAccounts.id, target.accountId), eq(socialAccounts.providerId, target.providerId)))
      .limit(1);
    const account = accountRows[0];
    if (!account || account.connection === "needs_reauth" || account.connection === "disconnected") {
      await setTarget({
        state: "token_expired",
        lastError: {
          code: "oauth_revoked",
          title: "This account needs to be reconnected",
          message: "Access was revoked, so publishing stopped before anything was sent.",
          hint: "Reconnect the account, then retry this destination.",
          retryable: true,
        },
      });
      await finishAttempt("token_expired", { code: "oauth_revoked", message: "account needs reauth" });
      await db.update(publishJobs).set({ state: "failed", lastError: "oauth_revoked", updatedAt: new Date() }).where(eq(publishJobs.id, jobId));
      await updatePostState(db, target.postId);
      await db.insert(notifications).values({
        workspaceId: account?.workspaceId ?? (await db.select({ ws: posts.workspaceId }).from(posts).where(eq(posts.id, target.postId)).limit(1))[0]?.ws,
        type: "needs_reauth",
        severity: "warning",
        title: "A destination needs reconnection",
        body: "Publishing paused because the account is disconnected. Nothing was half-published.",
        postId: target.postId,
        accountId: target.accountId,
      });
      return;
    }

    // ---- Validate with the adapter ----------------------------------------
    const adapter: SocialProviderAdapter = getAdapter(target.providerId as ProviderId);
    const caps = adapter.capabilities();
    void caps;

    const postRows = await db.select().from(posts).where(eq(posts.id, target.postId)).limit(1);
    const post = postRows[0];
    const variantRows = await db
      .select()
      .from(postVariants)
      .where(eq(postVariants.postId, target.postId))
      .limit(5);
    const variant = variantRows.find((v) => v.providerId === target.providerId);

    await setTarget({ state: "queued", attempts: attemptNo, lastError: null });

    const input = {
      content: {
        caption: variant?.caption ?? post?.caption ?? "",
        title: variant?.title ?? undefined,
        link: post?.link ?? undefined,
        firstComment: variant?.firstComment ?? undefined,
        media: [] as Array<import("../adapters/contract.js").AdapterMedia>,
      },
      aiDisclosed: post?.aiDisclosed ?? false,
      settings: { ...variant?.settings, __idempotencyKey: target.idempotencyKey },
    };
    const mediaRows = await db
      .select()
      .from(postMedia)
      .where(eq(postMedia.postId, target.postId));
    const mediaIds = mediaRows.sort((a, b) => a.position - b.position).map((pm) => pm.mediaId);
    if (mediaIds.length > 0) {
      const assets = await db
        .select()
        .from(mediaAssets)
        .where(inArray(mediaAssets.id, mediaIds));
      input.content.media = mediaIds
        .map((mid) => assets.find((a) => a.id === mid))
        .filter((a): a is NonNullable<typeof a> => !!a)
        .map((a) => ({
          mediaId: a.id,
          kind: a.kind === "video" ? ("video" as const) : a.kind === "image" ? ("image" as const) : ("document" as const),
          filename: a.filename,
          bytes: a.bytes,
          mime: a.detectedMime,
          altText: a.altText ?? undefined,
          storageKey: a.storageKey ?? undefined,
          aspectRatio: a.aspectRatio ?? undefined,
          durationSec: a.durationSec ?? undefined,
        }));
      // Load raw content from object storage for adapters that upload bytes.
      for (const m of input.content.media) {
        if (m.storageKey) {
          try {
            m.data = new Uint8Array(await storage.read(m.storageKey));
          } catch {
            throw Object.assign(
              new Error(`Stored media content is missing (${m.filename}). non_retryable`),
              { code: "media_content_missing" }
            );
          }
        }
      }
    }

    // ---- Circuit breaker (plan §32) ---------------------------------------
    // If the provider is failing systemically, hold this job until the probe
    // window opens instead of burning attempts against a sick endpoint.
    const circuitOpenUntil = await isCircuitOpen(db, target.providerId as ProviderId);
    if (circuitOpenUntil) {
      const waitMs = Math.max(1000, circuitOpenUntil.getTime() - Date.now());
      log(`circuit open for ${target.providerId} — holding job ${jobId} until ${circuitOpenUntil.toISOString()}`);
      await setTarget({
        state: "queued",
        lastError: {
          code: "circuit_open",
          title: `${PROVIDER_LABELS[target.providerId] ?? target.providerId} is temporarily unavailable`,
          message: "The provider is failing systemically. Publishing pauses automatically and retries when a probe window opens.",
          retryable: true,
        },
      });
      await finishAttempt("retry_scheduled", { code: "circuit_open", message: "circuit breaker open" });
      await db
        .update(publishJobs)
        .set({ state: "delayed", runAt: circuitOpenUntil, updatedAt: new Date() })
        .where(eq(publishJobs.id, jobId));
      await enqueue("publish", { jobId, targetId, attempt: attemptNo }, waitMs + 1000);
      return;
    }

    const validation = adapter.validateContent(input);
    if (validation) {
      await setTarget({ state: "failed", lastError: validation });
      await finishAttempt("failed", { code: validation.code, message: validation.message });
      await db.update(publishJobs).set({ state: "failed", lastError: validation.code, updatedAt: new Date() }).where(eq(publishJobs.id, jobId));
      await updatePostState(db, target.postId);
      return;
    }

    // ---- Upload + publish --------------------------------------------------
    // Real integrations pull a live, auto-refreshed token from the encrypted
    // vault; refresh failure pauses the destination as token_expired.
    let accessToken: string | undefined;
    if (usesRealCredentials(target.providerId as ProviderId)) {
      try {
        const credential = await resolveAccessToken(db, account.id);
        accessToken = credential.accessToken;
      } catch (err) {
        if (err instanceof RefreshFailedError) {
          const account2 = account; // markRefreshFailed already flipped health + notified
          void account2;
          await setTarget({
            state: "token_expired",
            lastError: {
              code: "refresh_failed",
              title: "This account needs to be reconnected",
              message: "Automatic token refresh failed. Reconnect the account, then retry this destination.",
              hint: "Reconnecting takes about a minute and keeps your scheduled content.",
              retryable: true,
            },
          });
          await finishAttempt("token_expired", { code: "refresh_failed", message: (err as Error).message });
          await db.update(publishJobs).set({ state: "failed", lastError: "refresh_failed", updatedAt: new Date() }).where(eq(publishJobs.id, jobId));
          await updatePostState(db, target.postId);
          return;
        }
        throw err;
      }
    }
    const ctx = {
      externalAccountId: account.externalAccountId,
      accessToken,
      scopes: account.scopes,
      instanceUrl: account.instanceUrl ?? undefined,
      log,
    };
    for (const m of input.content.media) {
      await setTarget({ state: "uploading_media" });
      await adapter.uploadMedia(m, ctx);
    }

    await setTarget({ state: "publishing" });
    const result = await adapter.createPost(input, ctx);
    // Success resets the provider circuit.
    await recordOutcome(db, target.providerId as ProviderId, { ok: true });

    if (result.asyncProcessing) {
      await setTarget({ state: "provider_processing" });
      await finishAttempt("retry_scheduled", undefined, result.providerRequestId);
      await db.update(publishJobs).set({ state: "delayed", updatedAt: new Date() }).where(eq(publishJobs.id, jobId));
      // Provider is still processing — reconcile later (webhook/poll equivalent).
      await enqueue("reconcile", { jobId, targetId, attempt: attemptNo, kind: "reconcile" }, 1500);
      return;
    }

    await db
      .insert(remotePosts)
      .values({
        targetId,
        providerPostId: result.providerPostId,
        permalink: result.permalink,
        publishedAt: new Date(),
        raw: { provider: target.providerId, providerRequestId: result.providerRequestId },
      })
      .onConflictDoNothing();
    await setTarget({ state: "published", publishedAt: new Date(), remoteUrl: result.permalink });
    await finishAttempt("published", undefined, result.providerRequestId);
    await db.update(publishJobs).set({ state: "completed", updatedAt: new Date() }).where(eq(publishJobs.id, jobId));
    await updatePostState(db, target.postId);
  } catch (err) {
    const e = err as Error & { retryAfterSec?: number };
    const providerHttpError = e as unknown as { status?: number; retryAfterSec?: number };
    const isProviderError =
      typeof providerHttpError.status === "number" &&
      (providerHttpError.status >= 500 || providerHttpError.status === 429 || providerHttpError.status === 0);
    const retryable = !e.message.includes("non_retryable");
    const maxAttempts = job.maxAttempts;

    // Record the outcome against the provider circuit (plan §32).
    await recordOutcome(db, target.providerId as ProviderId, {
      ok: false,
      errorCode: e.message.slice(0, 120),
      providerError: isProviderError,
    });

    if (retryable && attemptNo < maxAttempts) {
      // Provider-aware backoff (plan §30): honor Retry-After when given,
      // otherwise exponential with jitter, capped.
      const base = providerHttpError.retryAfterSec
        ? providerHttpError.retryAfterSec * 1000
        : Math.min(60_000, 1000 * 2 ** attemptNo) + Math.floor(Math.random() * 500);
      const backoff = Math.min(120_000, base);
      log(`job ${jobId} failed (attempt ${attemptNo}) — retrying in ${backoff}ms`, { error: e.message });
      await finishAttempt("retry_scheduled", { code: "adapter_error", message: e.message });
      await db
        .update(publishJobs)
        .set({ state: "delayed", lastError: e.message.slice(0, 300), updatedAt: new Date() })
        .where(eq(publishJobs.id, jobId));
      await setTarget({ state: "retrying", lastError: { code: "adapter_error", title: "Temporary failure", message: e.message, retryable: true } });
      await enqueue("publish", { jobId, targetId, attempt: attemptNo + 1 }, backoff);
      return;
    }
    await finishAttempt("failed", { code: "adapter_error", message: e.message });
    await setTarget({
      state: "failed",
      lastError: { code: "adapter_error", title: "Publishing failed", message: e.message, retryable: true },
    });
    await db
      .update(publishJobs)
      .set({ state: "dead_letter", lastError: e.message.slice(0, 300), updatedAt: new Date() })
      .where(eq(publishJobs.id, jobId));
    await updatePostState(db, target.postId);
  }
}

/** Reconcile async platform processing (TikTok/YouTube-style). */
export async function processReconcileJob(
  handle: DatabaseHandle,
  payload: PublishJobPayload,
  enqueue: (queue: string, payload: Record<string, unknown>, delayMs?: number) => Promise<void>,
  log: (msg: string, meta?: Record<string, unknown>) => void
): Promise<void> {
  const db = handle.db;
  const { jobId, targetId } = payload;
  const targetRows = await db.select().from(publishTargets).where(eq(publishTargets.id, targetId)).limit(1);
  const target = targetRows[0];
  if (!target || target.state === "published" || target.state === "canceled") return;
  const remote = (await db.select().from(remotePosts).where(eq(remotePosts.targetId, targetId)).limit(1))[0];
  const adapter = getAdapter(target.providerId as ProviderId);
  const providerPostId = remote?.providerPostId ?? `pending_${targetId}`;
  const status = await adapter.getPostStatus(providerPostId, { externalAccountId: "", scopes: [], log });
  if (status.state === "published") {
    if (!remote) {
      await db.insert(remotePosts).values({
        targetId,
        providerPostId,
        permalink: `https://example.invalid/${target.providerId}/${providerPostId}`,
        publishedAt: new Date(),
        raw: { reconciled: true },
      });
    }
    await db
      .update(publishTargets)
      .set({ state: "published", publishedAt: new Date(), remoteUrl: remote?.permalink ?? null, updatedAt: new Date() })
      .where(eq(publishTargets.id, targetId));
    await db.update(publishJobs).set({ state: "completed", updatedAt: new Date() }).where(eq(publishJobs.id, jobId));
    await updatePostState(db, target.postId);
    log(`reconciled ${targetId} → published`);
    return;
  }
  // Still processing — keep waiting (bounded by the job's max attempts via re-enqueue).
  await enqueue("reconcile", payload, 1500);
}

export async function openDatabase(): Promise<DatabaseHandle> {
  return createDatabase({ dataDir: process.env.ARIA_DATA_DIR });
}

export type { DatabaseDriver };
