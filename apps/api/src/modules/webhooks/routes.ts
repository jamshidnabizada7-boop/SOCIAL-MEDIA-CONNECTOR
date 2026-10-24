import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import {
  posts,
  publishTargets,
  remotePosts,
  webhookEvents,
} from "@aria/db";
import type { ProviderId } from "@aria/shared-types";
import { PROVIDERS } from "@aria/shared-types";

const SUPPORTED: ProviderId[] = [
  "facebook",
  "instagram",
  "threads",
  "linkedin",
  "tiktok",
  "youtube",
  "x",
  "pinterest",
  "mastodon",
];

function webhookSecret(provider: ProviderId): string | null {
  const key = `WEBHOOK_SECRET_${provider.toUpperCase()}`;
  return process.env[key] ?? null;
}

/** Constant-time signature comparison. */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Token for Meta-style GET subscription verification (hub.verify_token). */
function verifyToken(provider: ProviderId): string | null {
  return process.env[`WEBHOOK_VERIFY_TOKEN_${provider.toUpperCase()}`] ?? process.env.WEBHOOK_VERIFY_TOKEN ?? null;
}

/**
 * Verifies the provider's HMAC signature over the raw body.
 * Supported header shapes: X-Hub-Signature-256 (Meta-style "sha256=…"),
 * X-Signature (TikTok-style hex). Returns null when no secret is configured.
 */
function verifySignature(
  provider: ProviderId,
  rawBody: string,
  headers: Record<string, string | string[] | undefined>
): { verified: boolean; reason: string } {
  const secret = webhookSecret(provider);
  if (!secret) return { verified: false, reason: "no_secret_configured" };
  const candidates = ["x-hub-signature-256", "x-signature", "x-webhook-signature"];
  let provided: string | undefined;
  for (const name of candidates) {
    const value = headers[name];
    if (typeof value === "string") {
      provided = value;
      break;
    }
  }
  if (!provided) return { verified: false, reason: "missing_signature" };
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const normalized = provided.replace(/^sha256=/, "").trim();
  if (!safeEqual(normalized, expected)) {
    return { verified: false, reason: "signature_mismatch" };
  }
  return { verified: true, reason: "verified" };
}

/** Extracts a provider event id for dedupe — shapes vary per provider. */
function extractEventId(payload: Record<string, unknown>): string | null {
  const candidates = ["id", "event_id", "eventId", "publish_id", "notification_id"];
  for (const key of candidates) {
    const value = payload[key];
    if (typeof value === "string") return value;
  }
  const entry = payload.entry as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(entry) && entry[0]?.id) return String(entry[0].id);
  return null;
}

/** Extracts a remote post id from common webhook payload shapes. */
function extractRemotePostId(payload: Record<string, unknown>): string | null {
  for (const key of ["publish_id", "post_id", "media_id", "video_id"]) {
    const value = payload[key];
    if (typeof value === "string") return value;
  }
  const data = payload.data as Record<string, unknown> | undefined;
  if (data && typeof data.id === "string") return data.id;
  return null;
}

/** True when the payload indicates the post went live. */
function indicatesPublished(payload: Record<string, unknown>): boolean {
  const status = String(payload.status ?? payload.event ?? "").toUpperCase();
  return (
    status.includes("PUBLISHED") ||
    status.includes("COMPLETE") ||
    status.includes("SUCCESS") ||
    status === "PUBLISH_COMPLETED" ||
    status === "VIDEO_PUBLISH_COMPLETE"
  );
}

export function registerWebhookRoutes(app: FastifyInstance): void {
  const db = app.database.db;

  /**
   * Subscription handshake (Meta: Facebook, Instagram, Threads). The provider
   * calls GET with hub.mode=subscribe and expects hub.challenge echoed back
   * when hub.verify_token matches WEBHOOK_VERIFY_TOKEN[_<PROVIDER>].
   */
  app.get("/v1/webhooks/:provider", async (req, reply) => {
    const { provider } = req.params as { provider: ProviderId };
    if (!SUPPORTED.includes(provider)) {
      return reply.status(404).send({ error: { code: "unknown_provider", message: "Unknown provider." } });
    }
    const q = req.query as Record<string, string | undefined>;
    const expected = verifyToken(provider);
    if (q["hub.mode"] === "subscribe" && expected && q["hub.verify_token"] && safeEqual(q["hub.verify_token"], expected)) {
      return reply.type("text/plain").send(q["hub.challenge"] ?? "");
    }
    return reply.status(403).send({ error: { code: "verification_failed", message: "Webhook verification failed." } });
  });

  /**
   * Inbound provider webhook gateway (plan §34): fast acknowledgement, HMAC
   * signature verification against the exact raw bytes, raw-event persistence
   * with dedupe, then targeted processing — never blind trust of unverified
   * payloads. The encapsulated scope keeps bodies as raw strings so the
   * signature is computed over what the provider actually sent.
   */
  app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser("*", { parseAs: "string", bodyLimit: 1024 * 1024 }, (_req, body, done) => {
      done(null, body);
    });

    scope.post("/v1/webhooks/:provider", async (req, reply) => {
      const { provider } = req.params as { provider: ProviderId };
      if (!SUPPORTED.includes(provider)) {
        return reply.status(404).send({ error: { code: "unknown_provider", message: "Unknown provider." } });
      }

      const rawBody = typeof req.body === "string" ? req.body : "";
      const signature = verifySignature(provider, rawBody, req.headers);

      if (!signature.verified) {
        // Never process or store unverified payloads (plan §34) — only record that one arrived.
        req.log.warn({ provider, reason: signature.reason }, "webhook rejected");
        await db
          .insert(webhookEvents)
          .values({
            providerId: provider,
            type: "rejected",
            signatureValid: false,
            status: "failed",
            payload: { reason: signature.reason },
            dedupeKey: null,
          })
          .catch((err: unknown) => req.log.error({ err }, "failed to record rejected webhook"));
        return reply.status(signature.reason === "no_secret_configured" ? 503 : 401).send({
          error: {
            code: "signature_" + signature.reason,
            message:
              signature.reason === "no_secret_configured"
                ? `No webhook secret configured for ${PROVIDERS[provider]?.name ?? provider} — set WEBHOOK_SECRET_${provider.toUpperCase()}.`
                : "Webhook signature verification failed.",
          },
        });
      }

      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(rawBody);
      } catch {
        payload = {};
      }

      const dedupeKey = extractEventId(payload);
      if (dedupeKey) {
        const seen = await db
          .select({ id: webhookEvents.id })
          .from(webhookEvents)
          .where(eq(webhookEvents.dedupeKey, `${provider}:${dedupeKey}`))
          .limit(1);
        if (seen[0]) {
          await db.insert(webhookEvents).values({
            providerId: provider,
            type: String(payload.type ?? payload.event ?? "duplicate"),
            signatureValid: true,
            status: "duplicate",
            payload: {},
            dedupeKey: `${provider}:${dedupeKey}:${Date.now()}`,
          });
          return reply.status(200).send({ ok: true, duplicate: true });
        }
      }

      const [event] = await db
        .insert(webhookEvents)
        .values({
          providerId: provider,
          type: String(payload.type ?? payload.event ?? "unknown"),
          signatureValid: true,
          status: "pending",
          payload,
          dedupeKey: dedupeKey ? `${provider}:${dedupeKey}` : null,
        })
        .returning();

      // ---- Processing: publish-status reconciliation --------------------------
      if (indicatesPublished(payload)) {
        const remotePostId = extractRemotePostId(payload);
        if (remotePostId) {
          const remote = (
            await db.select().from(remotePosts).where(eq(remotePosts.providerPostId, remotePostId)).limit(1)
          )[0];
          if (remote) {
            const target = (
              await db.select().from(publishTargets).where(eq(publishTargets.id, remote.targetId)).limit(1)
            )[0];
            if (target && target.state !== "published" && target.state !== "canceled") {
              await db
                .update(publishTargets)
                .set({ state: "published", publishedAt: new Date(), remoteUrl: remote.permalink ?? null, updatedAt: new Date() })
                .where(eq(publishTargets.id, remote.targetId));
              const siblings = await db
                .select({ state: publishTargets.state })
                .from(publishTargets)
                .where(eq(publishTargets.postId, target.postId));
              const states = siblings.map((s) => s.state);
              const allPublished = states.every((s) => s === "published");
              const anyInFlight = states.some(
                (s) => !["published", "failed", "canceled", "token_expired", "needs_user_action", "pending"].includes(s)
              );
              const nextState = anyInFlight
                ? "processing"
                : allPublished
                  ? "published"
                  : states.some((s) => s === "failed" || s === "token_expired")
                    ? states.some((s) => s === "published")
                      ? "partially_published"
                      : "failed"
                    : "partially_published";
              await db
                .update(posts)
                .set({ state: nextState as typeof posts.$inferSelect.state, updatedAt: new Date() })
                .where(eq(posts.id, target.postId));
            }
          }
        }
        await db.update(webhookEvents).set({ status: "processed" }).where(eq(webhookEvents.id, event.id));
        return reply.status(200).send({ ok: true, processed: true });
      }

      await db.update(webhookEvents).set({ status: "processed" }).where(eq(webhookEvents.id, event.id));
      return reply.status(200).send({ ok: true, processed: false });
    });
  });
}
