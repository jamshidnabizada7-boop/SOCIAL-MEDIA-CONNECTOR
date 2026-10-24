import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import {
  decryptSecret,
  oauthCredentials,
  socialAccounts,
} from "@aria/db";
import {
  flagExpiringTokens,
  resolveAccessToken,
  RefreshFailedError,
} from "@aria/providers-core";
import { requireWorkspacePermission } from "../../plugins/auth.js";
import { writeAudit } from "../../lib/audit.js";

export function registerAccountRoutes(app: FastifyInstance): void {
  const db = app.database.db;

  /** Connected accounts with live health. Any workspace member can view. */
  app.get(
    "/v1/workspaces/:workspaceId/accounts",
    { preHandler: requireWorkspacePermission(app) },
    async (req, reply) => {
      const { workspaceId } = req.params as { workspaceId: string };
      const rows = await db
        .select({
          id: socialAccounts.id,
          providerId: socialAccounts.providerId,
          brandId: socialAccounts.brandId,
          displayName: socialAccounts.displayName,
          handle: socialAccounts.handle,
          connection: socialAccounts.connection,
          connectionNote: socialAccounts.connectionNote,
          instanceUrl: socialAccounts.instanceUrl,
          followers: socialAccounts.followers,
          connectedAt: socialAccounts.connectedAt,
          lastRefreshedAt: socialAccounts.lastRefreshedAt,
          tokenExpiresAt: socialAccounts.tokenExpiresAt,
        })
        .from(socialAccounts)
        .where(eq(socialAccounts.workspaceId, workspaceId));
      return reply.send({ accounts: rows });
    }
  );

  /** Health sweep: flags tokens expiring within 7 days. */
  app.post(
    "/v1/workspaces/:workspaceId/accounts/health-check",
    { preHandler: requireWorkspacePermission(app, "connect_accounts") },
    async (_req, reply) => {
      const flipped = await flagExpiringTokens(db);
      return reply.send({ flagged: flipped });
    }
  );

  /** Forces a token refresh (also proves the vault end-to-end). */
  app.post(
    "/v1/workspaces/:workspaceId/accounts/:accountId/refresh",
    { preHandler: requireWorkspacePermission(app, "connect_accounts") },
    async (req, reply) => {
      const { workspaceId, accountId } = req.params as { workspaceId: string; accountId: string };
      const owned = (
        await db
          .select({ id: socialAccounts.id })
          .from(socialAccounts)
          .where(and(eq(socialAccounts.id, accountId), eq(socialAccounts.workspaceId, workspaceId)))
          .limit(1)
      )[0];
      if (!owned) {
        return reply.status(404).send({ error: { code: "not_found", message: "Account not found." } });
      }
      try {
        const cred = await resolveAccessToken(db, accountId);
        return reply.send({
          ok: true,
          expiresAt: cred.expiresAt?.toISOString() ?? null,
          scopes: cred.scopes,
        });
      } catch (err) {
        if (err instanceof RefreshFailedError) {
          const account = (
            await db.select().from(socialAccounts).where(eq(socialAccounts.id, accountId)).limit(1)
          )[0];
          return reply.status(409).send({
            error: {
              code: "refresh_failed",
              message: "Token refresh failed — reconnect this account.",
              connection: account?.connection ?? "needs_reauth",
            },
          });
        }
        throw err;
      }
    }
  );

  /**
   * Disconnect: revokes with the provider where we can (Bluesky session,
   * Mastodon token with its persisted app credentials), deletes the encrypted
   * credential, and removes the account. Published content at the network is
   * unaffected — we explain this in the UI confirm dialog.
   */
  app.delete(
    "/v1/workspaces/:workspaceId/accounts/:accountId",
    { preHandler: requireWorkspacePermission(app, "disconnect_accounts") },
    async (req, reply) => {
      const { workspaceId, accountId } = req.params as { workspaceId: string; accountId: string };
      const account = (
        await db
          .select()
          .from(socialAccounts)
          .where(and(eq(socialAccounts.id, accountId), eq(socialAccounts.workspaceId, workspaceId)))
          .limit(1)
      )[0];
      if (!account) {
        return reply.status(404).send({ error: { code: "not_found", message: "Account not found." } });
      }

      // Best-effort revocation with the provider.
      try {
        const cred = (
          await db.select().from(oauthCredentials).where(eq(oauthCredentials.accountId, accountId)).limit(1)
        )[0];
        if (cred) {
          const accessToken = decryptSecret(cred.accessTokenEnc);
          const refreshToken = cred.refreshTokenEnc ? decryptSecret(cred.refreshTokenEnc) : undefined;
          if (account.providerId === "bluesky") {
            const { blueskyDeleteSession } = await import("@aria/providers-core");
            await blueskyDeleteSession(accessToken, {
              instanceUrl: account.instanceUrl ?? undefined,
            }).catch(() => {});
          } else if (account.providerId === "mastodon" && account.instanceUrl) {
            const { ensureMastodonApp, mastodonRevokeToken } = await import("@aria/providers-core");
            const appCfg = await ensureMastodonApp(db, account.instanceUrl);
            await mastodonRevokeToken(
              account.instanceUrl,
              appCfg.clientId,
              appCfg.clientSecret,
              refreshToken ?? accessToken
            );
          }
          // Other providers' revocation endpoints ship with their adapters (Phase 5).
        }
      } catch {
        // Revocation is best-effort; local deletion is the source of truth.
      }

      await db.delete(socialAccounts).where(eq(socialAccounts.id, accountId)); // cascades credentials
      await writeAudit(db, {
        workspaceId,
        actorUserId: req.user!.id,
        action: "account.disconnected",
        targetType: "social_account",
        targetId: accountId,
        targetLabel: `${account.providerId} · ${account.handle}`,
        ip: req.ip,
      });
      return reply.status(204).send();
    }
  );
}
