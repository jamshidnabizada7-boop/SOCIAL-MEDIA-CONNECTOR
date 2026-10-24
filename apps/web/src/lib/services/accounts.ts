import type { ProviderId, SocialAccount } from "../types";
import { ACCOUNTS } from "../mock/data";
import { DATA_MODE } from "@/lib/api/client";
import { ApiAccountsService } from "@/lib/services/backend";
import { Notifier, latency, loadPersisted, persistDebounced } from "./core";
import { uid } from "../utils";
import { PROVIDERS } from "../providers";

/**
 * Social account connections.
 *
 * Real implementation will own: OAuth authorize/callback, encrypted credential
 * vault, token refresh with single-flight locking, and connection-health checks.
 * The mock implementation simulates all of it client-side.
 */
export interface AccountsService {
  subscribe(fn: () => void): () => void;
  list(): SocialAccount[];
  listAsync(): Promise<SocialAccount[]>;
  get(id: string): SocialAccount | undefined;
  /** Simulates the full OAuth round-trip and returns the new connection. */
  connect(
    provider: ProviderId,
    brandId: string,
    profile?: { displayName?: string; handle?: string }
  ): Promise<SocialAccount>;
  reconnect(id: string): Promise<SocialAccount>;
  disconnect(id: string): Promise<void>;
  refresh(id: string): Promise<SocialAccount>;
}

class MockAccountsService implements AccountsService {
  private notifier = new Notifier();
  private accounts: SocialAccount[] = loadPersisted<SocialAccount[]>("accounts") ?? ACCOUNTS.map((a) => ({ ...a }));

  constructor() {
    this.notifier.subscribe(() => persistDebounced("accounts", () => this.accounts));
  }

  subscribe(fn: () => void) {
    return this.notifier.subscribe(fn);
  }

  list(): SocialAccount[] {
    return this.accounts;
  }

  async listAsync(): Promise<SocialAccount[]> {
    await latency("slow");
    return this.accounts;
  }

  get(id: string): SocialAccount | undefined {
    return this.accounts.find((a) => a.id === id);
  }

  async connect(
    provider: ProviderId,
    brandId: string,
    profile?: { displayName?: string; handle?: string }
  ): Promise<SocialAccount> {
    await latency("slow");
    await new Promise((r) => setTimeout(r, 1200)); // simulated provider authorization
    const base = provider.slice(0, 3);
    const existing = this.accounts.filter((a) => a.provider === provider).length;
    const account: SocialAccount = {
      id: uid("acc"),
      provider,
      brandId,
      displayName: profile?.displayName ?? `New ${PROVIDERS[provider].name} account`,
      handle: profile?.handle ?? `@new${base}${existing > 0 ? existing + 1 : ""}`,
      avatarHue: Math.floor(Math.random() * 360),
      connection: "healthy",
      followers: 800 + Math.floor(Math.random() * 40000),
      connectedAt: new Date().toISOString(),
      lastRefreshedAt: new Date().toISOString(),
      scopes: ["read", "publish"],
    };
    this.accounts = [...this.accounts, account];
    this.notifier.emit();
    return account;
  }

  async reconnect(id: string): Promise<SocialAccount> {
    await new Promise((r) => setTimeout(r, 1400)); // simulated re-auth
    this.accounts = this.accounts.map((a) =>
      a.id === id
        ? { ...a, connection: "healthy", connectionNote: undefined, lastRefreshedAt: new Date().toISOString() }
        : a
    );
    this.notifier.emit();
    return this.accounts.find((a) => a.id === id)!;
  }

  async disconnect(id: string): Promise<void> {
    await latency();
    this.accounts = this.accounts.filter((a) => a.id !== id);
    this.notifier.emit();
  }

  async refresh(id: string): Promise<SocialAccount> {
    await latency("fast");
    this.accounts = this.accounts.map((a) =>
      a.id === id ? { ...a, lastRefreshedAt: new Date().toISOString() } : a
    );
    this.notifier.emit();
    return this.accounts.find((a) => a.id === id)!;
  }
}

export const accountsService: AccountsService =
  DATA_MODE === "api" ? new ApiAccountsService() : new MockAccountsService();
