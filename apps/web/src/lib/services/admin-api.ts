"use client";

/**
 * API-backed admin service. One overview endpoint feeds providers, jobs,
 * DLQ, webhooks, flags and audit — all from real database state.
 */

import type {
  AdminJob,
  AdminProvider,
  AuditEntry,
  FeatureFlag,
  ProviderCredentialGroup,
  ProviderStatus,
  WebhookEvent,
} from "@/lib/types";
import type { AdminService } from "@/lib/services/admin";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api/client";

interface OverviewResponse {
  providers: Array<{
    provider: string;
    name?: string;
    status: ProviderStatus;
    apiVersion: string | null;
    approval: string | null;
    verifiedAt?: string | null;
    errorRate7d: number;
    lastSuccessfulPublish: string | null;
    circuitOpen: boolean;
    consecutiveFailures: number;
  }>;
  jobs: AdminJob[];
  dlq: AdminJob[];
  webhooks: WebhookEvent[];
  flags: FeatureFlag[];
  audit: AuditEntry[];
}

export class ApiAdminService implements AdminService {
  private cache: OverviewResponse | null = null;
  private listeners = new Set<() => void>();

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit(): void {
    this.listeners.forEach((fn) => fn());
  }

  private async refresh(): Promise<OverviewResponse> {
    const res = await apiGet<OverviewResponse>("/v1/admin/overview");
    this.cache = res;
    this.emit();
    return res;
  }

  private async overview(): Promise<OverviewResponse> {
    if (!this.cache) await this.refresh();
    return this.cache!;
  }

  async providers(): Promise<AdminProvider[]> {
    const data = await this.overview();
    return data.providers.map((p) => ({
      provider: p.provider as AdminProvider["provider"],
      status: p.status,
      apiVersion: p.apiVersion ?? "",
      approval: (p.approval as AdminProvider["approval"]) ?? "approved",
      errorRate7d: p.errorRate7d,
      lastSuccessfulPublish: p.lastSuccessfulPublish ?? undefined,
      rateLimitHealth: "normal",
    }));
  }

  async setProviderStatus(provider: AdminProvider["provider"], status: ProviderStatus): Promise<void> {
    await apiPost(`/v1/admin/providers/${provider}/status`, { status });
    await this.refresh();
  }

  async jobs(): Promise<AdminJob[]> {
    return (await this.overview()).jobs;
  }

  async deadLetters(): Promise<AdminJob[]> {
    return (await this.overview()).dlq;
  }

  async replayDeadLetter(id: string): Promise<void> {
    await apiPost(`/v1/admin/jobs/${id}/replay`);
    await this.refresh();
  }

  async discardDeadLetter(id: string): Promise<void> {
    await apiPost(`/v1/admin/jobs/${id}/discard`);
    await this.refresh();
  }

  async webhookEvents(): Promise<WebhookEvent[]> {
    return (await this.overview()).webhooks;
  }

  async flags(): Promise<FeatureFlag[]> {
    return (await this.overview()).flags;
  }

  async setFlag(key: string, enabled: boolean): Promise<void> {
    await apiPost(`/v1/admin/flags/${key}`, { enabled });
    await this.refresh();
  }

  async auditLog(): Promise<AuditEntry[]> {
    const data = await this.overview();
    return data.audit.map((a) => ({
      id: a.id,
      at: a.at,
      actor: a.actor,
      action: a.action,
      target: a.target,
      workspace: "—",
      ip: a.ip ?? "—",
    }));
  }

  async providerCredentials(): Promise<ProviderCredentialGroup[]> {
    const res = await apiGet<{ groups: ProviderCredentialGroup[] }>("/v1/admin/provider-credentials");
    return res.groups;
  }

  async setProviderCredentials(
    provider: ProviderCredentialGroup["provider"],
    clientId: string,
    clientSecret: string
  ): Promise<void> {
    await apiPut(`/v1/admin/provider-credentials/${provider}`, { clientId, clientSecret });
  }

  async deleteProviderCredentials(provider: ProviderCredentialGroup["provider"]): Promise<void> {
    await apiDelete(`/v1/admin/provider-credentials/${provider}`);
  }
}
