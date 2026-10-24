"use client";

import { API_URL, apiFetch, apiGet, apiPost } from "./client";

export interface NotificationPrefs {
  failures: boolean;
  reauth: boolean;
}

export interface ApiUser {
  id: string;
  email: string;
  name: string;
  avatarHue?: number;
  isPlatformAdmin?: boolean;
  emailVerified?: boolean;
}

export interface ApiWorkspaceSummary {
  workspaceId: string;
  name: string;
  slug: string;
  timezone: string;
  locale: string;
  planId: string;
  role: string;
}

export interface MeResponse {
  user: ApiUser;
  workspaces: ApiWorkspaceSummary[];
}

export const sessionApi = {
  async me(): Promise<MeResponse> {
    return apiGet<MeResponse>("/v1/auth/me");
  },
  async login(email: string, password: string): Promise<ApiUser> {
    const res = await apiPost<{ user: ApiUser }>("/v1/auth/login", { email, password });
    return res.user;
  },
  async register(name: string, email: string, password: string): Promise<ApiUser> {
    const res = await apiPost<{ user: ApiUser }>("/v1/auth/register", { name, email, password });
    return res.user;
  },
  async logout(): Promise<void> {
    await apiPost("/v1/auth/logout");
  },
  async updateProfile(patch: { name?: string; notificationPrefs?: Partial<NotificationPrefs> }): Promise<{ notificationPrefs: NotificationPrefs }> {
    return apiFetch<{ notificationPrefs: NotificationPrefs }>("/v1/auth/me", { method: "PATCH", body: JSON.stringify(patch) });
  },
  async notificationPrefs(): Promise<NotificationPrefs> {
    const res = await apiGet<{ notificationPrefs: NotificationPrefs }>("/v1/auth/me");
    return res.notificationPrefs;
  },
  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await apiPost("/v1/auth/change-password", { currentPassword, newPassword });
  },
  async deleteAccount(password: string): Promise<void> {
    await apiFetch("/v1/auth/me", { method: "DELETE", body: JSON.stringify({ password }) });
  },
  async deleteWorkspace(workspaceId: string): Promise<void> {
    await apiFetch(`/v1/workspaces/${workspaceId}`, { method: "DELETE" });
  },
  /** Downloads the workspace export through the browser (cookie-authenticated). */
  async downloadExport(workspaceId: string): Promise<void> {
    const res = await fetch(`${API_URL}/v1/workspaces/${workspaceId}/export`, { credentials: "include" });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new Error(body.error?.message ?? "Export failed.");
    }
    const blob = await res.blob();
    const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "aria-hub-export.json";
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  },
  async createWorkspace(name: string, timezone: string): Promise<void> {
    await apiPost("/v1/workspaces", { name, timezone });
  },
  async forgotPassword(email: string): Promise<void> {
    await apiPost("/v1/auth/forgot-password", { email });
  },
  async resetPassword(token: string, password: string): Promise<void> {
    await apiPost("/v1/auth/reset-password", { token, password });
  },
  async verifyEmail(token: string): Promise<void> {
    await apiPost("/v1/auth/verify-email", { token });
  },
  async resendVerification(): Promise<void> {
    await apiPost("/v1/auth/resend-verification");
  },
  async invitation(token: string): Promise<InvitationPreview> {
    const res = await apiGet<{ invitation: InvitationPreview }>(`/v1/invitations/${encodeURIComponent(token)}`);
    return res.invitation;
  },
  async acceptInvitation(token: string): Promise<{ workspaceId: string }> {
    return apiPost<{ ok: true; workspaceId: string }>(`/v1/invitations/${encodeURIComponent(token)}/accept`);
  },
};

export interface InvitationPreview {
  email: string;
  role: string;
  workspaceName: string;
  inviterName: string | null;
  expiresAt: string;
}
