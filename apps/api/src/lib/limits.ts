import { and, count, eq, gte, inArray, lt, notInArray, sum } from "drizzle-orm";
import { mediaAssets, plans, posts, socialAccounts, subscriptions, workspaceMembers, workspaces } from "@aria/db";
import type { DbOrTx } from "@aria/db";

/** Error body for a plan limit; routes reply 402 with `{ error: LimitError }`. */
export interface LimitError {
  code: "plan_limit";
  limit: "channels" | "scheduled_posts" | "members" | "storage";
  message: string;
}

type Plan = typeof plans.$inferSelect;

/** The subscription's plan wins; the workspace's planId is the fallback. */
export async function effectivePlan(db: DbOrTx, workspaceId: string): Promise<Plan | undefined> {
  const sub = (
    await db.select({ planId: subscriptions.planId }).from(subscriptions).where(eq(subscriptions.workspaceId, workspaceId)).limit(1)
  )[0];
  const planId =
    sub?.planId ??
    (await db.select({ planId: workspaces.planId }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1))[0]?.planId ??
    "free";
  return (await db.select().from(plans).where(eq(plans.id, planId)).limit(1))[0];
}

function limitError(limit: LimitError["limit"], message: string): LimitError {
  return { code: "plan_limit", limit, message };
}

export async function checkChannelLimit(db: DbOrTx, workspaceId: string, adding = 1): Promise<LimitError | null> {
  const plan = await effectivePlan(db, workspaceId);
  if (plan?.maxChannels == null) return null;
  const [row] = await db.select({ n: count() }).from(socialAccounts).where(eq(socialAccounts.workspaceId, workspaceId));
  if (row.n + adding <= plan.maxChannels) return null;
  return limitError("channels", `Your ${plan.name} plan includes ${plan.maxChannels} connected channels. Upgrade to connect more.`);
}

/** Counts posts scheduled for the current UTC month (drafts and canceled posts don't count). */
export async function checkScheduledPostLimit(db: DbOrTx, workspaceId: string): Promise<LimitError | null> {
  const plan = await effectivePlan(db, workspaceId);
  if (plan?.maxScheduledPosts == null) return null;
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const [row] = await db
    .select({ n: count() })
    .from(posts)
    .where(
      and(
        eq(posts.workspaceId, workspaceId),
        gte(posts.scheduledAt, monthStart),
        lt(posts.scheduledAt, nextMonth),
        notInArray(posts.state, ["draft", "canceled"])
      )
    );
  if (row.n < plan.maxScheduledPosts) return null;
  return limitError(
    "scheduled_posts",
    `Your ${plan.name} plan includes ${plan.maxScheduledPosts} scheduled posts per month. Upgrade for unlimited scheduling.`
  );
}

/** Active and invited members both hold a seat. */
export async function checkMemberLimit(db: DbOrTx, workspaceId: string): Promise<LimitError | null> {
  const plan = await effectivePlan(db, workspaceId);
  if (!plan) return null;
  const [row] = await db
    .select({ n: count() })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), inArray(workspaceMembers.status, ["active", "invited"])));
  if (row.n < plan.maxMembers) return null;
  return limitError("members", `Your ${plan.name} plan includes ${plan.maxMembers} team seat${plan.maxMembers === 1 ? "" : "s"}. Upgrade to invite more people.`);
}

export async function checkStorageLimit(db: DbOrTx, workspaceId: string, addingBytes: number): Promise<LimitError | null> {
  const plan = await effectivePlan(db, workspaceId);
  if (!plan) return null;
  const [row] = await db.select({ total: sum(mediaAssets.bytes) }).from(mediaAssets).where(eq(mediaAssets.workspaceId, workspaceId));
  const used = Number(row.total ?? 0);
  if (used + addingBytes <= plan.storageGb * 1024 ** 3) return null;
  return limitError("storage", `Your ${plan.name} plan includes ${plan.storageGb} GB of media storage. Delete unused media or upgrade.`);
}
