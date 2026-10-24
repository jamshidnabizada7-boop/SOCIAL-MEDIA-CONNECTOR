import { desc, eq, gte } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AriaDatabase } from "@aria/db";
import type { ProviderId } from "@aria/shared-types";
import {
  auditLogs,
  featureFlags,
  posts,
  providerAppConfigs,
  providerHealthState,
  publishAttempts,
  publishJobs,
  publishTargets,
  socialProviders,
  webhookEvents,
} from "@aria/db";
import {
  deleteProviderCredentials,
  getProviderCredentials,
  redirectUriFor,
  setProviderCredentials,
} from "@aria/providers-core";

/** Credential groups shown in the Admin UI (instagram shares facebook's Meta app). */
const CREDENTIAL_GROUPS: { provider: ProviderId; covers: string[] }[] = [
  { provider: "facebook", covers: ["facebook", "instagram"] },
  { provider: "threads", covers: ["threads"] },
  { provider: "linkedin", covers: ["linkedin"] },
  { provider: "tiktok", covers: ["tiktok"] },
  { provider: "youtube", covers: ["youtube"] },
  { provider: "x", covers: ["x"] },
  { provider: "pinterest", covers: ["pinterest"] },
];

function mask(value: string): string {
  if (value.length <= 8) return "••••";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export async function collectAdminOverview(db: AriaDatabase) {
  const now = Date.now();
  const sevenDaysAgo = new Date(now - 7 * 86_400_000);

  const providers = await db.select().from(socialProviders);
  const health = await db.select().from(providerHealthState);
  const healthByProvider = new Map(health.map((h) => [h.providerId, h]));

  // 7-day attempt outcomes per provider.
  const attempts = await db
    .select({
      targetId: publishAttempts.targetId,
      success: publishAttempts.success,
      outcome: publishAttempts.outcome,
      startedAt: publishAttempts.startedAt,
    })
    .from(publishAttempts)
    .where(gte(publishAttempts.startedAt, sevenDaysAgo));
  const targetProvider = new Map(
    (await db.select({ id: publishTargets.id, providerId: publishTargets.providerId }).from(publishTargets)).map((t) => [t.id, t.providerId])
  );
  const statsByProvider = new Map<string, { total: number; failed: number }>();
  for (const a of attempts) {
    const provider = targetProvider.get(a.targetId);
    if (!provider) continue;
    const entry = statsByProvider.get(provider) ?? { total: 0, failed: 0 };
    entry.total += 1;
    if (a.success === false) entry.failed += 1;
    statsByProvider.set(provider, entry);
  }

  const lastPublish = await db
    .select({ providerId: publishTargets.providerId, publishedAt: publishTargets.publishedAt })
    .from(publishTargets)
    .where(eq(publishTargets.state, "published"));
  const lastPublishByProvider = new Map<string, Date>();
  for (const row of lastPublish) {
    if (row.publishedAt && (!lastPublishByProvider.get(row.providerId) || row.publishedAt > lastPublishByProvider.get(row.providerId)!)) {
      lastPublishByProvider.set(row.providerId, row.publishedAt);
    }
  }

  const adminProviders = providers.map((p) => {
    const stats = statsByProvider.get(p.id) ?? { total: 0, failed: 0 };
    const circuit = healthByProvider.get(p.id);
    return {
      provider: p.id,
      name: p.name,
      status: p.status,
      apiVersion: p.apiVersion,
      approval: p.approval,
      verifiedAt: p.verifiedAt?.toISOString() ?? null,
      errorRate7d: stats.total > 0 ? Number(((stats.failed / stats.total) * 100).toFixed(1)) : 0,
      lastSuccessfulPublish: lastPublishByProvider.get(p.id)?.toISOString() ?? null,
      circuitOpen: !!(circuit?.circuitOpenUntil && circuit.circuitOpenUntil.getTime() > now),
      consecutiveFailures: circuit?.consecutiveFailures ?? 0,
    };
  });

  const jobRows = await db
    .select({
      id: publishJobs.id,
      state: publishJobs.state,
      attempts: publishJobs.attempts,
      runAt: publishJobs.runAt,
      lastError: publishJobs.lastError,
      postTitle: posts.title,
      providerId: publishTargets.providerId,
    })
    .from(publishJobs)
    .innerJoin(publishTargets, eq(publishTargets.id, publishJobs.targetId))
    .innerJoin(posts, eq(posts.id, publishTargets.postId))
    .orderBy(desc(publishJobs.updatedAt))
    .limit(50);

  const adminJobs = jobRows.map((j) => ({
    id: j.id,
    postTitle: j.postTitle,
    provider: j.providerId,
    state: j.state,
    attempts: j.attempts,
    runAt: j.runAt.toISOString(),
    lastError: j.lastError,
  }));

  const dlq = jobRows
    .filter((j) => j.state === "dead_letter")
    .map((j) => ({ id: j.id, postTitle: j.postTitle, provider: j.providerId, attempts: j.attempts, lastError: j.lastError }));

  const webhookRows = await db.select().from(webhookEvents).orderBy(desc(webhookEvents.receivedAt)).limit(50);
  const flagRows = await db.select().from(featureFlags);
  const auditRows = await db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(100);

  return {
    providers: adminProviders,
    jobs: adminJobs,
    dlq,
    webhooks: webhookRows.map((w) => ({
      id: w.id,
      provider: w.providerId,
      type: w.type,
      receivedAt: w.receivedAt.toISOString(),
      signatureValid: w.signatureValid,
      status: w.status,
    })),
    flags: flagRows.map((f) => ({ key: f.key, description: f.description, enabled: f.enabled, rollout: f.rollout })),
    audit: auditRows.map((a) => ({
      id: a.id,
      at: a.createdAt.toISOString(),
      actor: a.actorType === "system" ? "System" : (a.actorUserId ?? "—"),
      action: a.action,
      target: a.targetLabel ?? a.targetId ?? a.targetType ?? "",
      ip: a.ip,
    })),
  };
}

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

export function registerAdminDataRoutes(app: FastifyInstance): void {
  const db = app.database.db;
  const guard = requirePlatformAdmin();

  app.get("/v1/admin/overview", { preHandler: guard }, async (_req, reply) => {
    return reply.send(await collectAdminOverview(db));
  });

  app.post("/v1/admin/providers/:provider/status", { preHandler: guard }, async (req, reply) => {
    const { provider } = req.params as { provider: string };
    const { status } = req.body as { status: "active" | "degraded" | "maintenance" | "disabled" };
    if (!["active", "degraded", "maintenance", "disabled"].includes(status)) {
      return reply.status(400).send({ error: { code: "invalid_input", message: "Invalid status." } });
    }
    await db.update(socialProviders).set({ status, updatedAt: new Date() }).where(eq(socialProviders.id, provider));
    await db.insert(auditLogs).values({
      actorUserId: req.user!.id,
      action: "admin.provider_status",
      targetType: "provider",
      targetId: provider,
      metadata: { status },
      ip: req.ip,
    });
    return reply.send({ ok: true });
  });

  app.post("/v1/admin/jobs/:jobId/replay", { preHandler: guard }, async (req, reply) => {
    const { jobId } = req.params as { jobId: string };
    const job = (await db.select().from(publishJobs).where(eq(publishJobs.id, jobId)).limit(1))[0];
    if (!job) return reply.status(404).send({ error: { code: "not_found", message: "Job not found." } });
    await db
      .update(publishJobs)
      .set({ state: "pending", runAt: new Date(), attempts: 0, lastError: null, updatedAt: new Date() })
      .where(eq(publishJobs.id, jobId));
    await db.insert(auditLogs).values({
      actorUserId: req.user!.id,
      action: "admin.job_replayed",
      targetType: "publish_job",
      targetId: jobId,
      ip: req.ip,
    });
    return reply.send({ ok: true });
  });

  app.post("/v1/admin/flags/:key", { preHandler: guard }, async (req, reply) => {
    const { key } = req.params as { key: string };
    const { enabled } = req.body as { enabled: boolean };
    await db.update(featureFlags).set({ enabled, updatedAt: new Date() }).where(eq(featureFlags.key, key));
    await db.insert(auditLogs).values({
      actorUserId: req.user!.id,
      action: "admin.flag_changed",
      targetType: "feature_flag",
      targetId: key,
      metadata: { enabled },
      ip: req.ip,
    });
    return reply.send({ ok: true });
  });

  app.get("/v1/admin/provider-credentials", { preHandler: guard }, async (_req, reply) => {
    const groups = await Promise.all(
      CREDENTIAL_GROUPS.map(async ({ provider, covers }) => {
        const creds = await getProviderCredentials(db, provider);
        return {
          provider,
          covers,
          configured: !!creds,
          source: creds?.source ?? null,
          clientIdMasked: creds ? mask(creds.clientId) : null,
          secretMasked: creds ? "••••••••" : null,
          redirectUri: redirectUriFor(provider),
        };
      })
    );
    return reply.send({ groups });
  });

  app.put("/v1/admin/provider-credentials/:provider", { preHandler: guard }, async (req, reply) => {
    const { provider } = req.params as { provider: string };
    if (!CREDENTIAL_GROUPS.some((g) => g.provider === provider)) {
      return reply.status(400).send({ error: { code: "invalid_input", message: `Unknown provider "${provider}".` } });
    }
    const { clientId, clientSecret } = (req.body ?? {}) as { clientId?: string; clientSecret?: string };
    if (!clientId || !clientSecret) {
      return reply.status(400).send({
        error: { code: "invalid_input", message: "Both clientId and clientSecret are required." },
      });
    }
    await setProviderCredentials(db, provider as ProviderId, { clientId, clientSecret });
    await db.insert(auditLogs).values({
      actorUserId: req.user!.id,
      action: "admin.provider_credentials_set",
      targetType: "provider_app_config",
      targetId: provider,
      ip: req.ip,
    });
    return reply.send({ ok: true });
  });

  app.delete("/v1/admin/provider-credentials/:provider", { preHandler: guard }, async (req, reply) => {
    const { provider } = req.params as { provider: string };
    if (!CREDENTIAL_GROUPS.some((g) => g.provider === provider)) {
      return reply.status(400).send({ error: { code: "invalid_input", message: `Unknown provider "${provider}".` } });
    }
    await deleteProviderCredentials(db, provider as ProviderId);
    await db.insert(auditLogs).values({
      actorUserId: req.user!.id,
      action: "admin.provider_credentials_deleted",
      targetType: "provider_app_config",
      targetId: provider,
      ip: req.ip,
    });
    return reply.send({ ok: true });
  });
}
