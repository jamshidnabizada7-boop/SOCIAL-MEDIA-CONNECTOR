import {
  auditLogs,
  brands,
  generateSessionToken,
  hashToken,
  invitations,
  subscriptions,
  users,
  workspaceMembers,
  workspaces,
} from "@aria/db";
import { and, count, desc, eq, gt, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireWorkspacePermission, requireAuth } from "../../plugins/auth.js";
import { writeAudit } from "../../lib/audit.js";
import { checkMemberLimit, effectivePlan } from "../../lib/limits.js";
import { actionEmail, sendMail, webAppUrl } from "../../lib/mailer.js";

const INVITE_TTL_MS = 7 * 86_400_000;

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
      const workspace = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(workspaces)
          .values({ name: parsed.data.name, slug, timezone: parsed.data.timezone, locale: parsed.data.locale })
          .returning();
        await tx.insert(workspaceMembers).values({
          workspaceId: created.id,
          userId: req.user!.id,
          role: "owner",
          status: "active",
          joinedAt: new Date(),
        });
        await tx.insert(subscriptions).values({ workspaceId: created.id, planId: "free" });
        await writeAudit(tx, {
          workspaceId: created.id,
          actorUserId: req.user!.id,
          action: "workspace.created",
          targetType: "workspace",
          targetId: created.id,
          targetLabel: created.name,
          ip: req.ip,
          userAgent: req.headers["user-agent"],
        });
        return created;
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
      .where(
        and(eq(workspaceMembers.userId, req.user!.id), eq(workspaceMembers.status, "active"), isNull(workspaces.deletedAt))
      );
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
        .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.status, "active")));
      // Pending invitations are listed as members with memberStatus "invited";
      // their id is the invitation id (PATCH/DELETE accept either kind).
      const pending = await db
        .select()
        .from(invitations)
        .where(
          and(
            eq(invitations.workspaceId, workspaceId),
            isNull(invitations.acceptedAt),
            isNull(invitations.revokedAt),
            gt(invitations.expiresAt, new Date())
          )
        );
      const invited = pending.map((i) => ({
        userId: i.id,
        email: i.email,
        name: i.email,
        avatarHue: 200,
        status: "invited" as const,
        lastActiveAt: null,
        role: i.role,
        memberStatus: "invited" as const,
        joinedAt: null,
        invitationId: i.id,
        invitationExpiresAt: i.expiresAt,
      }));
      return reply.send({ members: [...rows, ...invited] });
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
      if (parsed.data.role === "admin" && req.member!.role !== "owner") {
        return reply.status(403).send({ error: { code: "forbidden", message: "Only the owner can invite admins." } });
      }
      const email = parsed.data.email.toLowerCase();
      const found = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
      if (found[0]) {
        const existing = await db
          .select({ id: workspaceMembers.id, status: workspaceMembers.status })
          .from(workspaceMembers)
          .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, found[0].id)))
          .limit(1);
        if (existing[0]?.status === "active") {
          return reply.status(409).send({ error: { code: "already_member", message: "That person is already in this workspace." } });
        }
      }
      const limit = await checkMemberLimit(db, workspaceId);
      if (limit) return reply.status(402).send({ error: limit });

      const token = generateSessionToken();
      const invite = await db.transaction(async (tx) => {
        // Re-inviting replaces any earlier pending invitation for the same email.
        await tx
          .update(invitations)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(invitations.workspaceId, workspaceId),
              eq(invitations.email, email),
              isNull(invitations.acceptedAt),
              isNull(invitations.revokedAt)
            )
          );
        const [created] = await tx
          .insert(invitations)
          .values({
            workspaceId,
            email,
            role: parsed.data.role,
            tokenHash: hashToken(token),
            invitedBy: req.user!.id,
            expiresAt: new Date(Date.now() + INVITE_TTL_MS),
          })
          .returning();
        await writeAudit(tx, {
          workspaceId,
          actorUserId: req.user!.id,
          action: "member.invited",
          targetType: "invitation",
          targetId: created.id,
          targetLabel: email,
          metadata: { role: parsed.data.role },
          ip: req.ip,
        });
        return created;
      });
      const workspace = (
        await db.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1)
      )[0];
      const inviteUrl = `${webAppUrl()}/invite?token=${token}`;
      const body = actionEmail({
        heading: `Join ${workspace?.name ?? "a workspace"} on Aria Hub`,
        body: `${req.user!.name} invited you to collaborate as ${parsed.data.role}. Sign in or create an account with ${email} to accept.`,
        actionLabel: "Accept invitation",
        actionUrl: inviteUrl,
        footer: "The invitation expires in 7 days.",
      });
      const mail = await sendMail(req.log, {
        to: email,
        subject: `${req.user!.name} invited you to ${workspace?.name ?? "Aria Hub"}`,
        ...body,
      });
      return reply.status(201).send({
        member: { userId: invite.id, email, role: invite.role, memberStatus: "invited", invitationId: invite.id },
        emailSent: mail.delivered,
        // Without email delivery the inviter can share the link directly.
        ...(mail.delivered ? {} : { inviteUrl }),
      });
    }
  );

  /** Public preview for the accept page — reveals only what the email already said. */
  app.get("/v1/invitations/:token", async (req, reply) => {
    const { token } = req.params as { token: string };
    const row = (
      await db
        .select({
          email: invitations.email,
          role: invitations.role,
          expiresAt: invitations.expiresAt,
          acceptedAt: invitations.acceptedAt,
          revokedAt: invitations.revokedAt,
          workspaceName: workspaces.name,
          inviterName: users.name,
        })
        .from(invitations)
        .innerJoin(workspaces, eq(workspaces.id, invitations.workspaceId))
        .leftJoin(users, eq(users.id, invitations.invitedBy))
        .where(eq(invitations.tokenHash, hashToken(token)))
        .limit(1)
    )[0];
    if (!row || row.revokedAt || row.acceptedAt || row.expiresAt.getTime() < Date.now()) {
      return reply.status(404).send({ error: { code: "invalid_invitation", message: "This invitation is no longer valid. Ask for a new one." } });
    }
    return reply.send({
      invitation: {
        email: row.email,
        role: row.role,
        workspaceName: row.workspaceName,
        inviterName: row.inviterName ?? null,
        expiresAt: row.expiresAt,
      },
    });
  });

  app.post(
    "/v1/invitations/:token/accept",
    { preHandler: requireAuth(app), config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const { token } = req.params as { token: string };
      const invite = (await db.select().from(invitations).where(eq(invitations.tokenHash, hashToken(token))).limit(1))[0];
      if (!invite || invite.revokedAt || invite.acceptedAt || invite.expiresAt.getTime() < Date.now()) {
        return reply.status(404).send({ error: { code: "invalid_invitation", message: "This invitation is no longer valid. Ask for a new one." } });
      }
      if (invite.email !== req.user!.email.toLowerCase()) {
        return reply.status(403).send({
          error: { code: "wrong_account", message: `This invitation was sent to ${invite.email}. Sign in with that email to accept it.` },
        });
      }
      await db.transaction(async (tx) => {
        const existing = (
          await tx
            .select({ id: workspaceMembers.id })
            .from(workspaceMembers)
            .where(and(eq(workspaceMembers.workspaceId, invite.workspaceId), eq(workspaceMembers.userId, req.user!.id)))
            .limit(1)
        )[0];
        if (existing) {
          await tx
            .update(workspaceMembers)
            .set({ status: "active", role: invite.role, joinedAt: new Date() })
            .where(eq(workspaceMembers.id, existing.id));
        } else {
          await tx.insert(workspaceMembers).values({
            workspaceId: invite.workspaceId,
            userId: req.user!.id,
            role: invite.role,
            status: "active",
            invitedBy: invite.invitedBy,
            joinedAt: new Date(),
          });
        }
        await tx.update(invitations).set({ acceptedAt: new Date() }).where(eq(invitations.id, invite.id));
        // Accepting a mailed link proves ownership of the address.
        await tx
          .update(users)
          .set({ emailVerifiedAt: new Date() })
          .where(and(eq(users.id, req.user!.id), isNull(users.emailVerifiedAt)));
        await writeAudit(tx, {
          workspaceId: invite.workspaceId,
          actorUserId: req.user!.id,
          action: "member.joined",
          targetType: "user",
          targetId: req.user!.id,
          targetLabel: invite.email,
          metadata: { role: invite.role },
          ip: req.ip,
        });
      });
      return reply.send({ ok: true, workspaceId: invite.workspaceId });
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
      if (parsed.data.role === "admin" && req.member!.role !== "owner") {
        return reply.status(403).send({ error: { code: "forbidden", message: "Only the owner can grant the admin role." } });
      }
      const [invite] = await db
        .update(invitations)
        .set({ role: parsed.data.role })
        .where(and(eq(invitations.id, userId), eq(invitations.workspaceId, workspaceId), isNull(invitations.acceptedAt)))
        .returning({ id: invitations.id });
      if (invite) return reply.send({ ok: true });
      const target = await db
        .select({ role: workspaceMembers.role })
        .from(workspaceMembers)
        .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
        .limit(1);
      if (!target[0]) return reply.status(404).send({ error: { code: "not_found", message: "Member not found." } });
      if (target[0].role === "owner") {
        return reply.status(400).send({ error: { code: "owner_immutable", message: "The owner's role cannot be changed." } });
      }
      if (target[0].role === "admin" && req.member!.role !== "owner") {
        return reply.status(403).send({ error: { code: "forbidden", message: "Only the owner can change an admin's role." } });
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
      const [revoked] = await db
        .update(invitations)
        .set({ revokedAt: new Date() })
        .where(and(eq(invitations.id, userId), eq(invitations.workspaceId, workspaceId), isNull(invitations.acceptedAt)))
        .returning({ id: invitations.id, email: invitations.email });
      if (revoked) {
        await writeAudit(db, {
          workspaceId,
          actorUserId: req.user!.id,
          action: "member.invitation_revoked",
          targetType: "invitation",
          targetId: revoked.id,
          targetLabel: revoked.email,
          ip: req.ip,
        });
        return reply.status(204).send();
      }
      const target = await db
        .select({ role: workspaceMembers.role })
        .from(workspaceMembers)
        .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
        .limit(1);
      if (!target[0]) return reply.status(404).send({ error: { code: "not_found", message: "Member not found." } });
      if (target[0].role === "owner") {
        return reply.status(400).send({ error: { code: "owner_immutable", message: "The owner cannot be removed." } });
      }
      if (target[0].role === "admin" && req.member!.role !== "owner" && userId !== req.user!.id) {
        return reply.status(403).send({ error: { code: "forbidden", message: "Only the owner can remove an admin." } });
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
      const plan = await effectivePlan(db, workspaceId);
      const [brandCount] = await db.select({ n: count() }).from(brands).where(eq(brands.workspaceId, workspaceId));
      if (plan && brandCount.n >= plan.maxBrands) {
        return reply.status(402).send({
          error: {
            code: "plan_limit",
            limit: "brands",
            message: `Your ${plan.name} plan includes ${plan.maxBrands} brand${plan.maxBrands === 1 ? "" : "s"}. Upgrade to add more.`,
          },
        });
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
