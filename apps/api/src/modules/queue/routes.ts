import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { posts, publishJobs, publishTargets, queueSlots } from "@aria/db";
import type { AriaDatabase } from "@aria/db";
import type { ProviderId } from "@aria/shared-types";
import { requireWorkspacePermission } from "../../plugins/auth.js";
import { writeAudit } from "../../lib/audit.js";

/**
 * Computes the next open queue window (UTC) shared by the post's destination
 * providers, at least 10 minutes out, scanning two weeks ahead.
 */
export async function nextQueueSlot(
  db: AriaDatabase,
  workspaceId: string,
  providerIds: ProviderId[],
  fromMs: number
): Promise<{ at: Date; slotId: string } | null> {
  const slots = await db
    .select()
    .from(queueSlots)
    .where(and(eq(queueSlots.workspaceId, workspaceId), eq(queueSlots.enabled, true)));
  if (slots.length === 0) return null;

  let best: { at: Date; slotId: string } | null = null;
  const start = new Date(fromMs);
  start.setUTCHours(0, 0, 0, 0);

  for (let dayOffset = 0; dayOffset < 15; dayOffset++) {
    const day = new Date(start.getTime() + dayOffset * 86_400_000);
    for (const slot of slots) {
      if (slot.dayOfWeek !== day.getUTCDay()) continue;
      const [h, m] = slot.time.split(":").map(Number);
      const at = new Date(day.getTime());
      at.setUTCHours(h, m, 0, 0);
      if (at.getTime() < fromMs + 10 * 60_000) continue;
      if (providerIds.length > 0 && !slot.providerIds.some((p) => providerIds.includes(p as ProviderId))) continue;
      if (!best || at < best.at) best = { at, slotId: slot.id };
    }
    if (best) break; // earliest day that has any matching slot wins
  }
  return best;
}

const slotSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  providerIds: z.array(z.string()).max(12).default([]),
  enabled: z.boolean().default(true),
});

export function registerQueueRoutes(app: FastifyInstance): void {
  const db = app.database.db;

  app.get(
    "/v1/workspaces/:workspaceId/queue/slots",
    { preHandler: requireWorkspacePermission(app) },
    async (req, reply) => {
      const { workspaceId } = req.params as { workspaceId: string };
      const slots = await db
        .select()
        .from(queueSlots)
        .where(eq(queueSlots.workspaceId, workspaceId))
        .orderBy(asc(queueSlots.dayOfWeek), asc(queueSlots.time));
      return reply.send({ slots });
    }
  );

  app.post(
    "/v1/workspaces/:workspaceId/queue/slots",
    { preHandler: requireWorkspacePermission(app, "publish_posts") },
    async (req, reply) => {
      const { workspaceId } = req.params as { workspaceId: string };
      const parsed = slotSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: { code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Invalid slot." } });
      }
      const [slot] = await db
        .insert(queueSlots)
        .values({ workspaceId, ...parsed.data })
        .returning();
      await writeAudit(db, {
        workspaceId,
        actorUserId: req.user!.id,
        action: "queue.slot_added",
        targetType: "queue_slot",
        targetId: slot.id,
        metadata: { day: slot.dayOfWeek, time: slot.time },
        ip: req.ip,
      });
      return reply.status(201).send({ slot });
    }
  );

  app.patch(
    "/v1/workspaces/:workspaceId/queue/slots/:slotId",
    { preHandler: requireWorkspacePermission(app, "publish_posts") },
    async (req, reply) => {
      const { workspaceId, slotId } = req.params as { workspaceId: string; slotId: string };
      const parsed = slotSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: { code: "invalid_input", message: "Invalid input." } });
      }
      const [slot] = await db
        .update(queueSlots)
        .set(parsed.data)
        .where(and(eq(queueSlots.id, slotId), eq(queueSlots.workspaceId, workspaceId)))
        .returning();
      if (!slot) return reply.status(404).send({ error: { code: "not_found", message: "Slot not found." } });
      return reply.send({ slot });
    }
  );

  app.delete(
    "/v1/workspaces/:workspaceId/queue/slots/:slotId",
    { preHandler: requireWorkspacePermission(app, "publish_posts") },
    async (req, reply) => {
      const { workspaceId, slotId } = req.params as { workspaceId: string; slotId: string };
      await db.delete(queueSlots).where(and(eq(queueSlots.id, slotId), eq(queueSlots.workspaceId, workspaceId)));
      return reply.status(204).send();
    }
  );

  /**
   * Add to queue (plan §20): schedules the post into the next open window
   * shared by its destination providers. Falls back to +24h when no slot
   * matches, so content still flows.
   */
  app.post(
    "/v1/workspaces/:workspaceId/posts/:postId/add-to-queue",
    { preHandler: requireWorkspacePermission(app, "publish_posts") },
    async (req, reply) => {
      const { workspaceId, postId } = req.params as { workspaceId: string; postId: string };
      const post = (await db.select().from(posts).where(eq(posts.id, postId)).limit(1))[0];
      if (!post || post.workspaceId !== workspaceId) {
        return reply.status(404).send({ error: { code: "not_found", message: "Post not found." } });
      }
      const targets = await db.select().from(publishTargets).where(eq(publishTargets.postId, postId));
      const providers = [...new Set(targets.map((t) => t.providerId))] as ProviderId[];
      const slot = await nextQueueSlot(db, workspaceId, providers, Date.now());
      const when = slot?.at ?? new Date(Date.now() + 24 * 3600_000);

      await db
        .update(posts)
        .set({ scheduledAt: when, state: "scheduled", updatedAt: new Date() })
        .where(eq(posts.id, postId));
      for (const t of targets) {
        if (["published", "failed", "canceled", "token_expired", "needs_user_action"].includes(t.state)) continue;
        await db
          .update(publishTargets)
          .set({ scheduledAt: when, updatedAt: new Date() })
          .where(eq(publishTargets.id, t.id));
        await db
          .insert(publishJobs)
          .values({ targetId: t.id, state: "delayed", runAt: when, queue: "publish" });
      }
      await writeAudit(db, {
        workspaceId,
        actorUserId: req.user!.id,
        action: "post.queued",
        targetType: "post",
        targetId: postId,
        metadata: { scheduledAt: when.toISOString(), slotId: slot?.slotId ?? null },
        ip: req.ip,
      });
      return reply.send({ scheduledAt: when.toISOString(), slotId: slot?.slotId ?? null });
    }
  );
}
