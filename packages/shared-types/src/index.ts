/**
 * Aria Hub — shared data contracts.
 *
 * These types are the frontend/backend contract. The UI phase consumes them
 * through mock service implementations (src/lib/services). When the real
 * backend arrives, the same shapes should be returned by the API.
 */

export type ProviderId =
  | "facebook"
  | "instagram"
  | "threads"
  | "linkedin"
  | "tiktok"
  | "youtube"
  | "x"
  | "pinterest"
  | "bluesky"
  | "mastodon";

export type ConnectionState =
  | "healthy"
  | "needs_reauth"
  | "token_expiring"
  | "permission_missing"
  | "disconnected";

/* ------------------------------------------------------------------ */
/* Provider capability registry                                        */
/* ------------------------------------------------------------------ */

export type ContentKind = "text" | "image" | "video" | "document" | "carousel";

export interface ProviderCapabilities {
  /** Content formats the provider accepts. */
  formats: Record<ContentKind, boolean>;
  altText: boolean;
  linkPreview: boolean;
  hashtags: boolean;
  firstComment: boolean;
  thumbnail: boolean;
  customCover: boolean;
  privacyControl: boolean;
  schedule: boolean;
  directPublish: boolean;
  manualPublishFallback: boolean;
  comments: boolean;
  analytics: boolean;
  deletion: boolean;
  editing: boolean;
  aiDisclosure: boolean;
  brandedContent: boolean;
  /** Hard limits, verified against provider documentation (mock values for UI phase). */
  maxCaptionLength: number;
  maxImages: number;
  maxVideoDurationSec: number;
  maxVideoBytes: number;
  maxImageBytes: number;
  aspectRatios: string[];
  /** Human-facing restrictions shown honestly in the UI. */
  note?: string;
  /** External approval state for production availability. */
  approval?: "approved" | "pending" | "testing";
}

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  /** Brand color used for iconography. */
  color: string;
  /** Roughly what the account picker card says. */
  connectHint: string;
  capabilities: ProviderCapabilities;
  /** Date the capability set was verified against official provider docs. */
  verifiedAt?: string;
}

/* ------------------------------------------------------------------ */
/* Tenancy                                                             */
/* ------------------------------------------------------------------ */

export type Role = "owner" | "admin" | "manager" | "editor" | "approver" | "viewer";

export interface User {
  id: string;
  name: string;
  email: string;
  avatarHue: number;
  role: Role;
  isAdmin?: boolean;
  lastActiveAt: string;
  status: "active" | "invited" | "suspended";
}

export interface Brand {
  id: string;
  name: string;
  hue: number;
  description?: string;
}

export type PlanId = "free" | "creator" | "pro" | "agency";

export interface Workspace {
  id: string;
  name: string;
  timezone: string;
  locale: string;
  plan: PlanId;
  brands: Brand[];
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Accounts                                                            */
/* ------------------------------------------------------------------ */

export interface SocialAccount {
  id: string;
  provider: ProviderId;
  brandId: string;
  displayName: string;
  handle: string;
  avatarHue: number;
  connection: ConnectionState;
  /** Why the connection is degraded, shown in plain language. */
  connectionNote?: string;
  followers: number;
  connectedAt: string;
  lastRefreshedAt: string;
  tokenExpiresAt?: string;
  scopes: string[];
}

/* ------------------------------------------------------------------ */
/* Media                                                               */
/* ------------------------------------------------------------------ */

export type MediaKind = "image" | "video" | "document";

export interface MediaAsset {
  id: string;
  kind: MediaKind;
  filename: string;
  bytes: number;
  mime: string;
  /** Detected content type from inspection — may differ from the extension. */
  detectedMime: string;
  width?: number;
  height?: number;
  aspectRatio?: string;
  durationSec?: number;
  codec?: string;
  audioCodec?: string;
  fps?: number;
  checksum: string;
  altText?: string;
  hue: number;
  tags: string[];
  status: "ready" | "processing" | "failed";
  createdAt: string;
  usedInCount: number;
}

/* ------------------------------------------------------------------ */
/* Posts & publishing                                                  */
/* ------------------------------------------------------------------ */

export type PostState =
  | "draft"
  | "ready"
  | "scheduled"
  | "queued"
  | "processing"
  | "partially_published"
  | "published"
  | "failed"
  | "canceled"
  | "archived";

export type TargetState =
  | "pending"
  | "validating"
  | "queued"
  | "uploading_media"
  | "publishing"
  | "provider_processing"
  | "published"
  | "retrying"
  | "needs_user_action"
  | "failed"
  | "token_expired"
  | "canceled";

export interface PublishError {
  code: string;
  title: string;
  message: string;
  hint?: string;
  retryable: boolean;
  /** Raw provider detail, behind a "Details" disclosure. */
  technical?: string;
}

export interface PublishTarget {
  id: string;
  accountId: string;
  provider: ProviderId;
  state: TargetState;
  attempts: number;
  idempotencyKey: string;
  scheduledAt?: string;
  publishedAt?: string;
  remoteUrl?: string;
  lastError?: PublishError;
  /** 0–100 while uploading/publishing. */
  progress?: number;
}

export interface PostVersion {
  /** Immutable snapshot frozen at publish/schedule time. */
  version: number;
  frozenAt: string;
  caption: string;
  mediaIds: string[];
  byUserId: string;
}

/** Platform-specific override, stored only where the user changed something. */
export interface VariantOverride {
  provider: ProviderId;
  caption?: string;
  title?: string;
  firstComment?: string;
  settings: {
    /** Pinterest */
    boardId?: string;
    /** TikTok */
    privacyOption?: "public" | "followers" | "private";
    allowComments?: boolean;
    /** YouTube */
    visibility?: "public" | "unlisted" | "private";
    madeForKids?: boolean;
    category?: string;
    tags?: string[];
    /** Instagram */
    shareToFacebook?: boolean;
    altText?: string;
  };
}

export interface Post {
  id: string;
  /** Internal label — never published. */
  title: string;
  caption: string;
  link?: string;
  mediaIds: string[];
  targets: PublishTarget[];
  state: PostState;
  brandId: string;
  authorId: string;
  campaign?: string;
  labels?: string[];
  timezone: string;
  scheduledAt?: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  aiDisclosed?: boolean;
  variants?: VariantOverride[];
  versions?: PostVersion[];
}

/* ------------------------------------------------------------------ */
/* Composer draft (client-side before save)                            */
/* ------------------------------------------------------------------ */

export interface ComposerDraft {
  title: string;
  caption: string;
  link?: string;
  mediaIds: string[];
  selectedAccountIds: string[];
  campaign?: string;
  labels?: string[];
  aiDisclosed: boolean;
  variants?: VariantOverride[];
}

/* ------------------------------------------------------------------ */
/* Queue & scheduling                                                  */
/* ------------------------------------------------------------------ */

export interface QueueSlot {
  id: string;
  /** 0 = Sunday … 6 = Saturday */
  dayOfWeek: number;
  time: string; // "HH:mm"
  providerIds: ProviderId[];
  enabled: boolean;
}

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

export type NotificationType =
  | "post_failed"
  | "post_published"
  | "account_disconnected"
  | "needs_reauth"
  | "needs_action"
  | "schedule_conflict"
  | "retry_succeeded"
  | "team_invite"
  | "billing";

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
  severity: "info" | "success" | "warning" | "error";
  postId?: string;
  accountId?: string;
}

/* ------------------------------------------------------------------ */
/* Analytics                                                           */
/* ------------------------------------------------------------------ */

export type NormalizedMetric =
  | "impressions"
  | "reach"
  | "likes"
  | "comments"
  | "shares"
  | "clicks"
  | "engagements"
  | "watchTimeMin"
  | "followers";

export interface MetricPoint {
  date: string; // yyyy-mm-dd
  value: number | null; // null = provider does not report this metric
}

export interface NetworkMetricSummary {
  provider: ProviderId;
  accountId?: string;
  accountName?: string;
  metrics: Partial<Record<NormalizedMetric, number | null>>;
  series?: Partial<Record<NormalizedMetric, MetricPoint[]>>;
}

export interface TopPost {
  postId: string;
  title: string;
  caption: string;
  provider: ProviderId;
  publishedAt: string;
  impressions: number | null;
  engagements: number | null;
  hue: number;
}

/* ------------------------------------------------------------------ */
/* Billing                                                             */
/* ------------------------------------------------------------------ */

export interface Plan {
  id: PlanId;
  name: string;
  priceMonthly: number;
  channels: number | "unlimited";
  brands: number;
  members: number;
  scheduledPostsPerMonth: number | "unlimited";
  storageGb: number;
  aiCredits: number;
  highlights: string[];
}

export interface Usage {
  channels: { used: number; limit: number | "unlimited" };
  brands: { used: number; limit: number };
  members: { used: number; limit: number };
  scheduledPosts: { used: number; limit: number | "unlimited" };
  storage: { usedGb: number; limitGb: number };
  aiCredits: { used: number; limit: number };
}

export interface Invoice {
  id: string;
  number: string;
  date: string;
  amount: number;
  status: "paid" | "open" | "failed";
  planName: string;
}

export interface Subscription {
  plan: Plan;
  renewsAt: string;
  paymentBrand: string;
  paymentLast4: string;
  seats: number;
}

/* ------------------------------------------------------------------ */
/* Admin                                                               */
/* ------------------------------------------------------------------ */

export type ProviderStatus = "active" | "degraded" | "maintenance" | "disabled";

export interface AdminProvider {
  provider: ProviderId;
  status: ProviderStatus;
  apiVersion: string;
  approval: ProviderCapabilities["approval"];
  errorRate7d: number;
  lastSuccessfulPublish?: string;
  rateLimitHealth: "normal" | "elevated" | "limited";
}

export interface AdminJob {
  id: string;
  postId: string;
  postTitle: string;
  provider: ProviderId;
  state: TargetState;
  attempts: number;
  queuedAt: string;
  lastError?: string;
}

export interface WebhookEvent {
  id: string;
  provider: ProviderId;
  type: string;
  receivedAt: string;
  verified: boolean;
  processed: "processed" | "duplicate" | "failed" | "pending";
}

export interface FeatureFlag {
  key: string;
  description: string;
  enabled: boolean;
  rollout: "internal" | "beta" | "percentage" | "all";
}

export interface AuditEntry {
  id: string;
  at: string;
  actor: string;
  action: string;
  target: string;
  workspace: string;
  ip: string;
}

/* ------------------------------------------------------------------ */
/* RBAC — canonical permission matrix (Phase 1)                        */
/* ------------------------------------------------------------------ */

export type Permission =
  | "connect_accounts"
  | "disconnect_accounts"
  | "create_posts"
  | "edit_posts"
  | "publish_posts"
  | "approve_posts"
  | "view_analytics"
  | "manage_team"
  | "manage_billing"
  | "manage_workspace";

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  owner: [
    "connect_accounts",
    "disconnect_accounts",
    "create_posts",
    "edit_posts",
    "publish_posts",
    "approve_posts",
    "view_analytics",
    "manage_team",
    "manage_billing",
    "manage_workspace",
  ],
  admin: [
    "connect_accounts",
    "disconnect_accounts",
    "create_posts",
    "edit_posts",
    "publish_posts",
    "approve_posts",
    "view_analytics",
    "manage_team",
    "manage_workspace",
  ],
  manager: ["connect_accounts", "disconnect_accounts", "create_posts", "edit_posts", "publish_posts", "approve_posts", "view_analytics"],
  editor: ["create_posts", "edit_posts", "view_analytics"],
  approver: ["approve_posts", "view_analytics"],
  viewer: ["view_analytics"],
};

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

/* ------------------------------------------------------------------ */
/* Provider capability registry (canonical, backend-side)              */
/* ------------------------------------------------------------------ */
export * from "./providers.js";
