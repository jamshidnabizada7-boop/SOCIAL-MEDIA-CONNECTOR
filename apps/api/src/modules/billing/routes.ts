import { and, count, eq, gte, inArray, lt, notInArray, sum } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  auditLogs,
  mediaAssets,
  notifications,
  plans,
  posts,
  socialAccounts,
  subscriptions,
  users,
  workspaceMembers,
  workspaces,
} from "@aria/db";
import type { AriaDatabase, DbOrTx } from "@aria/db";
import { requireWorkspacePermission } from "../../plugins/auth.js";
import { webAppUrl } from "../../lib/mailer.js";
import {
  periodEnd,
  planForPrice,
  priceForPlan,
  StripeError,
  stripeConfigured,
  stripeRequest,
  verifyStripeSignature,
  type StripeSubscription,
} from "../../lib/stripe.js";

async function ensureSubscription(db: DbOrTx, workspaceId: string) {
  const existing = (await db.select().from(subscriptions).where(eq(subscriptions.workspaceId, workspaceId)).limit(1))[0];
  if (existing) return existing;
  const [created] = await db.insert(subscriptions).values({ workspaceId, planId: "free" }).onConflictDoNothing().returning();
  return created ?? (await db.select().from(subscriptions).where(eq(subscriptions.workspaceId, workspaceId)).limit(1))[0];
}

/** Keeps workspaces.planId (read by /me and the UI) in step with the subscription. */
async function setPlan(db: DbOrTx, workspaceId: string, patch: Partial<typeof subscriptions.$inferInsert> & { planId: string }) {
  await ensureSubscription(db, workspaceId);
  await db.update(subscriptions).set({ ...patch, updatedAt: new Date() }).where(eq(subscriptions.workspaceId, workspaceId));
  await db.update(workspaces).set({ planId: patch.planId, updatedAt: new Date() }).where(eq(workspaces.id, workspaceId));
}

export async function billingOverview(db: AriaDatabase, workspaceId: string) {
  const subscription = await ensureSubscription(db, workspaceId);
  const plan = (await db.select().from(plans).where(eq(plans.id, subscription.planId)).limit(1))[0];
  const allPlans = await db.select().from(plans);

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const [[members], [accounts], [scheduled], [storage]] = await Promise.all([
    db
      .select({ n: count() })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), inArray(workspaceMembers.status, ["active", "invited"]))),
    db.select({ n: count() }).from(socialAccounts).where(eq(socialAccounts.workspaceId, workspaceId)),
    db
      .select({ n: count() })
      .from(posts)
      .where(
        and(
          eq(posts.workspaceId, workspaceId),
          gte(posts.scheduledAt, monthStart),
          lt(posts.scheduledAt, nextMonth),
          notInArray(posts.state, ["draft", "canceled"])
        )
      ),
    db.select({ bytes: sum(mediaAssets.bytes) }).from(mediaAssets).where(eq(mediaAssets.workspaceId, workspaceId)),
  ]);

  let invoices: Array<{ id: string; number: string; date: string; amountCents: number; status: string; url?: string }> = [];
  if (stripeConfigured() && subscription.stripeCustomerId) {
    try {
      const res = await stripeRequest<{
        data: Array<{ id: string; number: string | null; created: number; amount_paid: number; amount_due: number; status: string; hosted_invoice_url?: string }>;
      }>("GET", "/invoices", { customer: subscription.stripeCustomerId, limit: 24 });
      invoices = res.data.map((i) => ({
        id: i.id,
        number: i.number ?? i.id,
        date: new Date(i.created * 1000).toISOString(),
        amountCents: i.status === "paid" ? i.amount_paid : i.amount_due,
        status: i.status,
        url: i.hosted_invoice_url,
      }));
    } catch {
      /* invoices are informational; never fail the page */
    }
  }

  return {
    billingEnabled: stripeConfigured(),
    subscription: {
      planId: subscription.planId,
      planName: plan?.name ?? subscription.planId,
      priceMonthlyCents: plan?.priceMonthlyCents ?? 0,
      status: subscription.status,
      currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      seats: subscription.seats,
      paymentBrand: subscription.paymentBrand,
      paymentLast4: subscription.paymentLast4,
      hasPaymentMethod: Boolean(subscription.stripeCustomerId),
    },
    usage: {
      channels: { used: accounts.n, limit: plan?.maxChannels ?? null },
      members: { used: members.n, limit: plan?.maxMembers ?? 1 },
      scheduledPosts: { used: scheduled.n, limit: plan?.maxScheduledPosts ?? null },
      storageGb: { used: Math.round((Number(storage.bytes ?? 0) / 1024 ** 3) * 100) / 100, limit: plan?.storageGb ?? 1 },
      aiCredits: { used: 0, limit: plan?.aiCredits ?? 0 },
    },
    plans: allPlans
      .sort((a, b) => a.priceMonthlyCents - b.priceMonthlyCents)
      .map((p) => ({
        id: p.id,
        name: p.name,
        priceMonthlyCents: p.priceMonthlyCents,
        features: p.features,
        purchasable: p.id === "free" || (stripeConfigured() && Boolean(priceForPlan(p.id))),
      })),
    invoices,
  };
}

/** Applies a Stripe subscription object to the workspace it belongs to. */
async function applyStripeSubscription(db: AriaDatabase, sub: StripeSubscription, workspaceIdHint?: string) {
  const workspaceId =
    sub.metadata?.workspaceId ??
    workspaceIdHint ??
    (await db.select({ ws: subscriptions.workspaceId }).from(subscriptions).where(eq(subscriptions.stripeCustomerId, sub.customer)).limit(1))[0]?.ws;
  if (!workspaceId) return;
  const live = ["active", "trialing", "past_due"].includes(sub.status);
  const paidPlan = planForPrice(sub.items.data[0]?.price.id);
  await setPlan(db, workspaceId, {
    planId: live && paidPlan ? paidPlan : "free",
    status: sub.status,
    stripeCustomerId: sub.customer,
    stripeSubscriptionId: live ? sub.id : null,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    currentPeriodEnd: periodEnd(sub),
  });
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
   * Upgrade/switch plan. New customers go to Stripe Checkout; existing
   * subscribers switch price in place (prorated). The webhook is the source
   * of truth for what plan the workspace ends up on.
   */
  app.post(
    "/v1/workspaces/:workspaceId/billing/checkout",
    { preHandler: requireWorkspacePermission(app, "manage_billing") },
    async (req, reply) => {
      const { workspaceId } = req.params as { workspaceId: string };
      const parsed = z.object({ planId: z.enum(["creator", "pro", "agency"]) }).safeParse(req.body);
      if (!parsed.success) return reply.status(400).send({ error: { code: "unknown_plan", message: "Choose a paid plan." } });
      const price = priceForPlan(parsed.data.planId);
      if (!stripeConfigured() || !price) {
        return reply.status(503).send({
          error: { code: "billing_unavailable", message: "Paid plans aren't available on this server yet. Contact the operator." },
        });
      }
      const sub = await ensureSubscription(db, workspaceId);
      try {
        if (sub.stripeSubscriptionId) {
          const current = await stripeRequest<StripeSubscription>("GET", `/subscriptions/${sub.stripeSubscriptionId}`);
          const updated = await stripeRequest<StripeSubscription>("POST", `/subscriptions/${sub.stripeSubscriptionId}`, {
            items: [{ id: current.items.data[0].id, price }],
            proration_behavior: "create_prorations",
            cancel_at_period_end: false,
          });
          await applyStripeSubscription(db, updated, workspaceId);
          return reply.send({ switched: true, overview: await billingOverview(db, workspaceId) });
        }
        let customer = sub.stripeCustomerId;
        if (!customer) {
          const ws = (await db.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1))[0];
          const created = await stripeRequest<{ id: string }>(
            "POST",
            "/customers",
            { email: req.user!.email, name: ws?.name, metadata: { workspaceId } },
            { idempotencyKey: `customer-${workspaceId}` }
          );
          customer = created.id;
          await db.update(subscriptions).set({ stripeCustomerId: customer, updatedAt: new Date() }).where(eq(subscriptions.workspaceId, workspaceId));
        }
        const session = await stripeRequest<{ url: string }>("POST", "/checkout/sessions", {
          mode: "subscription",
          customer,
          client_reference_id: workspaceId,
          line_items: [{ price, quantity: 1 }],
          subscription_data: { metadata: { workspaceId } },
          metadata: { workspaceId, planId: parsed.data.planId },
          allow_promotion_codes: true,
          success_url: `${webAppUrl()}/billing?checkout=success`,
          cancel_url: `${webAppUrl()}/billing?checkout=canceled`,
        });
        await db.insert(auditLogs).values({
          workspaceId,
          actorUserId: req.user!.id,
          action: "billing.checkout_started",
          targetType: "subscription",
          targetId: workspaceId,
          metadata: { planId: parsed.data.planId },
          ip: req.ip,
        });
        return reply.send({ url: session.url });
      } catch (err) {
        req.log.error({ err: (err as Error).message }, "stripe checkout failed");
        const message = err instanceof StripeError ? err.message : "Payment provider unavailable. Try again shortly.";
        return reply.status(502).send({ error: { code: "billing_error", message } });
      }
    }
  );

  /** Stripe-hosted portal: payment method, invoices, cancellation. */
  app.post(
    "/v1/workspaces/:workspaceId/billing/portal",
    { preHandler: requireWorkspacePermission(app, "manage_billing") },
    async (req, reply) => {
      const { workspaceId } = req.params as { workspaceId: string };
      const sub = await ensureSubscription(db, workspaceId);
      if (!stripeConfigured() || !sub.stripeCustomerId) {
        return reply.status(409).send({ error: { code: "no_billing_account", message: "There's no billing account for this workspace yet." } });
      }
      try {
        const session = await stripeRequest<{ url: string }>("POST", "/billing_portal/sessions", {
          customer: sub.stripeCustomerId,
          return_url: `${webAppUrl()}/billing`,
        });
        return reply.send({ url: session.url });
      } catch (err) {
        return reply.status(502).send({ error: { code: "billing_error", message: (err as Error).message } });
      }
    }
  );

  /**
   * Downgrade to Free. Paid subscriptions cancel at period end (the workspace
   * keeps what it paid for). Paid plans are only granted by Stripe or a
   * platform admin, never by this endpoint.
   */
  app.post(
    "/v1/workspaces/:workspaceId/billing/plan",
    { preHandler: requireWorkspacePermission(app, "manage_billing") },
    async (req, reply) => {
      const { workspaceId } = req.params as { workspaceId: string };
      const { planId } = (req.body ?? {}) as { planId?: string };
      if (planId !== "free") {
        return reply.status(400).send({
          error: { code: "use_checkout", message: "Upgrades go through checkout: POST …/billing/checkout." },
        });
      }
      const sub = await ensureSubscription(db, workspaceId);
      if (sub.stripeSubscriptionId && stripeConfigured()) {
        const updated = await stripeRequest<StripeSubscription>("POST", `/subscriptions/${sub.stripeSubscriptionId}`, {
          cancel_at_period_end: true,
        });
        await applyStripeSubscription(db, updated, workspaceId);
      } else {
        await setPlan(db, workspaceId, { planId: "free", status: "active", cancelAtPeriodEnd: false });
      }
      await db.insert(auditLogs).values({
        workspaceId,
        actorUserId: req.user!.id,
        action: "billing.downgraded",
        targetType: "subscription",
        targetId: workspaceId,
        ip: req.ip,
      });
      return reply.send(await billingOverview(db, workspaceId));
    }
  );

  /** Platform admins can comp or correct a plan (support, partners). */
  app.post("/v1/admin/workspaces/:workspaceId/plan", async (req, reply) => {
    if (!req.user?.isPlatformAdmin) {
      return reply.status(403).send({ error: { code: "forbidden", message: "Platform admin access required." } });
    }
    const { workspaceId } = req.params as { workspaceId: string };
    const { planId } = (req.body ?? {}) as { planId?: string };
    const plan = (await db.select().from(plans).where(eq(plans.id, planId ?? "")).limit(1))[0];
    if (!plan) return reply.status(400).send({ error: { code: "unknown_plan", message: "Unknown plan." } });
    const ws = (await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1))[0];
    if (!ws) return reply.status(404).send({ error: { code: "not_found", message: "Workspace not found." } });
    await setPlan(db, workspaceId, { planId: plan.id, status: "active" });
    await db.insert(auditLogs).values({
      workspaceId,
      actorUserId: req.user.id,
      action: "admin.plan_set",
      targetType: "subscription",
      targetId: workspaceId,
      metadata: { planId: plan.id },
      ip: req.ip,
    });
    return reply.send({ ok: true });
  });

  /** Stripe webhook — raw body for signature verification. */
  app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser("*", { parseAs: "string", bodyLimit: 1024 * 1024 }, (_req, body, done) => done(null, body));

    scope.post("/v1/billing/webhook", async (req, reply) => {
      const secret = process.env.STRIPE_WEBHOOK_SECRET;
      const raw = typeof req.body === "string" ? req.body : "";
      if (!secret || !verifyStripeSignature(raw, req.headers["stripe-signature"] as string | undefined, secret)) {
        return reply.status(400).send({ error: { code: "invalid_signature", message: "Invalid Stripe signature." } });
      }
      let event: { id?: string; type?: string; data?: { object?: Record<string, unknown> } };
      try {
        event = JSON.parse(raw);
      } catch {
        return reply.status(400).send({ error: { code: "invalid_payload", message: "Malformed event." } });
      }
      const obj = event.data?.object ?? {};
      try {
        switch (event.type) {
          case "checkout.session.completed": {
            const subId = obj.subscription as string | undefined;
            if (subId) {
              const sub = await stripeRequest<StripeSubscription>("GET", `/subscriptions/${subId}`);
              await applyStripeSubscription(db, sub, (obj.client_reference_id as string) ?? undefined);
            }
            break;
          }
          case "customer.subscription.created":
          case "customer.subscription.updated":
          case "customer.subscription.deleted":
            await applyStripeSubscription(db, obj as unknown as StripeSubscription);
            break;
          case "invoice.payment_failed": {
            const customer = obj.customer as string;
            const sub = (await db.select().from(subscriptions).where(eq(subscriptions.stripeCustomerId, customer)).limit(1))[0];
            if (sub) {
              await db.update(subscriptions).set({ status: "past_due", updatedAt: new Date() }).where(eq(subscriptions.id, sub.id));
              await db.insert(notifications).values({
                workspaceId: sub.workspaceId,
                type: "billing",
                severity: "warning",
                title: "Payment failed",
                body: "We couldn't charge your card. Update the payment method in Billing to keep your plan.",
              });
            }
            break;
          }
          default:
            break;
        }
      } catch (err) {
        req.log.error({ err: (err as Error).message, type: event.type }, "stripe webhook processing failed");
        // 500 makes Stripe retry with backoff.
        return reply.status(500).send({ error: { code: "processing_failed", message: "Retry later." } });
      }
      return reply.send({ received: true });
    });
  });

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
        .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.status, "active")));
      return reply.send({ members });
    }
  );
}
