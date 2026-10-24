import { desc, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { providerHealthState } from "@aria/db";
import type { ProviderId } from "@aria/shared-types";
import { PROVIDERS } from "@aria/shared-types";

/**
 * Admin provider-health endpoints (plan §64/§65): circuit-breaker state per
 * provider. Guarded to platform admins — never exposes secrets, and reset is
 * an explicit, audited action.
 */
function requirePlatformAdmin() {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) {
      return reply.status(401).send({ error: { code: "unauthenticated", message: "Sign in to continue." } });
    }
    if (!req.user.isPlatformAdmin) {
      return reply.status(403).send({ error: { code: "forbidden", message: "Platform admin access required." } });
    }
  };
}

export function registerAdminRoutes(app: FastifyInstance): void {
  const db = app.database.db;

  app.get("/v1/admin/provider-health", { preHandler: requirePlatformAdmin() }, async (req, reply) => {
    const rows = await db
      .select()
      .from(providerHealthState)
      .orderBy(desc(providerHealthState.updatedAt));
    const known = new Set(Object.keys(PROVIDERS));
    return reply.send({
      providers: rows
        .filter((r) => known.has(r.providerId))
        .map((r) => ({
          provider: r.providerId,
          consecutiveFailures: r.consecutiveFailures,
          circuitOpen: !!(r.circuitOpenUntil && r.circuitOpenUntil.getTime() > Date.now()),
          circuitOpenUntil: r.circuitOpenUntil?.toISOString() ?? null,
          lastErrorCode: r.lastErrorCode,
          updatedAt: r.updatedAt.toISOString(),
        })),
    });
  });

  app.post("/v1/admin/provider-health/:provider/reset", { preHandler: requirePlatformAdmin() }, async (req, reply) => {
    const { provider } = req.params as { provider: ProviderId };
    if (!PROVIDERS[provider]) {
      return reply.status(404).send({ error: { code: "unknown_provider", message: "Unknown provider." } });
    }
    await db
      .update(providerHealthState)
      .set({ consecutiveFailures: 0, circuitOpenUntil: null, updatedAt: new Date() })
      .where(eq(providerHealthState.providerId, provider));
    return reply.send({ ok: true });
  });
}
