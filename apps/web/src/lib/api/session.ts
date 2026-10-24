"use client";

import { apiGet, apiPost } from "./client";

export interface ApiUser {
  id: string;
  email: string;
  name: string;
  avatarHue?: number;
  isPlatformAdmin?: boolean;
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
};
