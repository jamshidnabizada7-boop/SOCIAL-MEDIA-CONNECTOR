"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowRight, Check, Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { ProviderBadge } from "@/components/ui/status";
import { ConnectAccountFlow as ConnectFlow } from "@/components/accounts/connect-flow";
import { useSession } from "@/components/providers";
import { accountsService } from "@/lib/services/accounts";
import { workspaceService } from "@/lib/services/workspace";
import { cn, formatNumber } from "@/lib/utils";
import type { ProviderId, SocialAccount } from "@/lib/types";

const STEPS = ["Workspace", "Brand", "Connect accounts", "Done"];

export default function OnboardingPage() {
  const router = useRouter();
  const { session, refresh, ready } = useSession();
  const [step, setStep] = useState(0);
  const [workspaceName, setWorkspaceName] = useState("Aria Studio");
  const [timezone, setTimezone] = useState("Europe/Berlin");
  const [brandName, setBrandName] = useState("");
  const [brandDescription, setBrandDescription] = useState("");
  const [brandId, setBrandId] = useState<string>("brand_aria");
  const [connected, setConnected] = useState<SocialAccount[]>([]);
  const [connectOpen, setConnectOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (ready && !session) router.replace("/signin");
  }, [ready, session, router]);

  useEffect(() => {
    setConnected(accountsService.list());
  }, []);

  const finishWorkspace = async () => {
    if (!session) return;
    setSaving(true);
    await workspaceService.updateWorkspace(session.workspace.id, { name: workspaceName || "Your workspace", timezone });
    refresh();
    setSaving(false);
    setStep(1);
  };

  const finishBrand = async () => {
    if (brandName.trim()) {
      setSaving(true);
      const brand = await workspaceService.addBrand(session!.workspace.id, { name: brandName.trim(), description: brandDescription.trim() || undefined });
      setBrandId(brand.id);
      setSaving(false);
    }
    setStep(2);
  };

  const onConnected = (account: SocialAccount) => {
    setConnected((prev) => [...prev.filter((a) => a.id !== account.id), account]);
  };

  if (!session) return null;

  const timezones = ["Europe/Berlin", "Europe/London", "America/New_York", "America/Los_Angeles", "Asia/Tokyo", "Australia/Sydney", "UTC"];

  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <header className="border-b bg-surface">
        <div className="mx-auto flex h-16 max-w-2xl items-center justify-between px-5">
          <span className="font-display text-[17px] font-bold tracking-tight">
            aria<span className="text-accent">hub</span>
          </span>
          <span className="text-[13px] text-ink-3">
            Step {Math.min(step + 1, 3)} of 3
          </span>
        </div>
        <div className="mx-auto flex max-w-2xl gap-1.5 px-5 pb-3">
          {STEPS.slice(0, 3).map((label, i) => (
            <div key={label} className="flex-1">
              <div className={cn("h-1 rounded-full transition-colors", i <= step ? "bg-accent" : "bg-surface-2 border border-line")} />
              <p className={cn("mt-1.5 text-[11px] font-medium", i <= step ? "text-accent-ink" : "text-ink-3")}>{label}</p>
            </div>
          ))}
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-5 py-10">
        {step === 0 && (
          <section className="rise">
            <h1 className="font-display text-[28px] font-bold tracking-tight">Where does your content live?</h1>
            <p className="mt-2 text-[15px] leading-relaxed text-ink-2">
              A workspace holds your brands, connected accounts and team. You can rename any of
              this later.
            </p>
            <div className="mt-7 flex flex-col gap-4 rounded-xl border bg-surface p-5">
              <Field label="Workspace name" htmlFor="wsname">
                <Input id="wsname" value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} />
              </Field>
              <Field label="Your time zone" htmlFor="tz" hint="Scheduling happens in UTC and is displayed in this time zone.">
                <Select id="tz" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                  {timezones.map((tz) => (
                    <option key={tz} value={tz}>{tz}</option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="mt-6 flex justify-end">
              <Button onClick={finishWorkspace} loading={saving}>
                Continue <ArrowRight className="size-4" />
              </Button>
            </div>
          </section>
        )}

        {step === 1 && (
          <section className="rise">
            <h1 className="font-display text-[28px] font-bold tracking-tight">Create your first brand</h1>
            <p className="mt-2 text-[15px] leading-relaxed text-ink-2">
              A brand groups connected accounts, content and campaigns — for example “Aria Hub” or
              a client&apos;s name. You can skip this and add brands later.
            </p>
            <div className="mt-7 flex flex-col gap-4 rounded-xl border bg-surface p-5">
              <Field label="Brand name" htmlFor="bname">
                <Input id="bname" placeholder="Aria Hub" value={brandName} onChange={(e) => setBrandName(e.target.value)} />
              </Field>
              <Field label="Description" htmlFor="bdesc" hint="Optional — who this brand speaks to.">
                <Textarea
                  id="bdesc"
                  rows={3}
                  placeholder="The main product brand — consumer social presence."
                  value={brandDescription}
                  onChange={(e) => setBrandDescription(e.target.value)}
                />
              </Field>
            </div>
            <div className="mt-6 flex items-center justify-between">
              <Button variant="ghost" onClick={() => setStep(2)}>Skip for now</Button>
              <Button onClick={finishBrand} loading={saving}>
                Continue <ArrowRight className="size-4" />
              </Button>
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="rise">
            <h1 className="font-display text-[28px] font-bold tracking-tight">Where do you publish?</h1>
            <p className="mt-2 text-[15px] leading-relaxed text-ink-2">
              Connect at least one account — or take the tour first and connect later.
            </p>

            {connected.length > 0 && (
              <ul className="mt-6 flex flex-col gap-2">
                {connected.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 rounded-xl border bg-surface p-3">
                    <ProviderBadge provider={a.provider} size="md" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{a.displayName}</p>
                      <p className="truncate text-[13px] text-ink-3">{a.handle} · {formatNumber(a.followers)} followers</p>
                    </div>
                    <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-semibold text-success-ink">
                      <Check className="size-3" /> Connected
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-6 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {(["facebook", "instagram", "threads", "linkedin", "tiktok", "youtube", "x", "pinterest", "bluesky", "mastodon"] as ProviderId[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setConnectOpen(true)}
                  className="flex flex-col items-center gap-2 rounded-xl border bg-surface p-4 text-center transition-colors hover:border-accent hover:bg-accent-soft/40"
                >
                  <ProviderBadge provider={p} size="lg" />
                  <span className="text-[13px] font-semibold capitalize">
                    {p === "x" ? "X" : p === "youtube" ? "YouTube" : p}
                  </span>
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-accent-ink">
                    <Plus className="size-3" /> Connect
                  </span>
                </button>
              ))}
            </div>

            <div className="mt-8 flex items-center justify-between">
              <Button variant="ghost" onClick={() => setStep(3)}>Connect later</Button>
              <Button onClick={() => setStep(3)} disabled={connected.length === 0}>
                Continue <ArrowRight className="size-4" />
              </Button>
            </div>
          </section>
        )}

        {step === 3 && (
          <section className="rise text-center">
            <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent-ink">
              <Sparkles className="size-6" aria-hidden />
            </span>
            <h1 className="mt-5 font-display text-[28px] font-bold tracking-tight">
              You&apos;re set, {session.user.name.split(" ")[0]}
            </h1>
            <p className="mx-auto mt-2 max-w-md text-[15px] leading-relaxed text-ink-2">
              {connected.length > 0
                ? `${connected.length} account${connected.length === 1 ? "" : "s"} connected. Your dashboard is pre-loaded with a realistic schedule — explore freely.`
                : "Your workspace is ready. Connect accounts whenever you like — the dashboard is pre-loaded with a realistic schedule to explore."}
            </p>
            <div className="mt-7 flex justify-center">
              <Button size="lg" onClick={() => router.push("/dashboard")}>
                Go to your dashboard <ArrowRight className="size-4" />
              </Button>
            </div>
          </section>
        )}
      </main>

      <ConnectFlow
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        brandId={brandId}
        onConnected={onConnected}
      />
    </div>
  );
}
