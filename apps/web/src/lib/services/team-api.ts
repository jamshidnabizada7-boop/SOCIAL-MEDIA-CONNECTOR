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

export async function fetchTeamMembers(): Promise<User[]> {
  const res = await apiGet<{ members: ApiTeamMember[] }>("/v1/workspaces/current/team");
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

export async function inviteMember(email: string, role: User["role"]): Promise<User[]> {
  await apiPost("/v1/workspaces/current/members", { email, role });
  return fetchTeamMembers();
}

export async function changeMemberRole(id: string, role: User["role"]): Promise<void> {
  await apiPatch(`/v1/workspaces/current/members/${id}`, { role });
}

export async function removeMember(id: string): Promise<void> {
  await apiDelete(`/v1/workspaces/current/members/${id}`);
}
