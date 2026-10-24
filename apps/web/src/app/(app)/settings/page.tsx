"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Save, Trash2 } from "lucide-react";
import { workspaceService } from "@/lib/services/workspace";
import { resetMockStore } from "@/lib/services/core";
import { useSubscribe } from "@/lib/services/hooks";
import { useSession, useToast } from "@/components/providers";
import { PageHeader, PageBody } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Avatar, Card, CardHeader, Field, Input, Select, Skeleton, Tabs } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type Tab = "general" | "profile" | "notifications" | "danger";

const TIMEZONES = ["Europe/Berlin", "Europe/London", "America/New_York", "America/Los_Angeles", "Asia/Tokyo", "Australia/Sydney", "UTC"];
const LANGUAGES = [
  { id: "en", label: "English" },
  { id: "de", label: "Deutsch" },
  { id: "fr", label: "Français" },
  { id: "es", label: "Español" },
  { id: "ar", label: "العربية (RTL)" },
  { id: "ja", label: "日本語" },
];

function SettingsInner() {
  useSubscribe(workspaceService);
  const params = useSearchParams();
  const { session, refresh, signOut } = useSession();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>((params.get("tab") as Tab) || "general");
  const [name, setName] = useState(session?.workspace.name ?? "");
  const [timezone, setTimezone] = useState(session?.workspace.timezone ?? "Europe/Berlin");
  const [locale, setLocale] = useState(session?.workspace.locale ?? "en");
  const [profileName, setProfileName] = useState(session?.user.name ?? "");
  const [savingWs, setSavingWs] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [notify, setNotify] = useState({
    failures: true,
    reauth: true,
    successes: false,
    weekly: true,
    product: false,
  });

  useEffect(() => {
    if (session) {
      setName(session.workspace.name);
      setTimezone(session.workspace.timezone);
      setLocale(session.workspace.locale);
      setProfileName(session.user.name);
    }
  }, [session]);

  if (!session) return null;

  const dirtyWs = name !== session.workspace.name || timezone !== session.workspace.timezone || locale !== session.workspace.locale;

  const saveWorkspace = async () => {
    setSavingWs(true);
    await workspaceService.updateWorkspace(session.workspace.id, { name, timezone, locale });
    refresh();
    setSavingWs(false);
    toast({ title: "Workspace settings saved", variant: "success" });
  };

  return (
    <div>
      <PageHeader title="Settings" description="Workspace, profile and notification preferences." />
      <PageBody>
        <div className="mb-5">
          <Tabs
            value={tab}
            onChange={setTab}
            options={[
              { value: "general", label: "Workspace" },
              { value: "profile", label: "Your profile" },
              { value: "notifications", label: "Notifications" },
              { value: "danger", label: "Danger zone" },
            ]}
          />
        </div>

        {tab === "general" && (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
            <Card>
              <CardHeader title="Workspace" description="Applies to everyone in this workspace." />
              <div className="flex flex-col gap-4 p-5">
                <Field label="Workspace name" htmlFor="ws-name">
                  <Input id="ws-name" value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
                <Field
                  label="Time zone"
                  htmlFor="ws-tz"
                  hint="Scheduling happens in UTC and is displayed in this zone — DST-safe."
                >
                  <Select id="ws-tz" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                    {TIMEZONES.map((tz) => (
                      <option key={tz} value={tz}>{tz}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Interface language" htmlFor="ws-locale" hint="Content can be written in any language independently.">
                  <Select id="ws-locale" value={locale} onChange={(e) => setLocale(e.target.value)}>
                    {LANGUAGES.map((l) => (
                      <option key={l.id} value={l.id}>{l.label}</option>
                    ))}
                  </Select>
                </Field>
                <div className="flex items-center justify-between border-t pt-4">
                  <p className={cn("text-[13px]", dirtyWs ? "font-medium text-warn-ink" : "text-ink-3")}>
                    {dirtyWs ? "You have unsaved changes" : "All changes saved"}
                  </p>
                  <Button onClick={saveWorkspace} loading={savingWs} disabled={!dirtyWs}>
                    <Save className="size-4" /> Save changes
                  </Button>
                </div>
              </div>
            </Card>
            <Card>
              <CardHeader title="Brands" description={`${session.workspace.brands.length} in this workspace.`} />
              <ul className="divide-y">
                {session.workspace.brands.map((b) => (
                  <li key={b.id} className="flex items-center gap-3 px-5 py-3.5">
                    <span className="size-8 rounded-lg" style={{ background: `linear-gradient(135deg, hsl(${b.hue} 50% 55%), hsl(${(b.hue + 40) % 360} 55% 40%))` }} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{b.name}</p>
                      {b.description && <p className="truncate text-[12px] text-ink-3">{b.description}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        )}

        {tab === "profile" && (
          <Card className="max-w-xl">
            <CardHeader title="Your profile" description="How teammates see you." />
            <div className="flex flex-col gap-4 p-5">
              <div className="flex items-center gap-4">
                <Avatar name={profileName || "You"} hue={session.user.avatarHue} size="lg" />
                <div>
                  <Button variant="secondary" size="sm" onClick={() => toast({ title: "Avatar upload is mocked in this prototype", variant: "info" })}>
                    Change avatar
                  </Button>
                  <p className="mt-1 text-[12px] text-ink-3">PNG or JPG, square works best.</p>
                </div>
              </div>
              <Field label="Full name" htmlFor="p-name">
                <Input id="p-name" value={profileName} onChange={(e) => setProfileName(e.target.value)} />
              </Field>
              <Field label="Email" htmlFor="p-email" hint="Used for sign-in and notifications.">
                <Input id="p-email" value={session.user.email} disabled />
              </Field>
              <Field label="Role" htmlFor="p-role">
                <Input id="p-role" value={`${session.user.role} · ${session.workspace.name}`} disabled />
              </Field>
              <div className="flex items-center justify-between border-t pt-4">
                <p className={cn("text-[13px]", profileName !== session.user.name ? "font-medium text-warn-ink" : "text-ink-3")}>
                  {profileName !== session.user.name ? "You have unsaved changes" : "All changes saved"}
                </p>
                <Button
                  loading={savingProfile}
                  disabled={profileName === session.user.name}
                  onClick={async () => {
                    setSavingProfile(true);
                    await new Promise((r) => setTimeout(r, 600));
                    setSavingProfile(false);
                    toast({ title: "Profile updated", variant: "success" });
                  }}
                >
                  <Save className="size-4" /> Save changes
                </Button>
              </div>
            </div>
          </Card>
        )}

        {tab === "notifications" && (
          <Card className="max-w-xl">
            <CardHeader title="Notifications" description="We notify you about things that need action — not routine successes." />
            <ul className="divide-y">
              {[
                { key: "failures" as const, title: "Failed or paused deliveries", body: "When a destination fails or needs your action." },
                { key: "reauth" as const, title: "Connection problems", body: "Revoked access, expiring tokens, permission changes." },
                { key: "successes" as const, title: "Successful publishes", body: "Off by default — success shouldn't be noisy." },
                { key: "weekly" as const, title: "Weekly digest", body: "A Monday summary of performance and upcoming posts." },
                { key: "product" as const, title: "Product updates", body: "Occasional notes about new capabilities." },
              ].map((row) => (
                <li key={row.key} className="flex items-center justify-between gap-4 px-5 py-4">
                  <div>
                    <p className="text-sm font-semibold">{row.title}</p>
                    <p className="text-[13px] text-ink-2">{row.body}</p>
                  </div>
                  <SwitchSimple
                    checked={notify[row.key]}
                    onChange={(v) => {
                      setNotify((n) => ({ ...n, [row.key]: v }));
                    }}
                  />
                </li>
              ))}
            </ul>
          </Card>
        )}

        {tab === "danger" && (
          <Card className="max-w-xl border-danger/30">
            <CardHeader title="Danger zone" description="Irreversible actions. Take a breath." />
            <div className="flex flex-col gap-4 p-5">
              <div className="rounded-lg border border-danger/25 p-4">
                <p className="text-sm font-semibold">Delete this workspace</p>
                <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
                  Removes all posts, drafts, media and connected account tokens for{" "}
                  <span className="font-semibold">{session.workspace.name}</span>. Published content at the
                  networks is not deleted. Type the workspace name to confirm.
                </p>
                <div className="mt-3 flex gap-2">
                  <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder={session.workspace.name} aria-label="Type workspace name to confirm" />
                  <Button
                    variant="danger"
                    disabled={confirmText !== session.workspace.name}
                    onClick={() => setDeleteOpen(true)}
                  >
                    <Trash2 className="size-4" /> Delete
                  </Button>
                </div>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-sm font-semibold">Reset demo data</p>
                <p className="mt-1 text-[13px] text-ink-2">
                  Restores the original mock workspace — posts, accounts, media and notifications
                  created while exploring are discarded.
                </p>
                <Button
                  variant="secondary"
                  className="mt-3"
                  onClick={() => {
                    resetMockStore();
                    window.location.href = "/dashboard";
                  }}
                >
                  Reset prototype data
                </Button>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-sm font-semibold">Export your data</p>
                <p className="mt-1 text-[13px] text-ink-2">Posts, media metadata and analytics as CSV + JSON.</p>
                <Button variant="secondary" className="mt-3" onClick={() => toast({ title: "Export queued", description: "You'll get an email when it's ready.", variant: "info" })}>
                  Request export
                </Button>
              </div>
            </div>
          </Card>
        )}
      </PageBody>

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => {
          setDeleteOpen(false);
          signOut();
          toast({ title: "Workspace deleted (simulated)", description: "In production this would be a scheduled deletion with a grace period.", variant: "warning" });
          window.location.href = "/";
        }}
        title="Really delete this workspace?"
        body="This cannot be undone. All tokens, drafts, schedules and media references are removed."
        confirmLabel="Delete workspace"
        danger
      />
    </div>
  );
}

function SwitchSimple({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-5.5 w-9.5 shrink-0 rounded-full border transition-colors",
        checked ? "border-accent bg-accent" : "border-line-strong bg-surface-2"
      )}
    >
      <span className={cn("absolute top-1/2 size-4 -translate-y-1/2 rounded-full bg-white shadow-sm transition-all dark:bg-ink", checked ? "left-[calc(100%-1.125rem)]" : "left-0.5")} />
    </button>
  );
}

export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <div>
          <PageHeader title="Settings" />
          <PageBody>
            <Skeleton className="h-80 rounded-xl" />
          </PageBody>
        </div>
      }
    >
      <SettingsInner />
    </Suspense>
  );
}
