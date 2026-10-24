"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Activity, Copy, Flag, Inbox, KeyRound, RotateCcw, ShieldCheck, Trash2, Webhook } from "lucide-react";
import type { AdminJob, AdminProvider, AuditEntry, FeatureFlag, ProviderCredentialGroup, ProviderStatus, WebhookEvent } from "@/lib/types";
import { adminService } from "@/lib/services/admin";
import { useToast } from "@/components/providers";
import { PageHeader, PageBody } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, Field, Input, Segmented, Skeleton, Switch, Tooltip } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/ui/dialog";
import { ProviderBadge, TargetStatePill } from "@/components/ui/status";
import { PROVIDERS } from "@/lib/providers";
import { cn, formatDateTime, timeAgo } from "@/lib/utils";

type Section = "overview" | "providers" | "credentials" | "jobs" | "webhooks" | "flags" | "audit";

const STATUS_TONE: Record<ProviderStatus, string> = {
  active: "bg-success-soft text-success-ink",
  degraded: "bg-warn-soft text-warn-ink",
  maintenance: "bg-info-soft text-info-ink",
  disabled: "bg-surface-2 text-ink-3",
};

export default function AdminPage() {
  const toast = useToast();
  const [section, setSection] = useState<Section>("overview");
  const [loaded, setLoaded] = useState(false);
  const [providers, setProviders] = useState<AdminProvider[]>([]);
  const [jobs, setJobs] = useState<AdminJob[]>([]);
  const [dlq, setDlq] = useState<AdminJob[]>([]);
  const [webhooks, setWebhooks] = useState<WebhookEvent[]>([]);
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [credGroups, setCredGroups] = useState<ProviderCredentialGroup[]>([]);
  const [editingCred, setEditingCred] = useState<ProviderCredentialGroup["provider"] | null>(null);
  const [credClientId, setCredClientId] = useState("");
  const [credClientSecret, setCredClientSecret] = useState("");
  const [credBusy, setCredBusy] = useState(false);
  const [deleteCredTarget, setDeleteCredTarget] = useState<ProviderCredentialGroup | null>(null);
  const [statusTarget, setStatusTarget] = useState<{ provider: AdminProvider; status: ProviderStatus } | null>(null);

  useEffect(() => {
    Promise.all([
      adminService.providers(),
      adminService.jobs(),
      adminService.deadLetters(),
      adminService.webhookEvents(),
      adminService.flags(),
      adminService.auditLog(),
      adminService.providerCredentials(),
    ]).then(([p, j, d, w, f, a, c]) => {
      setProviders(p);
      setJobs(j);
      setDlq(d);
      setWebhooks(w);
      setFlags(f);
      setAudit(a);
      setCredGroups(c);
      setLoaded(true);
    });
  }, []);

  if (!loaded) {
    return (
      <div>
        <PageHeader title="Admin" />
        <PageBody className="space-y-4">
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-96 rounded-xl" />
        </PageBody>
      </div>
    );
  }

  const errorRate = (providers.reduce((a, p) => a + p.errorRate7d, 0) / providers.length).toFixed(2);
  const openJobs = jobs.filter((j) => !["published", "failed"].includes(j.state)).length;

  return (
    <div>
      <PageHeader
        title="Admin"
        description="Internal operations. Provider secrets are never shown here — sensitive actions require elevated permission and are audit-logged."
      />
      <PageBody>
        <div className="mb-5">
          <Segmented
            value={section}
            onChange={setSection}
            options={[
              { value: "overview", label: "Overview" },
              { value: "providers", label: "Providers" },
              { value: "credentials", label: "Provider credentials" },
              { value: "jobs", label: "Publishing jobs" },
              { value: "webhooks", label: "Webhooks" },
              { value: "flags", label: "Feature flags" },
              { value: "audit", label: "Audit log" },
            ]}
          />
        </div>

        {section === "overview" && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {[
                { label: "Open publishing jobs", value: openJobs, tone: "text-info-ink", icon: <Activity className="size-4" /> },
                { label: "Dead-letter entries", value: dlq.length, tone: dlq.length ? "text-danger-ink" : "text-ink", icon: <Inbox className="size-4" /> },
                { label: "Avg provider error rate (7d)", value: `${errorRate}%`, tone: Number(errorRate) > 3 ? "text-warn-ink" : "text-success-ink", icon: <Activity className="size-4" /> },
                { label: "Providers degraded", value: providers.filter((p) => p.status !== "active").length, tone: "text-warn-ink", icon: <ShieldCheck className="size-4" /> },
              ].map((s) => (
                <Card key={s.label} className="p-4">
                  <span className={cn("flex size-8 items-center justify-center rounded-lg bg-surface-2", s.tone)}>{s.icon}</span>
                  <p className="tnum mt-3 font-display text-[24px] font-bold leading-none">{s.value}</p>
                  <p className="mt-1 text-[13px] text-ink-2">{s.label}</p>
                </Card>
              ))}
            </div>
            <Card>
              <CardHeader title="Provider health" description="Rolling 7-day view across all integrations." />
              <ul className="divide-y">
                {providers.map((p) => (
                  <li key={p.provider} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <ProviderBadge provider={p.provider} size="sm" />
                    <span className="w-24 text-[13px] font-semibold">{PROVIDERS[p.provider].name}</span>
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize", STATUS_TONE[p.status])}>{p.status}</span>
                    <span className="text-[12px] text-ink-3">
                      {p.approval === "approved" ? "App review approved" : p.approval === "pending" ? "Audit pending" : "Testing"}
                    </span>
                    <span className={cn("tnum ml-auto text-[12px] font-medium", p.errorRate7d > 3 ? "text-danger-ink" : "text-ink-2")}>
                      {p.errorRate7d}% errors
                    </span>
                    <span className="text-[12px] text-ink-3">last publish {p.lastSuccessfulPublish ? timeAgo(p.lastSuccessfulPublish) : "—"}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        )}

        {section === "providers" && (
          <Card>
            <CardHeader
              title="Provider integrations"
              description="Status, API versions and review state. Disabling a provider pauses its queue with a clear user-facing message."
            />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-[12px] text-ink-3">
                    <th className="px-5 py-2.5 font-medium">Provider</th>
                    <th className="px-5 py-2.5 font-medium">Status</th>
                    <th className="px-5 py-2.5 font-medium">API version</th>
                    <th className="px-5 py-2.5 font-medium">App review</th>
                    <th className="px-5 py-2.5 font-medium">Errors (7d)</th>
                    <th className="px-5 py-2.5 font-medium">Rate-limit health</th>
                    <th className="px-5 py-2.5 font-medium">Last publish</th>
                    <th className="px-5 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {providers.map((p) => (
                    <tr key={p.provider} className="border-b last:border-b-0">
                      <td className="px-5 py-3">
                        <span className="flex items-center gap-2 font-medium">
                          <ProviderBadge provider={p.provider} size="xs" />
                          {PROVIDERS[p.provider].name}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize", STATUS_TONE[p.status])}>{p.status}</span>
                      </td>
                      <td className="tnum px-5 py-3 text-ink-2">{p.apiVersion}</td>
                      <td className="px-5 py-3 text-ink-2">
                        {p.approval === "approved" ? "Approved" : p.approval === "pending" ? "Pending audit" : "Testing"}
                      </td>
                      <td className={cn("tnum px-5 py-3 font-medium", p.errorRate7d > 3 ? "text-danger-ink" : "text-ink-2")}>{p.errorRate7d}%</td>
                      <td className="px-5 py-3 text-ink-2 capitalize">{p.rateLimitHealth}</td>
                      <td className="px-5 py-3 text-ink-2">{p.lastSuccessfulPublish ? timeAgo(p.lastSuccessfulPublish) : "—"}</td>
                      <td className="px-5 py-3 text-right">
                        <Button
                          size="sm"
                          variant={p.status === "disabled" ? "soft" : "ghost"}
                          onClick={() =>
                            setStatusTarget({ provider: p, status: p.status === "disabled" ? "active" : "disabled" })
                          }
                        >
                          {p.status === "disabled" ? "Enable" : "Disable"}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {section === "credentials" && (
          <div className="space-y-4">
            <Card>
              <CardHeader
                title="Developer app credentials"
                description="Paste the app ID and secret from each network's developer portal. Secrets are encrypted at rest and never displayed again — only a masked fingerprint is shown. After saving, add this server's redirect URI to the app in the developer portal."
              />
              <ul className="divide-y">
                {credGroups.map((g) => (
                  <li key={g.provider} className="px-5 py-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <ProviderBadge provider={g.provider} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold">
                          {PROVIDERS[g.provider].name}
                          {g.covers.length > 1 && (
                            <span className="ml-2 text-[12px] font-normal text-ink-3">
                              also covers {g.covers.filter((c) => c !== g.provider).map((c) => PROVIDERS[c].name).join(", ")}
                            </span>
                          )}
                        </p>
                        <p className="mt-0.5 flex items-center gap-1.5 text-[12px] text-ink-3">
                          <span className="font-mono">Redirect URI:</span>
                          <span className="tnum max-w-72 truncate font-mono">{g.redirectUri}</span>
                          <button
                            type="button"
                            className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[11px] font-medium text-ink-2 hover:bg-surface-2"
                            onClick={() => {
                              navigator.clipboard.writeText(g.redirectUri);
                              toast({ title: "Redirect URI copied", variant: "info" });
                            }}
                          >
                            <Copy className="size-3" /> Copy
                          </button>
                        </p>
                      </div>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                          g.configured ? "bg-success-soft text-success-ink" : "bg-surface-2 text-ink-3"
                        )}
                      >
                        {g.configured ? (g.source === "database" ? "configured via Admin" : "configured via env") : "not configured"}
                      </span>
                      {g.configured && <span className="tnum font-mono text-[12px] text-ink-3">{g.clientIdMasked}</span>}
                      <Button
                        size="sm"
                        variant={g.configured ? "ghost" : "soft"}
                        onClick={() => {
                          setEditingCred(editingCred === g.provider ? null : g.provider);
                          setCredClientId("");
                          setCredClientSecret("");
                        }}
                      >
                        <KeyRound className="size-3.5" />
                        {g.configured ? "Replace" : "Add credentials"}
                      </Button>
                      {g.configured && g.source === "database" && (
                        <Button size="sm" variant="ghost" onClick={() => setDeleteCredTarget(g)}>
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
                    </div>
                    {editingCred === g.provider && (
                      <form
                        className="mt-3 grid gap-3 rounded-lg border bg-surface-2/40 p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
                        onSubmit={async (e) => {
                          e.preventDefault();
                          if (!credClientId.trim() || !credClientSecret.trim() || credBusy) return;
                          setCredBusy(true);
                          try {
                            await adminService.setProviderCredentials(g.provider, credClientId.trim(), credClientSecret.trim());
                            setCredGroups(await adminService.providerCredentials());
                            setEditingCred(null);
                            setCredClientId("");
                            setCredClientSecret("");
                            toast({
                              title: `${PROVIDERS[g.provider].name} credentials saved`,
                              description: "Users can now connect accounts. Make sure the redirect URI is registered on the developer app.",
                              variant: "success",
                            });
                          } catch (err) {
                            toast({ title: "Save failed", description: (err as Error).message, variant: "error" });
                          } finally {
                            setCredBusy(false);
                          }
                        }}
                      >
                        <Field label="App ID / Client ID">
                          <Input value={credClientId} onChange={(e) => setCredClientId(e.target.value)} placeholder="e.g. 123456789012345" autoComplete="off" />
                        </Field>
                        <Field label="App secret / Client secret">
                          <Input type="password" value={credClientSecret} onChange={(e) => setCredClientSecret(e.target.value)} placeholder="Paste the secret" autoComplete="new-password" />
                        </Field>
                        <Button type="submit" disabled={credBusy || !credClientId.trim() || !credClientSecret.trim()}>
                          {credBusy ? "Saving…" : "Save"}
                        </Button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
            <p className="text-[12.5px] text-ink-3">
              Bluesky (app password) and Mastodon (per-instance OAuth) need no developer app — users connect them directly
              from <Link href="/settings/accounts" className="underline hover:text-ink-2">Settings → Accounts</Link>. For the
              networks above, registration steps are in <code className="font-mono">docs/phase-0/PROVIDER-SETUP.md</code>.
            </p>
          </div>
        )}

        {section === "jobs" && (
          <div className="space-y-4">
            <Card>
              <CardHeader title="Publishing jobs" description="Queue state per target. Jobs are idempotent — retries verify remote state before acting." />
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-[12px] text-ink-3">
                      <th className="px-5 py-2.5 font-medium">Post</th>
                      <th className="px-5 py-2.5 font-medium">Provider</th>
                      <th className="px-5 py-2.5 font-medium">State</th>
                      <th className="px-5 py-2.5 font-medium">Attempts</th>
                      <th className="px-5 py-2.5 font-medium">Queued</th>
                      <th className="px-5 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.map((j) => (
                      <tr key={j.id} className="border-b last:border-b-0">
                        <td className="max-w-64 truncate px-5 py-3">
                          <Link href={`/posts/${j.postId}`} className="font-medium hover:underline">{j.postTitle}</Link>
                        </td>
                        <td className="px-5 py-3">
                          <span className="inline-flex items-center gap-1.5 text-ink-2">
                            <ProviderBadge provider={j.provider} size="xs" />
                            {PROVIDERS[j.provider].name}
                          </span>
                        </td>
                        <td className="px-5 py-3"><TargetStatePill state={j.state} /></td>
                        <td className="tnum px-5 py-3 text-ink-2">{j.attempts}</td>
                        <td className="tnum px-5 py-3 text-ink-2">{timeAgo(j.queuedAt)}</td>
                        <td className="px-5 py-3 text-right font-mono text-[11px] text-ink-3">{j.lastError ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card>
              <CardHeader
                title="Dead-letter queue"
                description="Retries exhausted. These need a human decision — replay after fixing content, or discard."
              />
              {dlq.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-ink-3">The dead-letter queue is empty.</p>
              ) : (
                <ul className="divide-y">
                  {dlq.map((j) => (
                    <li key={j.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{j.postTitle}</span>
                        <span className="text-[12px] text-ink-3">
                          {PROVIDERS[j.provider].name} · {j.attempts} attempts · <span className="font-mono">{j.lastError}</span>
                        </span>
                      </span>
                      <Button size="sm" variant="secondary" onClick={async () => { await adminService.replayDeadLetter(j.id); setDlq(await adminService.deadLetters()); toast({ title: "Job requeued", description: "It will verify remote state before publishing.", variant: "success" }); }}>
                        <RotateCcw className="size-3.5" /> Replay
                      </Button>
                      <Button size="sm" variant="ghost" onClick={async () => { await adminService.discardDeadLetter(j.id); setDlq(await adminService.deadLetters()); toast({ title: "Job discarded", variant: "info" }); }}>
                        Discard
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        )}

        {section === "webhooks" && (
          <Card>
            <CardHeader
              title="Inbound provider webhooks"
              description="Signature verification, deduplication and raw-event persistence happen at the gateway before processing."
            />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-[12px] text-ink-3">
                    <th className="px-5 py-2.5 font-medium">Provider</th>
                    <th className="px-5 py-2.5 font-medium">Event</th>
                    <th className="px-5 py-2.5 font-medium">Received</th>
                    <th className="px-5 py-2.5 font-medium">Signature</th>
                    <th className="px-5 py-2.5 font-medium">Processing</th>
                  </tr>
                </thead>
                <tbody>
                  {webhooks.map((w) => (
                    <tr key={w.id} className="border-b last:border-b-0">
                      <td className="px-5 py-3">
                        <span className="inline-flex items-center gap-1.5 font-medium">
                          <ProviderBadge provider={w.provider} size="xs" />
                          {PROVIDERS[w.provider].name}
                        </span>
                      </td>
                      <td className="px-5 py-3 font-mono text-[12px]">{w.type}</td>
                      <td className="tnum px-5 py-3 text-ink-2">{formatDateTime(w.receivedAt)}</td>
                      <td className="px-5 py-3">
                        <Tooltip label={w.verified ? "HMAC verified" : "Verification failed — event rejected"}>
                          <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold", w.verified ? "bg-success-soft text-success-ink" : "bg-danger-soft text-danger-ink")}>
                            {w.verified ? "verified" : "invalid"}
                          </span>
                        </Tooltip>
                      </td>
                      <td className="px-5 py-3">
                        <span className={cn(
                          "text-[12px] font-medium capitalize",
                          w.processed === "failed" && "text-danger-ink",
                          w.processed === "duplicate" && "text-warn-ink",
                          w.processed === "processed" && "text-ink-2"
                        )}>
                          {w.processed}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {section === "flags" && (
          <Card>
            <CardHeader title="Feature flags" description="Risky integrations ship behind flags — internal, beta, percentage, then all." />
            <ul className="divide-y">
              {flags.map((f) => (
                <li key={f.key} className="flex flex-wrap items-center gap-3 px-5 py-4">
                  <Flag className="size-4 shrink-0 text-ink-3" />
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-[13px] font-semibold">{f.key}</p>
                    <p className="text-[12.5px] text-ink-2">{f.description}</p>
                  </div>
                  <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold capitalize text-ink-2">{f.rollout}</span>
                  <Switch
                    checked={f.enabled}
                    label={`Toggle ${f.key}`}
                    onChange={async (v) => {
                      await adminService.setFlag(f.key, v);
                      setFlags(await adminService.flags());
                      toast({ title: `${f.key} ${v ? "enabled" : "disabled"}`, variant: "info" });
                    }}
                  />
                </li>
              ))}
            </ul>
          </Card>
        )}

        {section === "audit" && (
          <Card>
            <CardHeader title="Audit log" description="Who did what, when — never secrets." />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-[12px] text-ink-3">
                    <th className="px-5 py-2.5 font-medium">When</th>
                    <th className="px-5 py-2.5 font-medium">Actor</th>
                    <th className="px-5 py-2.5 font-medium">Action</th>
                    <th className="px-5 py-2.5 font-medium">Target</th>
                    <th className="px-5 py-2.5 font-medium">Workspace</th>
                    <th className="px-5 py-2.5 font-medium">IP</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.map((a) => (
                    <tr key={a.id} className="border-b last:border-b-0">
                      <td className="tnum whitespace-nowrap px-5 py-3 text-ink-2">{formatDateTime(a.at)}</td>
                      <td className="whitespace-nowrap px-5 py-3 font-medium">{a.actor}</td>
                      <td className="px-5 py-3 font-mono text-[12px]">{a.action}</td>
                      <td className="max-w-56 truncate px-5 py-3 text-ink-2">{a.target}</td>
                      <td className="whitespace-nowrap px-5 py-3 text-ink-2">{a.workspace}</td>
                      <td className="tnum px-5 py-3 text-ink-3">{a.ip}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </PageBody>

      <ConfirmDialog
        open={!!statusTarget}
        onClose={() => setStatusTarget(null)}
        onConfirm={async () => {
          if (statusTarget) {
            await adminService.setProviderStatus(statusTarget.provider.provider, statusTarget.status);
            setProviders(await adminService.providers());
            toast({
              title: `${PROVIDERS[statusTarget.provider.provider].name} ${statusTarget.status === "disabled" ? "disabled" : "enabled"}`,
              description: statusTarget.status === "disabled" ? "Its queue is paused and users see a clear notice." : "Queue resumed.",
              variant: "info",
            });
          }
          setStatusTarget(null);
        }}
        title={`${statusTarget?.status === "disabled" ? "Disable" : "Enable"} ${statusTarget ? PROVIDERS[statusTarget.provider.provider].name : ""}?`}
        body={
          statusTarget?.status === "disabled"
            ? "All publishing to this provider pauses. Scheduled content holds safely; users see an honest notice instead of silent failures."
            : "Jobs for this provider resume from the queue. Nothing is re-published — idempotency keys are re-verified first."
        }
        confirmLabel={statusTarget?.status === "disabled" ? "Disable provider" : "Enable provider"}
        danger={statusTarget?.status === "disabled"}
      />

      <p className="mt-4 flex items-center gap-1.5 text-[12px] text-ink-3">
        <Webhook className="size-3.5" />
        Secrets are encrypted (AES-256-GCM) and masked everywhere in this UI. Credential changes are audit-logged.
      </p>

      <ConfirmDialog
        open={!!deleteCredTarget}
        onClose={() => setDeleteCredTarget(null)}
        onConfirm={async () => {
          if (deleteCredTarget) {
            await adminService.deleteProviderCredentials(deleteCredTarget.provider);
            setCredGroups(await adminService.providerCredentials());
            toast({
              title: `${PROVIDERS[deleteCredTarget.provider].name} credentials removed`,
              description: "New connections for this network are paused until credentials are added again.",
              variant: "info",
            });
          }
          setDeleteCredTarget(null);
        }}
        title={`Remove ${deleteCredTarget ? PROVIDERS[deleteCredTarget.provider].name : ""} credentials?`}
        body="Existing connected accounts keep working until their tokens expire, but new connections will fail until credentials are added again."
        confirmLabel="Remove credentials"
        danger
      />
    </div>
  );
}
