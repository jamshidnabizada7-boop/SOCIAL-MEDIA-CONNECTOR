import { auditLogs, brands, subscriptions, users, workspaceMembers, workspaces } from "@aria/db";
import { and, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Role } from "@aria/shared-types";
import { requireWorkspacePermission, requireAuth } from "../../plugins/auth.js";
import { writeAudit } from "../../lib/audit.js";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "workspace";
}

const createWorkspaceSchema = z.object({
  name: z.string().min(2).max(80),
  timezone: z.string().max(60).default("UTC"),
  locale: z.string().max(10).default("en"),
});

const updateWorkspaceSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  timezone: z.string().max(60).optional(),
  locale: z.string().max(10).optional(),
});

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "manager", "editor", "approver", "viewer"]).default("editor"),
});

const updateMemberSchema = z.object({
  role: z.enum(["admin", "manager", "editor", "approver", "viewer"]),
});

const brandSchema = z.object({
  name: z.string().min(2).max(60),
  description: z.string().max(300).optional(),
  hue: z.number().int().min(0).max(359).optional(),
});

export function registerWorkspaceRoutes(app: FastifyInstance): void {
  const db = app.database.db;

  app.post(
    "/v1/workspaces",
    { preHandler: requireAuth(app) },
    async (req, reply) => {
      const parsed = createWorkspaceSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Invalid input." },
        });
      }
      if (!req.user) return reply.status(401).send({});
      const slug = `${slugify(parsed.data.name)}-${Math.random().toString(36).slice(2, 7)}`;
      const [workspace] = await db
        .insert(workspaces)
        .values({ name: parsed.data.name, slug, timezone: parsed.data.timezone, locale: parsed.data.locale })
        .returning();
      await db.insert(workspaceMembers).values({
        workspaceId: workspace.id,
        userId: req.user.id,
        role: "owner",
        status: "active",
        joinedAt: new Date(),
      });
      await db.insert(subscriptions).values({ workspaceId: workspace.id, planId: "free" });
      await writeAudit(db, {
        workspaceId: workspace.id,
        actorUserId: req.user.id,
        action: "workspace.created",
        targetType: "workspace",
        targetId: workspace.id,
        targetLabel: workspace.name,
        ip: req.ip,
        userAgent: req.headers["user-agent"],
      });
      return reply.status(201).send({ workspace });
    }
  );

  app.get("/v1/workspaces", { preHandler: requireAuth(app) }, async (req, reply) => {
    const rows = await db
      .select({
        id: workspaces.id,
        name: workspaces.name,
        slug: workspaces.slug,
        timezone: workspaces.timezone,
        locale: workspaces.locale,
        planId: workspaces.planId,
        role: workspaceMembers.role,
      })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(eq(workspaceMembers.userId, req.user!.id));
    return reply.send({ workspaces: rows });
  });

  app.get("/v1/workspaces/:workspaceId", { preHandler: requireWorkspacePermission(app) }, async (req, reply) => {
    const { workspaceId } = req.params as { workspaceId: string };
    const rows = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
    if (!rows[0]) return reply.status(404).send({ error: { code: "not_found", message: "Workspace not found." } });
    const brandRows = await db.select().from(brands).where(eq(brands.workspaceId, workspaceId));
    return reply.send({ workspace: rows[0], brands: brandRows, role: req.member!.role });
  });

  app.patch(
    "/v1/workspaces/:workspaceId",
    { preHandler: requireWorkspacePermission(app, "manage_workspace") },
    async (req, reply) => {
      const { workspaceId } = req.params as { workspaceId: string };
      const parsed = updateWorkspaceSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: { code: "invalid_input", message: "Invalid input." } });
      }
      const [updated] = await db
        .update(workspaces)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(workspaces.id, workspaceId))
        .returning();
      await writeAudit(db, {
        workspaceId,
        actorUserId: req.user!.id,
        action: "workspace.updated",
        targetType: "workspace",
        targetId: workspaceId,
        metadata: parsed.data,
        ip: req.ip,
      });
      return reply.send({ workspace: updated });
    }
  );

  app.delete(
    "/v1/workspaces/:workspaceId",
    { preHandler: requireWorkspacePermission(app, "manage_workspace") },
    async (req, reply) => {
      const { workspaceId } = req.params as { workspaceId: string };
      if (req.member!.role !== "owner") {
        return reply.status(403).send({ error: { code: "forbidden", message: "Only the owner can delete a workspace." } });
      }
      await db.update(workspaces).set({ deletedAt: new Date() }).where(eq(workspaces.id, workspaceId));
      await writeAudit(db, {
        workspaceId,
        actorUserId: req.user!.id,
        action: "workspace.deleted",
        targetType: "workspace",
        targetId: workspaceId,
        ip: req.ip,
      });
      return reply.status(204).send();
    }
  );

  /* --------------------------------- Members -------------------------------- */

  app.get(
    "/v1/workspaces/:workspaceId/members",
    { preHandler: requireWorkspacePermission(app) },
    async (req, reply) => {
      const { workspaceId } = req.params as { workspaceId: string };
      const rows = await db
        .select({
          userId: users.id,
          email: users.email,
          name: users.name,
          avatarHue: users.avatarHue,
          status: users.status,
          lastActiveAt: users.lastActiveAt,
          role: workspaceMembers.role,
          memberStatus: workspaceMembers.status,
          joinedAt: workspaceMembers.joinedAt,
        })
        .from(workspaceMembers)
        .innerJoin(users, eq(users.id, workspaceMembers.userId))
        .where(eq(workspaceMembers.workspaceId, workspaceId));
      return reply.send({ members: rows });
    }
  );

  app.post(
    "/v1/workspaces/:workspaceId/members",
    { preHandler: requireWorkspacePermission(app, "manage_team") },
    async (req, reply) => {
      const { workspaceId } = req.params as { workspaceId: string };
      const parsed = inviteSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: { code: "invalid_input", message: "Enter a valid email and role." } });
      }
      const email = parsed.data.email.toLowerCase();
      const found = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
      if (!found[0]) {
        return reply.status(404).send({
          error: { code: "user_not_found", message: "No Aria Hub account exists for that email yet. Ask them to sign up first (email invitations arrive with the email phase)." },
        });
      }
      const existing = await db
        .select({ id: workspaceMembers.id })
        .from(workspaceMembers)
        .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, found[0].id)))
        .limit(1);
      if (existing[0]) {
        return reply.status(409).send({ error: { code: "already_member", message: "That person is already in this workspace." } });
      }
      const [member] = await db
        .insert(workspaceMembers)
        .values({ workspaceId, userId: found[0].id, role: parsed.data.role, status: "invited", invitedBy: req.user!.id })
        .returning();
      await writeAudit(db, {
        workspaceId,
        actorUserId: req.user!.id,
        action: "member.invited",
        targetType: "user",
        targetId: found[0].id,
        targetLabel: email,
        metadata: { role: parsed.data.role },
        ip: req.ip,
      });
      return reply.status(201).send({ member });
    }
  );

  app.patch(
    "/v1/workspaces/:workspaceId/members/:userId",
    { preHandler: requireWorkspacePermission(app, "manage_team") },
    async (req, reply) => {
      const { workspaceId, userId } = req.params as { workspaceId: string; userId: string };
      const parsed = updateMemberSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: { code: "invalid_input", message: "Invalid role." } });
      }
      const target = await db
        .select({ role: workspaceMembers.role })
        .from(workspaceMembers)
        .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
        .limit(1);
      if (!target[0]) return reply.status(404).send({ error: { code: "not_found", message: "Member not found." } });
      if (target[0].role === "owner") {
        return reply.status(400).send({ error: { code: "owner_immutable", message: "The owner's role cannot be changed." } });
      }
      await db
        .update(workspaceMembers)
        .set({ role: parsed.data.role })
        .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));
      await writeAudit(db, {
        workspaceId,
        actorUserId: req.user!.id,
        action: "member.role_changed",
        targetType: "user",
        targetId: userId,
        metadata: { role: parsed.data.role },
        ip: req.ip,
      });
      return reply.send({ ok: true });
    }
  );

  app.delete(
    "/v1/workspaces/:workspaceId/members/:userId",
    { preHandler: requireWorkspacePermission(app, "manage_team") },
    async (req, reply) => {
      const { workspaceId, userId } = req.params as { workspaceId: string; userId: string };
      const target = await db
        .select({ role: workspaceMembers.role })
        .from(workspaceMembers)
        .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
        .limit(1);
      if (!target[0]) return reply.status(404).send({ error: { code: "not_found", message: "Member not found." } });
      if (target[0].role === "owner") {
        return reply.status(400).send({ error: { code: "owner_immutable", message: "The owner cannot be removed." } });
      }
      await db
        .delete(workspaceMembers)
        .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));
      await writeAudit(db, {
        workspaceId,
        actorUserId: req.user!.id,
        action: "member.removed",
        targetType: "user",
        targetId: userId,
        ip: req.ip,
      });
      return reply.status(204).send();
    }
  );

  /* ---------------------------------- Brands -------------------------------- */

  app.get("/v1/workspaces/:workspaceId/brands", { preHandler: requireWorkspacePermission(app) }, async (req, reply) => {
    const { workspaceId } = req.params as { workspaceId: string };
    const rows = await db.select().from(brands).where(eq(brands.workspaceId, workspaceId));
    return reply.send({ brands: rows });
  });

  app.post(
    "/v1/workspaces/:workspaceId/brands",
    { preHandler: requireWorkspacePermission(app, "manage_workspace") },
    async (req, reply) => {
      const { workspaceId } = req.params as { workspaceId: string };
      const parsed = brandSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: { code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Invalid input." } });
      }
      const [brand] = await db
        .insert(brands)
        .values({
          workspaceId,
          name: parsed.data.name,
          description: parsed.data.description,
          hue: parsed.data.hue ?? Math.floor(Math.random() * 360),
        })
        .returning();
      await writeAudit(db, {
        workspaceId,
        actorUserId: req.user!.id,
        action: "brand.created",
        targetType: "brand",
        targetId: brand.id,
        targetLabel: brand.name,
        ip: req.ip,
      });
      return reply.status(201).send({ brand });
    }
  );

  app.delete(
    "/v1/workspaces/:workspaceId/brands/:brandId",
    { preHandler: requireWorkspacePermission(app, "manage_workspace") },
    async (req, reply) => {
      const { workspaceId, brandId } = req.params as { workspaceId: string; brandId: string };
      await db.delete(brands).where(and(eq(brands.workspaceId, workspaceId), eq(brands.id, brandId)));
      await writeAudit(db, {
        workspaceId,
        actorUserId: req.user!.id,
        action: "brand.deleted",
        targetType: "brand",
        targetId: brandId,
        ip: req.ip,
      });
      return reply.status(204).send();
    }
  );

  /* --------------------------------- Audit log ------------------------------- */

  app.get(
    "/v1/workspaces/:workspaceId/audit-logs",
    { preHandler: requireWorkspacePermission(app, "manage_workspace") },
    async (req, reply) => {
      const { workspaceId } = req.params as { workspaceId: string };
      const rows = await db
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId))
        .limit(1);
      if (!rows[0]) return reply.status(404).send({ error: { code: "not_found", message: "Workspace not found." } });
      const logs = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.workspaceId, workspaceId))
        .orderBy(desc(auditLogs.createdAt))
        .limit(100);
      return reply.send({ entries: logs });
    }
  );
}
