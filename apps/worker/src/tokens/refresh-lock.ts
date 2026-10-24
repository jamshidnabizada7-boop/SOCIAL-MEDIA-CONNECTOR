import { sql } from "drizzle-orm";
import type { AriaDatabase } from "@aria/db";

/**
 * Single-flight token refresh (plan §27). When several workers hit an expired
 * token simultaneously, exactly one may talk to the provider's token endpoint:
 * it takes a Postgres advisory lock keyed on the account id, refreshes,
 * persists the new token atomically, and releases the lock. Concurrent
 * callers fail fast with `refresh_in_progress` and must re-read the vault.
 */
export async function withRefreshLock<T>(
  db: AriaDatabase,
  accountId: string,
  fn: () => Promise<T>
): Promise<T> {
  const lockKey = Number(
    BigInt("0x" + Buffer.from(accountId).toString("hex").slice(0, 14) || "1")
  );
  const acquired = await db.execute(
    sql`select pg_try_advisory_lock(${lockKey}) as acquired`
  );
  const rows = (acquired as unknown as { rows: Array<{ acquired: boolean }> }).rows;
  if (!rows[0]?.acquired) {
    const err = new Error("token refresh already in progress for this account") as Error & {
      code?: string;
    };
    err.code = "refresh_in_progress";
    throw err;
  }
  try {
    return await fn();
  } finally {
    await db.execute(sql`select pg_advisory_unlock(${lockKey})`);
  }
}
