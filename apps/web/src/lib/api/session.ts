"use client";

import { apiGet, apiPost } from "./client";

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
