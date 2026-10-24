import type { AdminJob, AdminProvider, AuditEntry, FeatureFlag, ProviderCredentialGroup, ProviderStatus, WebhookEvent } from "../types";
import { ADMIN_JOBS, ADMIN_PROVIDERS, AUDIT_LOG, DLQ, FEATURE_FLAGS, WEBHOOK_EVENTS } from "../mock/data";
import { DATA_MODE } from "@/lib/api/client";
import { ApiAdminService } from "@/lib/services/admin-api";
import { Notifier, latency, loadPersisted, persistDebounced } from "./core";

export interface AdminService {
  subscribe(fn: () => void): () => void;
  providers(): Promise<AdminProvider[]>;
  setProviderStatus(provider: AdminProvider["provider"], status: ProviderStatus): Promise<void>;
  jobs(): Promise<AdminJob[]>;
  deadLetters(): Promise<AdminJob[]>;
  replayDeadLetter(id: string): Promise<void>;
  discardDeadLetter(id: string): Promise<void>;
  webhookEvents(): Promise<WebhookEvent[]>;
  flags(): Promise<FeatureFlag[]>;
  setFlag(key: string, enabled: boolean): Promise<void>;
  auditLog(): Promise<AuditEntry[]>;
  providerCredentials(): Promise<ProviderCredentialGroup[]>;
  setProviderCredentials(provider: ProviderCredentialGroup["provider"], clientId: string, clientSecret: string): Promise<void>;
  deleteProviderCredentials(provider: ProviderCredentialGroup["provider"]): Promise<void>;
}

/**
 * Internal administration. Sensitive operations (provider credential changes,
 * token inspection) are intentionally not exposed here even in mock form —
 * the real admin UI must never surface provider secrets.
 */
class MockAdminService implements AdminService {
  private notifier = new Notifier();
  private providersList: AdminProvider[] = ADMIN_PROVIDERS.map((p) => ({ ...p }));
  private jobsList: AdminJob[] = ADMIN_JOBS.map((j) => ({ ...j }));
  private dlqList: AdminJob[] = DLQ.map((j) => ({ ...j }));
  private flagsList: FeatureFlag[] = FEATURE_FLAGS.map((f) => ({ ...f }));
  private webhooksList: WebhookEvent[] = WEBHOOK_EVENTS.map((w) => ({ ...w }));
  private auditList: AuditEntry[] = AUDIT_LOG.map((a) => ({ ...a }));

  constructor() {
    const saved = loadPersisted<Partial<{ flags: FeatureFlag[]; providers: AdminProvider[]; dlq: AdminJob[] }>>("admin");
    if (saved?.flags) this.flagsList = saved.flags;
    if (saved?.providers) this.providersList = saved.providers;
    if (saved?.dlq) this.dlqList = saved.dlq;
    this.notifier.subscribe(() =>
      persistDebounced("admin", () => ({ flags: this.flagsList, providers: this.providersList, dlq: this.dlqList }))
    );
  }

  subscribe(fn: () => void) {
    return this.notifier.subscribe(fn);
  }

  async providers(): Promise<AdminProvider[]> {
    await latency("normal");
    return this.providersList;
  }

  async setProviderStatus(provider: AdminProvider["provider"], status: ProviderStatus): Promise<void> {
    await latency("fast");
    this.providersList = this.providersList.map((p) => (p.provider === provider ? { ...p, status } : p));
    this.notifier.emit();
  }

  async jobs(): Promise<AdminJob[]> {
    await latency("normal");
    return this.jobsList;
  }

  async deadLetters(): Promise<AdminJob[]> {
    await latency("normal");
    return this.dlqList;
  }

  async replayDeadLetter(id: string): Promise<void> {
    await latency("fast");
    this.dlqList = this.dlqList.filter((j) => j.id !== id);
    this.notifier.emit();
  }

  async discardDeadLetter(id: string): Promise<void> {
    await latency("fast");
    this.dlqList = this.dlqList.filter((j) => j.id !== id);
    this.notifier.emit();
  }

  async webhookEvents(): Promise<WebhookEvent[]> {
    await latency("normal");
    return this.webhooksList;
  }

  async flags(): Promise<FeatureFlag[]> {
    await latency("normal");
    return this.flagsList;
  }

  async setFlag(key: string, enabled: boolean): Promise<void> {
    await latency("fast");
    this.flagsList = this.flagsList.map((f) => (f.key === key ? { ...f, enabled } : f));
    this.notifier.emit();
  }

  async auditLog(): Promise<AuditEntry[]> {
    await latency("normal");
    return this.auditList;
  }

  async providerCredentials(): Promise<ProviderCredentialGroup[]> {
    await latency("normal");
    return [
      { provider: "facebook", covers: ["facebook", "instagram"], configured: true, source: "env", clientIdMasked: "1234…abcd", secretMasked: "••••••••", redirectUri: "https://app.ariahub.test/v1/oauth/callback/facebook" },
      { provider: "threads", covers: ["threads"], configured: true, source: "env", clientIdMasked: "5678…efgh", secretMasked: "••••••••", redirectUri: "https://app.ariahub.test/v1/oauth/callback/threads" },
      { provider: "linkedin", covers: ["linkedin"], configured: false, source: null, clientIdMasked: null, secretMasked: null, redirectUri: "https://app.ariahub.test/v1/oauth/callback/linkedin" },
      { provider: "tiktok", covers: ["tiktok"], configured: false, source: null, clientIdMasked: null, secretMasked: null, redirectUri: "https://app.ariahub.test/v1/oauth/callback/tiktok" },
      { provider: "youtube", covers: ["youtube"], configured: false, source: null, clientIdMasked: null, secretMasked: null, redirectUri: "https://app.ariahub.test/v1/oauth/callback/youtube" },
      { provider: "x", covers: ["x"], configured: false, source: null, clientIdMasked: null, secretMasked: null, redirectUri: "https://app.ariahub.test/v1/oauth/callback/x" },
      { provider: "pinterest", covers: ["pinterest"], configured: false, source: null, clientIdMasked: null, secretMasked: null, redirectUri: "https://app.ariahub.test/v1/oauth/callback/pinterest" },
    ];
  }

  async setProviderCredentials(): Promise<void> {
    await latency("fast");
  }

  async deleteProviderCredentials(): Promise<void> {
    await latency("fast");
  }
}

export const adminService: AdminService =
  DATA_MODE === "api" ? new ApiAdminService() : new MockAdminService();
