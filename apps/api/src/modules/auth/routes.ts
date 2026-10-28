import { generateSessionToken, hashToken, sessions, userTokens, users, workspaceMembers, workspaces } from "@aria/db";
import { and, eq, gt, inArray, isNull, ne } from "drizzle-orm";
import { resolveNotificationPrefs } from "@aria/shared-types";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { createSession, destroySession, requireAuth } from "../../plugins/auth.js";
import { writeAudit } from "../../lib/audit.js";
import { actionEmail, sendMail, webAppUrl } from "../../lib/mailer.js";
import { retireWorkspaces } from "../../lib/workspace-lifecycle.js";

const passwordSchema = z.string().min(8, "Use at least 8 characters.").max(200);

const registerSchema = z.object({
  email: z.string().email(),
  password: passwordSchema,
  name: z.string().min(2).max(80),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MS = 15 * 60_000;
const RESET_TTL_MS = 60 * 60_000;
const VERIFY_TTL_MS = 3 * 86_400_000;

type TokenPurpose = "password_reset" | "email_verify";

function publicUser(u: {
  id: string;
  email: string;
  name: string;
  avatarHue: number;
  isPlatformAdmin: boolean;
  emailVerifiedAt?: Date | null;
}) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    avatarHue: u.avatarHue,
    isPlatformAdmin: u.isPlatformAdmin,
    emailVerified: Boolean(u.emailVerifiedAt),
  };
}

export function registerAuthRoutes(app: FastifyInstance): void {
  const db = app.database.db;

  /** Issues a single-use token (older unused ones for the same purpose are retired). */
  async function issueToken(userId: string, purpose: TokenPurpose, ttlMs: number): Promise<string> {
    const token = generateSessionToken();
    await db
      .update(userTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(userTokens.userId, userId), eq(userTokens.purpose, purpose), isNull(userTokens.usedAt)));
    await db.insert(userTokens).values({ userId, purpose, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + ttlMs) });
    return token;
  }

  /** Consumes a token atomically; returns its user id when valid. */
  async function consumeToken(token: string, purpose: TokenPurpose): Promise<string | null> {
    const [row] = await db
      .update(userTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(userTokens.tokenHash, hashToken(token)),
          eq(userTokens.purpose, purpose),
          isNull(userTokens.usedAt),
          gt(userTokens.expiresAt, new Date())
        )
      )
      .returning({ userId: userTokens.userId });
    return row?.userId ?? null;
  }

  async function sendVerification(req: FastifyRequest, user: { id: string; email: string; name: string }) {
    const token = await issueToken(user.id, "email_verify", VERIFY_TTL_MS);
    const url = `${webAppUrl()}/verify-email?token=${token}`;
    const body = actionEmail({
      heading: "Confirm your email",
      body: `Hi ${user.name}, confirm this address to finish setting up your Aria Hub account.`,
      actionLabel: "Confirm email",
      actionUrl: url,
      footer: "The link expires in 3 days. If you didn't create an account, ignore this email.",
    });
    return sendMail(req.log, { to: user.email, subject: "Confirm your Aria Hub email", ...body });
  }

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
      const email = parsed.data.email.toLowerCase();
      const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
      if (existing.length > 0) {
        return reply.status(409).send({
          error: { code: "email_taken", message: "An account with this email already exists." },
        });
      }
      const bcrypt = await import("bcryptjs");
      const passwordHash = await bcrypt.hash(parsed.data.password, 12);
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
      await sendVerification(req, user);
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
      const email = parsed.data.email.toLowerCase();
      const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
      const user = rows[0];
      if (user?.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
        const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
        return reply.status(429).send({
          error: {
            code: "account_locked",
            message: `Too many failed sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}, or reset your password.`,
          },
        });
      }
      const bcrypt = await import("bcryptjs");
      const ok = user?.passwordHash
        ? await bcrypt.compare(parsed.data.password, user.passwordHash)
        : // Equalize timing for unknown accounts.
          await bcrypt.compare(parsed.data.password, "$2a$10$C6UzMDM.H6dfI/f/IKcEeO7ZBpEyR2eKok4Ma8VjFrOAmX.iE0oMy");
      if (!user || !ok) {
        if (user) {
          const failed = user.failedLoginCount + 1;
          await db
            .update(users)
            .set({
              failedLoginCount: failed >= MAX_FAILED_LOGINS ? 0 : failed,
              lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCKOUT_MS) : user.lockedUntil,
            })
            .where(eq(users.id, user.id));
          if (failed >= MAX_FAILED_LOGINS) {
            await writeAudit(db, { actorUserId: user.id, action: "user.locked_out", targetType: "user", targetId: user.id, ip: req.ip });
          }
        }
        return reply.status(401).send({
          error: { code: "invalid_credentials", message: "Email or password is incorrect." },
        });
      }
      if (user.status !== "active") {
        return reply.status(403).send({ error: { code: "account_suspended", message: "This account is suspended. Contact support." } });
      }
      await db
        .update(users)
        .set({ lastActiveAt: new Date(), failedLoginCount: 0, lockedUntil: null })
        .where(eq(users.id, user.id));
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

  /** Always answers the same way so it can't be used to discover accounts. */
  app.post(
    "/v1/auth/forgot-password",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const parsed = z.object({ email: z.string().email() }).safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: { code: "invalid_input", message: "Enter a valid email." } });
      }
      const email = parsed.data.email.toLowerCase();
      const user = (await db.select().from(users).where(eq(users.email, email)).limit(1))[0];
      if (user && user.status === "active") {
        const token = await issueToken(user.id, "password_reset", RESET_TTL_MS);
        const body = actionEmail({
          heading: "Reset your password",
          body: "Someone asked to reset the password for your Aria Hub account. Use the button below to choose a new one.",
          actionLabel: "Choose a new password",
          actionUrl: `${webAppUrl()}/reset-password?token=${token}`,
          footer: "The link expires in 1 hour. If you didn't ask for this, ignore this email — your password stays the same.",
        });
        await sendMail(req.log, { to: user.email, subject: "Reset your Aria Hub password", ...body });
        await writeAudit(db, { actorUserId: user.id, action: "user.password_reset_requested", targetType: "user", targetId: user.id, ip: req.ip });
      }
      return reply.send({ ok: true });
    }
  );

  app.post(
    "/v1/auth/reset-password",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const parsed = z.object({ token: z.string().min(16).max(200), password: passwordSchema }).safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Invalid input." },
        });
      }
      const userId = await consumeToken(parsed.data.token, "password_reset");
      if (!userId) {
        return reply.status(400).send({ error: { code: "invalid_token", message: "This reset link is invalid or has expired. Request a new one." } });
      }
      const bcrypt = await import("bcryptjs");
      const passwordHash = await bcrypt.hash(parsed.data.password, 12);
      await db.transaction(async (tx) => {
        // A reset proves inbox ownership, so it also verifies the email and clears any lockout.
        await tx
          .update(users)
          .set({ passwordHash, failedLoginCount: 0, lockedUntil: null, emailVerifiedAt: new Date(), updatedAt: new Date() })
          .where(eq(users.id, userId));
        // Sign out every existing session.
        await tx.delete(sessions).where(eq(sessions.userId, userId));
        await writeAudit(tx, { actorUserId: userId, action: "user.password_reset", targetType: "user", targetId: userId, ip: req.ip });
      });
      await createSession(app, reply, userId, { ip: req.ip, userAgent: req.headers["user-agent"] });
      return reply.send({ ok: true });
    }
  );

  app.post("/v1/auth/verify-email", async (req, reply) => {
    const parsed = z.object({ token: z.string().min(16).max(200) }).safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "invalid_input", message: "Missing verification token." } });
    }
    const userId = await consumeToken(parsed.data.token, "email_verify");
    if (!userId) {
      return reply.status(400).send({ error: { code: "invalid_token", message: "This confirmation link is invalid or has expired." } });
    }
    await db.update(users).set({ emailVerifiedAt: new Date(), updatedAt: new Date() }).where(eq(users.id, userId));
    await writeAudit(db, { actorUserId: userId, action: "user.email_verified", targetType: "user", targetId: userId, ip: req.ip });
    return reply.send({ ok: true });
  });

  app.post(
    "/v1/auth/resend-verification",
    { preHandler: requireAuth(app), config: { rateLimit: { max: 3, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const user = (await db.select().from(users).where(eq(users.id, req.user!.id)).limit(1))[0];
      if (!user) return reply.status(404).send({ error: { code: "not_found", message: "Account not found." } });
      if (user.emailVerifiedAt) return reply.send({ ok: true, alreadyVerified: true });
      const mail = await sendVerification(req, user);
      if (!mail.delivered) return reply.status(503).send({ error: { code: "email_unavailable", message: "The confirmation email couldn't be sent. Please try again later or contact support." } });
      return reply.send({ ok: true });
    }
  );

  app.post(
    "/v1/auth/change-password",
    { preHandler: requireAuth(app), config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const parsed = z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema }).safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Invalid input." },
        });
      }
      const user = (await db.select().from(users).where(eq(users.id, req.user!.id)).limit(1))[0];
      const bcrypt = await import("bcryptjs");
      if (!user?.passwordHash || !(await bcrypt.compare(parsed.data.currentPassword, user.passwordHash))) {
        return reply.status(400).send({ error: { code: "invalid_credentials", message: "Your current password is incorrect." } });
      }
      const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);
      await db.transaction(async (tx) => {
        await tx.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, user.id));
        await tx.delete(sessions).where(eq(sessions.userId, user.id));
        await writeAudit(tx, { actorUserId: user.id, action: "user.password_changed", targetType: "user", targetId: user.id, ip: req.ip });
      });
      await createSession(app, reply, user.id, { ip: req.ip, userAgent: req.headers["user-agent"] });
      return reply.send({ ok: true });
    }
  );

  app.get("/v1/auth/me", { preHandler: requireAuth(app) }, async (req, reply) => {
    const user = (await db.select().from(users).where(eq(users.id, req.user!.id)).limit(1))[0];
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
      .where(
        and(eq(workspaceMembers.userId, req.user!.id), eq(workspaceMembers.status, "active"), isNull(workspaces.deletedAt))
      );
    return reply.send({
      user: user ? publicUser(user) : req.user,
      notificationPrefs: resolveNotificationPrefs(user?.notificationPrefs),
      workspaces: memberships,
    });
  });

  app.patch("/v1/auth/me", { preHandler: requireAuth(app) }, async (req, reply) => {
    const parsed = z
      .object({
        name: z.string().trim().min(2).max(80).optional(),
        notificationPrefs: z.object({ failures: z.boolean().optional(), reauth: z.boolean().optional() }).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Invalid input." } });
    }
    const current = (await db.select().from(users).where(eq(users.id, req.user!.id)).limit(1))[0];
    if (!current) return reply.status(404).send({ error: { code: "not_found", message: "Account not found." } });
    const prefs = parsed.data.notificationPrefs
      ? { ...resolveNotificationPrefs(current.notificationPrefs), ...parsed.data.notificationPrefs }
      : current.notificationPrefs;
    const [updated] = await db
      .update(users)
      .set({ ...(parsed.data.name ? { name: parsed.data.name } : {}), notificationPrefs: prefs, updatedAt: new Date() })
      .where(eq(users.id, current.id))
      .returning();
    return reply.send({ user: publicUser(updated), notificationPrefs: resolveNotificationPrefs(updated.notificationPrefs) });
  });

  /**
   * Account deletion (right to erasure). Requires the password. Workspaces the
   * user owns alone are deleted with the account; a workspace that still has
   * other members must be handed over first, so nobody loses their work.
   */
  app.delete(
    "/v1/auth/me",
    { preHandler: requireAuth(app), config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const parsed = z.object({ password: z.string().min(1) }).safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: { code: "invalid_input", message: "Enter your password to confirm." } });
      }
      const user = (await db.select().from(users).where(eq(users.id, req.user!.id)).limit(1))[0];
      const bcrypt = await import("bcryptjs");
      if (!user?.passwordHash || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
        return reply.status(400).send({ error: { code: "invalid_credentials", message: "That password is incorrect." } });
      }
      const owned = await db
        .select({ workspaceId: workspaceMembers.workspaceId, name: workspaces.name })
        .from(workspaceMembers)
        .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
        .where(and(eq(workspaceMembers.userId, user.id), eq(workspaceMembers.role, "owner"), isNull(workspaces.deletedAt)));
      if (owned.length > 0) {
        const shared = await db
          .select({ workspaceId: workspaceMembers.workspaceId })
          .from(workspaceMembers)
          .where(
            and(
              inArray(workspaceMembers.workspaceId, owned.map((o) => o.workspaceId)),
              ne(workspaceMembers.userId, user.id),
              eq(workspaceMembers.status, "active")
            )
          );
        if (shared.length > 0) {
          const names = owned.filter((o) => shared.some((s) => s.workspaceId === o.workspaceId)).map((o) => o.name);
          return reply.status(409).send({
            error: {
              code: "owns_shared_workspace",
              message: `Transfer ownership of ${names.join(", ")} to a teammate (Team → member menu) before deleting your account.`,
            },
          });
        }
      }
      await db.transaction(async (tx) => {
        await retireWorkspaces(tx, owned.map((o) => o.workspaceId));
        await writeAudit(tx, { actorUserId: user.id, action: "user.deleted", targetType: "user", targetId: user.id, ip: req.ip });
        // Cascades sessions, memberships and tokens; audit rows keep the id only.
        await tx.delete(users).where(eq(users.id, user.id));
      });
      await destroySession(app, req, reply);
      return reply.status(204).send();
    }
  );
}
