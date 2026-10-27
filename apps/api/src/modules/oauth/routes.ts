import { and, eq, isNull, lt } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AriaDatabase } from "@aria/db";
import {
  oauthCredentials,
  oauthStates,
  socialAccounts,
  workspaceMembers,
  workspaces,
} from "@aria/db";
import { encryptSecret } from "@aria/db";
import type { ProviderId } from "@aria/shared-types";
import { PROVIDERS, roleHasPermission } from "@aria/shared-types";
import {
  appBaseUrl,
  assertPublicHost,
  blueskyCreateSession,
  normalizeInstance,
  UnsafeHostError,
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  DEFAULT_BLUESKY_INSTANCE,
  fetchProfile,
  mastodonInstanceInfo,
} from "@aria/providers-core";
import { requireAuth, requireWorkspacePermission } from "../../plugins/auth.js";
import { connectionOption } from "./availability.js";
import { writeAudit } from "../../lib/audit.js";
import { checkChannelLimit } from "../../lib/limits.js";

const STATE_TTL_MS = 10 * 60_000;

const workspaceRef = z.union([z.string().uuid(), z.literal("current")]);

const authorizeQuery = z.object({
  workspaceId: workspaceRef,
  brandId: z.string().uuid().optional(),
  instance: z.string().optional(),
  /** json → returns {url, state} for SPA handling instead of a 302. */
  format: z.enum(["redirect", "json"]).default("redirect"),
});

const blueskyConnectSchema = z.object({
  workspaceId: workspaceRef,
  brandId: z.string().uuid().optional(),
  handle: z.string().min(3),
  appPassword: z.string().min(8),
  instance: z.string().optional(),
});

function webRedirect(path: string): string {
  // WEB_ORIGIN may be a comma-separated list (multiple allowed CORS origins);
  // post-OAuth redirects go to the first (primary) web origin only.
  const base = process.env.WEB_ORIGIN?.split(",")[0]?.trim() || "http://localhost:3000";
  return `${base}${path}`;
}

/** Resolves "current" (the caller's first active workspace) to an id. */
async function resolveWorkspaceId(db: AriaDatabase, ref: string, userId: string): Promise<string | null> {
  if (ref !== "current") return ref;
  const first = await db
    .select({ workspaceId: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(and(eq(workspaceMembers.userId, userId), eq(workspaceMembers.status, "active"), isNull(workspaces.deletedAt)))
    .orderBy(workspaceMembers.joinedAt)
    .limit(1);
  return first[0]?.workspaceId ?? null;
}

async function requireConnectPermission(
  db: AriaDatabase,
  workspaceId: string,
  userId: string
): Promise<boolean> {
  const member = await db
    .select({ role: workspaceMembers.role, status: workspaceMembers.status, deletedAt: workspaces.deletedAt })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
    .limit(1);
  const m = member[0];
  return !!m && m.status === "active" && !m.deletedAt && roleHasPermission(m.role, "connect_accounts");
}

/** Normalizes a user-supplied server URL and refuses private/internal hosts. */
async function safeInstance(input: string | undefined): Promise<string | undefined> {
  if (!input) return undefined;
  const normalized = normalizeInstance(input);
  await assertPublicHost(normalized);
  return normalized;
}

export function registerOauthRoutes(app: FastifyInstance): void {
  const db = app.database.db;

  app.get("/v1/workspaces/:workspaceId/connection-options", {
    preHandler: requireWorkspacePermission(app, "connect_accounts"),
  }, async (_req, reply) => {
    reply.header("Cache-Control", "no-store");
    return { options: await Promise.all((Object.keys(PROVIDERS) as ProviderId[]).map((provider) => connectionOption(db, provider))) };
  });

  /**
   * Step 1 of OAuth: mint a single-use state bound to (provider, workspace,
   * user), persist it, and redirect to the provider. The stored state is the
   * CSRF anchor — the callback only accepts codes matching a stored, unexpired
   * state, which it burns before use.
   */
  app.get("/v1/oauth/:provider/authorize", { preHandler: requireAuth(app) }, async (req, reply) => {
    const { provider } = req.params as { provider: ProviderId };
    if (!Object.hasOwn(PROVIDERS, provider)) {
      return reply.status(404).send({ error: { code: "unknown_provider", message: "Unknown provider." } });
    }
    const parsed = authorizeQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "invalid_input", message: "workspaceId is required." } });
    }
    const { brandId, format } = parsed.data;
    const workspaceId = await resolveWorkspaceId(db, parsed.data.workspaceId, req.user!.id);
    if (!workspaceId || !(await requireConnectPermission(db, workspaceId, req.user!.id))) {
      return reply.status(403).send({ error: { code: "forbidden", message: "You cannot connect accounts in this workspace." } });
    }
    const option = await connectionOption(db, provider);
    if (option.status !== "available") {
      return reply.status(400).send({ error: {
        code: option.status === "unsupported" ? "provider_unsupported" : option.status === "unavailable" ? "provider_unavailable" : "provider_unconfigured",
        message: option.message,
      } });
    }
    let instance: string | undefined;
    try {
      instance = await safeInstance(parsed.data.instance);
    } catch (err) {
      return reply.status(400).send({ error: { code: "invalid_instance", message: (err as Error).message } });
    }
    // The provider has not identified the account yet. Enforce the channel
    // limit in the callback so an existing account can reconnect at capacity.
    if (provider === "bluesky") {
      return reply.status(400).send({
        error: { code: "use_app_password", message: "Bluesky connects with an app password: POST /v1/accounts/bluesky/connect." },
      });
    }

    try {
      const { url, state, codeVerifier } = await buildAuthorizeUrl(provider, { instanceUrl: instance, db });
      await db.insert(oauthStates).values({
        state,
        providerId: provider,
        workspaceId,
        createdBy: req.user!.id,
        brandId: brandId ?? null,
        instanceUrl: instance ?? null,
        codeVerifier: codeVerifier ?? null,
        redirectUri: `${appBaseUrl()}/v1/oauth/callback/${provider}`,
        expiresAt: new Date(Date.now() + STATE_TTL_MS),
      });
      await db.delete(oauthStates).where(lt(oauthStates.expiresAt, new Date()));
      if (format === "json") {
        return reply.send({ url, state });
      }
      return reply.redirect(url);
    } catch (err) {
      return reply.status(400).send({
        error: { code: "authorize_failed", message: (err as Error).message },
      });
    }
  });

  /**
   * Step 2: the provider redirects here. Validate + burn the state,
   * exchange the code, fetch the profile, store encrypted credentials and the
   * account, then hand the user back to the web app.
   */
  app.get("/v1/oauth/callback/:provider", async (req, reply) => {
    const { provider } = req.params as { provider: ProviderId };
    const { code, state, error } = req.query as { code?: string; state?: string; error?: string };
    if (error || !code || !state) {
      return reply.redirect(webRedirect(`/accounts?connect=error&reason=${encodeURIComponent(error ?? "missing_code")}`));
    }
    const stored = (
      await db
        .select()
        .from(oauthStates)
        .where(and(eq(oauthStates.state, state), eq(oauthStates.providerId, provider)))
        .limit(1)
    )[0];
    if (!stored || stored.expiresAt.getTime() < Date.now()) {
      return reply.redirect(webRedirect("/accounts?connect=error&reason=state_expired"));
    }
    // Single-use: burn the state before anything else.
    await db.delete(oauthStates).where(eq(oauthStates.id, stored.id));

    try {
      const grant = await exchangeCodeForTokens({
        provider,
        code,
        codeVerifier: stored.codeVerifier ?? undefined,
        instanceUrl: stored.instanceUrl ?? undefined,
        db,
      });
      const profile = await fetchProfile(provider, grant.accessToken, {
        instanceUrl: stored.instanceUrl ?? undefined,
      });
      const expiresAt = grant.expiresInSeconds
        ? new Date(Date.now() + grant.expiresInSeconds * 1000)
        : null;

      const accounts = [profile, ...(profile.extra ?? [])];
      const metaProvider = provider === "facebook" || provider === "instagram" || provider === "threads";
      let skippedForLimit = 0;
      let connected = 0;
      for (const p of accounts) {
        // Facebook: p.accessToken is the Page token (the only token that can
        // publish to the Page). Other providers use the grant token directly.
        const accountToken = p.accessToken ?? grant.accessToken;
        // Page tokens minted from a long-lived user token don't expire; Meta
        // invalidates them on password change/app removal, which publishing
        // surfaces as needs_reauth.
        const accountExpiresAt = metaProvider && p.accessToken ? null : expiresAt;
        const already = (
          await db
            .select({ id: socialAccounts.id })
            .from(socialAccounts)
            .where(
              and(
                eq(socialAccounts.workspaceId, stored.workspaceId),
                eq(socialAccounts.providerId, provider),
                eq(socialAccounts.externalAccountId, p.externalAccountId)
              )
            )
            .limit(1)
        )[0];
        if (!already && (await checkChannelLimit(db, stored.workspaceId))) {
          skippedForLimit++;
          continue;
        }
        await db
          .insert(socialAccounts)
          .values({
            workspaceId: stored.workspaceId,
            brandId: stored.brandId ?? null,
            providerId: provider,
            externalAccountId: p.externalAccountId,
            displayName: p.displayName,
            handle: p.handle,
            followers: p.followers ?? 0,
            instanceUrl: stored.instanceUrl ?? null,
            avatarHue: Math.floor(Math.random() * 360),
            connection: "healthy",
            scopes: grant.scopes ?? [],
            connectedAt: new Date(),
            lastRefreshedAt: new Date(),
            createdBy: stored.createdBy,
          })
          .onConflictDoUpdate({
            target: [socialAccounts.workspaceId, socialAccounts.providerId, socialAccounts.externalAccountId],
            set: {
              displayName: p.displayName,
              handle: p.handle,
              followers: p.followers ?? 0,
              connection: "healthy",
              connectionNote: null,
              lastRefreshedAt: new Date(),
            },
          });
        const accountRow = (
          await db
            .select()
            .from(socialAccounts)
            .where(
              and(
                eq(socialAccounts.workspaceId, stored.workspaceId),
                eq(socialAccounts.providerId, provider),
                eq(socialAccounts.externalAccountId, p.externalAccountId)
              )
            )
            .limit(1)
        )[0];
        await db
          .insert(oauthCredentials)
          .values({
            accountId: accountRow.id,
            accessTokenEnc: encryptSecret(accountToken),
            refreshTokenEnc: grant.refreshToken ? encryptSecret(grant.refreshToken) : null,
            expiresAt: accountExpiresAt,
            scopes: grant.scopes ?? [],
          })
          .onConflictDoUpdate({
            target: oauthCredentials.accountId,
            set: {
              accessTokenEnc: encryptSecret(accountToken),
              refreshTokenEnc: grant.refreshToken ? encryptSecret(grant.refreshToken) : null,
              expiresAt: accountExpiresAt,
              scopes: grant.scopes ?? [],
              rotatedAt: new Date(),
            },
          });
        await writeAudit(db, {
          workspaceId: stored.workspaceId,
          actorUserId: stored.createdBy,
          action: "account.connected",
          targetType: "social_account",
          targetId: accountRow.id,
          targetLabel: `${PROVIDERS[provider]?.name ?? provider} · ${p.handle}`,
          ip: req.ip,
          userAgent: req.headers["user-agent"],
        });
        connected++;
      }
      if (!connected && skippedForLimit) return reply.redirect(webRedirect("/accounts?connect=error&reason=plan_limit"));
      return reply.redirect(
        webRedirect(`/accounts?connected=${provider}${skippedForLimit ? `&skipped=${skippedForLimit}&reason=plan_limit` : ""}`)
      );
    } catch (err) {
      const message = (err as Error).message ?? "Connection failed";
      // Provider response bodies are deliberately not logged: they can echo tokens or personal data.
      req.log.warn({ provider, reason: message, status: (err as { status?: number }).status }, "oauth_callback_failed");
      await writeAudit(db, {
        actorType: "system",
        action: "account.connect_failed",
        targetType: "provider",
        targetId: provider,
        metadata: { message },
        ip: req.ip,
      });
      return reply.redirect(webRedirect(`/accounts?connect=error&reason=${encodeURIComponent(message.slice(0, 120))}`));
    }
  });

  /**
   * Bluesky: app-password connect (self-serve, no developer app). The password
   * itself is NOT stored — we store the session JWTs, which refresh.
   */
  app.post("/v1/accounts/bluesky/connect", { preHandler: requireAuth(app) }, async (req, reply) => {
    const parsed = blueskyConnectSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "invalid_input", message: "Handle and app password are required." } });
    }
    const { brandId, handle, appPassword } = parsed.data;
    const workspaceId = await resolveWorkspaceId(db, parsed.data.workspaceId, req.user!.id);
    if (!workspaceId || !(await requireConnectPermission(db, workspaceId, req.user!.id))) {
      return reply.status(403).send({ error: { code: "forbidden", message: "You cannot connect accounts in this workspace." } });
    }
    const option = await connectionOption(db, "bluesky");
    if (option.status !== "available") return reply.status(400).send({ error: { code: "provider_unavailable", message: option.message } });
    let instanceUrl: string;
    try {
      instanceUrl = (await safeInstance(parsed.data.instance)) ?? DEFAULT_BLUESKY_INSTANCE;
    } catch (err) {
      return reply.status(400).send({ error: { code: "invalid_instance", message: (err as Error).message } });
    }
    try {
      const session = await blueskyCreateSession(handle, appPassword, { instanceUrl });
      const [existing] = await db.select({ id: socialAccounts.id }).from(socialAccounts).where(and(
        eq(socialAccounts.workspaceId, workspaceId),
        eq(socialAccounts.providerId, "bluesky"),
        eq(socialAccounts.externalAccountId, session.did),
      )).limit(1);
      if (!existing) {
        const limit = await checkChannelLimit(db, workspaceId);
        if (limit) return reply.status(402).send({ error: limit });
      }
      const displayHandle = `@${session.handle}`;
      await db
        .insert(socialAccounts)
        .values({
          workspaceId,
          brandId: brandId ?? null,
          providerId: "bluesky",
          externalAccountId: session.did,
          displayName: session.handle,
          handle: displayHandle,
          instanceUrl,
          avatarHue: Math.floor(Math.random() * 360),
          connection: "healthy",
          scopes: ["app password"],
          connectedAt: new Date(),
          lastRefreshedAt: new Date(),
          createdBy: req.user!.id,
        })
        .onConflictDoUpdate({
          target: [socialAccounts.workspaceId, socialAccounts.providerId, socialAccounts.externalAccountId],
          set: { displayName: session.handle, handle: displayHandle, connection: "healthy", connectionNote: null },
        });
      const accountRow = (
        await db
          .select()
          .from(socialAccounts)
          .where(
            and(
              eq(socialAccounts.workspaceId, workspaceId),
              eq(socialAccounts.providerId, "bluesky"),
              eq(socialAccounts.externalAccountId, session.did)
            )
          )
          .limit(1)
      )[0];
      // Access JWTs live ~2h; store conservatively at 90 minutes so refresh
      // runs before expiry.
      await db
        .insert(oauthCredentials)
        .values({
          accountId: accountRow.id,
          accessTokenEnc: encryptSecret(session.accessJwt),
          refreshTokenEnc: encryptSecret(session.refreshJwt),
          expiresAt: new Date(Date.now() + 90 * 60_000),
          scopes: ["app password"],
        })
        .onConflictDoUpdate({
          target: oauthCredentials.accountId,
          set: {
            accessTokenEnc: encryptSecret(session.accessJwt),
            refreshTokenEnc: encryptSecret(session.refreshJwt),
            expiresAt: new Date(Date.now() + 90 * 60_000),
            rotatedAt: new Date(),
          },
        });
      await writeAudit(db, {
        workspaceId,
        actorUserId: req.user!.id,
        action: "account.connected",
        targetType: "social_account",
        targetId: accountRow.id,
        targetLabel: `Bluesky · ${displayHandle}`,
        ip: req.ip,
      });
      return reply.status(201).send({ account: { id: accountRow.id, handle: displayHandle } });
    } catch {
      return reply.status(401).send({
        error: {
          code: "bluesky_auth_failed",
          message:
            "Bluesky rejected this handle or app password. Create an app password in Bluesky settings and try again.",
        },
      });
    }
  });

  /** Instance info for the connect form (character limits, media caps). */
  app.get("/v1/oauth/mastodon/instance", { preHandler: requireAuth(app) }, async (req, reply) => {
    const { instance } = req.query as { instance?: string };
    if (!instance) return reply.status(400).send({ error: { code: "invalid_input", message: "instance is required." } });
    try {
      const info = await mastodonInstanceInfo((await safeInstance(instance))!);
      return reply.send({ instance: info });
    } catch (err) {
      if (err instanceof UnsafeHostError) {
        return reply.status(400).send({ error: { code: "invalid_instance", message: err.message } });
      }
      return reply.status(400).send({ error: { code: "instance_unreachable", message: "That instance could not be reached." } });
    }
  });
}
