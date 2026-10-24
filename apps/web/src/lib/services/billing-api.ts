"use client";

/**
 * API-backed billing support for the workspace service in api mode.
 * Subscription/usage come from the real entitlement tables; plan changes
 * apply immediately in local/self-hosted mode (Stripe payment collection is a
 * production-phase integration gated on STRIPE_SECRET_KEY).
 */

import type { Invoice, Subscription, Usage, Workspace } from "@/lib/types";
import { apiGet, apiPost } from "@/lib/api/client";

export interface ApiBilling {
  subscription: {
    planId: string;
    planName: string;
    priceMonthlyCents: number;
    status: string;
    currentPeriodEnd: string | null;
    seats: number;
    paymentBrand: string | null;
    paymentLast4: string | null;
  };
  usage: {
    channels: { used: number; limit: number | null };
    members: { used: number; limit: number };
    scheduledPosts: { used: number; limit: number | null };
    storageGb: { used: number; limit: number };
    aiCredits: { used: number; limit: number };
  };
}

export interface WorkspaceBilling {
  subscription: Subscription;
  usage: Usage;
  invoices: Invoice[];
}

export async function fetchWorkspaceBilling(workspace: Workspace): Promise<WorkspaceBilling> {
  const b = await apiGet<ApiBilling>("/v1/workspaces/current/billing");
  const subscription: Subscription = {
    plan: {
      id: b.subscription.planId as Subscription["plan"]["id"],
      name: b.subscription.planName,
      priceMonthly: b.subscription.priceMonthlyCents / 100,
      channels: b.usage.channels.limit ?? "unlimited",
      brands: 10,
      members: b.usage.members.limit,
      scheduledPostsPerMonth: b.usage.scheduledPosts.limit ?? "unlimited",
      storageGb: b.usage.storageGb.limit,
      aiCredits: b.usage.aiCredits.limit,
      highlights: [],
    },
    renewsAt: b.subscription.currentPeriodEnd ?? new Date(Date.now() + 30 * 86_400_000).toISOString(),
    paymentBrand: b.subscription.paymentBrand ?? "—",
    paymentLast4: b.subscription.paymentLast4 ?? "0000",
    seats: b.subscription.seats,
  };
  const usage: Usage = {
    channels: { used: b.usage.channels.used, limit: b.usage.channels.limit ?? "unlimited" },
    brands: { used: 0, limit: 10 },
    members: { used: b.usage.members.used, limit: b.usage.members.limit },
    scheduledPosts: { used: b.usage.scheduledPosts.used, limit: b.usage.scheduledPosts.limit ?? "unlimited" },
    storage: { usedGb: b.usage.storageGb.used, limitGb: b.usage.storageGb.limit },
    aiCredits: { used: b.usage.aiCredits.used, limit: b.usage.aiCredits.limit },
  };
  void workspace;
  return { subscription, usage, invoices: [] as Invoice[] };
}

export async function postPlanChange(planId: string): Promise<void> {
  await apiPost("/v1/workspaces/current/billing/plan", { planId });
}
