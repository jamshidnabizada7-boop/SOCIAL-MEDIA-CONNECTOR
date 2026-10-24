import { and, eq, isNotNull, lt, sql } from "drizzle-orm";
import type { AriaDatabase, DbOrTx } from "@aria/db";
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
 *  - an in-process map so concurrent callers in one process serialize;
 *  - a transaction-scoped Postgres advisory lock (see resolveAccessToken) so
 *    the API and every worker serialize too. Transaction scope matters: with
 *    a connection pool a session lock could be released on another connection.
 * Losers re-read the freshly persisted credential instead of refreshing again,
 * which is what keeps rotating refresh tokens (X, Bluesky) from being burned.
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
  db: DbOrTx,
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
  db: DbOrTx,
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
 * stored one is expired or expiring (within `marginMs`, default 5 minutes).
 * Refresh failures flip the connection to `needs_reauth` and raise a
 * notification — scheduled content pauses safely instead of failing
 * mysteriously later.
 */
export async function resolveAccessToken(
  db: AriaDatabase,
  accountId: string,
  options: { marginMs?: number } = {}
): Promise<DecryptedCredential> {
  const marginMs = options.marginMs ?? REFRESH_MARGIN_MS;
  const cred = await loadDecryptedCredential(db, accountId);
  if (!cred) throw new RefreshFailedError("No stored credential for this account", accountId);

  const expiring = (c: DecryptedCredential) => !!c.expiresAt && c.expiresAt.getTime() - marginMs < Date.now();
  if (!expiring(cred)) return cred;

  type Outcome = { cred: DecryptedCredential } | { failed: string; message: string };
  const outcome = await withRefreshLock(accountId, () =>
    db.transaction(async (tx): Promise<Outcome> => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`aria-refresh:${accountId}`}))`);
      // Another process may have refreshed while we waited on the lock.
      const fresh = await loadDecryptedCredential(tx, accountId);
      if (!fresh) return { failed: "The stored credential disappeared — reconnect the account.", message: "Credential disappeared during refresh" };
      if (!expiring(fresh)) return { cred: fresh };
      if (!fresh.refreshToken) {
        return { failed: "The stored credential cannot be refreshed — reconnect the account.", message: "No refresh token available" };
      }
      const account = (await tx.select().from(socialAccounts).where(eq(socialAccounts.id, accountId)).limit(1))[0];
      try {
        const grant = await refreshAccessToken(account.providerId as ProviderId, fresh.refreshToken, {
          instanceUrl: fresh.instanceUrl,
          blueskyInstance: fresh.instanceUrl ?? DEFAULT_BLUESKY_INSTANCE,
          facebookPageId: account.providerId === "facebook" ? account.externalAccountId : undefined,
          db,
        });
        return { cred: await persistRefreshedCredential(tx, accountId, grant) };
      } catch (err) {
        const message = (err as Error).message ?? "Token refresh failed";
        return { failed: `Automatic token refresh failed (${message}). Reconnect the account.`, message };
      }
    })
  );
  if ("failed" in outcome) {
    // Recorded outside the transaction so the health flip and notification persist.
    await markRefreshFailed(db, accountId, outcome.failed);
    throw new RefreshFailedError(outcome.message, accountId);
  }
  return outcome.cred;
}

/**
 * Connection monitor: refreshes tokens that expire within `withinMs` ahead of
 * time, so a post scheduled for 3 a.m. never waits on a refresh. Returns how
 * many were refreshed; failures are flagged by resolveAccessToken itself.
 */
export async function refreshExpiringTokens(db: AriaDatabase, withinMs = 24 * 3_600_000): Promise<number> {
  const soon = new Date(Date.now() + withinMs);
  const rows = await db
    .select({ accountId: oauthCredentials.accountId })
    .from(oauthCredentials)
    .innerJoin(socialAccounts, eq(socialAccounts.id, oauthCredentials.accountId))
    .where(
      and(
        lt(oauthCredentials.expiresAt, soon),
        isNotNull(oauthCredentials.refreshTokenEnc),
        // Accounts already flagged for reconnection would only fail again.
        sql`${socialAccounts.connection} not in ('needs_reauth', 'disconnected')`
      )
    );
  let refreshed = 0;
  for (const r of rows) {
    try {
      await resolveAccessToken(db, r.accountId, { marginMs: withinMs });
      refreshed += 1;
    } catch {
      /* markRefreshFailed already notified the workspace */
    }
  }
  return refreshed;
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

/**
 * Flips accounts whose tokens expire soon and CANNOT refresh themselves to
 * `token_expiring`, so users reconnect before schedules break. Tokens with a
 * refresh token are renewed by refreshExpiringTokens instead.
 */
export async function flagExpiringTokens(
  db: AriaDatabase,
  withinMs = 7 * 86_400_000
): Promise<number> {
  const soon = new Date(Date.now() + withinMs);
  const rows = await db
    .select({ accountId: oauthCredentials.accountId })
    .from(oauthCredentials)
    .where(and(lt(oauthCredentials.expiresAt, soon), sql`${oauthCredentials.refreshTokenEnc} is null`));
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
          connectionNote: "Access expires soon and can't renew itself. Reconnect the account to keep scheduled posts running.",
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
