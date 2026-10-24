import { and, desc, eq, inArray } from "drizzle-orm";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import {
  mediaAssets,
  postMedia,
  postVersions,
  postVariants,
  posts,
  publishJobs,
  publishTargets,
  remotePosts,
  socialAccounts,
} from "@aria/db";
import type { DbOrTx } from "@aria/db";
import type { PostState, TargetState } from "@aria/shared-types";
import { requireWorkspacePermission } from "../../plugins/auth.js";
import { writeAudit } from "../../lib/audit.js";
import { checkScheduledPostLimit } from "../../lib/limits.js";

const variantSchema = z.object({
  providerId: z.string().min(1).max(40),
  caption: z.string().max(100_000).nullable().optional(),
  title: z.string().max(200).nullable().optional(),
  firstComment: z.string().max(10_000).nullable().optional(),
  /** e.g. { boardId } for Pinterest, { privacy, madeForKids } for YouTube. */
  settings: z.record(z.string(), z.unknown()).default({}),
});

const createPostSchema = z.object({
  title: z.string().max(120).optional(),
  caption: z.string().max(100_000).default(""),
  link: z.string().url().max(2000).optional(),
  brandId: z.string().uuid().optional(),
  campaign: z.string().max(80).optional(),
  labels: z.array(z.string().max(40)).max(10).default([]),
  accountIds: z.array(z.string().uuid()).min(0).max(50).default([]),
  /** Media attached to the post, in display order. Assets must belong to the workspace. */
  mediaIds: z.array(z.string().uuid()).max(20).default([]),
  variants: z.array(variantSchema).max(20).default([]),
  aiDisclosed: z.boolean().default(false),
  scheduledAt: z.string().datetime().optional(),
});

const patchPostSchema = z.object({
  title: z.string().max(120).optional(),
  caption: z.string().max(100_000).optional(),
  link: z.string().url().max(2000).nullable().optional(),
  campaign: z.string().max(80).nullable().optional(),
  labels: z.array(z.string().max(40)).max(10).optional(),
  mediaIds: z.array(z.string().uuid()).max(20).optional(),
  variants: z.array(variantSchema).max(20).optional(),
  aiDisclosed: z.boolean().optional(),
  /** Replaces the destinations. Only targets that never published can be removed. */
  accountIds: z.array(z.string().uuid()).max(50).optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
});

const TARGET_TERMINAL = new Set<TargetState>([
  "published",
  "failed",
  "canceled",
  "token_expired",
  "needs_user_action",
]);

/** Targets that may be (re)dispatched by publish-now. In-flight states are excluded so nothing runs twice. */
const TARGET_DISPATCHABLE = new Set<TargetState>(["pending", "failed", "token_expired", "needs_user_action"]);

/** Job states that will still fire; superseded when a post is rescheduled, published now or canceled. */
const LIVE_JOB_STATES = ["pending", "delayed"] as const;

function notFound(reply: FastifyReply, what = "Post") {
  return reply.status(404).send({ error: { code: "not_found", message: `${what} not found.` } });
}

/** Loads a post only if it belongs to the workspace — never by id alone. */
async function findPost(db: DbOrTx, workspaceId: string, postId: string) {
  return (
    await db
      .select()
      .from(posts)
      .where(and(eq(posts.id, postId), eq(posts.workspaceId, workspaceId)))
      .limit(1)
  )[0];
}

async function postWithTargets(db: DbOrTx, workspaceId: string, postId: string) {
  const post = await findPost(db, workspaceId, postId);
  if (!post) return null;
  const targets = await db
    .select({
      id: publishTargets.id,
      accountId: publishTargets.accountId,
      providerId: publishTargets.providerId,
      state: publishTargets.state,
      attempts: publishTargets.attempts,
      idempotencyKey: publishTargets.idempotencyKey,
      scheduledAt: publishTargets.scheduledAt,
      publishedAt: publishTargets.publishedAt,
      remoteUrl: publishTargets.remoteUrl,
      lastError: publishTargets.lastError,
      accountName: socialAccounts.displayName,
      accountHandle: socialAccounts.handle,
    })
    .from(publishTargets)
    .innerJoin(socialAccounts, eq(socialAccounts.id, publishTargets.accountId))
    .where(eq(publishTargets.postId, postId));
  const media = await db
    .select({ mediaId: postMedia.mediaId, position: postMedia.position })
    .from(postMedia)
    .where(eq(postMedia.postId, postId));
  const variants = await db.select().from(postVariants).where(eq(postVariants.postId, postId));
  return {
    ...post,
    targets,
    mediaIds: media.sort((a, b) => a.position - b.position).map((m) => m.mediaId),
    variants,
  };
}

async function snapshotVersion(db: DbOrTx, postId: string, userId: string) {
  const post = (await db.select().from(posts).where(eq(posts.id, postId)).limit(1))[0];
  if (!post) return;
  const existing = await db
    .select({ version: postVersions.version })
    .from(postVersions)
    .where(eq(postVersions.postId, postId));
  const next = existing.reduce((m, v) => Math.max(m, v.version), 0) + 1;
  const media = await db
    .select({ id: postMedia.mediaId, position: postMedia.position })
    .from(postMedia)
    .where(eq(postMedia.postId, postId));
  await db.insert(postVersions).values({
    postId,
    version: next,
    caption: post.caption,
    mediaIds: media.sort((a, b) => a.position - b.position).map((m) => m.id),
    byUserId: userId,
  });
}

/** Creates a job row for a target; the worker's sweep dispatches it at runAt. */
async function enqueueTarget(db: DbOrTx, targetId: string, runAt: Date, state: "pending" | "delayed") {
  await db.insert(publishJobs).values({ targetId, state, runAt, queue: "publish" });
}

/** Retires every job that would still fire for these targets. */
async function supersedeJobs(db: DbOrTx, targetIds: string[], reason: string) {
  if (targetIds.length === 0) return;
  await db
    .update(publishJobs)
    .set({ state: "dead_letter", lastError: reason, updatedAt: new Date() })
    .where(and(inArray(publishJobs.targetId, targetIds), inArray(publishJobs.state, [...LIVE_JOB_STATES])));
}

/** Returns the ids from `mediaIds` that are NOT owned by the workspace. */
async function foreignMedia(db: DbOrTx, workspaceId: string, mediaIds: string[]) {
  if (mediaIds.length === 0) return [];
  const owned = await db
    .select({ id: mediaAssets.id })
    .from(mediaAssets)
    .where(and(eq(mediaAssets.workspaceId, workspaceId), inArray(mediaAssets.id, mediaIds)));
  const ok = new Set(owned.map((o) => o.id));
  return mediaIds.filter((id) => !ok.has(id));
}

async function replaceMedia(db: DbOrTx, postId: string, mediaIds: string[]) {
  await db.delete(postMedia).where(eq(postMedia.postId, postId));
  const unique = [...new Set(mediaIds)];
  if (unique.length > 0) {
    await db.insert(postMedia).values(unique.map((mediaId, position) => ({ postId, mediaId, position })));
  }
}

async function replaceVariants(
  db: DbOrTx,
  postId: string,
  userId: string,
  variants: z.infer<typeof variantSchema>[]
) {
  await db.delete(postVariants).where(eq(postVariants.postId, postId));
  const byProvider = new Map(variants.map((v) => [v.providerId, v]));
  if (byProvider.size === 0) return;
  await db.insert(postVariants).values(
    [...byProvider.values()].map((v) => ({
      postId,
      providerId: v.providerId,
      caption: v.caption ?? null,
      title: v.title ?? null,
      firstComment: v.firstComment ?? null,
      settings: v.settings,
      updatedBy: userId,
    }))
  );
}

/** Moves every non-terminal target (and its live jobs) to a new time. */
async function rescheduleTargets(db: DbOrTx, postId: string, when: Date) {
  const targets = await db.select().from(publishTargets).where(eq(publishTargets.postId, postId));
  const live = targets.filter((t) => !TARGET_TERMINAL.has(t.state));
  await supersedeJobs(db, live.map((t) => t.id), "rescheduled");
  for (const t of live) {
    await db
      .update(publishTargets)
      .set({ state: "pending", scheduledAt: when, updatedAt: new Date() })
      .where(eq(publishTargets.id, t.id));
    await enqueueTarget(db, t.id, when, "delayed");
  }
}

export function registerPostRoutes(app: FastifyInstance): void {
  const db = app.database.db;

  app.post(
    "/v1/workspaces/:workspaceId/posts",
    { preHandler: requireWorkspacePermission(app, "create_posts") },
    async (req, reply) => {
      const { workspaceId } = req.params as { workspaceId: string };
      const parsed = createPostSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Invalid input." },
        });
      }
      const input = parsed.data;
      const when = input.scheduledAt ? new Date(input.scheduledAt) : null;
      if (when && when.getTime() < Date.now() + 60_000) {
        return reply.status(400).send({ error: { code: "invalid_input", message: "Choose a time at least a minute in the future." } });
      }
      const accountIds = [...new Set(input.accountIds)];
      const ownedAccounts = accountIds.length
        ? await db
            .select({ id: socialAccounts.id, providerId: socialAccounts.providerId })
            .from(socialAccounts)
            .where(and(eq(socialAccounts.workspaceId, workspaceId), inArray(socialAccounts.id, accountIds)))
        : [];
      if (ownedAccounts.length !== accountIds.length) {
        return reply.status(400).send({
          error: { code: "unknown_account", message: "One or more destinations do not belong to this workspace." },
        });
      }
      if ((await foreignMedia(db, workspaceId, input.mediaIds)).length > 0) {
        return reply.status(400).send({
          error: { code: "unknown_media", message: "One or more media assets do not belong to this workspace." },
        });
      }
      if (when) {
        const limit = await checkScheduledPostLimit(db, workspaceId);
        if (limit) return reply.status(402).send({ error: limit });
      }

      const postId = await db.transaction(async (tx) => {
        const [post] = await tx
          .insert(posts)
          .values({
            workspaceId,
            brandId: input.brandId ?? null,
            authorId: req.user!.id,
            title: input.title ?? "",
            caption: input.caption,
            link: input.link,
            campaign: input.campaign,
            labels: input.labels,
            aiDisclosed: input.aiDisclosed,
            timezone: "UTC",
            state: when ? "scheduled" : "draft",
            scheduledAt: when ?? undefined,
          })
          .returning();
        await replaceMedia(tx, post.id, input.mediaIds);
        await replaceVariants(tx, post.id, req.user!.id, input.variants);
        for (const account of ownedAccounts) {
          const [target] = await tx
            .insert(publishTargets)
            .values({
              postId: post.id,
              accountId: account.id,
              providerId: account.providerId,
              state: "pending",
              idempotencyKey: `idem_${post.id}_${account.id}`,
              scheduledAt: when ?? undefined,
            })
            .returning();
          if (when) await enqueueTarget(tx, target.id, when, "delayed");
        }
        await snapshotVersion(tx, post.id, req.user!.id);
        await writeAudit(tx, {
          workspaceId,
          actorUserId: req.user!.id,
          action: "post.created",
          targetType: "post",
          targetId: post.id,
          targetLabel: post.title || post.caption.slice(0, 60),
          ip: req.ip,
        });
        return post.id;
      });
      return reply.status(201).send({ post: await postWithTargets(db, workspaceId, postId) });
    }
  );

  app.get(
    "/v1/workspaces/:workspaceId/posts",
    { preHandler: requireWorkspacePermission(app) },
    async (req, reply) => {
      const { workspaceId } = req.params as { workspaceId: string };
      const { state, limit } = req.query as { state?: PostState; limit?: string };
      const cap = Math.min(200, Math.max(1, Number(limit) || 100));
      const rows = await db
        .select()
        .from(posts)
        .where(state ? and(eq(posts.workspaceId, workspaceId), eq(posts.state, state)) : eq(posts.workspaceId, workspaceId))
        .orderBy(desc(posts.updatedAt))
        .limit(cap);
      const ids = rows.map((p) => p.id);
      const [targets, media] = ids.length
        ? await Promise.all([
            db
              .select({
                id: publishTargets.id,
                postId: publishTargets.postId,
                accountId: publishTargets.accountId,
                providerId: publishTargets.providerId,
                state: publishTargets.state,
                attempts: publishTargets.attempts,
              })
              .from(publishTargets)
              .where(inArray(publishTargets.postId, ids)),
            db
              .select({ postId: postMedia.postId, mediaId: postMedia.mediaId, position: postMedia.position })
              .from(postMedia)
              .where(inArray(postMedia.postId, ids)),
          ])
        : [[], []];
      const withCounts = rows.map((p) => ({
        ...p,
        targets: targets.filter((t) => t.postId === p.id).map(({ postId: _postId, ...t }) => t),
        mediaIds: media
          .filter((m) => m.postId === p.id)
          .sort((a, b) => a.position - b.position)
          .map((m) => m.mediaId),
      }));
      return reply.send({ posts: withCounts });
    }
  );

  app.get(
    "/v1/workspaces/:workspaceId/posts/:postId",
    { preHandler: requireWorkspacePermission(app) },
    async (req, reply) => {
      const { workspaceId, postId } = req.params as { workspaceId: string; postId: string };
      const post = await postWithTargets(db, workspaceId, postId);
      if (!post) return notFound(reply);
      const versions = await db
        .select()
        .from(postVersions)
        .where(eq(postVersions.postId, postId))
        .orderBy(desc(postVersions.version));
      return reply.send({ post: { ...post, versions } });
    }
  );

  app.patch(
    "/v1/workspaces/:workspaceId/posts/:postId",
    { preHandler: requireWorkspacePermission(app, "edit_posts") },
    async (req, reply) => {
      const { workspaceId, postId } = req.params as { workspaceId: string; postId: string };
      const parsed = patchPostSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Invalid input." },
        });
      }
      const existing = await findPost(db, workspaceId, postId);
      if (!existing) return notFound(reply);
      if (existing.state !== "draft" && existing.state !== "scheduled" && existing.state !== "ready") {
        return reply.status(409).send({
          error: { code: "not_editable", message: "Only drafts and scheduled posts can be edited. Editing published content is not supported by most networks." },
        });
      }
      const { scheduledAt, mediaIds, variants, accountIds, ...rest } = parsed.data;
      if (mediaIds && (await foreignMedia(db, workspaceId, mediaIds)).length > 0) {
        return reply.status(400).send({
          error: { code: "unknown_media", message: "One or more media assets do not belong to this workspace." },
        });
      }
      const wantedAccounts = accountIds ? [...new Set(accountIds)] : null;
      const ownedAccounts = wantedAccounts?.length
        ? await db
            .select({ id: socialAccounts.id, providerId: socialAccounts.providerId })
            .from(socialAccounts)
            .where(and(eq(socialAccounts.workspaceId, workspaceId), inArray(socialAccounts.id, wantedAccounts)))
        : [];
      if (wantedAccounts && ownedAccounts.length !== wantedAccounts.length) {
        return reply.status(400).send({
          error: { code: "unknown_account", message: "One or more destinations do not belong to this workspace." },
        });
      }
      const when = scheduledAt ? new Date(scheduledAt) : null;
      if (when && when.getTime() < Date.now() + 60_000) {
        return reply.status(400).send({ error: { code: "invalid_input", message: "Choose a time at least a minute in the future." } });
      }
      await db.transaction(async (tx) => {
        await tx
          .update(posts)
          .set({ ...rest, updatedAt: new Date() })
          .where(and(eq(posts.id, postId), eq(posts.workspaceId, workspaceId)));
        if (mediaIds) await replaceMedia(tx, postId, mediaIds);
        if (variants) await replaceVariants(tx, postId, req.user!.id, variants);
        if (wantedAccounts) {
          const current = await tx.select().from(publishTargets).where(eq(publishTargets.postId, postId));
          const keep = new Set(wantedAccounts);
          const removable = current.filter((t) => !keep.has(t.accountId) && t.state !== "published");
          if (removable.length > 0) {
            await supersedeJobs(tx, removable.map((t) => t.id), "destination_removed");
            await tx.delete(publishTargets).where(inArray(publishTargets.id, removable.map((t) => t.id)));
          }
          const have = new Set(current.map((t) => t.accountId));
          const post = (await tx.select().from(posts).where(eq(posts.id, postId)).limit(1))[0];
          for (const account of ownedAccounts.filter((a) => !have.has(a.id))) {
            const [target] = await tx
              .insert(publishTargets)
              .values({
                postId,
                accountId: account.id,
                providerId: account.providerId,
                state: "pending",
                idempotencyKey: `idem_${postId}_${account.id}`,
                scheduledAt: post.state === "scheduled" ? post.scheduledAt : undefined,
              })
              .onConflictDoNothing()
              .returning();
            if (target && post.state === "scheduled" && post.scheduledAt) {
              await enqueueTarget(tx, target.id, post.scheduledAt, "delayed");
            }
          }
        }
        if (scheduledAt !== undefined) {
          if (when) {
            await tx.update(posts).set({ scheduledAt: when, state: "scheduled" }).where(eq(posts.id, postId));
            await rescheduleTargets(tx, postId, when);
          } else {
            // Unschedule: back to draft, nothing fires.
            const targets = await tx.select({ id: publishTargets.id }).from(publishTargets).where(eq(publishTargets.postId, postId));
            await supersedeJobs(tx, targets.map((t) => t.id), "unscheduled");
            await tx.update(posts).set({ scheduledAt: null, state: "draft" }).where(eq(posts.id, postId));
            await tx
              .update(publishTargets)
              .set({ scheduledAt: null, updatedAt: new Date() })
              .where(eq(publishTargets.postId, postId));
          }
        }
      });
      return reply.send({ post: await postWithTargets(db, workspaceId, postId) });
    }
  );

  /** Publish now: snapshot, enqueue one job per target, return immediately. */
  app.post(
    "/v1/workspaces/:workspaceId/posts/:postId/publish",
    { preHandler: requireWorkspacePermission(app, "publish_posts") },
    async (req, reply) => {
      const { workspaceId, postId } = req.params as { workspaceId: string; postId: string };
      const post = await findPost(db, workspaceId, postId);
      if (!post) return notFound(reply);
      if (post.state === "published" || post.state === "processing") {
        return reply.status(409).send({ error: { code: "already_publishing", message: "This post is already published or in flight." } });
      }
      const targets = await db.select().from(publishTargets).where(eq(publishTargets.postId, postId));
      const actionable = targets.filter((t) => TARGET_DISPATCHABLE.has(t.state));
      if (actionable.length === 0) {
        return reply.status(409).send({ error: { code: "no_targets", message: "This post has no pending destinations." } });
      }
      await db.transaction(async (tx) => {
        await snapshotVersion(tx, postId, req.user!.id);
        const now = new Date();
        await supersedeJobs(tx, actionable.map((t) => t.id), "published_now");
        for (const t of actionable) {
          await tx
            .update(publishTargets)
            .set({ state: "queued", scheduledAt: now, lastError: null, updatedAt: now })
            .where(eq(publishTargets.id, t.id));
          await enqueueTarget(tx, t.id, now, "pending");
        }
        await tx.update(posts).set({ state: "processing", updatedAt: now }).where(eq(posts.id, postId));
        await writeAudit(tx, {
          workspaceId,
          actorUserId: req.user!.id,
          action: "post.published",
          targetType: "post",
          targetId: postId,
          targetLabel: post.title || post.caption.slice(0, 60),
          metadata: { destinations: actionable.length },
          ip: req.ip,
        });
      });
      return reply
        .status(202)
        .send({ post: await postWithTargets(db, workspaceId, postId), dispatched: actionable.length });
    }
  );

  app.post(
    "/v1/workspaces/:workspaceId/posts/:postId/schedule",
    { preHandler: requireWorkspacePermission(app, "publish_posts") },
    async (req, reply) => {
      const { workspaceId, postId } = req.params as { workspaceId: string; postId: string };
      const { scheduledAt } = (req.body ?? {}) as { scheduledAt?: string };
      const when = scheduledAt ? new Date(scheduledAt) : null;
      if (!when || Number.isNaN(when.getTime()) || when.getTime() < Date.now() + 60_000) {
        return reply.status(400).send({ error: { code: "invalid_input", message: "Choose a time at least a minute in the future." } });
      }
      const post = await findPost(db, workspaceId, postId);
      if (!post) return notFound(reply);
      if (post.state === "published" || post.state === "processing") {
        return reply.status(409).send({ error: { code: "already_publishing", message: "This post is already published or in flight." } });
      }
      if (post.state !== "scheduled") {
        const limit = await checkScheduledPostLimit(db, workspaceId);
        if (limit) return reply.status(402).send({ error: limit });
      }
      await db.transaction(async (tx) => {
        await snapshotVersion(tx, postId, req.user!.id);
        await tx.update(posts).set({ scheduledAt: when, state: "scheduled", updatedAt: new Date() }).where(eq(posts.id, postId));
        await rescheduleTargets(tx, postId, when);
        await writeAudit(tx, {
          workspaceId,
          actorUserId: req.user!.id,
          action: "post.scheduled",
          targetType: "post",
          targetId: postId,
          targetLabel: post.title || post.caption.slice(0, 60),
          metadata: { scheduledAt: when.toISOString() },
          ip: req.ip,
        });
      });
      return reply.send({ post: await postWithTargets(db, workspaceId, postId) });
    }
  );

  app.post(
    "/v1/workspaces/:workspaceId/posts/:postId/cancel",
    { preHandler: requireWorkspacePermission(app, "publish_posts") },
    async (req, reply) => {
      const { workspaceId, postId } = req.params as { workspaceId: string; postId: string };
      const post = await findPost(db, workspaceId, postId);
      if (!post) return notFound(reply);
      await db.transaction(async (tx) => {
        const targets = await tx.select().from(publishTargets).where(eq(publishTargets.postId, postId));
        const live = targets.filter((t) => !TARGET_TERMINAL.has(t.state));
        for (const t of live) {
          await tx.update(publishTargets).set({ state: "canceled", updatedAt: new Date() }).where(eq(publishTargets.id, t.id));
        }
        await supersedeJobs(tx, targets.map((t) => t.id), "canceled");
        await tx.update(posts).set({ state: "canceled", updatedAt: new Date() }).where(eq(posts.id, postId));
        await writeAudit(tx, {
          workspaceId,
          actorUserId: req.user!.id,
          action: "post.canceled",
          targetType: "post",
          targetId: postId,
          ip: req.ip,
        });
      });
      return reply.send({ post: await postWithTargets(db, workspaceId, postId) });
    }
  );

  app.post(
    "/v1/workspaces/:workspaceId/posts/:postId/targets/:targetId/retry",
    { preHandler: requireWorkspacePermission(app, "publish_posts") },
    async (req, reply) => {
      const { workspaceId, postId, targetId } = req.params as { workspaceId: string; postId: string; targetId: string };
      const post = await findPost(db, workspaceId, postId);
      if (!post) return notFound(reply);
      const target = (
        await db
          .select()
          .from(publishTargets)
          .where(and(eq(publishTargets.id, targetId), eq(publishTargets.postId, postId)))
          .limit(1)
      )[0];
      if (!target) return notFound(reply, "Target");
      if (target.state === "published") {
        return reply.status(409).send({
          error: { code: "already_published", message: "This destination is already live — retries are idempotent and never publish twice." },
        });
      }
      if (!TARGET_DISPATCHABLE.has(target.state)) {
        return reply.status(409).send({
          error: { code: "in_flight", message: "This destination is still being published. Wait for it to finish before retrying." },
        });
      }
      const remote = await db.select().from(remotePosts).where(eq(remotePosts.targetId, targetId)).limit(1);
      if (remote[0]) {
        return reply.status(409).send({
          error: { code: "remote_exists", message: "A remote post already exists for this destination; nothing to retry." },
        });
      }
      await db.transaction(async (tx) => {
        await supersedeJobs(tx, [targetId], "retried");
        await tx
          .update(publishTargets)
          .set({ state: "retrying", lastError: null, updatedAt: new Date() })
          .where(eq(publishTargets.id, targetId));
        await enqueueTarget(tx, targetId, new Date(), "pending");
        await tx.update(posts).set({ state: "processing", updatedAt: new Date() }).where(eq(posts.id, postId));
        await writeAudit(tx, {
          workspaceId,
          actorUserId: req.user!.id,
          action: "post.target_retried",
          targetType: "publish_target",
          targetId,
          ip: req.ip,
        });
      });
      return reply.status(202).send({ ok: true });
    }
  );

  app.delete(
    "/v1/workspaces/:workspaceId/posts/:postId",
    { preHandler: requireWorkspacePermission(app, "edit_posts") },
    async (req, reply) => {
      const { workspaceId, postId } = req.params as { workspaceId: string; postId: string };
      const post = await findPost(db, workspaceId, postId);
      if (!post) return notFound(reply);
      if (post.state !== "draft" && post.state !== "canceled" && post.state !== "failed") {
        return reply.status(409).send({
          error: { code: "not_deletable", message: "Only drafts, canceled and failed posts can be deleted. Published history is kept." },
        });
      }
      await db.transaction(async (tx) => {
        await tx.delete(posts).where(and(eq(posts.id, postId), eq(posts.workspaceId, workspaceId)));
        await writeAudit(tx, {
          workspaceId,
          actorUserId: req.user!.id,
          action: "post.deleted",
          targetType: "post",
          targetId: postId,
          ip: req.ip,
        });
      });
      return reply.status(204).send();
    }
  );
}
