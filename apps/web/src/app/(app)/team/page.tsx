"use client";

import { useEffect, useState } from "react";
import { Mail, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import type { Role, User } from "@/lib/types";
import { workspaceService } from "@/lib/services/workspace";
import { DATA_MODE } from "@/lib/api/client";
import { fetchTeamMembers, inviteMember, changeMemberRole, removeMember as apiRemoveMember } from "@/lib/services/team-api";
import { useSubscribe } from "@/lib/services/hooks";
import { useSession, useToast } from "@/components/providers";
import { PageHeader, PageBody } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Avatar, Card, CardHeader, Field, Input, Select, Skeleton } from "@/components/ui/primitives";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { cn, timeAgo } from "@/lib/utils";

const ROLES: { id: Role; label: string; blurb: string }[] = [
  { id: "owner", label: "Owner", blurb: "Full control including billing and workspace deletion." },
  { id: "admin", label: "Admin", blurb: "Everything except billing and deletion." },
  { id: "manager", label: "Manager", blurb: "Publishes, schedules and manages content and accounts." },
  { id: "editor", label: "Editor", blurb: "Creates and edits content; publishes only what they create." },
  { id: "approver", label: "Approver", blurb: "Reviews and approves scheduled content." },
  { id: "viewer", label: "Viewer", blurb: "Read-only access to content and analytics." },
];

const PERMISSIONS: { label: string; roles: Record<Role, boolean> }[] = [
  { label: "Connect / disconnect accounts", roles: { owner: true, admin: true, manager: true, editor: false, approver: false, viewer: false } },
  { label: "Create posts", roles: { owner: true, admin: true, manager: true, editor: true, approver: false, viewer: false } },
  { label: "Publish & schedule", roles: { owner: true, admin: true, manager: true, editor: false, approver: false, viewer: false } },
  { label: "Approve posts", roles: { owner: true, admin: true, manager: true, editor: false, approver: true, viewer: false } },
  { label: "View analytics", roles: { owner: true, admin: true, manager: true, editor: true, approver: true, viewer: true } },
  { label: "Manage team", roles: { owner: true, admin: true, manager: false, editor: false, approver: false, viewer: false } },
  { label: "Manage billing", roles: { owner: true, admin: false, manager: false, editor: false, approver: false, viewer: false } },
];

export default function TeamPage() {
  useSubscribe(workspaceService);
  const { session } = useSession();
  const toast = useToast();
  const [loaded, setLoaded] = useState(false);
  const [members, setMembers] = useState<User[]>([]);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("editor");
  const [removeTarget, setRemoveTarget] = useState<User | null>(null);
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string>();

  useEffect(() => {
    const load = async () => {
      const list = await workspaceService.membersAsync?.();
      setMembers(list ?? workspaceService.members());
      setLoaded(true);
    };
    void load();
  }, []);

  const invite = async () => {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(inviteEmail)) {
      setInviteError("Enter a valid email address.");
      return;
    }
    setInviteError(undefined);
    setInviting(true);
    if (DATA_MODE === "api") {
      try {
        const list = await inviteMember(inviteEmail, inviteRole);
        setMembers(list);
      } catch (err) {
        setInviting(false);
        setInviteError((err as Error).message);
        return;
      }
    } else {
      await workspaceService.invite(inviteEmail, inviteRole);
      setMembers(workspaceService.members());
    }
    setInviting(false);
    setInviteOpen(false);
    setInviteEmail("");
    toast({ title: "Invitation sent", description: `${inviteEmail} will appear here once they accept.`, variant: "success" });
  };

  if (!loaded) {
    return (
      <div>
        <PageHeader title="Team" />
        <PageBody className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </PageBody>
      </div>
    );
  }

  const pending = members.filter((m) => m.status === "invited");
  const active = members.filter((m) => m.status !== "invited");

  return (
    <div>
      <PageHeader
        title="Team"
        description="People in this workspace and what they're allowed to do."
        actions={
          <Button onClick={() => setInviteOpen(true)}>
            <UserPlus className="size-4" /> Invite member
          </Button>
        }
      />
      <PageBody className="space-y-5">
        <Card>
          <CardHeader title="Members" description={`${active.length} active${pending.length ? ` · ${pending.length} pending` : ""}`} />
          <ul className="divide-y">
            {active.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <Avatar name={m.name} hue={m.avatarHue} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">
                    {m.name}
                    {session?.user.id === m.id && <span className="ml-2 text-[12px] font-normal text-ink-3">you</span>}
                  </p>
                  <p className="truncate text-[13px] text-ink-3">{m.email}</p>
                </div>
                <span className="hidden text-[12px] text-ink-3 sm:block">active {timeAgo(m.lastActiveAt)}</span>
                <Select
                  value={m.role}
                  onChange={async (e) => {
                    const role = e.target.value as Role;
                    if (DATA_MODE === "api") {
                      await changeMemberRole(m.id, role);
                      setMembers(await fetchTeamMembers());
                    } else {
                      await workspaceService.updateMemberRole(m.id, role);
                      setMembers(workspaceService.members());
                    }
                    toast({ title: `${m.name} is now ${role}`, variant: "success" });
                  }}
                  disabled={m.role === "owner"}
                  className="w-32 text-[13px]"
                  aria-label={`Role for ${m.name}`}
                >
                  {ROLES.map((r) => (
                    <option key={r.id} value={r.id} disabled={r.id === "owner" && m.role !== "owner"}>
                      {r.label}
                    </option>
                  ))}
                </Select>
                {m.role !== "owner" && (
                  <button
                    onClick={() => setRemoveTarget(m)}
                    className="rounded-lg p-2 text-ink-3 transition-colors hover:bg-danger-soft hover:text-danger"
                    aria-label={`Remove ${m.name}`}
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {pending.length > 0 && (
            <>
              <div className="border-t bg-surface-2 px-5 py-2">
                <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-3">Pending invitations</p>
              </div>
              <ul className="divide-y border-t-0">
                {pending.map((m) => (
                  <li key={m.id} className="flex items-center gap-3 px-5 py-3">
                    <Avatar name={m.name} hue={m.avatarHue} size="md" className="opacity-60" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{m.name}</p>
                      <p className="truncate text-[13px] text-ink-3">{m.email}</p>
                    </div>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-warn-soft px-2.5 py-1 text-[12px] font-medium text-warn-ink">
                      <Mail className="size-3.5" /> Invited · not yet accepted
                    </span>
                    <span className="w-32 text-center text-[13px] capitalize text-ink-2">{m.role}</span>
                    <button
                      onClick={async () => {
                        if (DATA_MODE === "api") {
                          await apiRemoveMember(m.id);
                          setMembers(await fetchTeamMembers());
                        } else {
                          await workspaceService.removeMember(m.id);
                          setMembers(workspaceService.members());
                        }
                        toast({ title: "Invitation withdrawn", variant: "info" });
                      }}
                      className="rounded-lg p-2 text-ink-3 hover:bg-danger-soft hover:text-danger"
                      aria-label={`Withdraw invite for ${m.email}`}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Roles" description="What each role can do, in one line." />
            <ul className="divide-y">
              {ROLES.map((r) => (
                <li key={r.id} className="flex items-baseline gap-3 px-5 py-3">
                  <span className="w-20 shrink-0 text-[13px] font-semibold">{r.label}</span>
                  <span className="text-[13px] leading-relaxed text-ink-2">{r.blurb}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Permission matrix" description="Checked = allowed." />
            <div className="overflow-x-auto p-2">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr>
                    <th className="px-2 py-1.5 text-left font-medium text-ink-3">Permission</th>
                    {ROLES.map((r) => (
                      <th key={r.id} className="px-1 py-1.5 text-center font-medium text-ink-3">{r.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {PERMISSIONS.map((perm) => (
                    <tr key={perm.label} className="border-t">
                      <td className="px-2 py-2 font-medium">{perm.label}</td>
                      {ROLES.map((r) => (
                        <td key={r.id} className="px-1 py-2 text-center">
                          {perm.roles[r.id] ? (
                            <ShieldCheck className="mx-auto size-4 text-success" aria-label="Allowed" />
                          ) : (
                            <span className="mx-auto block size-2 rounded-full bg-surface-2 border border-line" aria-label="Not allowed" />
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </PageBody>

      <Dialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Invite a teammate"
        description="They'll get an email invitation to join this workspace."
        footer={
          <>
            <Button variant="secondary" onClick={() => setInviteOpen(false)}>Cancel</Button>
            <Button onClick={invite} loading={inviting}>Send invitation</Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Email" htmlFor="inv-email" error={inviteError}>
            <Input
              id="inv-email"
              type="email"
              placeholder="teammate@company.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              aria-invalid={!!inviteError}
            />
          </Field>
          <Field label="Role" htmlFor="inv-role" hint={ROLES.find((r) => r.id === inviteRole)?.blurb}>
            <Select id="inv-role" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as Role)}>
              {ROLES.filter((r) => r.id !== "owner").map((r) => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </Select>
          </Field>
        </div>
      </Dialog>

      <ConfirmDialog
        open={!!removeTarget}
        onClose={() => setRemoveTarget(null)}
        onConfirm={async () => {
          if (removeTarget) {
            if (DATA_MODE === "api") {
              await apiRemoveMember(removeTarget.id);
              setMembers(await fetchTeamMembers());
            } else {
              await workspaceService.removeMember(removeTarget.id);
              setMembers(workspaceService.members());
            }
            toast({ title: `${removeTarget.name} removed`, variant: "info" });
          }
          setRemoveTarget(null);
        }}
        title={`Remove ${removeTarget?.name ?? ""}?`}
        body="They lose access immediately. Content they created stays in the workspace."
        confirmLabel="Remove member"
        danger
      />
    </div>
  );
}
