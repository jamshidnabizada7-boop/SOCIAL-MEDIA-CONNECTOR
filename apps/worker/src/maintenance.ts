import { and, inArray, isNotNull, lt, or } from "drizzle-orm";
import { mediaAssets, oauthStates, rateLimitBuckets, sessions, userTokens, webhookEvents, workspaces } from "@aria/db";
import type { AriaDatabase } from "@aria/db";
import { defaultStorage } from "@aria/media-core";

const DAY = 86_400_000;
/** Grace period before a deleted workspace's data (and media files) is erased. */
export const WORKSPACE_PURGE_AFTER_MS = 30 * DAY;

/**
 * Daily housekeeping: erases workspaces deleted more than 30 days ago (DB
 * rows cascade; media files are removed from storage) and prunes expired
 * sessions, single-use tokens, OAuth states and old webhook records.
 */
export async function runMaintenance(db: AriaDatabase): Promise<Record<string, number>> {
  const now = Date.now();
  const purgeBefore = new Date(now - WORKSPACE_PURGE_AFTER_MS);
  const doomed = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(and(isNotNull(workspaces.deletedAt), lt(workspaces.deletedAt, purgeBefore)));

  let filesRemoved = 0;
  if (doomed.length > 0) {
    const ids = doomed.map((w) => w.id);
    const files = await db
      .select({ key: mediaAssets.storageKey })
      .from(mediaAssets)
      .where(and(inArray(mediaAssets.workspaceId, ids), isNotNull(mediaAssets.storageKey)));
    await db.delete(workspaces).where(inArray(workspaces.id, ids));
    const storage = defaultStorage();
    for (const f of files) {
      if (!f.key) continue;
      await storage.remove(f.key).catch(() => {});
      filesRemoved++;
    }
  }

  const expiredSessions = await db.delete(sessions).where(lt(sessions.expiresAt, new Date(now))).returning({ id: sessions.id });
  const expiredBudgets = await db.delete(rateLimitBuckets).where(lt(rateLimitBuckets.expiresAt, new Date(now))).returning({ key: rateLimitBuckets.key });
  const staleTokens = await db
    .delete(userTokens)
    .where(or(lt(userTokens.expiresAt, new Date(now - DAY)), isNotNull(userTokens.usedAt)))
    .returning({ id: userTokens.id });
  const staleStates = await db.delete(oauthStates).where(lt(oauthStates.expiresAt, new Date(now))).returning({ id: oauthStates.id });
  const oldWebhooks = await db
    .delete(webhookEvents)
    .where(lt(webhookEvents.receivedAt, new Date(now - 90 * DAY)))
    .returning({ id: webhookEvents.id });

  return {
    workspacesPurged: doomed.length,
    filesRemoved,
    sessions: expiredSessions.length,
    rateLimitBuckets: expiredBudgets.length,
    tokens: staleTokens.length,
    oauthStates: staleStates.length,
    webhookEvents: oldWebhooks.length,
  };
}
