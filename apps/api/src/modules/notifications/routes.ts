import { and, desc, eq, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { notifications } from "@aria/db";
import { requireWorkspacePermission } from "../../plugins/auth.js";

export function registerNotificationRoutes(app: FastifyInstance): void {
  const db = app.database.db;

  app.get(
    "/v1/workspaces/:workspaceId/notifications",
    { preHandler: requireWorkspacePermission(app) },
    async (req, reply) => {
      const { workspaceId } = req.params as { workspaceId: string };
      const { unread, limit } = req.query as { unread?: string; limit?: string };
      const cap = Math.min(100, Number(limit) || 50);
      const filters = [eq(notifications.workspaceId, workspaceId)];
      if (unread === "1") filters.push(isNull(notifications.readAt));
      const rows = await db
        .select()
        .from(notifications)
        .where(and(...filters))
        .orderBy(desc(notifications.createdAt))
        .limit(cap);
      return reply.send({ notifications: rows, unread: rows.filter((n) => !n.readAt).length });
    }
  );

  app.post(
    "/v1/workspaces/:workspaceId/notifications/:notificationId/read",
    { preHandler: requireWorkspacePermission(app) },
    async (req, reply) => {
      const { notificationId } = req.params as { notificationId: string };
      await db
        .update(notifications)
        .set({ readAt: new Date() })
        .where(eq(notifications.id, notificationId));
      return reply.send({ ok: true });
    }
  );

  app.post(
    "/v1/workspaces/:workspaceId/notifications/read-all",
    { preHandler: requireWorkspacePermission(app) },
    async (req, reply) => {
      const { workspaceId } = req.params as { workspaceId: string };
      await db
        .update(notifications)
        .set({ readAt: new Date() })
        .where(and(eq(notifications.workspaceId, workspaceId), isNull(notifications.readAt)));
      return reply.send({ ok: true });
    }
  );
}
