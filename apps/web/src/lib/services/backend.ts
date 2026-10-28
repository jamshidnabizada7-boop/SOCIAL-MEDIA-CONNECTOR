"use client";

/**
 * API-backed implementations of the UI service interfaces. Selected by
 * NEXT_PUBLIC_DATA_MODE=api (the production default). An explicit "mock"
 * selects the separate offline design demo.
 *
 * Live-updating: services poll on an interval while subscribed; server state
 * is durable, so resumeInFlight is a no-op.
 *
 * Analytics/admin/billing/queue/media have dedicated API services.
 */

import type {
  VariantOverride,
  Brand,
  Invoice,
  Notification,
  Plan,
  Post,
  PublishTarget,
  SocialAccount,
  Subscription,
  Usage,
  User,
  Workspace,
} from "@/lib/types";
import type { NewPostInput, PostsService } from "@/lib/services/posts";
import type { AccountsService } from "@/lib/services/accounts";
import type { NotificationsService } from "@/lib/services/notifications";
import type { WorkspaceService } from "@/lib/services/workspace";
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "@/lib/api/client";

/* ------------------------------- shared ---------------------------------- */

class Poller {
  private listeners = new Set<() => void>();
  private timer?: ReturnType<typeof setInterval>;

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    if (this.listeners.size === 1) {
      this.timer = setInterval(() => {
        void this.tick();
      }, this.intervalMs());
    }
    void this.tick();
    return () => {
      this.listeners.delete(fn);
      if (this.listeners.size === 0 && this.timer) {
        clearInterval(this.timer);
        this.timer = undefined;
      }
    };
  }

  emit(): void {
    this.listeners.forEach((fn) => fn());
  }

  protected async tick(): Promise<void> {}

  protected intervalMs(): number {
    return 3000;
  }
}

/* --------------------------------- Posts --------------------------------- */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** API variant rows use providerId and the worker's setting names. */
interface ApiVariant {
  providerId: string;
  caption?: string | null;
  title?: string | null;
  firstComment?: string | null;
  settings?: Record<string, unknown>;
}

function toApiVariants(variants: VariantOverride[] | undefined): ApiVariant[] {
  return (variants ?? []).map((v) => {
    const { category, ...settings } = v.settings ?? {};
    return {
      providerId: v.provider,
      caption: v.caption ?? null,
      title: v.title ?? null,
      firstComment: v.firstComment ?? null,
      settings: { ...settings, ...(category ? { categoryId: category } : {}) },
    };
  });
}

function fromApiVariants(rows: ApiVariant[] | undefined): VariantOverride[] {
  return (rows ?? []).map((r) => {
    const { categoryId, ...settings } = (r.settings ?? {}) as Record<string, unknown>;
    return {
      provider: r.providerId as VariantOverride["provider"],
      caption: r.caption ?? undefined,
      title: r.title ?? undefined,
      firstComment: r.firstComment ?? undefined,
      settings: { ...(settings as VariantOverride["settings"]), ...(typeof categoryId === "string" ? { category: categoryId } : {}) },
    };
  });
}

interface ApiPostRow {
  id: string;
  title: string;
  caption: string;
  link?: string | null;
  workspaceId: string;
  brandId?: string | null;
  authorId?: string | null;
  authorName?: string | null;
  authorHue?: number | null;
  campaign?: string | null;
  labels?: string[];
  timezone: string;
  state: Post["state"];
  scheduledAt?: string | null;
  publishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  aiDisclosed?: boolean;
  targets: Array<{
    id: string;
    accountId: string;
    providerId: string;
    state: PublishTarget["state"];
    attempts: number;
    idempotencyKey?: string;
    scheduledAt?: string | null;
    publishedAt?: string | null;
    remoteUrl?: string | null;
    lastError?: PublishTarget["lastError"];
  }>;
  mediaIds?: string[];
  versions?: Array<{ version: number; frozenAt: string; caption: string; mediaIds: string[]; byUserId?: string | null }>;
  variants?: ApiVariant[];
}

class PostsPoller extends Poller {
  constructor(private refresh: () => Promise<void>, private emitFn: () => void) {
    super();
  }
  protected async tick() {
    await this.refresh();
    this.emitFn();
  }
  protected intervalMs() {
    return 2500;
  }
}

export class ApiPostsService implements PostsService {
  private cache: Post[] = [];
  private poller = new PostsPoller(
    () => this.refresh(),
    () => this.poller.emit()
  );

  subscribe(fn: () => void): () => void {
    return this.poller.subscribe(fn);
  }

  private mapPost(row: ApiPostRow): Post {
    return {
      id: row.id,
      title: row.title || row.caption.slice(0, 60) || "Untitled post",
      caption: row.caption,
      link: row.link ?? undefined,
      mediaIds: row.mediaIds ?? [],
      state: row.state,
      brandId: row.brandId ?? "",
      authorId: row.authorId ?? "",
      authorName: row.authorName ?? "Workspace member",
      authorHue: row.authorHue ?? 200,
      campaign: row.campaign ?? undefined,
      labels: row.labels ?? [],
      timezone: row.timezone,
      scheduledAt: row.scheduledAt ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      publishedAt: row.publishedAt ?? undefined,
      aiDisclosed: row.aiDisclosed,
      variants: fromApiVariants(row.variants),
      versions:
        row.versions?.map((v) => ({
          version: v.version,
          frozenAt: v.frozenAt,
          caption: v.caption,
          mediaIds: v.mediaIds,
          byUserId: v.byUserId ?? "",
        })) ?? [],
      targets: row.targets.map((t) => ({
        id: t.id,
        accountId: t.accountId,
        provider: t.providerId as Post["targets"][number]["provider"],
        state: t.state,
        attempts: t.attempts,
        idempotencyKey: t.idempotencyKey ?? "",
        scheduledAt: t.scheduledAt ?? undefined,
        publishedAt: t.publishedAt ?? undefined,
        remoteUrl: t.remoteUrl ?? undefined,
        lastError: t.lastError ?? undefined,
      })),
    };
  }

  async refresh(): Promise<void> {
    try {
      const res = await apiGet<{ posts: ApiPostRow[] }>("/v1/workspaces/current/posts");
      const previous = new Map(this.cache.map((p) => [p.id, p]));
      this.cache = res.posts.map((row) => {
        const mapped = this.mapPost(row);
        const detail = previous.get(row.id);
        return {
          ...mapped,
          // The list endpoint omits detail-only history/variants. Polling must
          // retain those while replacing live target state and error/link data.
          versions: row.versions ? mapped.versions : detail?.versions ?? [],
          variants: row.variants ? mapped.variants : detail?.variants ?? [],
        };
      });
    } catch {
      /* keep last good cache on transient errors */
    }
  }

  list(): Post[] {
    return this.cache;
  }

  async listAsync(): Promise<Post[]> {
    await this.refresh();
    return this.cache;
  }

  get(id: string): Post | undefined {
    return this.cache.find((p) => p.id === id);
  }

  async getAsync(id: string): Promise<Post | undefined> {
    return this.getDetail(id);
  }

  async getDetail(id: string): Promise<Post | undefined> {
    try {
      const res = await apiGet<{ post: ApiPostRow }>(`/v1/workspaces/current/posts/${id}`);
      const mapped = this.mapPost(res.post);
      this.cache = [mapped, ...this.cache.filter((p) => p.id !== id)];
      return mapped;
    } catch {
      return undefined;
    }
  }

  async createDraft(input: NewPostInput): Promise<Post> {
    const res = await apiPost<{ post: ApiPostRow }>("/v1/workspaces/current/posts", {
      title: input.title,
      caption: input.caption,
      // An empty link string would fail the API's URL validation.
      link: input.link || undefined,
      // Demo/mock brand ids aren't UUIDs; the API only accepts real ones.
      brandId: input.brandId && UUID_RE.test(input.brandId) ? input.brandId : undefined,
      campaign: input.campaign,
      labels: input.labels ?? [],
      accountIds: input.selectedAccountIds,
      mediaIds: input.mediaIds ?? [],
      variants: toApiVariants(input.variants),
      aiDisclosed: input.aiDisclosed ?? false,
    });
    const mapped = this.mapPost(res.post);
    this.cache = [mapped, ...this.cache];
    return mapped;
  }

  async updateDraft(id: string, patch: Partial<Post> & { selectedAccountIds?: string[] }): Promise<Post> {
    const body: Record<string, unknown> = {};
    if (patch.title !== undefined) body.title = patch.title;
    if (patch.caption !== undefined) body.caption = patch.caption;
    if (patch.link !== undefined) body.link = patch.link || null;
    if (patch.campaign !== undefined) body.campaign = patch.campaign;
    if (patch.labels !== undefined) body.labels = patch.labels;
    if (patch.mediaIds !== undefined) body.mediaIds = patch.mediaIds;
    if (patch.variants !== undefined) body.variants = toApiVariants(patch.variants);
    if (patch.aiDisclosed !== undefined) body.aiDisclosed = patch.aiDisclosed;
    if (patch.selectedAccountIds !== undefined) body.accountIds = patch.selectedAccountIds;
    const res = await apiPatch<{ post: ApiPostRow }>(`/v1/workspaces/current/posts/${id}`, body);
    const mapped = this.mapPost(res.post);
    this.cache = [mapped, ...this.cache.filter((p) => p.id !== id)];
    return mapped;
  }

  async deletePost(id: string): Promise<void> {
    await apiDelete(`/v1/workspaces/current/posts/${id}`);
    this.cache = this.cache.filter((p) => p.id !== id);
  }

  async duplicate(id: string): Promise<Post> {
    const src = await this.getDetail(id);
    if (!src) throw new Error("Post not found");
    return this.createDraft({
      title: `${src.title} (copy)`,
      caption: src.caption,
      link: src.link,
      mediaIds: src.mediaIds,
      selectedAccountIds: src.targets.map((t) => t.accountId),
      brandId: src.brandId,
      campaign: src.campaign,
      labels: src.labels,
      aiDisclosed: src.aiDisclosed,
      variants: src.variants ?? [],
    });
  }

  async publish(id: string): Promise<void> {
    await apiPost(`/v1/workspaces/current/posts/${id}/publish`);
    await this.refresh();
  }

  async schedule(id: string, whenIso: string): Promise<void> {
    await apiPost(`/v1/workspaces/current/posts/${id}/schedule`, { scheduledAt: whenIso });
    await this.refresh();
  }

  async unschedule(id: string): Promise<void> {
    await apiPatch(`/v1/workspaces/current/posts/${id}`, { scheduledAt: null });
    await this.refresh();
  }

  async cancelScheduled(id: string): Promise<void> {
    await apiPost(`/v1/workspaces/current/posts/${id}/cancel`);
    await this.refresh();
  }

  async retryTarget(postId: string, targetId: string): Promise<void> {
    await apiPost(`/v1/workspaces/current/posts/${postId}/targets/${targetId}/retry`);
    await this.refresh();
  }

  async cancelTarget(postId: string): Promise<void> {
    await apiPost(`/v1/workspaces/current/posts/${postId}/cancel`);
    await this.refresh();
  }

  resumeInFlight(): void {
    // Server state is durable — nothing to resume client-side.
  }
}

/* -------------------------------- Accounts -------------------------------- */

interface ApiAccountRow {
  id: string;
  providerId: string;
  brandId?: string | null;
  displayName: string;
  handle: string;
  connection: SocialAccount["connection"];
  connectionNote?: string | null;
  instanceUrl?: string | null;
  followers?: number;
  connectedAt: string;
  lastRefreshedAt?: string | null;
}

class AccountsPoller extends Poller {
  constructor(private refresh: () => Promise<void>, private emitFn: () => void) {
    super();
  }
  protected async tick() {
    await this.refresh();
    this.emitFn();
  }
  protected intervalMs() {
    return 8000;
  }
}

export class ApiAccountsService implements AccountsService {
  private cache: SocialAccount[] = [];
  private poller = new AccountsPoller(
    () => this.refreshCache(),
    () => this.poller.emit()
  );

  subscribe(fn: () => void): () => void {
    return this.poller.subscribe(fn);
  }

  private map(row: ApiAccountRow): SocialAccount {
    return {
      id: row.id,
      provider: row.providerId as SocialAccount["provider"],
      brandId: row.brandId ?? "",
      displayName: row.displayName,
      handle: row.handle,
      avatarHue: Math.floor([...row.id].reduce((a, c) => a + c.charCodeAt(0), 0) % 360),
      connection: row.connection,
      connectionNote: row.connectionNote ?? undefined,
      followers: row.followers ?? 0,
      connectedAt: row.connectedAt,
      lastRefreshedAt: row.lastRefreshedAt ?? row.connectedAt,
      scopes: [],
    };
  }

  async refreshCache(): Promise<void> {
    try {
      const res = await apiGet<{ accounts: ApiAccountRow[] }>("/v1/workspaces/current/accounts");
      this.cache = res.accounts.map((a) => this.map(a));
    } catch {
      /* keep last good cache */
    }
  }

  list(): SocialAccount[] {
    return this.cache;
  }

  async listAsync(): Promise<SocialAccount[]> {
    await this.refreshCache();
    return this.cache;
  }

  get(id: string): SocialAccount | undefined {
    return this.cache.find((a) => a.id === id);
  }

  /**
   * Generic OAuth connect: asks the API for the authorize URL and navigates.
   * Bluesky/Mastodon use their dedicated UI flows — this throws a directed
   * error for them so callers fall back to the form.
   */
  async connect(provider: SocialAccount["provider"]): Promise<SocialAccount> {
    if (provider === "bluesky" || provider === "mastodon") {
      throw new ApiError(400, "use_dedicated_flow", "Use the dedicated connect form for this provider.");
    }
    const res = await apiGet<{ url: string }>(
      `/v1/oauth/${provider}/authorize?workspaceId=current&format=json`
    );
    window.location.href = res.url;
    return new Promise<SocialAccount>(() => {}); // navigation continues the flow
  }

  async reconnect(id: string): Promise<SocialAccount> {
    const account = this.cache.find((a) => a.id === id);
    if (!account) throw new ApiError(404, "not_found", "Account not found. Refresh the page and try again.");
    return this.connect(account.provider);
  }

  async disconnect(id: string): Promise<void> {
    await apiDelete(`/v1/workspaces/current/accounts/${id}`);
    this.cache = this.cache.filter((a) => a.id !== id);
  }

  async refresh(id: string): Promise<SocialAccount> {
    await apiPost(`/v1/workspaces/current/accounts/${id}/refresh`);
    await this.refreshCache();
    return this.cache.find((a) => a.id === id)!;
  }
}

/* ------------------------------ Notifications ------------------------------ */

interface ApiNotificationRow {
  id: string;
  type: string;
  severity: Notification["severity"];
  title: string;
  body: string;
  createdAt: string;
  readAt?: string | null;
  postId?: string | null;
  accountId?: string | null;
}

class NotificationsPoller extends Poller {
  constructor(private refresh: () => Promise<void>, private emitFn: () => void) {
    super();
  }
  protected async tick() {
    await this.refresh();
    this.emitFn();
  }
  protected intervalMs() {
    return 10_000;
  }
}

export class ApiNotificationsService implements NotificationsService {
  private cache: Notification[] = [];
  private poller = new NotificationsPoller(
    () => this.refresh(),
    () => this.poller.emit()
  );

  subscribe(fn: () => void): () => void {
    return this.poller.subscribe(fn);
  }

  private map(n: ApiNotificationRow): Notification {
    return {
      id: n.id,
      type: n.type as Notification["type"],
      severity: n.severity,
      title: n.title,
      body: n.body,
      createdAt: n.createdAt,
      read: !!n.readAt,
      postId: n.postId ?? undefined,
      accountId: n.accountId ?? undefined,
    };
  }

  async refresh(): Promise<void> {
    try {
      const res = await apiGet<{ notifications: ApiNotificationRow[] }>(
        "/v1/workspaces/current/notifications"
      );
      this.cache = res.notifications.map((n) => this.map(n));
    } catch {
      /* keep last good cache */
    }
  }

  list(): Notification[] {
    return this.cache;
  }

  async listAsync(): Promise<Notification[]> {
    await this.refresh();
    return this.cache;
  }

  unreadCount(): number {
    return this.cache.filter((n) => !n.read).length;
  }

  markRead(id: string): void {
    void apiPost(`/v1/workspaces/current/notifications/${id}/read`);
    this.cache = this.cache.map((n) => (n.id === id ? { ...n, read: true } : n));
  }

  markAllRead(): void {
    void apiPost(`/v1/workspaces/current/notifications/read-all`);
    this.cache = this.cache.map((n) => ({ ...n, read: true }));
  }

  remove(_id: string): void {
    // Dismissal is a UI concern; server notifications are audit-linked.
  }

  push(_n: Notification): void {
    // The server pushes via the notifications table.
  }
}

/* ------------------------------- Workspace -------------------------------- */

interface ApiWorkspaceSummary {
  workspaceId: string;
  name: string;
  slug: string;
  timezone: string;
  locale: string;
  planId: string;
  role: string;
}

interface ApiMemberRow {
  userId: string;
  email: string;
  name: string;
  avatarHue?: number;
  role: string;
  memberStatus: string;
  lastActiveAt?: string | null;
  joinedAt?: string | null;
}

export class ApiWorkspaceService implements WorkspaceService {
  private cache: ApiWorkspaceSummary[] = [];
  private notifierListeners = new Set<() => void>();

  subscribe(fn: () => void): () => void {
    this.notifierListeners.add(fn);
    return () => this.notifierListeners.delete(fn);
  }

  private emit() {
    this.notifierListeners.forEach((fn) => fn());
  }

  workspaces(): Workspace[] {
    return this.cache.map((w) => this.mapSummary(w));
  }

  private mapSummary(w: ApiWorkspaceSummary): Workspace {
    return {
      id: w.workspaceId,
      name: w.name,
      timezone: w.timezone,
      locale: w.locale,
      plan: w.planId as Workspace["plan"],
      brands: [],
      createdAt: new Date().toISOString(),
    };
  }

  async refreshWorkspaces(): Promise<Workspace[]> {
    const res = await apiGet<{ workspaces: ApiWorkspaceSummary[] }>("/v1/workspaces");
    this.cache = res.workspaces;
    this.emit();
    return this.workspaces();
  }

  get(id: string): Workspace | undefined {
    return this.workspaces().find((w) => w.id === id);
  }

  async getDetail(id: string): Promise<Workspace | undefined> {
    await this.refreshWorkspaces();
    const summary = this.cache.find((w) => w.workspaceId === id);
    if (!summary) return undefined;
    try {
      const res = await apiGet<{ workspace: Workspace; brands: Brand[] }>(`/v1/workspaces/${id}`);
      return { ...this.mapSummary(summary), brands: res.brands };
    } catch {
      return this.mapSummary(summary);
    }
  }

  async updateWorkspace(id: string, patch: Partial<Pick<Workspace, "name" | "timezone" | "locale">>): Promise<void> {
    await apiPatch(`/v1/workspaces/${id}`, patch);
    await this.refreshWorkspaces();
  }

  async addBrand(workspaceId: string, brand: { name: string; description?: string }): Promise<Brand> {
    const res = await apiPost<{ brand: Brand }>(`/v1/workspaces/${workspaceId}/brands`, brand);
    return res.brand;
  }

  async removeBrand(brandId: string): Promise<void> {
    await apiDelete(`/v1/workspaces/current/brands/${brandId}`);
  }

  private memberCache: User[] = [];

  members(): User[] {
    // Team page pattern is sync-first; kick a refresh and let subscribers update.
    void this.membersAsync();
    return this.memberCache;
  }

  async membersAsync(): Promise<User[]> {
    try {
      const res = await apiGet<{ members: ApiMemberRow[] }>("/v1/workspaces/current/members");
      this.memberCache = res.members.map((m) => ({
        id: m.userId,
        name: m.name,
        email: m.email,
        avatarHue: m.avatarHue ?? 200,
        role: m.role as User["role"],
        lastActiveAt: m.lastActiveAt ?? new Date().toISOString(),
        status: (m.memberStatus === "invited" ? "invited" : "active") as User["status"],
      }));
      this.emit();
      return this.memberCache;
    } catch {
      return this.memberCache;
    }
  }

  async invite(email: string, role: User["role"]): Promise<User> {
    await apiPost("/v1/workspaces/current/members", { email, role });
    const members = await this.membersAsync();
    return members[members.length - 1]!;
  }

  async updateMemberRole(id: string, role: User["role"]): Promise<void> {
    await apiPatch(`/v1/workspaces/current/members/${id}`, { role });
  }

  async removeMember(id: string): Promise<void> {
    await apiDelete(`/v1/workspaces/current/members/${id}`);
    await this.membersAsync();
  }

  // Live billing is asynchronous: callers must use fetchWorkspaceBilling.
  // Never substitute demo subscriptions or invoices when the request fails.
  subscription(): Subscription {
    throw new ApiError(503, "billing_not_loaded", "Billing data hasn't loaded. Please try again.");
  }

  usage(): Usage {
    throw new ApiError(503, "billing_not_loaded", "Usage data hasn't loaded. Please try again.");
  }

  invoices(): Invoice[] {
    throw new ApiError(503, "billing_not_loaded", "Invoices haven't loaded. Please try again.");
  }

  async changePlan(_plan: unknown): Promise<void> {
    throw new ApiError(501, "billing_not_wired", "Payments arrive with the production phase.");
  }

  plans(): Plan[] {
    return [];
  }
}

export const apiPostsService = new ApiPostsService();
export const apiAccountsService = new ApiAccountsService();
export const apiNotificationsService = new ApiNotificationsService();
export const apiWorkspaceService = new ApiWorkspaceService();
