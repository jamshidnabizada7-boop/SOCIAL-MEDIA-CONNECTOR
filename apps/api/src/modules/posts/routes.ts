import { and, desc, eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  mediaAssets,
  postMedia,
  postVersions,
  postVariants,
  posts,
  publishJobs,
  publishTargets,
  socialAccounts,
} from "@aria/db";
import type { AriaDatabase } from "@aria/db";
import type { PostState, TargetState } from "@aria/shared-types";
import { requireWorkspacePermission } from "../../plugins/auth.js";
import { writeAudit } from "../../lib/audit.js";

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
  scheduledAt: z.string().datetime().optional(),
});

const patchPostSchema = z.object({
  title: z.string().max(120).optional(),
  caption: z.string().max(100_000).optional(),
  link: z.string().url().max(2000).nullable().optional(),
  campaign: z.string().max(80).nullable().optional(),
  labels: z.array(z.string().max(40)).max(10).optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
});

const TARGET_TERMINAL = new Set<TargetState>([
  "published",
  "failed",
  "canceled",
  "token_expired",
  "needs_user_action",
]);

async function postWithTargets(
  db: AriaDatabase,
  postId: string
) {
  const post = (await db.select().from(posts).where(eq(posts.id, postId)).limit(1))[0];
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
    .select({ mediaId: postMedia.mediaId })
    .from(postMedia)
    .where(eq(postMedia.postId, postId));
  return { ...post, targets, mediaIds: media.map((m) => m.mediaId) };
}

async function snapshotVersion(
  db: AriaDatabase,
  postId: string,
  userId: string
) {
  const post = (await db.select().from(posts).where(eq(posts.id, postId)).limit(1))[0];
  if (!post) return;
  const existing = await db
    .select({ version: postVersions.version })
    .from(postVersions)
    .where(eq(postVersions.postId, postId));
  const next = existing.reduce((m, v) => Math.max(m, v.version), 0) + 1;
  const media = await db.select({ id: postMedia.mediaId }).from(postMedia).where(eq(postMedia.postId, postId));
  await db.insert(postVersions).values({
    postId,
    version: next,
    caption: post.caption,
    mediaIds: media.map((m) => m.id),
    byUserId: userId,
  });
}

/** Creates (or reuses) a pending job row for a target. */
async function enqueueTarget(
  db: AriaDatabase,
  targetId: string,
  runAt: Date,
  state: "pending" | "delayed"
) {
  await db.insert(publishJobs).values({
    targetId,
    state,
    runAt,
    queue: "publish",
  });
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
      if (!input.caption.trim() && input.accountIds.length > 0 && !input.scheduledAt) {
        // Text-only networks fine; media networks validated per-adapter at publish.
      }
      const ownedAccounts = input.accountIds.length
        ? await db
            .select({ id: socialAccounts.id })
            .from(socialAccounts)
            .where(and(eq(socialAccounts.workspaceId, workspaceId), inArray(socialAccounts.id, input.accountIds)))
        : [];
      if (ownedAccounts.length !== input.accountIds.length) {
        return reply.status(400).send({
          error: { code: "unknown_account", message: "One or more destinations do not belong to this workspace." },
        });
      }
      const [post] = await db
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
          timezone: "UTC",
          state: input.scheduledAt ? "scheduled" : "draft",
          scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : undefined,
        })
        .returning();
      if (input.mediaIds.length > 0) {
        const owned = await db
          .select({ id: mediaAssets.id })
          .from(mediaAssets)
          .where(and(eq(mediaAssets.workspaceId, workspaceId), inArray(mediaAssets.id, input.mediaIds)));
        if (owned.length !== input.mediaIds.length) {
          return reply.status(400).send({
            error: { code: "unknown_media", message: "One or more media assets do not belong to this workspace." },
          });
        }
        await db
          .insert(postMedia)
          .values(input.mediaIds.map((mediaId, position) => ({ postId: post.id, mediaId, position })));
      }
      for (const accountId of input.accountIds) {
        const account = (
          await db.select().from(socialAccounts).where(eq(socialAccounts.id, accountId)).limit(1)
        )[0];
        const [target] = await db
          .insert(publishTargets)
          .values({
            postId: post.id,
            accountId,
            providerId: account.providerId,
            state: input.scheduledAt ? "pending" : "pending",
            idempotencyKey: `idem_${post.id}_${accountId}`,
            scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : undefined,
          })
          .returning();
        if (input.scheduledAt) {
          await enqueueTarget(db, target.id, new Date(input.scheduledAt), "delayed");
        }
      }
      await snapshotVersion(db, post.id, req.user!.id);
      await writeAudit(db, {
        workspaceId,
        actorUserId: req.user!.id,
        action: "post.created",
        targetType: "post",
        targetId: post.id,
        targetLabel: post.title || post.caption.slice(0, 60),
        ip: req.ip,
      });
      return reply.status(201).send({ post: await postWithTargets(db, post.id) });
    }
  );

  app.get(
    "/v1/workspaces/:workspaceId/posts",
    { preHandler: requireWorkspacePermission(app) },
    async (req, reply) => {
      const { workspaceId } = req.params as { workspaceId: string };
      const { state, limit } = req.query as { state?: PostState; limit?: string };
      const cap = Math.min(200, Number(limit) || 100);
      const rows = await db
        .select()
        .from(posts)
        .where(state ? and(eq(posts.workspaceId, workspaceId), eq(posts.state, state)) : eq(posts.workspaceId, workspaceId))
        .orderBy(desc(posts.updatedAt))
        .limit(cap);
      const withCounts = await Promise.all(
        rows.map(async (p) => {
          const targets = await db
            .select({
              id: publishTargets.id,
              accountId: publishTargets.accountId,
              providerId: publishTargets.providerId,
              state: publishTargets.state,
              attempts: publishTargets.attempts,
            })
            .from(publishTargets)
            .where(eq(publishTargets.postId, p.id));
          return { ...p, targets, mediaIds: [] as string[] };
        })
      );
      return reply.send({ posts: withCounts });
    }
  );

  app.get(
    "/v1/workspaces/:workspaceId/posts/:postId",
    { preHandler: requireWorkspacePermission(app) },
    async (req, reply) => {
      const { postId } = req.params as { postId: string };
      const post = await postWithTargets(db, postId);
      if (!post) return reply.status(404).send({ error: { code: "not_found", message: "Post not found." } });
      const versions = await db
        .select()
        .from(postVersions)
        .where(eq(postVersions.postId, postId))
        .orderBy(desc(postVersions.version));
      const variants = await db.select().from(postVariants).where(eq(postVariants.postId, postId));
      return reply.send({ post: { ...post, versions, variants } });
    }
  );

  app.patch(
    "/v1/workspaces/:workspaceId/posts/:postId",
    { preHandler: requireWorkspacePermission(app, "edit_posts") },
    async (req, reply) => {
      const { postId } = req.params as { postId: string };
      const parsed = patchPostSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: { code: "invalid_input", message: "Invalid input." } });
      }
      const existing = (await db.select().from(posts).where(eq(posts.id, postId)).limit(1))[0];
      if (!existing) return reply.status(404).send({ error: { code: "not_found", message: "Post not found." } });
      if (existing.state !== "draft" && existing.state !== "scheduled" && existing.state !== "ready") {
        return reply.status(409).send({
          error: { code: "not_editable", message: "Only drafts and scheduled posts can be edited. Editing published content is not supported by most networks." },
        });
      }
      const { scheduledAt, ...rest } = parsed.data;
      await db
        .update(posts)
        .set({
          ...rest,
          ...(scheduledAt !== undefined ? { scheduledAt: scheduledAt ? new Date(scheduledAt) : null } : {}),
          updatedAt: new Date(),
        })
        .where(eq(posts.id, postId));
      return reply.send({ post: await postWithTargets(db, postId) });
    }
  );

  /** Publish now: snapshot, enqueue one job per target, return immediately. */
  app.post(
    "/v1/workspaces/:workspaceId/posts/:postId/publish",
    { preHandler: requireWorkspacePermission(app, "publish_posts") },
    async (req, reply) => {
      const { postId } = req.params as { postId: string };
      const post = (await db.select().from(posts).where(eq(posts.id, postId)).limit(1))[0];
      if (!post) return reply.status(404).send({ error: { code: "not_found", message: "Post not found." } });
      if (post.state === "published" || post.state === "processing") {
        return reply.status(409).send({ error: { code: "already_publishing", message: "This post is already published or in flight." } });
      }
      const targets = await db.select().from(publishTargets).where(eq(publishTargets.postId, postId));
      const actionable = targets.filter((t) => !TARGET_TERMINAL.has(t.state) || t.state === "token_expired" || t.state === "failed");
      if (actionable.length === 0) {
        return reply.status(409).send({ error: { code: "no_targets", message: "This post has no pending destinations." } });
      }
      await snapshotVersion(db, postId, req.user!.id);
      const now = new Date();
      for (const t of actionable) {
        await db
          .update(publishTargets)
          .set({ state: "queued", scheduledAt: t.scheduledAt ?? now, updatedAt: now })
          .where(eq(publishTargets.id, t.id));
        await enqueueTarget(db, t.id, now, "pending");
      }
      await db.update(posts).set({ state: "processing", updatedAt: now }).where(eq(posts.id, postId));
      await writeAudit(db, {
        workspaceId: post.workspaceId,
        actorUserId: req.user!.id,
        action: "post.published",
        targetType: "post",
        targetId: postId,
        targetLabel: post.title || post.caption.slice(0, 60),
        metadata: { destinations: actionable.length },
        ip: req.ip,
      });
      return reply.status(202).send({ post: await postWithTargets(db, postId), dispatched: actionable.length });
    }
  );

  app.post(
    "/v1/workspaces/:workspaceId/posts/:postId/schedule",
    { preHandler: requireWorkspacePermission(app, "publish_posts") },
    async (req, reply) => {
      const { postId } = req.params as { postId: string };
      const { scheduledAt } = req.body as { scheduledAt?: string };
      const when = scheduledAt ? new Date(scheduledAt) : null;
      if (!when || Number.isNaN(when.getTime()) || when.getTime() < Date.now() + 60_000) {
        return reply.status(400).send({ error: { code: "invalid_input", message: "Choose a time at least a minute in the future." } });
      }
      const post = (await db.select().from(posts).where(eq(posts.id, postId)).limit(1))[0];
      if (!post) return reply.status(404).send({ error: { code: "not_found", message: "Post not found." } });
      await snapshotVersion(db, postId, req.user!.id);
      await db
        .update(posts)
        .set({ scheduledAt: when, state: "scheduled", updatedAt: new Date() })
        .where(eq(posts.id, postId));
      const targets = await db.select().from(publishTargets).where(eq(publishTargets.postId, postId));
      for (const t of targets) {
        if (TARGET_TERMINAL.has(t.state)) continue;
        await db
          .update(publishTargets)
          .set({ scheduledAt: when, updatedAt: new Date() })
          .where(eq(publishTargets.id, t.id));
        // Replace any stale job with a delayed one due at the scheduled time.
        await db
          .update(publishJobs)
          .set({ state: "dead_letter", lastError: "rescheduled", updatedAt: new Date() })
          .where(and(eq(publishJobs.targetId, t.id), eq(publishJobs.state, "pending")));
        await enqueueTarget(db, t.id, when, "delayed");
      }
      await writeAudit(db, {
        workspaceId: post.workspaceId,
        actorUserId: req.user!.id,
        action: "post.scheduled",
        targetType: "post",
        targetId: postId,
        targetLabel: post.title || post.caption.slice(0, 60),
        metadata: { scheduledAt: when.toISOString() },
        ip: req.ip,
      });
      return reply.send({ post: await postWithTargets(db, postId) });
    }
  );

  app.post(
    "/v1/workspaces/:workspaceId/posts/:postId/cancel",
    { preHandler: requireWorkspacePermission(app, "publish_posts") },
    async (req, reply) => {
      const { postId } = req.params as { postId: string };
      const post = (await db.select().from(posts).where(eq(posts.id, postId)).limit(1))[0];
      if (!post) return reply.status(404).send({ error: { code: "not_found", message: "Post not found." } });
      const targets = await db.select().from(publishTargets).where(eq(publishTargets.postId, postId));
      for (const t of targets) {
        if (!TARGET_TERMINAL.has(t.state)) {
          await db.update(publishTargets).set({ state: "canceled", updatedAt: new Date() }).where(eq(publishTargets.id, t.id));
        }
      }
      await db.update(publishJobs).set({ state: "dead_letter", updatedAt: new Date() }).where(
        and(eq(publishJobs.state, "pending"), inArray(publishJobs.targetId, targets.map((t) => t.id)))
      );
      await db.update(posts).set({ state: "canceled", updatedAt: new Date() }).where(eq(posts.id, postId));
      await writeAudit(db, {
        workspaceId: post.workspaceId,
        actorUserId: req.user!.id,
        action: "post.canceled",
        targetType: "post",
        targetId: postId,
        ip: req.ip,
      });
      return reply.send({ post: await postWithTargets(db, postId) });
    }
  );

  app.post(
    "/v1/workspaces/:workspaceId/posts/:postId/targets/:targetId/retry",
    { preHandler: requireWorkspacePermission(app, "publish_posts") },
    async (req, reply) => {
      const { targetId } = req.params as { targetId: string };
      const target = (await db.select().from(publishTargets).where(eq(publishTargets.id, targetId)).limit(1))[0];
      if (!target) return reply.status(404).send({ error: { code: "not_found", message: "Target not found." } });
      if (target.state === "published") {
        return reply.status(409).send({
          error: { code: "already_published", message: "This destination is already live — retries are idempotent and never publish twice." },
        });
      }
      const remote = await db.select().from((await import("@aria/db")).remotePosts).where(eq((await import("@aria/db")).remotePosts.targetId, targetId)).limit(1);
      if (remote[0]) {
        return reply.status(409).send({
          error: { code: "remote_exists", message: "A remote post already exists for this destination; nothing to retry." },
        });
      }
      await db
        .update(publishTargets)
        .set({ state: "retrying", attempts: target.attempts + 1, lastError: null, updatedAt: new Date() })
        .where(eq(publishTargets.id, targetId));
      await enqueueTarget(db, targetId, new Date(), "pending");
      await db.update(posts).set({ state: "processing", updatedAt: new Date() }).where(eq(posts.id, target.postId));
      return reply.status(202).send({ ok: true });
    }
  );

  app.delete(
    "/v1/workspaces/:workspaceId/posts/:postId",
    { preHandler: requireWorkspacePermission(app, "edit_posts") },
    async (req, reply) => {
      const { postId } = req.params as { postId: string };
      const post = (await db.select().from(posts).where(eq(posts.id, postId)).limit(1))[0];
      if (!post) return reply.status(404).send({ error: { code: "not_found", message: "Post not found." } });
      if (post.state !== "draft" && post.state !== "canceled" && post.state !== "failed") {
        return reply.status(409).send({
          error: { code: "not_deletable", message: "Only drafts, canceled and failed posts can be deleted. Published history is kept." },
        });
      }
      await db.delete(posts).where(eq(posts.id, postId));
      await writeAudit(db, {
        workspaceId: post.workspaceId,
        actorUserId: req.user!.id,
        action: "post.deleted",
        targetType: "post",
        targetId: postId,
        ip: req.ip,
      });
      return reply.status(204).send();
    }
  );
}
