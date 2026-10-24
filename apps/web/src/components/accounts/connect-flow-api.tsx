"use client";

import Link from "next/link";
import { useState } from "react";
import { KeyRound, Loader2, ShieldCheck } from "lucide-react";
import type { ProviderId } from "@/lib/types";
import { PROVIDERS, PROVIDER_LIST } from "@/lib/providers";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ProviderBadge } from "@/components/ui/status";
import { useSession } from "@/components/providers";
import { apiGet, apiPost, ApiError } from "@/lib/api/client";

type ApiStep =
  | { kind: "picker" }
  | { kind: "bluesky"; state: "form" | "connecting" }
  | { kind: "mastodon"; state: "instance" | "authorizing" }
  | { kind: "working"; provider: ProviderId }
  | { kind: "error"; provider: ProviderId; message: string; code?: string };

/**
 * API-mode connect flow: Bluesky uses an app password, Mastodon redirects to
 * the instance's own authorize screen, and configured OAuth providers go
 * straight to their authorize URL. Unconfigured providers show the exact
 * server message (register the developer app first).
 */
export function ConnectFlowApi({
  open,
  onClose,
  onConnected,
}: {
  open: boolean;
  onClose: () => void;
  onConnected?: (account: { provider: ProviderId; handle: string }) => void;
}) {
  const { session } = useSession();
  const [step, setStep] = useState<ApiStep>({ kind: "picker" });
  const [handle, setHandle] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [instance, setInstance] = useState("mastodon.social");
  const [error, setError] = useState<string | null>(null);

  if (!session) return null;

  const reset = () => {
    setStep({ kind: "picker" });
    setError(null);
    setAppPassword("");
  };

  const connectBluesky = async () => {
    setStep({ kind: "bluesky", state: "connecting" });
    setError(null);
    try {
      const res = await apiPost<{ account: { handle: string } }>("/v1/accounts/bluesky/connect", {
        workspaceId: session.workspace.id,
        brandId: session.brandId ?? undefined,
        handle: handle.trim(),
        appPassword: appPassword.trim(),
      });
      onConnected?.({ provider: "bluesky", handle: res.account.handle });
      reset();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach Bluesky.");
      setStep({ kind: "bluesky", state: "form" });
    }
  };

  const connectMastodon = async () => {
    setStep({ kind: "mastodon", state: "authorizing" });
    setError(null);
    try {
      await apiGet<{ instance: unknown }>(
        `/v1/oauth/mastodon/instance?instance=${encodeURIComponent(instance.trim())}`
      );
      const res = await apiGet<{ url: string }>(
        `/v1/oauth/mastodon/authorize?workspaceId=${session.workspace.id}${session.brandId ? `&brandId=${session.brandId}` : ""}&instance=${encodeURIComponent(instance.trim())}&format=json`
      );
      window.location.href = res.url;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That instance could not be reached.");
      setStep({ kind: "mastodon", state: "instance" });
    }
  };

  const connectGeneric = async (provider: ProviderId) => {
    setStep({ kind: "working", provider });
    setError(null);
    try {
      const res = await apiGet<{ url: string }>(
        `/v1/oauth/${provider}/authorize?workspaceId=${session.workspace.id}${session.brandId ? `&brandId=${session.brandId}` : ""}&format=json`
      );
      window.location.assign(res.url);
    } catch (err) {
      setStep({
        kind: "error",
        provider,
        message: err instanceof ApiError ? err.message : "Connection failed.",
        code: err instanceof ApiError ? err.code : undefined,
      });
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title={
        step.kind === "picker"
          ? "Connect a social account"
          : step.kind === "bluesky"
            ? "Connect Bluesky"
            : step.kind === "mastodon"
              ? "Connect Mastodon"
              : step.kind === "error"
                ? "Connection unavailable"
                : `Connect ${PROVIDERS[step.provider].name}`
      }
      description={
        step.kind === "picker"
          ? "Authorization happens through the network's official sign-in. We never see your password."
          : step.kind === "bluesky"
            ? "Create an app password in Bluesky (Settings → App passwords) and paste it here."
            : step.kind === "mastodon"
              ? "Enter your instance — the app is registered there automatically."
              : undefined
      }
      width="md"
      footer={
        <Button variant="secondary" onClick={() => { reset(); onClose(); }}>
          {step.kind === "error" ? "Back" : "Cancel"}
        </Button>
      }
    >
      {step.kind === "picker" && (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {PROVIDER_LIST.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                if (p.id === "bluesky") setStep({ kind: "bluesky", state: "form" });
                else if (p.id === "mastodon") setStep({ kind: "mastodon", state: "instance" });
                else void connectGeneric(p.id);
              }}
              className="group flex flex-col items-center gap-2 rounded-xl border bg-surface p-4 text-center transition-colors hover:border-accent hover:bg-accent-soft/40"
            >
              <ProviderBadge provider={p.id} size="lg" />
              <span className="text-[13px] font-semibold">{p.name}</span>
              <span className="text-[11px] leading-snug text-ink-3">{p.connectHint}</span>
            </button>
          ))}
        </div>
      )}

      {step.kind === "bluesky" && (
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium">Handle</span>
            <input
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="you.bsky.social"
              className="h-9.5 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink outline-none focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium">App password</span>
            <input
              type="password"
              value={appPassword}
              onChange={(e) => setAppPassword(e.target.value)}
              placeholder="xxxx-xxxx-xxxx-xxxx"
              className="h-9.5 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink outline-none focus:border-accent"
            />
          </label>
          {error && <p className="text-[13px] text-danger">{error}</p>}
          <Button onClick={() => void connectBluesky()} loading={step.state === "connecting"} disabled={!handle || !appPassword}>
            <KeyRound className="size-4" /> Connect with app password
          </Button>
          <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-3">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
            The app password is exchanged for refreshable session tokens and never stored in plain text.
          </p>
        </div>
      )}

      {step.kind === "mastodon" && (
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium">Instance URL</span>
            <input
              value={instance}
              onChange={(e) => setInstance(e.target.value)}
              placeholder="mastodon.social"
              className="h-9.5 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink outline-none focus:border-accent"
            />
          </label>
          {error && <p className="text-[13px] text-danger">{error}</p>}
          <Button onClick={() => void connectMastodon()} loading={step.state === "authorizing"}>
            Continue to {instance || "instance"}
          </Button>
          <p className="text-[11px] leading-relaxed text-ink-3">
            You authorize Aria Hub on the instance itself and come straight back.
          </p>
        </div>
      )}

      {step.kind === "error" && (
        <div className="flex flex-col items-center py-6 text-center">
          <span className="flex size-11 items-center justify-center rounded-xl bg-warn-soft text-warn-ink">
            <KeyRound className="size-5" />
          </span>
          <p className="mt-3 text-sm font-semibold">{PROVIDERS[step.provider].name} isn&apos;t connected yet</p>
          <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-ink-2">{step.message}</p>
          {step.code === "provider_unconfigured" && (
            <div className="mt-4 max-w-sm rounded-lg border bg-surface-2/40 p-3 text-left text-[12.5px] leading-relaxed text-ink-2">
              <p className="font-semibold text-ink">How to fix this</p>
              {session.user.isAdmin ? (
                <p className="mt-1">
                  Register a developer app for {PROVIDERS[step.provider].name} (steps in{" "}
                  <code className="font-mono text-[11.5px]">docs/phase-0/PROVIDER-SETUP.md</code>), then paste its ID and
                  secret in{" "}
                  <Link
                    href="/admin"
                    className="font-semibold text-accent underline"
                    onClick={() => {
                      reset();
                      onClose();
                    }}
                  >
                    Admin → Provider credentials
                  </Link>
                  . This dialog will connect normally afterwards.
                </p>
              ) : (
                <p className="mt-1">
                  A platform admin needs to register a developer app for this network and paste its credentials under
                  Admin → Provider credentials.
                </p>
              )}
              <p className="mt-2 text-ink-3">
                Bluesky and Mastodon need no developer app — they connect right now from this dialog.
              </p>
            </div>
          )}
        </div>
      )}

      {step.kind === "working" && (
        <div className="flex flex-col items-center py-10">
          <Loader2 className="size-6 animate-spin text-accent motion-reduce:animate-none" />
          <p className="mt-3 text-sm text-ink-2">Opening {PROVIDERS[step.provider].name}…</p>
        </div>
      )}
    </Dialog>
  );
}
