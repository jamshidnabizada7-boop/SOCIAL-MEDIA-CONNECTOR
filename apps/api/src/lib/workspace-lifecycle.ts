import { and, inArray, notInArray } from "drizzle-orm";
import { posts, publishJobs, publishTargets, workspaces } from "@aria/db";
import type { DbOrTx } from "@aria/db";

/**
 * Soft-deletes workspaces and stops everything they had scheduled. The worker
 * purges soft-deleted workspaces (and their media files) after 30 days.
 */
export async function retireWorkspaces(tx: DbOrTx, workspaceIds: string[]): Promise<void> {
  if (workspaceIds.length === 0) return;
  await tx.update(workspaces).set({ deletedAt: new Date() }).where(inArray(workspaces.id, workspaceIds));
  const postIds = (await tx.select({ id: posts.id }).from(posts).where(inArray(posts.workspaceId, workspaceIds))).map((p) => p.id);
  if (postIds.length === 0) return;
  const targetIds = (
    await tx.select({ id: publishTargets.id }).from(publishTargets).where(inArray(publishTargets.postId, postIds))
  ).map((t) => t.id);
  if (targetIds.length === 0) return;
  await tx
    .update(publishJobs)
    .set({ state: "dead_letter", lastError: "workspace_deleted", updatedAt: new Date() })
    .where(and(inArray(publishJobs.targetId, targetIds), inArray(publishJobs.state, ["pending", "delayed"])));
  await tx
    .update(publishTargets)
    .set({ state: "canceled", updatedAt: new Date() })
    .where(and(inArray(publishTargets.id, targetIds), notInArray(publishTargets.state, ["published", "failed", "canceled"])));
}

