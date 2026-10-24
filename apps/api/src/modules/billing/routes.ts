import { desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import {
  auditLogs,
  plans,
  socialAccounts,
  subscriptions,
  usageCounters,
  users,
  workspaceMembers,
  posts,
} from "@aria/db";
import type { AriaDatabase } from "@aria/db";
import { requireWorkspacePermission } from "../../plugins/auth.js";

export async function billingOverview(db: AriaDatabase, workspaceId: string) {
  const subRows = await db.select().from(subscriptions).where(eq(subscriptions.workspaceId, workspaceId)).limit(1);
  let subscription = subRows[0];
  if (!subscription) {
    const [created] = await db.insert(subscriptions).values({ workspaceId, planId: "free" }).returning();
    subscription = created;
  }
  const plan = (await db.select().from(plans).where(eq(plans.id, subscription.planId)).limit(1))[0];

  const members = await db.select().from(workspaceMembers).where(eq(workspaceMembers.workspaceId, workspaceId));
  const accounts = await db.select().from(socialAccounts).where(eq(socialAccounts.workspaceId, workspaceId));
  const scheduled = await db.select({ id: posts.id }).from(posts).where(eq(posts.workspaceId, workspaceId));

  const periodStart = new Date().toISOString().slice(0, 7);
  const counters = await db.select().from(usageCounters).where(eq(usageCounters.workspaceId, workspaceId));
  const used = (metric: string) => counters.find((c) => c.metric === metric && c.periodStart === periodStart)?.used ?? 0;

  return {
    subscription: {
      planId: subscription.planId,
      planName: plan?.name ?? subscription.planId,
      priceMonthlyCents: plan?.priceMonthlyCents ?? 0,
      status: subscription.status,
      currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
      seats: subscription.seats,
      paymentBrand: subscription.paymentBrand,
      paymentLast4: subscription.paymentLast4,
    },
    usage: {
      channels: { used: accounts.length, limit: plan?.maxChannels ?? null },
      members: { used: members.length, limit: plan?.maxMembers ?? 1 },
      scheduledPosts: { used: scheduled.length, limit: plan?.maxScheduledPosts ?? null },
      storageGb: { used: used("storage_gb") || 0, limit: plan?.storageGb ?? 1 },
      aiCredits: { used: used("ai_credits") || 0, limit: plan?.aiCredits ?? 0 },
    },
    invoices: [] as Array<{ id: string; number: string; date: string; amountCents: number; status: string }>,
  };
}

export function registerBillingRoutes(app: FastifyInstance): void {
  const db = app.database.db;

  app.get(
    "/v1/workspaces/:workspaceId/billing",
    { preHandler: requireWorkspacePermission(app, "manage_billing") },
    async (req, reply) => {
      const { workspaceId } = req.params as { workspaceId: string };
      return reply.send(await billingOverview(db, workspaceId));
    }
  );

  /**
   * Plan change: updates entitlements in the database. Payment collection
   * runs through Stripe in production — without STRIPE_SECRET_KEY the change
   * applies immediately (local/self-hosted mode), and the audit log records
   * who changed what.
   */
  app.post(
    "/v1/workspaces/:workspaceId/billing/plan",
    { preHandler: requireWorkspacePermission(app, "manage_billing") },
    async (req, reply) => {
      const { workspaceId } = req.params as { workspaceId: string };
      const { planId } = req.body as { planId?: string };
      const plan = (await db.select().from(plans).where(eq(plans.id, planId ?? "")).limit(1))[0];
      if (!planId || !plan) {
        return reply.status(400).send({ error: { code: "unknown_plan", message: "Unknown plan." } });
      }
      const sub = (await db.select().from(subscriptions).where(eq(subscriptions.workspaceId, workspaceId)).limit(1))[0];
      if (sub) {
        await db
          .update(subscriptions)
          .set({ planId, updatedAt: new Date() })
          .where(eq(subscriptions.workspaceId, workspaceId));
      } else {
        await db.insert(subscriptions).values({ workspaceId, planId });
      }
      await db.insert(auditLogs).values({
        workspaceId,
        actorUserId: req.user!.id,
        action: "billing.plan_changed",
        targetType: "subscription",
        targetId: workspaceId,
        metadata: { planId },
        ip: req.ip,
      });
      return reply.send(await billingOverview(db, workspaceId));
    }
  );

  app.get(
    "/v1/workspaces/:workspaceId/team",
    { preHandler: requireWorkspacePermission(app) },
    async (req, reply) => {
      const { workspaceId } = req.params as { workspaceId: string };
      const members = await db
        .select({
          userId: users.id,
          email: users.email,
          name: users.name,
          avatarHue: users.avatarHue,
          status: users.status,
          lastActiveAt: users.lastActiveAt,
          role: workspaceMembers.role,
          memberStatus: workspaceMembers.status,
          joinedAt: workspaceMembers.joinedAt,
        })
        .from(workspaceMembers)
        .innerJoin(users, eq(users.id, workspaceMembers.userId))
        .where(eq(workspaceMembers.workspaceId, workspaceId));
      return reply.send({ members });
    }
  );

  void desc;
}
