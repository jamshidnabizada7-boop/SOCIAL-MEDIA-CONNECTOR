"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { CreditCard, Download } from "lucide-react";
import type { Invoice, Subscription, Usage } from "@/lib/types";
import { PLAN_OFFERS, workspaceService } from "@/lib/services/workspace";
import { useSubscribe } from "@/lib/services/hooks";
import { useSession, useToast } from "@/components/providers";
import { PageHeader, PageBody } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, Meter, Skeleton } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/ui/dialog";
import { cn, formatDate } from "@/lib/utils";
import { DATA_MODE } from "@/lib/api/client";
import {
  downgradeToFree,
  fetchWorkspaceBilling,
  openBillingPortal,
  startCheckout,
  type WorkspaceBilling,
} from "@/lib/services/billing-api";

const PLAN_ORDER = ["free", "creator", "pro", "agency"];

function BillingInner() {
  useSubscribe(workspaceService);
  const { session, refresh } = useSession();
  const toast = useToast();
  const params = useSearchParams();
  const [loaded, setLoaded] = useState(false);
  const [invoices, setInvoices] = useState<Array<Invoice & { url?: string }>>([]);
  const [targetPlan, setTargetPlan] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [apiBilling, setApiBilling] = useState<WorkspaceBilling | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const workspace = session?.workspace;
  const load = useCallback(async () => {
    if (!workspace) return;
    setLoaded(false);
    setLoadError(null);
    setApiBilling(null);
    setInvoices([]);
    try {
      const billing = await fetchWorkspaceBilling(workspace);
      setApiBilling(billing);
      setInvoices(billing.invoices);
    } catch (err) {
      setLoadError((err as Error).message);
    } finally {
      setLoaded(true);
    }
  }, [workspace]);

  useEffect(() => {
    if (DATA_MODE === "api") {
      void load();
      return;
    }
    setInvoices(workspaceService.invoices());
    setLoaded(true);
  }, [load]);

  // Returning from Stripe Checkout: the webhook may land a moment later.
  useEffect(() => {
    const outcome = params.get("checkout");
    if (DATA_MODE !== "api" || !outcome) return;
    if (outcome === "success") {
      toast({ title: "Checking payment confirmation", description: "Your plan updates after Stripe confirms your payment.", variant: "info" });
      const t = window.setTimeout(() => {
        void load();
        void refresh();
      }, 4000);
      return () => window.clearTimeout(t);
    }
    toast({ title: "Checkout canceled", description: "Nothing was charged.", variant: "info" });
  }, [params, load, refresh, toast]);

  if (!loaded || !session) {
    return (
      <div>
        <PageHeader title="Billing" />
        <PageBody className="space-y-4">
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-40 rounded-xl" />
        </PageBody>
      </div>
    );
  }

  if (DATA_MODE === "api" && (!apiBilling || loadError)) {
    return (
      <div>
        <PageHeader title="Billing" />
        <PageBody>
          <div role="alert" className="rounded-xl border border-danger/30 bg-danger-soft p-5 text-sm text-danger-ink">
            <p className="font-semibold">Billing is unavailable</p>
            <p className="mt-1">{loadError || "The server hasn't returned billing data."}</p>
            <Button variant="secondary" className="mt-3" onClick={() => void load()}>Try again</Button>
          </div>
        </PageBody>
      </div>
    );
  }

  const sub: Subscription = DATA_MODE === "api" ? apiBilling!.subscription : workspaceService.subscription();
  const usage: Usage = DATA_MODE === "api" ? apiBilling!.usage : workspaceService.usage();
  const isDowngrade = (planId: string) => PLAN_ORDER.indexOf(planId) < PLAN_ORDER.indexOf(sub.plan.id);
  const api = DATA_MODE === "api";
  const canBuy = (planId: string) => !api || planId === "free" || !!apiBilling?.purchasable.has(planId);

  const portal = async () => {
    if (!api) {
      toast({ title: "Opening the customer portal…", description: "Payments are disabled in this prototype.", variant: "info" });
      return;
    }
    setBusy(true);
    try {
      window.location.assign(await openBillingPortal());
    } catch (err) {
      setBusy(false);
      toast({ title: "Couldn't open billing", description: (err as Error).message, variant: "error" });
    }
  };

  const changePlan = async (planId: string) => {
    const plan = PLAN_OFFERS.find((p) => p.id === planId);
    if (!plan) return;
    if (!api) {
      await workspaceService.changePlan(plan);
      toast({ title: `Plan changed to ${plan.name}`, variant: "success" });
      return;
    }
    setBusy(true);
    try {
      if (planId === "free") {
        await downgradeToFree();
        toast({
          title: "Downgrade scheduled",
          description: apiBilling?.periodEnd
            ? `You keep ${sub.plan.name} until ${formatDate(apiBilling.periodEnd, { month: "long", day: "numeric" })}.`
            : "You're on the Free plan now.",
          variant: "success",
        });
      } else {
        const res = await startCheckout(planId);
        if (res.url) {
          window.location.assign(res.url);
          return;
        }
        toast({ title: `Switched to ${plan.name}`, description: "The difference is prorated on your next invoice.", variant: "success" });
      }
      await load();
      await refresh();
    } catch (err) {
      toast({ title: "Couldn't change the plan", description: (err as Error).message, variant: "error" });
    } finally {
      setBusy(false);
    }
  };

  const renewLabel = api
    ? apiBilling?.periodEnd
      ? `${apiBilling.cancelAtPeriodEnd ? "Ends" : "Renews"} ${formatDate(apiBilling.periodEnd, { month: "long", day: "numeric", year: "numeric" })}`
      : sub.plan.id === "free"
        ? "Free forever"
        : "Active"
    : `Renews ${formatDate(sub.renewsAt, { month: "long", day: "numeric", year: "numeric" })}`;

  return (
    <div>
      <PageHeader title="Billing" description="Your plan, usage and invoices. Limits are enforced by the server." />
      <PageBody className="space-y-5">
        {api && apiBilling?.status === "past_due" && (
          <div role="alert" className="rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger-ink">
            Your last payment failed. Update the payment method to keep your plan.
          </div>
        )}
        {api && apiBilling && !apiBilling.billingEnabled && (
          <div className="rounded-xl border bg-surface-2 px-4 py-3 text-sm text-ink-2">
            Paid plans aren&apos;t available on this server yet. Everything on the Free plan works as usual.
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
          <Card>
            <CardHeader
              title="Current plan"
              description={renewLabel}
              actions={<span className="rounded-full bg-accent-soft px-2.5 py-1 text-[12px] font-semibold text-accent-ink">{sub.plan.name}</span>}
            />
            <div className="p-5">
              <p className="flex items-baseline gap-1.5">
                <span className="font-display text-4xl font-bold tracking-tight">${sub.plan.priceMonthly}</span>
                <span className="text-sm text-ink-3">/ month</span>
              </p>
              {(!api || apiBilling?.hasPaymentMethod) && (
                <>
                  <div className="mt-4 flex items-center justify-between rounded-lg border bg-surface-2 p-3">
                    <span className="flex items-center gap-2 text-[13px]">
                      <CreditCard className="size-4 text-ink-3" />
                      {sub.paymentLast4 ? `${sub.paymentBrand} ending in ${sub.paymentLast4}` : "Payment method on file with Stripe"}
                    </span>
                    <button onClick={portal} className="text-[13px] font-medium text-accent-ink hover:underline">
                      Update
                    </button>
                  </div>
                  <Button variant="secondary" className="mt-4 w-full" onClick={portal} loading={busy}>
                    Manage payment & invoices
                  </Button>
                </>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Usage this cycle" description="Entitlements from your plan." />
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <Meter label="Connected channels" used={usage.channels.used} limit={usage.channels.limit} />
              <Meter label="Team seats" used={usage.members.used} limit={usage.members.limit} />
              <Meter label="Media storage (GB)" used={usage.storage.usedGb} limit={usage.storage.limitGb} />
              <Meter label="Scheduled posts this month" used={usage.scheduledPosts.used} limit={usage.scheduledPosts.limit} />
            </div>
          </Card>
        </div>

        <Card>
          <CardHeader title="Plans" description="Upgrades apply immediately (prorated). Downgrades take effect at the end of the billing period." />
          <div className="grid gap-3 p-5 md:grid-cols-2 xl:grid-cols-4">
            {PLAN_OFFERS.map((plan) => {
              const current = plan.id === sub.plan.id;
              const available = canBuy(plan.id);
              return (
                <div key={plan.id} className={cn("flex flex-col rounded-xl border p-4", current ? "border-accent ring-1 ring-accent/25" : "")}>
                  <div className="flex items-center justify-between">
                    <p className="font-display text-[15px] font-bold">{plan.name}</p>
                    {current && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent-ink">Current</span>}
                  </div>
                  <p className="mt-2">
                    <span className="font-display text-2xl font-bold tracking-tight">${plan.priceMonthly}</span>
                    <span className="text-[12px] text-ink-3"> /mo</span>
                  </p>
                  <p className="tnum mt-1 text-[12px] text-ink-3">
                    {plan.channels === "unlimited" ? "Unlimited channels" : `${plan.channels} channels`}
                  </p>
                  <ul className="mt-3 flex flex-1 flex-col gap-1.5 text-[12.5px] text-ink-2">
                    {plan.highlights.slice(0, 4).map((h) => (
                      <li key={h} className="leading-snug">{h}</li>
                    ))}
                  </ul>
                  <Button
                    className="mt-4"
                    variant={current ? "secondary" : isDowngrade(plan.id) ? "ghost" : "soft"}
                    disabled={current || !available || busy || (api && apiBilling?.cancelAtPeriodEnd && plan.id === "free")}
                    onClick={() => setTargetPlan(plan.id)}
                  >
                    {current ? "Your plan" : !available ? "Not available" : isDowngrade(plan.id) ? "Downgrade" : "Upgrade"}
                  </Button>
                </div>
              );
            })}
          </div>
        </Card>

        <Card>
          <CardHeader title="Invoices" description="Receipts for every billing period." />
          {invoices.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-ink-3">No invoices yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-[12px] text-ink-3">
                    <th className="px-5 py-2.5 font-medium">Invoice</th>
                    <th className="px-5 py-2.5 font-medium">Date</th>
                    <th className="px-5 py-2.5 font-medium">Amount</th>
                    <th className="px-5 py-2.5 font-medium">Status</th>
                    <th className="px-5 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv.id} className="border-b last:border-b-0">
                      <td className="tnum px-5 py-3 font-medium">{inv.number}</td>
                      <td className="tnum px-5 py-3 text-ink-2">{formatDate(inv.date, { month: "short", day: "numeric", year: "numeric" })}</td>
                      <td className="tnum px-5 py-3">${inv.amount.toFixed(2)}</td>
                      <td className="px-5 py-3">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-semibold",
                            inv.status === "paid" ? "bg-success-soft text-success-ink" : inv.status === "open" ? "bg-warn-soft text-warn-ink" : "bg-danger-soft text-danger-ink"
                          )}
                        >
                          {inv.status}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right">
                        {inv.url ? (
                          <a href={inv.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-accent-ink hover:underline">
                            <Download className="size-3.5" /> View
                          </a>
                        ) : !api ? (
                          <button onClick={() => toast({ title: `Downloading ${inv.number}.pdf…`, variant: "info" })} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-accent-ink hover:underline">
                            <Download className="size-3.5" /> PDF
                          </button>
                        ) : <span className="text-ink-3">Unavailable</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </PageBody>

      <ConfirmDialog
        open={!!targetPlan}
        onClose={() => setTargetPlan(null)}
        onConfirm={async () => {
          const id = targetPlan;
          setTargetPlan(null);
          if (id) await changePlan(id);
        }}
        title={`Switch to ${PLAN_OFFERS.find((p) => p.id === targetPlan)?.name ?? ""}?`}
        body={
          targetPlan === "free"
            ? "Your paid features stay active until the end of the current billing period, then the Free plan limits apply."
            : apiBilling?.hasPaymentMethod
              ? "The new price applies now; the difference is prorated on your next invoice."
              : "You'll be taken to Stripe's secure checkout to add a payment method."
        }
        confirmLabel={targetPlan === "free" ? "Downgrade" : "Continue"}
      />
    </div>
  );
}

export default function BillingPage() {
  return (
    <Suspense fallback={null}>
      <BillingInner />
    </Suspense>
  );
}
