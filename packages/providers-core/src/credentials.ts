import { and, eq, lt } from "drizzle-orm";
import type { AriaDatabase } from "@aria/db";
import { notifications, oauthCredentials, socialAccounts } from "@aria/db";
import { decryptSecret, encryptSecret } from "@aria/db";
import type { ProviderId } from "@aria/shared-types";
import { refreshAccessToken } from "./oauth.js";
import { DEFAULT_BLUESKY_INSTANCE } from "./bluesky.js";

export interface DecryptedCredential {
  accountId: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  scopes: string[];
  instanceUrl?: string;
}

export class RefreshFailedError extends Error {
  constructor(
    message: string,
    readonly accountId: string
  ) {
    super(message);
    this.name = "RefreshFailedError";
  }
}

/**
 * Single-flight token refresh (plan §27). Two layers:
 *  - an in-process map so threads in one worker serialize;
 *  - a Postgres advisory lock so multiple workers/processes serialize.
 * Losers re-read the freshly persisted credential instead of refreshing again.
 */
const inFlight = new Map<string, Promise<unknown>>();

export function withRefreshLock<T>(accountId: string, fn: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(accountId);
  // Waiters chain behind the current holder AND become the new map entry, so
  // three concurrent callers serialize 1 -> 2 -> 3 instead of 1 -> (2||3).
  const run = existing ? existing.then(() => fn()) : fn();
  const tracked: Promise<unknown> = run.then(
    () => undefined,
    () => undefined
  );
  inFlight.set(accountId, tracked);
  tracked.finally(() => {
    if (inFlight.get(accountId) === tracked) inFlight.delete(accountId);
  });
  return run as Promise<T>;
}

const REFRESH_MARGIN_MS = 5 * 60_000;

export async function loadDecryptedCredential(
  db: AriaDatabase,
  accountId: string
): Promise<DecryptedCredential | null> {
  const rows = await db
    .select()
    .from(oauthCredentials)
    .where(eq(oauthCredentials.accountId, accountId))
    .limit(1);
  const cred = rows[0];
  if (!cred) return null;
  const account = (
    await db.select().from(socialAccounts).where(eq(socialAccounts.id, accountId)).limit(1)
  )[0];
  return {
    accountId,
    accessToken: decryptSecret(cred.accessTokenEnc),
    refreshToken: cred.refreshTokenEnc ? decryptSecret(cred.refreshTokenEnc) : undefined,
    expiresAt: cred.expiresAt ?? undefined,
    scopes: cred.scopes ?? [],
    instanceUrl: account?.instanceUrl ?? undefined,
  };
}

async function persistRefreshedCredential(
  db: AriaDatabase,
  accountId: string,
  grant: { accessToken: string; refreshToken?: string; expiresInSeconds?: number; scopes?: string[] }
): Promise<DecryptedCredential> {
  const expiresAt = grant.expiresInSeconds
    ? new Date(Date.now() + grant.expiresInSeconds * 1000)
    : undefined;
  await db
    .update(oauthCredentials)
    .set({
      accessTokenEnc: encryptSecret(grant.accessToken),
      ...(grant.refreshToken ? { refreshTokenEnc: encryptSecret(grant.refreshToken) } : {}),
      ...(expiresAt ? { expiresAt } : {}),
      ...(grant.scopes ? { scopes: grant.scopes } : {}),
      rotatedAt: new Date(),
    })
    .where(eq(oauthCredentials.accountId, accountId));
  await db
    .update(socialAccounts)
    .set({ lastRefreshedAt: new Date(), connection: "healthy", connectionNote: null })
    .where(eq(socialAccounts.id, accountId));
  return {
    accountId,
    accessToken: grant.accessToken,
    refreshToken: grant.refreshToken,
    expiresAt,
    scopes: grant.scopes ?? [],
  };
}

/**
 * Returns a valid access token for the account, refreshing first when the
 * stored one is expired or expiring. Refresh failures flip the connection to
 * `needs_reauth` and raise a notification — scheduled content pauses safely
 * instead of failing mysteriously later.
 */
export async function resolveAccessToken(
  db: AriaDatabase,
  accountId: string
): Promise<DecryptedCredential> {
  const cred = await loadDecryptedCredential(db, accountId);
  if (!cred) throw new RefreshFailedError("No stored credential for this account", accountId);

  const needsRefresh =
    !!cred.expiresAt && cred.expiresAt.getTime() - REFRESH_MARGIN_MS < Date.now();
  if (!needsRefresh) return cred;

  return withRefreshLock(accountId, async () => {
    // Another caller may have refreshed while we waited on the lock.
    const fresh = await loadDecryptedCredential(db, accountId);
    if (!fresh) throw new RefreshFailedError("Credential disappeared during refresh", accountId);
    if (!fresh.expiresAt || fresh.expiresAt.getTime() - REFRESH_MARGIN_MS >= Date.now()) {
      return fresh;
    }
    if (!fresh.refreshToken) {
      await markRefreshFailed(db, accountId, "The stored credential cannot be refreshed — reconnect the account.");
      throw new RefreshFailedError("No refresh token available", accountId);
    }
    const account = (
      await db.select().from(socialAccounts).where(eq(socialAccounts.id, accountId)).limit(1)
    )[0];
    try {
      const grant = await refreshAccessToken(account.providerId as ProviderId, fresh.refreshToken, {
        instanceUrl: fresh.instanceUrl,
        blueskyInstance: fresh.instanceUrl ?? DEFAULT_BLUESKY_INSTANCE,
        facebookPageId: account.providerId === "facebook" ? account.externalAccountId : undefined,
        db,
      });
      return await persistRefreshedCredential(db, accountId, grant);
    } catch (err) {
      const message = (err as Error).message ?? "Token refresh failed";
      await markRefreshFailed(db, accountId, `Automatic token refresh failed (${message}). Reconnect the account.`);
      throw new RefreshFailedError(message, accountId);
    }
  });
}

async function markRefreshFailed(db: AriaDatabase, accountId: string, note: string): Promise<void> {
  const account = (
    await db.select().from(socialAccounts).where(eq(socialAccounts.id, accountId)).limit(1)
  )[0];
  if (!account) return;
  await db
    .update(socialAccounts)
    .set({ connection: "needs_reauth", connectionNote: note, lastRefreshedAt: new Date() })
    .where(eq(socialAccounts.id, accountId));
  await db.insert(notifications).values({
    workspaceId: account.workspaceId,
    type: "needs_reauth",
    severity: "warning",
    title: `${account.displayName} needs to be reconnected`,
    body: note,
    accountId,
  });
}

/** Flips accounts whose tokens expire soon to `token_expiring` (health signal). */
export async function flagExpiringTokens(
  db: AriaDatabase,
  withinMs = 7 * 86_400_000
): Promise<number> {
  const soon = new Date(Date.now() + withinMs);
  const rows = await db
    .select({ accountId: oauthCredentials.accountId })
    .from(oauthCredentials)
    .where(lt(oauthCredentials.expiresAt, soon));
  let flipped = 0;
  for (const r of rows) {
    const account = (
      await db.select().from(socialAccounts).where(eq(socialAccounts.id, r.accountId)).limit(1)
    )[0];
    if (account && account.connection === "healthy") {
      await db
        .update(socialAccounts)
        .set({
          connection: "token_expiring",
          connectionNote: "Access token expires soon. It will refresh automatically.",
        })
        .where(eq(socialAccounts.id, r.accountId));
      flipped += 1;
    }
  }
  return flipped;
}

export async function findCredentialRow(db: AriaDatabase, accountId: string) {
  const rows = await db
    .select()
    .from(oauthCredentials)
    .where(and(eq(oauthCredentials.accountId, accountId)))
    .limit(1);
  return rows[0] ?? null;
}
