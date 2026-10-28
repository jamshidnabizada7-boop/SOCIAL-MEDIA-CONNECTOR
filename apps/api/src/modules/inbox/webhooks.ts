import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import {
  socialAccounts,
  socialInboxWebhooks,
  socialSyncState,
  workspaces,
} from "@aria/db";
import { getProviderCredentials } from "@aria/providers-core";

const payloadSchema = z.object({
  object: z.enum(["page", "instagram"]),
  entry: z.array(z.object({ id: z.string().regex(/^\d+$/).max(100) })).max(100),
});
export function validMetaInboxSignature(
  raw: Buffer,
  signature: unknown,
  secret: string,
): boolean {
  if (typeof signature !== "string" || !/^sha256=[a-f\d]{64}$/.test(signature))
    return false;
  return timingSafeEqual(
    Buffer.from(signature.slice(7), "hex"),
    createHmac("sha256", secret).update(raw).digest(),
  );
}
/** Dedicated Meta-only signature protocol. Raw bodies are verified, then discarded. */
export async function registerInboxWebhooks(
  parent: FastifyInstance,
): Promise<void> {
  await parent.register(async (app) => {
    app.removeContentTypeParser("application/json");
    app.addContentTypeParser(
      "application/json",
      { parseAs: "buffer", bodyLimit: 1048576 },
      (_req, body, done) => done(null, body),
    );
    const route = "/v1/webhooks/inbox/:provider";
    app.get(route, async (req, reply) => {
      const { provider } = req.params as { provider: string };
      if (!["facebook", "instagram"].includes(provider))
        return reply.code(404).send({
          error: {
            code: "not_implemented",
            message: "This provider uses polling or has no inbox integration.",
          },
        });
      const expected = process.env.INBOX_WEBHOOK_VERIFY_TOKEN;
      const query = req.query as Record<string, string>;
      if (
        !expected ||
        query["hub.mode"] !== "subscribe" ||
        query["hub.verify_token"] !== expected ||
        !query["hub.challenge"] ||
        query["hub.challenge"].length > 200
      )
        return reply.code(403).send({
          error: {
            code: "verification_failed",
            message: "Webhook verification failed.",
          },
        });
      return reply.type("text/plain").send(query["hub.challenge"]);
    });
    app.post(route, async (req, reply) => {
      const { provider } = req.params as { provider: "facebook" | "instagram" };
      if (!["facebook", "instagram"].includes(provider))
        return reply.code(404).send({
          error: {
            code: "not_implemented",
            message:
              "No signed inbox webhook is implemented for this provider.",
          },
        });
      const creds = await getProviderCredentials(app.database.db, provider);
      if (!creds)
        return reply.code(503).send({
          error: {
            code: "webhook_unconfigured",
            message: "Meta app credentials are not configured.",
          },
        });
      if (
        !Buffer.isBuffer(req.body) ||
        !validMetaInboxSignature(
          req.body,
          req.headers["x-hub-signature-256"],
          creds.clientSecret,
        )
      )
        return reply.code(401).send({
          error: {
            code: "invalid_signature",
            message: "Webhook signature verification failed.",
          },
        });
      let body: unknown;
      try {
        body = JSON.parse(req.body.toString("utf8"));
      } catch {
        return reply.code(400).send({
          error: { code: "invalid_payload", message: "Invalid JSON." },
        });
      }
      const payload = payloadSchema.safeParse(body);
      if (
        !payload.success ||
        payload.data.object !== (provider === "facebook" ? "page" : "instagram")
      )
        return reply.code(400).send({
          error: {
            code: "invalid_payload",
            message: "Unexpected Meta webhook payload.",
          },
        });
      const digest = createHash("sha256").update(req.body).digest("hex");
      const ids = [...new Set(payload.data.entry.map((e) => e.id))];
      return app.database.db.transaction(async (tx) => {
        const accepted = await tx
          .insert(socialInboxWebhooks)
          .values({ providerId: provider, digest })
          .onConflictDoNothing()
          .returning({ id: socialInboxWebhooks.id });
        if (!accepted.length) return { accepted: true, duplicate: true };
        const accounts = ids.length
          ? await tx
              .select({
                id: socialAccounts.id,
                workspaceId: socialAccounts.workspaceId,
              })
              .from(socialAccounts)
              .innerJoin(
                workspaces,
                eq(socialAccounts.workspaceId, workspaces.id),
              )
              .where(
                and(
                  eq(socialAccounts.providerId, provider),
                  inArray(socialAccounts.externalAccountId, ids),
                  isNull(workspaces.deletedAt),
                ),
              )
          : [];
        for (const account of accounts)
          await tx
            .insert(socialSyncState)
            .values({ workspaceId: account.workspaceId, accountId: account.id })
            .onConflictDoUpdate({
              target: socialSyncState.accountId,
              set: { nextSyncAt: new Date() },
              setWhere: eq(socialSyncState.workspaceId, account.workspaceId),
            });
        await tx
          .update(socialInboxWebhooks)
          .set({ matchedAccounts: accounts.length })
          .where(eq(socialInboxWebhooks.id, accepted[0].id));
        // Acknowledge only after durable dedupe + wakeup. The worker fetches owned content.
        return { accepted: true, duplicate: false };
      });
    });
  });
}
