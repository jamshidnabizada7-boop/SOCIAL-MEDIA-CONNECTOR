"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { CircleCheckBig, KeyRound, RefreshCw, ShieldCheck, Users } from "lucide-react";
import type { ProviderId, ProviderInfo, SocialAccount } from "@/lib/types";
import { accountsService } from "@/lib/services/accounts";
import { useSubscribe } from "@/lib/services/hooks";
import { useSession, useToast } from "@/components/providers";
import { PageHeader, PageBody } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Avatar, Card, EmptyState, Skeleton } from "@/components/ui/primitives";
import { ConfirmDialog, Dialog, DropdownMenu } from "@/components/ui/dialog";
import { ConnectionPill, ProviderBadge } from "@/components/ui/status";
import { ConnectAccountFlow as ConnectFlow } from "@/components/accounts/connect-flow";
import { PROVIDERS, PROVIDER_LIST } from "@/lib/providers";
import { formatNumber, timeAgo } from "@/lib/utils";

function CapabilityDialog({ open, onClose, provider }: { open: boolean; onClose: () => void; provider: ProviderInfo }) {
  const caps = provider.capabilities;
  const formats: [string, boolean][] = [
    ["Text posts", caps.formats.text],
    ["Images", caps.formats.image],
    ["Multiple images", caps.formats.image && caps.maxImages > 1],
    ["Video", caps.formats.video],
    ["Carousels", caps.formats.carousel],
    ["Documents", caps.formats.document],
  ];
  const features: [string, boolean][] = [
    ["Alt text", caps.altText],
    ["Scheduling", caps.schedule],
    ["Direct publishing", caps.directPublish],
    ["First comment", caps.firstComment],
    ["Custom thumbnail", caps.thumbnail],
    ["Edit after publish", caps.editing],
    ["Delete via API", caps.deletion],
    ["Analytics", caps.analytics],
    ["AI disclosure labels", caps.aiDisclosure],
  ];
  return (
    <Dialog open={open} onClose={onClose} title={`${provider.name} — what's supported`} description={provider.connectHint} width="lg">
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <p className="text-[13px] font-semibold">Content formats</p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {formats.map(([label, ok]) => (
              <li key={label} className="flex items-center gap-2 text-[13px]">
                {ok ? <CircleCheckBig className="size-4 text-success" /> : <span className="size-4 rounded border border-dashed border-line-strong" />}
                <span className={ok ? "" : "text-ink-3"}>{label}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-[13px] font-semibold">Features</p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {features.map(([label, ok]) => (
              <li key={label} className="flex items-center gap-2 text-[13px]">
                {ok ? <CircleCheckBig className="size-4 text-success" /> : <span className="size-4 rounded border border-dashed border-line-strong" />}
                <span className={ok ? "" : "text-ink-3"}>{label}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="mt-5 grid gap-2 rounded-xl border bg-surface-2 p-4 text-[13px] sm:grid-cols-2">
        <p><span className="text-ink-3">Caption limit:</span> <span className="tnum font-semibold">{caps.maxCaptionLength.toLocaleString()}</span></p>
        <p><span className="text-ink-3">Max images:</span> <span className="tnum font-semibold">{caps.maxImages || "—"}</span></p>
        <p><span className="text-ink-3">Max video:</span> <span className="tnum font-semibold">{caps.maxVideoDurationSec ? `${Math.floor(caps.maxVideoDurationSec / 60)} min` : "—"}</span></p>
        <p><span className="text-ink-3">Ratios:</span> <span className="font-semibold">{caps.aspectRatios.join(", ") || "any"}</span></p>
      </div>
      {caps.note && <p className="mt-3 rounded-lg border border-warn/30 bg-warn-soft p-3 text-[13px] leading-relaxed text-warn-ink">{caps.note}</p>}
      {caps.approval && caps.approval !== "approved" && (
        <p className="mt-2 rounded-lg border border-info/25 bg-info-soft p-3 text-[13px] leading-relaxed text-info-ink">
          Production availability depends on the provider's app review — current status:{" "}
          <span className="font-semibold">{caps.approval === "pending" ? "pending audit" : "in testing"}</span>. The integration is
          built and verified against sandbox behavior; the switch flips on automatically once approved.
        </p>
      )}
    </Dialog>
  );
}

function AccountsInner() {
  useSubscribe(accountsService);
  const params = useSearchParams();
  const { session } = useSession();
  const toast = useToast();
  const [loaded, setLoaded] = useState(false);
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [connectOpen, setConnectOpen] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState<SocialAccount | null>(null);
  const [capsProvider, setCapsProvider] = useState<ProviderInfo | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const read = () => {
      setAccounts(accountsService.list());
      setLoaded(true);
    };
    accountsService.listAsync().then(read);
    return accountsService.subscribe(read);
  }, []);

  useEffect(() => {
    if (params.get("connect") === "1") setConnectOpen(true);
    const connect = params.get("connect");
    if (connect === "error") {
      toast({
        title: "Connection failed",
        description: params.get("reason") ?? "The network rejected the connection. Try again.",
        variant: "error",
      });
      window.history.replaceState(null, "", "/accounts");
    } else if (params.get("connected")) {
      toast({ title: "Account connected", description: "It can now publish for this workspace.", variant: "success" });
      window.history.replaceState(null, "", "/accounts");
    }
  }, [params, toast]);

  const grouped = useMemo(() => {
    const map = new Map<ProviderId, SocialAccount[]>();
    for (const a of accounts) map.set(a.provider, [...(map.get(a.provider) ?? []), a]);
    return [...map.entries()];
  }, [accounts]);

  const unhealthy = accounts.filter((a) => a.connection === "needs_reauth");
  const expiring = accounts.filter((a) => a.connection === "token_expiring");

  const reconnect = async (a: SocialAccount) => {
    setBusy(a.id);
    await accountsService.reconnect(a.id);
    setAccounts(accountsService.list());
    setBusy(null);
    toast({ title: `${a.displayName} reconnected`, description: "Scheduled content will resume normally.", variant: "success" });
  };

  if (!loaded) {
    return (
      <div>
        <PageHeader title="Social accounts" />
        <PageBody className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </PageBody>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Social accounts"
        description="Connections are owned by the workspace, not by one person. Tokens refresh automatically; problems surface here before they break your schedule."
        actions={
          <Button onClick={() => setConnectOpen(true)}>
            <Users className="size-4" /> Connect account
          </Button>
        }
      >
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <span className="inline-flex items-center gap-1.5 rounded-full border bg-surface px-2.5 py-1 font-medium">
            <CircleCheckBig className="size-3.5 text-success" />
            {accounts.length - unhealthy.length - expiring.length} healthy
          </span>
          {unhealthy.length > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-danger/30 bg-danger-soft px-2.5 py-1 font-medium text-danger-ink">
              <KeyRound className="size-3.5" /> {unhealthy.length} needs reauthorization
            </span>
          )}
          {expiring.length > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-warn/30 bg-warn-soft px-2.5 py-1 font-medium text-warn-ink">
              <RefreshCw className="size-3.5" /> {expiring.length} token expiring
            </span>
          )}
        </div>
      </PageHeader>

      <PageBody className="space-y-5">
        {unhealthy.length > 0 && (
          <Card className="border-danger/30">
            <div className="flex flex-wrap items-center gap-3 p-4">
              <span className="flex size-9 items-center justify-center rounded-lg bg-danger-soft text-danger">
                <KeyRound className="size-4.5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">Reauthorization required</p>
                <p className="text-[13px] text-ink-2">
                  {unhealthy.map((a) => a.displayName).join(", ")} revoked access. Scheduled content to these accounts is paused
                  safely — nothing half-publishes.
                </p>
              </div>
              <Button loading={busy === unhealthy[0].id} onClick={() => reconnect(unhealthy[0])}>
                Reconnect {unhealthy[0].displayName.split(" ")[0]}
              </Button>
            </div>
          </Card>
        )}

        {accounts.length === 0 ? (
          <EmptyState
            icon={<ShieldCheck className="size-5" />}
            title="No accounts connected"
            body="Connect your first social account to start publishing everywhere."
            action={<Button onClick={() => setConnectOpen(true)}>Connect account</Button>}
          />
        ) : (
          <div className="flex flex-col gap-6">
            {grouped.map(([providerId, list]) => (
              <section key={providerId}>
                <div className="mb-2.5 flex items-center gap-2">
                  <ProviderBadge provider={providerId} size="sm" />
                  <h2 className="text-sm font-semibold">{PROVIDERS[providerId].name}</h2>
                  <button
                    onClick={() => setCapsProvider(PROVIDERS[providerId])}
                    className="text-[12px] font-medium text-accent-ink hover:underline"
                  >
                    View capabilities
                  </button>
                  <span className="ml-auto text-[12px] text-ink-3">{list.length} connected</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {list.map((a) => {
                    const brand = session?.workspace.brands.find((b) => b.id === a.brandId);
                    return (
                      <Card key={a.id} className={a.connection === "needs_reauth" ? "border-danger/40" : undefined}>
                        <div className="flex items-start gap-3 p-4">
                          <Avatar name={a.displayName} hue={a.avatarHue} size="lg" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold">{a.displayName}</p>
                            <p className="truncate text-[13px] text-ink-3">{a.handle}</p>
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                              <ConnectionPill state={a.connection} />
                              {brand && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-ink-2">
                                  <span className="size-1.5 rounded-full" style={{ backgroundColor: `hsl(${brand.hue} 55% 50%)` }} />
                                  {brand.name}
                                </span>
                              )}
                            </div>
                          </div>
                          <DropdownMenu
                            items={[
                              {
                                label: "Refresh health",
                                icon: <RefreshCw className="size-4" />,
                                onSelect: async () => {
                                  await accountsService.refresh(a.id);
                                  setAccounts(accountsService.list());
                                  toast({ title: "Connection checked", description: "Token verified and refreshed.", variant: "success" });
                                },
                              },
                              ...(a.connection !== "healthy"
                                ? [
                                    {
                                      label: "Reconnect",
                                      icon: <KeyRound className="size-4" />,
                                      onSelect: () => reconnect(a),
                                    },
                                  ]
                                : []),
                              {
                                separatorBefore: true,
                                label: "Disconnect",
                                icon: <ShieldCheck className="size-4" />,
                                danger: true,
                                onSelect: () => setConfirmDisconnect(a),
                              },
                            ]}
                            trigger={({ toggle }) => (
                              <button onClick={toggle} aria-label="Account actions" className="rounded-lg p-1.5 text-ink-3 hover:bg-surface-2 hover:text-ink">
                                <svg viewBox="0 0 20 20" className="size-4 fill-current"><circle cx="10" cy="4" r="1.6" /><circle cx="10" cy="10" r="1.6" /><circle cx="10" cy="16" r="1.6" /></svg>
                              </button>
                            )}
                          />
                        </div>
                        {a.connectionNote && (
                          <p className="border-t px-4 py-2.5 text-[12.5px] leading-relaxed text-warn-ink">{a.connectionNote}</p>
                        )}
                        <div className="flex items-center justify-between border-t bg-surface-2 px-4 py-2.5 text-[12px] text-ink-3">
                          <span className="tnum">{formatNumber(a.followers)} followers</span>
                          <span>checked {timeAgo(a.lastRefreshedAt)}</span>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}

        <Card className="p-5">
          <p className="text-[13px] font-semibold">How connections work</p>
          <p className="mt-1.5 max-w-3xl text-[13px] leading-relaxed text-ink-2">
            Connecting uses each network's official authorization — Aria Hub never sees your
            password. Access tokens are encrypted at rest, refreshed automatically before they
            expire (with a lock so two workers never refresh the same token), and revoked with the
            network when you disconnect. Disconnecting here does not delete anything you've already
            published.
          </p>
        </Card>
      </PageBody>

      <ConnectFlow
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        brandId={session?.brandId ?? "brand_aria"}
        onConnected={() => setAccounts(accountsService.list())}
      />

      <ConfirmDialog
        open={!!confirmDisconnect}
        onClose={() => setConfirmDisconnect(null)}
        onConfirm={async () => {
          if (confirmDisconnect) {
            await accountsService.disconnect(confirmDisconnect.id);
            setAccounts(accountsService.list());
            toast({ title: `${confirmDisconnect.displayName} disconnected`, description: "The token was revoked with the network.", variant: "info" });
          }
          setConfirmDisconnect(null);
        }}
        title={`Disconnect ${confirmDisconnect?.displayName ?? ""}?`}
        body="We revoke the stored token with the network and remove the connection from this workspace. Already-published posts stay live; scheduled content for this account will be paused."
        confirmLabel="Disconnect"
        danger
      />

      {capsProvider && <CapabilityDialog open onClose={() => setCapsProvider(null)} provider={capsProvider} />}
    </div>
  );
}

export default function AccountsPage() {
  return (
    <Suspense
      fallback={
        <div>
          <PageHeader title="Social accounts" />
          <PageBody className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-40 rounded-xl" />
            ))}
          </PageBody>
        </div>
      }
    >
      <AccountsInner />
    </Suspense>
  );
}
