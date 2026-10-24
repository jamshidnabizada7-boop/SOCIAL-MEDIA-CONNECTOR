"use client";

/**
 * API-backed team support for the workspace service in api mode: members,
 * invites and role changes against /v1/workspaces/current/team + members.
 */

import type { User } from "@/lib/types";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api/client";

export interface ApiTeamMember {
  userId: string;
  email: string;
  name: string;
  avatarHue?: number;
  role: string;
  memberStatus: string;
  lastActiveAt?: string | null;
}

/** Active members plus pending invitations (status "invited", id = invitation id). */
export async function fetchTeamMembers(): Promise<User[]> {
  const res = await apiGet<{ members: ApiTeamMember[] }>("/v1/workspaces/current/members");
  return res.members.map((m) => ({
    id: m.userId,
    name: m.name,
    email: m.email,
    avatarHue: m.avatarHue ?? 200,
    role: m.role as User["role"],
    lastActiveAt: m.lastActiveAt ?? new Date().toISOString(),
    status: (m.memberStatus === "invited" ? "invited" : "active") as User["status"],
  }));
}

export interface InviteResult {
  members: User[];
  emailSent: boolean;
  /** Present when email delivery isn't configured — share it with the invitee directly. */
  inviteUrl?: string;
}

export async function inviteMember(email: string, role: User["role"]): Promise<InviteResult> {
  const res = await apiPost<{ emailSent: boolean; inviteUrl?: string }>("/v1/workspaces/current/members", { email, role });
  return { members: await fetchTeamMembers(), emailSent: res.emailSent, inviteUrl: res.inviteUrl };
}

export async function changeMemberRole(id: string, role: User["role"]): Promise<void> {
  await apiPatch(`/v1/workspaces/current/members/${id}`, { role });
}

export async function removeMember(id: string): Promise<void> {
  await apiDelete(`/v1/workspaces/current/members/${id}`);
}

export async function transferOwnership(userId: string): Promise<void> {
  await apiPost("/v1/workspaces/current/transfer-ownership", { userId });
}
