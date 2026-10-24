"use client";

/**
 * API-backed billing for api mode. Plans and usage come from the server's
 * entitlement tables; upgrades go through Stripe Checkout, payment methods
 * and invoices through the Stripe customer portal. Without Stripe configured
 * on the server, paid plans show as unavailable.
 */

import type { Invoice, Subscription, Usage, Workspace } from "@/lib/types";
import { apiGet, apiPost } from "@/lib/api/client";

export interface ApiBilling {
  billingEnabled: boolean;
  subscription: {
    planId: string;
    planName: string;
    priceMonthlyCents: number;
    status: string;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    seats: number;
    paymentBrand: string | null;
    paymentLast4: string | null;
    hasPaymentMethod: boolean;
  };
  usage: {
    channels: { used: number; limit: number | null };
    members: { used: number; limit: number };
    scheduledPosts: { used: number; limit: number | null };
    storageGb: { used: number; limit: number };
    aiCredits: { used: number; limit: number };
  };
  plans: Array<{ id: string; name: string; priceMonthlyCents: number; features: string[]; purchasable: boolean }>;
  invoices: Array<{ id: string; number: string; date: string; amountCents: number; status: string; url?: string }>;
}

export interface WorkspaceBilling {
  subscription: Subscription;
  usage: Usage;
  invoices: Array<Invoice & { url?: string }>;
  billingEnabled: boolean;
  status: string;
  cancelAtPeriodEnd: boolean;
  hasPaymentMethod: boolean;
  periodEnd: string | null;
  /** Plan ids that can be bought on this server. */
  purchasable: Set<string>;
}

export async function fetchWorkspaceBilling(workspace: Workspace): Promise<WorkspaceBilling> {
  const b = await apiGet<ApiBilling>("/v1/workspaces/current/billing");
  const subscription: Subscription = {
    plan: {
      id: b.subscription.planId as Subscription["plan"]["id"],
      name: b.subscription.planName,
      priceMonthly: b.subscription.priceMonthlyCents / 100,
      channels: b.usage.channels.limit ?? "unlimited",
      brands: workspace.brands.length,
      members: b.usage.members.limit,
      scheduledPostsPerMonth: b.usage.scheduledPosts.limit ?? "unlimited",
      storageGb: b.usage.storageGb.limit,
      aiCredits: b.usage.aiCredits.limit,
      highlights: [],
    },
    renewsAt: b.subscription.currentPeriodEnd ?? "",
    paymentBrand: b.subscription.paymentBrand ?? "",
    paymentLast4: b.subscription.paymentLast4 ?? "",
    seats: b.subscription.seats,
  };
  const usage: Usage = {
    channels: { used: b.usage.channels.used, limit: b.usage.channels.limit ?? "unlimited" },
    brands: { used: workspace.brands.length, limit: Math.max(workspace.brands.length, 1) },
    members: { used: b.usage.members.used, limit: b.usage.members.limit },
    scheduledPosts: { used: b.usage.scheduledPosts.used, limit: b.usage.scheduledPosts.limit ?? "unlimited" },
    storage: { usedGb: b.usage.storageGb.used, limitGb: b.usage.storageGb.limit },
    aiCredits: { used: b.usage.aiCredits.used, limit: b.usage.aiCredits.limit },
  };
  const invoices = b.invoices.map((i) => ({
    id: i.id,
    number: i.number,
    date: i.date,
    amount: i.amountCents / 100,
    status: (i.status === "paid" ? "paid" : i.status === "open" || i.status === "draft" ? "open" : "failed") as Invoice["status"],
    planName: "",
    url: i.url,
  }));
  return {
    subscription,
    usage,
    invoices,
    billingEnabled: b.billingEnabled,
    status: b.subscription.status,
    cancelAtPeriodEnd: b.subscription.cancelAtPeriodEnd,
    hasPaymentMethod: b.subscription.hasPaymentMethod,
    periodEnd: b.subscription.currentPeriodEnd,
    purchasable: new Set(b.plans.filter((p) => p.purchasable).map((p) => p.id)),
  };
}

/** Starts checkout (new subscriber → redirect URL) or switches price in place. */
export async function startCheckout(planId: string): Promise<{ url?: string; switched?: boolean }> {
  return apiPost<{ url?: string; switched?: boolean }>("/v1/workspaces/current/billing/checkout", { planId });
}

export async function openBillingPortal(): Promise<string> {
  const res = await apiPost<{ url: string }>("/v1/workspaces/current/billing/portal");
  return res.url;
}

export async function downgradeToFree(): Promise<void> {
  await apiPost("/v1/workspaces/current/billing/plan", { planId: "free" });
}
