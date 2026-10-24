"use client";

import { useEffect, useState } from "react";
import { CreditCard, Download, Sparkles } from "lucide-react";
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
import { fetchWorkspaceBilling, postPlanChange } from "@/lib/services/billing-api";

export default function BillingPage() {
  useSubscribe(workspaceService);
  const { session } = useSession();
  const toast = useToast();
  const [loaded, setLoaded] = useState(false);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [targetPlan, setTargetPlan] = useState<string | null>(null);
  // API mode: real billing from entitlement tables.
  const [apiBilling, setApiBilling] = useState<{ subscription: Subscription; usage: Usage } | null>(null);

  useEffect(() => {
    if (DATA_MODE === "api") {
      const load = async () => {
        if (!session?.workspace) return;
        const billing = await fetchWorkspaceBilling(session.workspace);
        setApiBilling(billing);
        setInvoices(billing.invoices);
        setLoaded(true);
      };
      void load();
      return;
    }
    setInvoices(workspaceService.invoices());
    setLoaded(true);
  }, [session]);

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

  const sub = apiBilling?.subscription ?? workspaceService.subscription();
  const usage = apiBilling?.usage ?? workspaceService.usage();
  const isDowngrade = (planId: string) => {
    const order = ["free", "creator", "pro", "agency"];
    return order.indexOf(planId) < order.indexOf(sub.plan.id);
  };

  return (
    <div>
      <PageHeader
        title="Billing"
        description="Plans are enforced by entitlements in the backend — the UI reflects what the server allows, never the other way round."
      />
      <PageBody className="space-y-5">
        {/* Current plan + usage */}
        <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
          <Card>
            <CardHeader
              title="Current plan"
              description={`Renews ${formatDate(sub.renewsAt, { month: "long", day: "numeric", year: "numeric" })}`}
              actions={<span className="rounded-full bg-accent-soft px-2.5 py-1 text-[12px] font-semibold text-accent-ink">{sub.plan.name}</span>}
            />
            <div className="p-5">
              <p className="flex items-baseline gap-1.5">
                <span className="font-display text-4xl font-bold tracking-tight">${sub.plan.priceMonthly}</span>
                <span className="text-sm text-ink-3">/ month · {sub.seats} seats</span>
              </p>
              <div className="mt-4 flex items-center justify-between rounded-lg border bg-surface-2 p-3">
                <span className="flex items-center gap-2 text-[13px]">
                  <CreditCard className="size-4 text-ink-3" />
                  {sub.paymentBrand} ending in {sub.paymentLast4}
                </span>
                <button onClick={() => toast({ title: "Card management opens Stripe in production", variant: "info" })} className="text-[13px] font-medium text-accent-ink hover:underline">
                  Update
                </button>
              </div>
              <Button
                variant="secondary"
                className="mt-4 w-full"
                onClick={() => toast({ title: "Opening the customer portal…", description: "Payments are disabled in this prototype.", variant: "info" })}
              >
                Manage payment & invoices
              </Button>
            </div>
          </Card>

          <Card>
            <CardHeader title="Usage this cycle" description="Entitlements from your plan." />
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <Meter label="Connected channels" used={usage.channels.used} limit={usage.channels.limit} />
              <Meter label="Team members" used={usage.members.used} limit={usage.members.limit} />
              <Meter label="Brands" used={usage.brands.used} limit={usage.brands.limit} />
              <Meter label="Media storage (GB)" used={usage.storage.usedGb} limit={usage.storage.limitGb} />
              <Meter label="AI credits" used={usage.aiCredits.used} limit={usage.aiCredits.limit} />
              <Meter label="Scheduled posts" used={usage.scheduledPosts.used} limit={usage.scheduledPosts.limit} />
            </div>
          </Card>
        </div>

        {/* Plans */}
        <Card>
          <CardHeader title="Plans" description="Change anytime — upgrades apply immediately, downgrades at the end of the cycle." />
          <div className="grid gap-3 p-5 md:grid-cols-2 xl:grid-cols-4">
            {PLAN_OFFERS.map((plan) => {
              const current = plan.id === sub.plan.id;
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
                    disabled={current}
                    onClick={() => setTargetPlan(plan.id)}
                  >
                    {current ? "Your plan" : isDowngrade(plan.id) ? "Downgrade" : "Upgrade"}
                  </Button>
                </div>
              );
            })}
          </div>
        </Card>

        {/* Invoices */}
        <Card>
          <CardHeader title="Invoices" description="Receipts for every billing period." />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-[12px] text-ink-3">
                  <th className="px-5 py-2.5 font-medium">Invoice</th>
                  <th className="px-5 py-2.5 font-medium">Date</th>
                  <th className="px-5 py-2.5 font-medium">Plan</th>
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
                    <td className="px-5 py-3 text-ink-2">{inv.planName}</td>
                    <td className="tnum px-5 py-3">${inv.amount}.00</td>
                    <td className="px-5 py-3">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-2 py-0.5 text-[12px] font-semibold text-success-ink">
                        {inv.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button onClick={() => toast({ title: `Downloading ${inv.number}.pdf…`, variant: "info" })} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-accent-ink hover:underline">
                        <Download className="size-3.5" /> PDF
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </PageBody>

      <ConfirmDialog
        open={!!targetPlan}
        onClose={() => setTargetPlan(null)}
        onConfirm={async () => {
          const plan = PLAN_OFFERS.find((p) => p.id === targetPlan);
          setTargetPlan(null);
          if (plan) {
            if (DATA_MODE === "api") {
              await postPlanChange(plan.id);
              const billing = await fetchWorkspaceBilling(session.workspace);
              setApiBilling(billing);
            } else {
              await workspaceService.changePlan(plan);
            }
            toast({
              title: `Plan changed to ${plan.name}`,
              description: "In production this runs through Stripe Checkout with verified webhooks.",
              variant: "success",
            });
          }
        }}
        title={`Switch to ${PLAN_OFFERS.find((p) => p.id === targetPlan)?.name ?? ""}?`}
        body="In production this opens Stripe Checkout. Entitlements (channels, seats, storage, AI credits) update as soon as the payment webhook confirms."
        confirmLabel="Confirm plan change"
      />
    </div>
  );
}
