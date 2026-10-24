import { createDatabase, signMediaQuery, type DatabaseHandle } from "@aria/db";
import { eq, inArray } from "drizzle-orm";
import {
  mediaAssets,
  notifications,
  postMedia,
  postVariants,
  posts,
  publishAttempts,
  publishTargets,
  remotePosts,
  socialAccounts,
} from "@aria/db";
import type { AriaDatabase, DatabaseDriver } from "@aria/db";
import type { ProviderId } from "@aria/shared-types";
import { PROVIDERS } from "@aria/shared-types";
import { defaultStorage } from "@aria/media-core";
import { appBaseUrl, ProviderHttpError, resolveAccessToken, RefreshFailedError } from "@aria/providers-core";
import { getAdapter, usesRealCredentials } from "../adapters/registry.js";
import type { AdapterAccountContext, AdapterMedia, AdapterPublishInput, PublishErrorInfo, SocialProviderAdapter } from "../adapters/contract.js";
import { isCircuitOpen, recordOutcome } from "../reliability/circuit.js";
import { backoffMs, jobOutcome, type ClaimedJob } from "./jobs.js";
import { emailAlert } from "../mailer.js";

export type Logger = (msg: string, meta?: Record<string, unknown>) => void;

/** Resolved per use so ARIA_STORAGE_DIR is read at runtime, not import time. */
let storageInstance: ReturnType<typeof defaultStorage> | undefined;
const storage = () => (storageInstance ??= defaultStorage());

const TERMINAL = new Set(["published", "failed", "canceled", "token_expired", "needs_user_action"]);

/** Providers whose create call is idempotent (an Idempotency-Key), so an ambiguous failure may be retried. */
const IDEMPOTENT_CREATE = new Set<string>(["mastodon"]);

/** Reconcile polling: first check after 15 s, backing off to 10 min, for up to 24 h. */
const RECONCILE_FIRST_MS = 15_000;
const RECONCILE_CAP_MS = 10 * 60_000;
const RECONCILE_MAX_AGE_MS = 24 * 3_600_000;
const RECONCILE_MAX_POLLS = 200;

/** Signed media links handed to providers that fetch media themselves. */
const PUBLIC_MEDIA_TTL_SEC = 6 * 3600;

function providerLabel(id: string): string {
  return PROVIDERS[id as ProviderId]?.name ?? id;
}

function computePostState(states: string[]): string {
  if (states.length === 0) return "draft";
  if (states.every((s) => s === "published")) return "published";
  if (states.every((s) => s === "canceled")) return "canceled";
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

export async function updatePostState(db: AriaDatabase, postId: string): Promise<void> {
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

/** URL a provider can fetch for this media, when the API has a public https origin. */
function publicMediaUrl(mediaId: string): string | undefined {
  const base = (process.env.APP_PUBLIC_MEDIA_BASE_URL ?? appBaseUrl()).replace(/\/+$/, "");
  if (!base.startsWith("https://")) return undefined;
  return `${base}/v1/media/${mediaId}/public?${signMediaQuery(mediaId, PUBLIC_MEDIA_TTL_SEC)}`;
}

/** Network-level failure where we can't know whether the provider acted on the request. */
function isAmbiguous(err: unknown): boolean {
  if (err instanceof ProviderHttpError) return err.status === 0 || err.status === 504;
  const name = (err as Error)?.name;
  return name === "AbortError" || name === "TimeoutError" || (err as Error)?.message === "fetch failed";
}

function classify(adapter: SocialProviderAdapter, err: unknown): PublishErrorInfo & { status?: number } {
  const e = err as Error & { code?: string; status?: number };
  let info: PublishErrorInfo;
  try {
    info = adapter.normalizeError(err);
  } catch {
    info = { code: e.code ?? "adapter_error", title: "Publishing failed", message: e.message ?? "Unknown error", retryable: false };
  }
  const status = err instanceof ProviderHttpError ? err.status : e.status;
  let retryable = info.retryable;
  if (typeof status === "number" && (status >= 500 || status === 429)) retryable = true;
  if (e.message?.includes("non_retryable")) retryable = false;
  return {
    ...info,
    message: (info.message ?? e.message ?? "").replace(/\s*non_retryable\s*/g, " ").trim(),
    retryable,
    status,
  };
}

async function notify(
  db: AriaDatabase,
  workspaceId: string | undefined,
  n: { type: string; severity: "info" | "success" | "warning" | "error"; title: string; body: string; postId?: string; accountId?: string }
) {
  if (!workspaceId) return;
  await db.insert(notifications).values({ workspaceId, ...n });
  // Email is best-effort and never blocks or fails the job.
  void emailAlert(db, workspaceId, n, () => {});
}

/**
 * Publishes one target (plan §29). Idempotency first: a target that is
 * already live, or has a recorded remote post, is never sent again — the
 * attempt is logged as skipped_duplicate so operators can prove the guard ran.
 * Every exit path settles the job row (completed / delayed / failed / dead_letter).
 */
export async function processPublishJob(handle: DatabaseHandle, job: ClaimedJob, log: Logger): Promise<void> {
  const db = handle.db;
  const targetId = job.targetId;
  const attemptNo = job.attempts + 1;
  const startedAt = new Date();

  const target = (await db.select().from(publishTargets).where(eq(publishTargets.id, targetId)).limit(1))[0];
  const existingRemote = target
    ? (await db.select().from(remotePosts).where(eq(remotePosts.targetId, targetId)).limit(1))[0]
    : undefined;

  const recordAttempt = async (
    outcome: string,
    error?: { code?: string; message?: string },
    providerRequestId?: string
  ) => {
    await db.insert(publishAttempts).values({
      jobId: job.id,
      targetId,
      attemptNo,
      startedAt,
      finishedAt: new Date(),
      success: outcome === "published" || outcome === "skipped_duplicate" || outcome === "provider_processing",
      outcome,
      errorCode: error?.code,
      errorMessage: error?.message?.slice(0, 1000),
      providerRequestId,
    });
  };
  const setTarget = async (patch: Partial<typeof publishTargets.$inferInsert>) => {
    await db
      .update(publishTargets)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(publishTargets.id, targetId));
  };

  if (!target) {
    await recordAttempt("skipped_duplicate", { code: "target_missing" });
    await jobOutcome.completed(db, job.id);
    return;
  }
  if (existingRemote && target.state === "provider_processing") {
    // A redelivered job for content the provider is still processing: keep polling, never re-create.
    await jobOutcome.toReconcile(db, job.id, new Date(Date.now() + RECONCILE_FIRST_MS), RECONCILE_MAX_POLLS);
    return;
  }
  if (target.state === "published" || existingRemote) {
    log(`target ${targetId} already published — skipping duplicate`, { targetId });
    if (target.state !== "published") {
      await setTarget({ state: "published", publishedAt: existingRemote?.publishedAt ?? new Date(), remoteUrl: existingRemote?.permalink ?? null });
    }
    await recordAttempt("skipped_duplicate", { code: "already_published" });
    await jobOutcome.completed(db, job.id);
    await updatePostState(db, target.postId);
    return;
  }
  if (target.state === "canceled") {
    await recordAttempt("skipped_duplicate", { code: "canceled" });
    await jobOutcome.completed(db, job.id);
    return;
  }
  const workspaceId = (await db.select({ ws: posts.workspaceId }).from(posts).where(eq(posts.id, target.postId)).limit(1))[0]?.ws;

  if (job.recovered && target.state === "publishing") {
    // The previous worker died mid-request: the provider may or may not have
    // created the post. Re-sending could duplicate it, so a human decides.
    const error = {
      code: "outcome_unknown",
      title: `We couldn't confirm the ${providerLabel(target.providerId)} post`,
      message: "Publishing was interrupted while the network was processing the request, so it may or may not have gone out.",
      hint: `Check the ${providerLabel(target.providerId)} account. If the post isn't there, retry this destination.`,
      retryable: true,
    };
    await setTarget({ state: "needs_user_action", lastError: error });
    await recordAttempt("failed", { code: error.code, message: error.message });
    await jobOutcome.failed(db, job.id, error.code);
    await updatePostState(db, target.postId);
    await notify(db, workspaceId, { type: "post_failed", severity: "warning", title: error.title, body: error.hint, postId: target.postId, accountId: target.accountId });
    return;
  }

  const adapter: SocialProviderAdapter = getAdapter(target.providerId as ProviderId);
  let phase: "prepare" | "upload" | "publishing" = "prepare";

  try {
    // ---- Connection health gate -------------------------------------------
    const account = (await db.select().from(socialAccounts).where(eq(socialAccounts.id, target.accountId)).limit(1))[0];
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
      await recordAttempt("token_expired", { code: "oauth_revoked", message: "account needs reauth" });
      await jobOutcome.failed(db, job.id, "oauth_revoked");
      await updatePostState(db, target.postId);
      await notify(db, account?.workspaceId ?? workspaceId, {
        type: "needs_reauth",
        severity: "warning",
        title: "A destination needs reconnection",
        body: "Publishing paused because the account is disconnected. Nothing was half-published.",
        postId: target.postId,
        accountId: target.accountId,
      });
      return;
    }

    // ---- Build the payload --------------------------------------------------
    const post = (await db.select().from(posts).where(eq(posts.id, target.postId)).limit(1))[0];
    const variant = (await db.select().from(postVariants).where(eq(postVariants.postId, target.postId))).find(
      (v) => v.providerId === target.providerId
    );
    await setTarget({ state: "validating", attempts: attemptNo, lastError: null });

    const input: AdapterPublishInput = {
      content: {
        caption: variant?.caption ?? post?.caption ?? "",
        // posts.title is an internal label and is never published.
        title: variant?.title ?? undefined,
        link: post?.link ?? undefined,
        firstComment: variant?.firstComment ?? undefined,
        media: [] as AdapterMedia[],
      },
      aiDisclosed: post?.aiDisclosed ?? false,
      settings: { ...variant?.settings, __idempotencyKey: target.idempotencyKey },
    };
    const mediaRows = await db.select().from(postMedia).where(eq(postMedia.postId, target.postId));
    const mediaIds = mediaRows.sort((a, b) => a.position - b.position).map((pm) => pm.mediaId);
    if (mediaIds.length > 0) {
      const assets = await db.select().from(mediaAssets).where(inArray(mediaAssets.id, mediaIds));
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
          publicUrl: publicMediaUrl(a.id),
        }));
      for (const m of input.content.media) {
        if (!m.storageKey) continue;
        try {
          m.data = new Uint8Array(await storage().read(m.storageKey));
        } catch {
          // Missing bytes fail validation below with a translated message.
          m.data = undefined;
        }
      }
    }

    // ---- Circuit breaker (plan §32) ---------------------------------------
    // A systemically failing provider holds the job until the probe window
    // opens instead of burning attempts against a sick endpoint.
    const circuitOpenUntil = await isCircuitOpen(db, target.providerId as ProviderId);
    if (circuitOpenUntil) {
      log(`circuit open for ${target.providerId} — holding job ${job.id} until ${circuitOpenUntil.toISOString()}`);
      await setTarget({
        state: "queued",
        lastError: {
          code: "circuit_open",
          title: `${providerLabel(target.providerId)} is temporarily unavailable`,
          message: "The network is failing for everyone right now. Publishing pauses automatically and resumes when it recovers.",
          retryable: true,
        },
      });
      await recordAttempt("retry_scheduled", { code: "circuit_open", message: "circuit breaker open" });
      await jobOutcome.retryAt(db, job, new Date(circuitOpenUntil.getTime() + 1000), "circuit_open", false);
      return;
    }

    const missing = input.content.media.find((m) => m.storageKey && !m.data);
    const validation =
      adapter.validateContent(input) ??
      (missing
        ? {
            code: "media_content_missing",
            title: "Media content is unavailable",
            message: `The stored file for “${missing.filename}” could not be loaded. Re-upload it and retry.`,
            retryable: false,
          }
        : null);
    if (validation) {
      await setTarget({ state: "failed", lastError: validation });
      await recordAttempt("failed", { code: validation.code, message: validation.message });
      await jobOutcome.failed(db, job.id, validation.code);
      await updatePostState(db, target.postId);
      await notify(db, workspaceId, {
        type: "post_failed",
        severity: "error",
        title: validation.title,
        body: validation.message,
        postId: target.postId,
        accountId: target.accountId,
      });
      return;
    }

    // ---- Credentials ------------------------------------------------------
    let accessToken: string | undefined;
    if (usesRealCredentials(target.providerId as ProviderId)) {
      try {
        accessToken = (await resolveAccessToken(db, account.id)).accessToken;
      } catch (err) {
        if (err instanceof RefreshFailedError) {
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
          await recordAttempt("token_expired", { code: "refresh_failed", message: err.message });
          await jobOutcome.failed(db, job.id, "refresh_failed");
          await updatePostState(db, target.postId);
          return;
        }
        throw err;
      }
    }
    const ctx: AdapterAccountContext = {
      externalAccountId: account.externalAccountId,
      accessToken,
      scopes: account.scopes,
      instanceUrl: account.instanceUrl ?? undefined,
      log,
    };

    // ---- Upload + publish -------------------------------------------------
    phase = "upload";
    for (const m of input.content.media) {
      await setTarget({ state: "uploading_media" });
      const uploaded = await adapter.uploadMedia(m, ctx);
      m.remoteMediaId = uploaded.remoteMediaId || undefined;
    }

    phase = "publishing";
    await setTarget({ state: "publishing" });
    const result = await adapter.createPost(input, ctx);
    await recordOutcome(db, target.providerId as ProviderId, { ok: true });

    // Record the provider's id immediately: from here on this target can never be created again.
    await db
      .insert(remotePosts)
      .values({
        targetId,
        providerPostId: result.providerPostId,
        permalink: result.permalink,
        publishedAt: result.asyncProcessing ? null : new Date(),
        raw: { provider: target.providerId, providerRequestId: result.providerRequestId },
      })
      .onConflictDoNothing();

    if (result.asyncProcessing) {
      await setTarget({ state: "provider_processing", remoteUrl: result.permalink ?? null });
      await recordAttempt("provider_processing", undefined, result.providerRequestId);
      await jobOutcome.toReconcile(db, job.id, new Date(Date.now() + RECONCILE_FIRST_MS), RECONCILE_MAX_POLLS);
      await updatePostState(db, target.postId);
      log(`target ${targetId} accepted by ${target.providerId}; reconciling`, { providerPostId: result.providerPostId });
      return;
    }

    await setTarget({ state: "published", publishedAt: new Date(), remoteUrl: result.permalink ?? null, lastError: null });
    await recordAttempt("published", undefined, result.providerRequestId);
    await jobOutcome.completed(db, job.id);
    await updatePostState(db, target.postId);
  } catch (err) {
    const info = classify(adapter, err);
    const maxAttempts = job.maxAttempts;
    log(`job ${job.id} failed during ${phase} (attempt ${attemptNo}/${maxAttempts})`, { code: info.code, status: info.status, message: info.message });

    await recordOutcome(db, target.providerId as ProviderId, {
      ok: false,
      errorCode: info.code.slice(0, 120),
      providerError: typeof info.status === "number" && (info.status >= 500 || info.status === 429 || info.status === 0),
    });

    if (info.status === 401) {
      // The provider rejected the credential itself — retrying can't help.
      await db
        .update(socialAccounts)
        .set({ connection: "needs_reauth", connectionNote: `${providerLabel(target.providerId)} rejected the stored access. Reconnect the account.` })
        .where(eq(socialAccounts.id, target.accountId));
      await setTarget({
        state: "token_expired",
        lastError: { ...info, title: "This account needs to be reconnected", hint: "Reconnect the account, then retry this destination.", retryable: true },
      });
      await recordAttempt("token_expired", { code: info.code, message: info.message });
      await jobOutcome.failed(db, job.id, info.code);
      await updatePostState(db, target.postId);
      await notify(db, workspaceId, {
        type: "needs_reauth",
        severity: "warning",
        title: `${providerLabel(target.providerId)} needs to be reconnected`,
        body: "The network rejected the saved access, so this post wasn't sent.",
        postId: target.postId,
        accountId: target.accountId,
      });
      return;
    }

    if (phase === "publishing" && isAmbiguous(err) && !IDEMPOTENT_CREATE.has(target.providerId) && process.env.ARIA_ADAPTER_MODE !== "mock") {
      const error = {
        code: "outcome_unknown",
        title: `We couldn't confirm the ${providerLabel(target.providerId)} post`,
        message: "The network didn't answer in time, so the post may or may not have gone out.",
        hint: `Check the ${providerLabel(target.providerId)} account. If the post isn't there, retry this destination.`,
        retryable: true,
        technical: info.technical,
      };
      await setTarget({ state: "needs_user_action", lastError: error });
      await recordAttempt("failed", { code: error.code, message: info.message });
      await jobOutcome.failed(db, job.id, error.code);
      await updatePostState(db, target.postId);
      await notify(db, workspaceId, { type: "post_failed", severity: "warning", title: error.title, body: error.hint, postId: target.postId, accountId: target.accountId });
      return;
    }

    if (info.retryable && attemptNo < maxAttempts) {
      // Provider-aware backoff (plan §30): honor Retry-After, else exponential with jitter.
      const retryAfterMs = err instanceof ProviderHttpError && err.retryAfterSec ? err.retryAfterSec * 1000 : 0;
      const delay = Math.min(15 * 60_000, Math.max(retryAfterMs, backoffMs(attemptNo, 5_000, 10 * 60_000)));
      await recordAttempt("retry_scheduled", { code: info.code, message: info.message });
      await setTarget({ state: "retrying", lastError: { ...info, title: "Temporary failure — retrying automatically" } });
      await jobOutcome.retryAt(db, job, new Date(Date.now() + delay), info.code);
      return;
    }

    await recordAttempt("failed", { code: info.code, message: info.message });
    await setTarget({ state: "failed", lastError: { code: info.code, title: info.title, message: info.message, hint: info.hint, retryable: true, technical: info.technical } });
    await jobOutcome.deadLetter(db, job, info.code);
    await updatePostState(db, target.postId);
    await notify(db, workspaceId, {
      type: "post_failed",
      severity: "error",
      title: `Publishing to ${providerLabel(target.providerId)} failed`,
      body: info.message || "The network rejected the post. Open it to see details and retry.",
      postId: target.postId,
      accountId: target.accountId,
    });
  }
}

/**
 * Polls async providers (YouTube encoding, Facebook video, Mastodon scheduled)
 * until the post is live, fails, or 24 h pass. Uses the provider id recorded
 * at create time and a live credential.
 */
export async function processReconcileJob(handle: DatabaseHandle, job: ClaimedJob, log: Logger): Promise<void> {
  const db = handle.db;
  const target = (await db.select().from(publishTargets).where(eq(publishTargets.id, job.targetId)).limit(1))[0];
  if (!target || target.state === "published" || target.state === "canceled" || TERMINAL.has(target.state)) {
    await jobOutcome.completed(db, job.id);
    return;
  }
  const workspaceId = (await db.select({ ws: posts.workspaceId }).from(posts).where(eq(posts.id, target.postId)).limit(1))[0]?.ws;
  const remote = (await db.select().from(remotePosts).where(eq(remotePosts.targetId, target.id)).limit(1))[0];
  const giveUp = async (error: PublishErrorInfo) => {
    await db.update(publishTargets).set({ state: "needs_user_action", lastError: error, updatedAt: new Date() }).where(eq(publishTargets.id, target.id));
    await jobOutcome.failed(db, job.id, error.code);
    await updatePostState(db, target.postId);
    await notify(db, workspaceId, { type: "post_failed", severity: "warning", title: error.title, body: error.message, postId: target.postId, accountId: target.accountId });
  };
  if (!remote) {
    await giveUp({
      code: "remote_missing",
      title: `We lost track of the ${providerLabel(target.providerId)} upload`,
      message: "The network accepted the upload but its id wasn't recorded. Check the account before retrying.",
      retryable: true,
    });
    return;
  }

  const adapter = getAdapter(target.providerId as ProviderId);
  const account = (await db.select().from(socialAccounts).where(eq(socialAccounts.id, target.accountId)).limit(1))[0];
  const polls = job.attempts + 1;
  const scheduleNext = async (reason: string) => {
    const age = Date.now() - job.createdAt.getTime();
    if (polls >= job.maxAttempts || age > RECONCILE_MAX_AGE_MS) {
      await giveUp({
        code: "processing_timeout",
        title: `${providerLabel(target.providerId)} is still processing`,
        message: "The network accepted the post but hasn't finished processing it after 24 hours. Check the account.",
        retryable: false,
      });
      return;
    }
    await jobOutcome.retryAt(db, job, new Date(Date.now() + backoffMs(polls, RECONCILE_FIRST_MS, RECONCILE_CAP_MS)), reason);
  };

  let status: Awaited<ReturnType<SocialProviderAdapter["getPostStatus"]>>;
  try {
    const accessToken =
      account && usesRealCredentials(target.providerId as ProviderId) ? (await resolveAccessToken(db, account.id)).accessToken : undefined;
    status = await adapter.getPostStatus(remote.providerPostId, {
      externalAccountId: account?.externalAccountId ?? "",
      accessToken,
      scopes: account?.scopes ?? [],
      instanceUrl: account?.instanceUrl ?? undefined,
      log,
    });
  } catch (err) {
    if (err instanceof RefreshFailedError) {
      await giveUp({
        code: "refresh_failed",
        title: "This account needs to be reconnected",
        message: "We couldn't check the upload's status because the account's access expired. Reconnect it and check the post.",
        retryable: true,
      });
      return;
    }
    log(`reconcile status check failed for ${target.id}`, { error: (err as Error).message });
    await scheduleNext("status_check_failed");
    return;
  }

  if (status.state === "published") {
    await db.update(remotePosts).set({ publishedAt: new Date() }).where(eq(remotePosts.id, remote.id));
    await db
      .update(publishTargets)
      .set({ state: "published", publishedAt: new Date(), remoteUrl: remote.permalink ?? null, lastError: null, updatedAt: new Date() })
      .where(eq(publishTargets.id, target.id));
    await jobOutcome.completed(db, job.id);
    await updatePostState(db, target.postId);
    log(`reconciled ${target.id} → published`);
    return;
  }
  if (status.state === "failed") {
    const error = status.error ?? {
      code: "provider_processing_failed",
      title: `${providerLabel(target.providerId)} couldn't process the post`,
      message: "The network rejected the upload during processing.",
      retryable: true,
    };
    await db.update(publishTargets).set({ state: "failed", lastError: error, updatedAt: new Date() }).where(eq(publishTargets.id, target.id));
    await jobOutcome.failed(db, job.id, error.code);
    await updatePostState(db, target.postId);
    await notify(db, workspaceId, { type: "post_failed", severity: "error", title: error.title, body: error.message, postId: target.postId, accountId: target.accountId });
    return;
  }
  await scheduleNext("still_processing");
}

export async function openDatabase(): Promise<DatabaseHandle> {
  return createDatabase({ dataDir: process.env.ARIA_DATA_DIR });
}

export type { DatabaseDriver };
