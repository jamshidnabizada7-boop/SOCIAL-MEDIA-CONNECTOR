"use client";

import { useEffect, useState } from "react";
import { Check, KeyRound, Loader2, ShieldCheck } from "lucide-react";
import type { ProviderId, SocialAccount } from "@/lib/types";
import { PROVIDERS, PROVIDER_LIST } from "@/lib/providers";
import { accountsService } from "@/lib/services/accounts";
import { DATA_MODE } from "@/lib/api/client";
import { ConnectFlowApi } from "./connect-flow-api";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ProviderBadge } from "@/components/ui/status";
import { Avatar } from "@/components/ui/primitives";

type Step =
  | { kind: "picker" }
  | { kind: "authorizing"; provider: ProviderId }
  | { kind: "profile"; provider: ProviderId }
  | { kind: "success"; account: SocialAccount };

const OAUTH_STEPS = [
  "Opening the official authorization window",
  "Verifying the redirect URI and state",
  "Requesting least-privilege scopes",
  "Encrypting and storing credentials",
];
/**
 * Simulated OAuth connection flow.
 * Mirrors the real flow's shape: authorize → callback → fetch profile →
 * store encrypted credentials → create the account record.
 */
export function ConnectFlow({
  open,
  onClose,
  brandId,
  onConnected,
  initialProvider,
}: {
  open: boolean;
  onClose: () => void;
  brandId: string;
  onConnected?: (account: SocialAccount) => void;
  initialProvider?: ProviderId;
}) {
  const [step, setStep] = useState<Step>({ kind: "picker" });
  const [oauthStep, setOauthStep] = useState(0);

  useEffect(() => {
    if (!open) return;
    setStep(initialProvider ? { kind: "authorizing", provider: initialProvider } : { kind: "picker" });
    setOauthStep(0);
  }, [open, initialProvider]);

  useEffect(() => {
    if (step.kind !== "authorizing") return;
    const provider: ProviderId = step.provider;
    setOauthStep(0);
    const timers: number[] = [];
    OAUTH_STEPS.forEach((_, i) => {
      timers.push(window.setTimeout(() => setOauthStep(i + 1), 500 + i * 620));
    });
    timers.push(
      window.setTimeout(async () => {
        setStep({ kind: "profile", provider });
        const account = await accountsService.connect(provider, brandId);
        setStep({ kind: "success", account });
        onConnected?.(account);
      }, 500 + OAUTH_STEPS.length * 620 + 300)
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.kind, step.kind === "authorizing" ? step.provider : null]);

  const provider = step.kind === "authorizing" || step.kind === "profile" ? step.provider : null;
  const info = provider ? PROVIDERS[provider] : null;

  const close = () => {
    setStep({ kind: "picker" });
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      width="md"
      title={
        step.kind === "picker"
          ? "Connect a social account"
          : step.kind === "success"
            ? "Connected"
            : `Authorize ${info?.name}`
      }
      description={
        step.kind === "picker"
          ? "Authorization happens through the network's official sign-in. We never see your password."
          : step.kind === "success"
            ? undefined
            : "Simulated authorization for the interface prototype."
      }
      footer={
        step.kind === "picker" ? (
          <Button variant="secondary" onClick={close}>Cancel</Button>
        ) : step.kind === "success" ? (
          <Button onClick={close}>Done</Button>
        ) : (
          <Button variant="secondary" onClick={close} disabled={step.kind === "authorizing" && oauthStep > 1}>
            Cancel
          </Button>
        )
      }
    >
      {step.kind === "picker" && (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {PROVIDER_LIST.map((p) => (
            <button
              key={p.id}
              onClick={() => setStep({ kind: "authorizing", provider: p.id })}
              className="group flex flex-col items-center gap-2 rounded-xl border bg-surface p-4 text-center transition-colors hover:border-accent hover:bg-accent-soft/40"
            >
              <ProviderBadge provider={p.id} size="lg" />
              <span className="text-[13px] font-semibold">{p.name}</span>
              <span className="text-[11px] leading-snug text-ink-3">{p.connectHint}</span>
            </button>
          ))}
        </div>
      )}

      {step.kind === "authorizing" && info && (
        <div className="flex flex-col items-center py-4 text-center">
          <ProviderBadge provider={info.id} size="lg" className="size-14 rounded-2xl" />
          <p className="mt-3 text-sm font-medium">Redirecting to {info.name}…</p>
          <ul className="mt-5 w-full max-w-xs space-y-2 text-left">
            {OAUTH_STEPS.map((s, i) => (
              <li key={s} className="flex items-center gap-2.5 text-[13px]">
                {i < oauthStep ? (
                  <Check className="size-4 shrink-0 text-success" aria-hidden />
                ) : i === oauthStep ? (
                  <Loader2 className="size-4 shrink-0 animate-spin text-accent motion-reduce:animate-none" aria-hidden />
                ) : (
                  <span className="size-4 shrink-0 rounded-full border border-dashed border-line-strong" aria-hidden />
                )}
                <span className={i < oauthStep ? "text-ink-2" : i === oauthStep ? "font-medium" : "text-ink-3"}>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {step.kind === "profile" && info && (
        <div className="flex flex-col items-center py-10">
          <Loader2 className="size-6 animate-spin text-accent motion-reduce:animate-none" aria-label="Loading account" />
          <p className="mt-3 text-sm text-ink-2">Fetching your {info.name} profile…</p>
        </div>
      )}

      {step.kind === "success" && (
        <div className="flex flex-col items-center py-2 text-center">
          <span className="flex size-11 items-center justify-center rounded-full bg-success-soft text-success-ink">
            <Check className="size-5" aria-hidden />
          </span>
          <p className="mt-3 font-display text-lg font-semibold">{info?.name} connected</p>
          <div className="mt-4 flex w-full max-w-xs items-center gap-3 rounded-xl border bg-surface-2 p-3 text-left">
            <Avatar name={step.account.displayName} hue={step.account.avatarHue} size="lg" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{step.account.displayName}</p>
              <p className="truncate text-[13px] text-ink-3">{step.account.handle}</p>
            </div>
            <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-semibold text-success-ink">
              <Check className="size-3" /> Healthy
            </span>
          </div>
          <p className="mt-4 flex items-start gap-2 text-left text-[12px] leading-relaxed text-ink-3">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            Credentials are encrypted at rest and never exposed to the browser. You can disconnect
            at any time — we revoke the token with {info?.name} when you do.
          </p>
        </div>
      )}

      {step.kind === "authorizing" && (
        <p className="mt-2 flex items-center justify-center gap-1.5 text-center text-[11px] text-ink-3">
          <KeyRound className="size-3" /> Prototype: no network traffic leaves this page.
        </p>
      )}
    </Dialog>
  );
}


/** Mode-aware wrapper used across the app. */
export function ConnectAccountFlow(props: {
  open: boolean;
  onClose: () => void;
  brandId?: string;
  onConnected?: (account: SocialAccount) => void;
  initialProvider?: ProviderId;
}) {
  if (DATA_MODE === "api") {
    return (
      <ConnectFlowApi
        open={props.open}
        initialProvider={props.initialProvider}
        onClose={props.onClose}
        onConnected={(a) => props.onConnected?.({ provider: a.provider, handle: a.handle } as unknown as SocialAccount)}
      />
    );
  }
  return (
    <ConnectFlow
      open={props.open}
      onClose={props.onClose}
      brandId={props.brandId ?? "brand_aria"}
      onConnected={props.onConnected}
      initialProvider={props.initialProvider}
    />
  );
}
