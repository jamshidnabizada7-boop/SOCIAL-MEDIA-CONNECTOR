import { users, workspaceMembers, workspaces } from "@aria/db";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createSession, destroySession, requireAuth, sessionHook } from "../../plugins/auth.js";
import { writeAudit } from "../../lib/audit.js";

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Use at least 8 characters."),
  name: z.string().min(2).max(80),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function publicUser(u: { id: string; email: string; name: string; avatarHue: number; isPlatformAdmin: boolean }) {
  return { id: u.id, email: u.email, name: u.name, avatarHue: u.avatarHue, isPlatformAdmin: u.isPlatformAdmin };
}

export function registerAuthRoutes(app: FastifyInstance): void {
  app.addHook("preHandler", (req) => sessionHook(app, req));

  app.post(
    "/v1/auth/register",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Invalid input." },
        });
      }
      const db = app.database.db;
      const email = parsed.data.email.toLowerCase();
      const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
      if (existing.length > 0) {
        return reply.status(409).send({
          error: { code: "email_taken", message: "An account with this email already exists." },
        });
      }
      const bcrypt = await import("bcryptjs");
      const passwordHash = await bcrypt.hash(parsed.data.password, 10);
      const [user] = await db
        .insert(users)
        .values({ email, name: parsed.data.name, passwordHash, avatarHue: Math.floor(Math.random() * 360) })
        .returning();
      await createSession(app, reply, user.id, {
        ip: req.ip,
        userAgent: req.headers["user-agent"],
      });
      await writeAudit(db, {
        actorUserId: user.id,
        action: "user.registered",
        targetType: "user",
        targetId: user.id,
        targetLabel: user.email,
        ip: req.ip,
        userAgent: req.headers["user-agent"],
      });
      return reply.status(201).send({ user: publicUser(user) });
    }
  );

  app.post(
    "/v1/auth/login",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "invalid_input", message: "Enter a valid email and password." },
        });
      }
      const db = app.database.db;
      const email = parsed.data.email.toLowerCase();
      const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
      const user = rows[0];
      const bcrypt = await import("bcryptjs");
      const ok = user?.passwordHash
        ? await bcrypt.compare(parsed.data.password, user.passwordHash)
        : // Equalize timing for unknown accounts.
          await bcrypt.compare(parsed.data.password, "$2a$10$C6UzMDM.H6dfI/f/IKcEeO7ZBpEyR2eKok4Ma8VjFrOAmX.iE0oMy");
      if (!user || !ok) {
        return reply.status(401).send({
          error: { code: "invalid_credentials", message: "Email or password is incorrect." },
        });
      }
      await db.update(users).set({ lastActiveAt: new Date() }).where(eq(users.id, user.id));
      await createSession(app, reply, user.id, { ip: req.ip, userAgent: req.headers["user-agent"] });
      await writeAudit(db, {
        actorUserId: user.id,
        action: "user.login",
        targetType: "user",
        targetId: user.id,
        ip: req.ip,
        userAgent: req.headers["user-agent"],
      });
      return reply.send({ user: publicUser(user) });
    }
  );

  app.post("/v1/auth/logout", async (req, reply) => {
    await destroySession(app, req, reply);
    return reply.send({ ok: true });
  });

  app.get("/v1/auth/me", { preHandler: requireAuth(app) }, async (req, reply) => {
    const db = app.database.db;
    const memberships = await db
      .select({
        workspaceId: workspaces.id,
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
    return reply.send({ user: req.user, workspaces: memberships });
  });
}
