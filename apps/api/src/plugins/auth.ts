import { sessions, users, workspaceMembers, workspaces } from "@aria/db";
import { hashToken } from "@aria/db";
import { and, eq, isNull, lt } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Role } from "@aria/shared-types";
import { roleHasPermission, type Permission } from "@aria/shared-types";
import { config, SESSION_COOKIE, SESSION_TTL_DAYS } from "../config.js";
import { generateSessionToken } from "@aria/db";

export interface SessionedUser {
  id: string;
  email: string;
  name: string;
  avatarHue: number;
  isPlatformAdmin: boolean;
}

declare module "fastify" {
  interface FastifyRequest {
    user?: SessionedUser;
    member?: { role: Role; workspaceId: string; userId: string };
  }
}

export async function createSession(
  app: FastifyInstance,
  reply: FastifyReply,
  userId: string,
  meta: { ip?: string; userAgent?: string }
): Promise<void> {
  const db = app.database.db;
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);
  await db.insert(sessions).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt,
    ip: meta.ip,
    userAgent: meta.userAgent?.slice(0, 300),
  });
  // Opportunistic cleanup of this user's expired sessions.
  await db
    .delete(sessions)
    .where(and(eq(sessions.userId, userId), lt(sessions.expiresAt, new Date())));
  reply.setCookie(SESSION_COOKIE, token, { ...sessionCookieOptions(), expires: expiresAt });
}

/**
 * Lax keeps the cookie off cross-site subrequests; the web app and API must
 * therefore share a site (same registrable domain). SESSION_COOKIE_DOMAIN
 * scopes it to a parent domain when they are on sibling subdomains.
 */
function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: config.NODE_ENV === "production",
    path: "/",
    ...(config.SESSION_COOKIE_DOMAIN ? { domain: config.SESSION_COOKIE_DOMAIN } : {}),
  };
}

export async function destroySession(app: FastifyInstance, req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = req.cookies[SESSION_COOKIE];
  if (token) {
    await app.database.db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  }
  reply.clearCookie(SESSION_COOKIE, sessionCookieOptions());
}

/** Populates req.user from the session cookie (no-op when absent/expired). */
export async function sessionHook(app: FastifyInstance, req: FastifyRequest): Promise<void> {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return;
  const rows = await app.database.db
    .select({
      userId: users.id,
      email: users.email,
      name: users.name,
      avatarHue: users.avatarHue,
      isPlatformAdmin: users.isPlatformAdmin,
      status: users.status,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, hashToken(token)))
    .limit(1);
  const row = rows[0];
  if (!row) return;
  if (row.expiresAt.getTime() < Date.now() || row.status !== "active") return;
  req.user = {
    id: row.userId,
    email: row.email,
    name: row.name,
    avatarHue: row.avatarHue,
    isPlatformAdmin: row.isPlatformAdmin,
  };
}

export function requireAuth(_app: FastifyInstance) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) {
      return reply.status(401).send({ error: { code: "unauthenticated", message: "Sign in to continue." } });
    }
  };
}

/**
 * Resolves :workspaceId against membership and enforces a permission.
 * Returns 404 for non-members (no existence leak), 403 for insufficient role.
 */
export function requireWorkspacePermission(app: FastifyInstance, permission?: Permission) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) {
      return reply.status(401).send({ error: { code: "unauthenticated", message: "Sign in to continue." } });
    }
    let { workspaceId } = req.params as { workspaceId: string };
    // SPA convenience: "current" resolves to the caller's first membership.
    if (workspaceId === "current") {
      const first = await app.database.db
        .select({ workspaceId: workspaceMembers.workspaceId })
        .from(workspaceMembers)
        .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
        .where(
          and(eq(workspaceMembers.userId, req.user.id), eq(workspaceMembers.status, "active"), isNull(workspaces.deletedAt))
        )
        .orderBy(workspaceMembers.joinedAt)
        .limit(1);
      if (!first[0]) {
        return reply.status(404).send({ error: { code: "not_found", message: "Workspace not found." } });
      }
      workspaceId = first[0].workspaceId;
      (req.params as Record<string, unknown>).workspaceId = workspaceId;
    }
    const rows = await app.database.db
      .select({ role: workspaceMembers.role, status: workspaceMembers.status, wsDeleted: workspaces.deletedAt })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, req.user.id)))
      .limit(1);
    const membership = rows[0];
    // Invited-but-not-accepted members get no access (indistinguishable from non-members).
    if (!membership || membership.wsDeleted || membership.status !== "active") {
      return reply.status(404).send({ error: { code: "not_found", message: "Workspace not found." } });
    }
    if (permission && !roleHasPermission(membership.role, permission)) {
      return reply.status(403).send({
        error: { code: "forbidden", message: `Your role (${membership.role}) cannot ${permission.replace(/_/g, " ")}.` },
      });
    }
    req.member = { role: membership.role, workspaceId, userId: req.user.id };
  };
}
