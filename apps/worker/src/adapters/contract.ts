import type { ProviderCapabilities, ProviderId } from "@aria/shared-types";

export interface PublishErrorInfo {
  code: string;
  title: string;
  message: string;
  hint?: string;
  retryable: boolean;
  technical?: string;
}

export interface AdapterMedia {
  mediaId: string;
  kind: "image" | "video" | "document";
  filename: string;
  bytes: number;
  mime?: string;
  altText?: string;
  /** Raw content, loaded from object storage by the engine. */
  data?: Uint8Array;
  storageKey?: string;
  aspectRatio?: string;
  durationSec?: number;
  /** Set by the engine from uploadMedia() results. */
  remoteMediaId?: string;
}

export interface AdapterPublishInput {
  /** AI-assistance disclosure where the network supports labeling. */
  aiDisclosed?: boolean;
  content: {
    caption: string;
    title?: string;
    link?: string;
    firstComment?: string;
    media: AdapterMedia[];
  };
  /** Platform variant settings (privacy, board, visibility, madeForKids…). */
  settings: Record<string, unknown>;
}

export interface AdapterAccountContext {
  externalAccountId: string;
  /** Decrypted OAuth credential — resolved by the engine, never logged. */
  accessToken?: string;
  scopes: string[];
  /** Federated providers (Mastodon) publish against this base URL. */
  instanceUrl?: string;
  log: (message: string, meta?: Record<string, unknown>) => void;
}

export interface AdapterPublishResult {
  providerPostId: string;
  permalink?: string;
  /** true = accepted but not yet public (TikTok/YouTube-style processing). */
  asyncProcessing?: boolean;
  providerRequestId?: string;
}

/**
 * The contract every provider integration implements. The publishing engine
 * contains zero provider-specific logic — all platform behavior lives in
 * adapters (plan §5). Each future provider must pass the full adapter test
 * contract before it is enabled.
 */
export interface SocialProviderAdapter {
  readonly id: ProviderId;
  capabilities(): ProviderCapabilities;
  /** Local validation before any network call — never wait for the API to reject. */
  validateContent(input: AdapterPublishInput): PublishErrorInfo | null;
  uploadMedia(media: AdapterMedia, ctx: AdapterAccountContext): Promise<{ remoteMediaId: string }>;
  createPost(input: AdapterPublishInput, ctx: AdapterAccountContext): Promise<AdapterPublishResult>;
  /** Poll async platforms until the post is live. */
  getPostStatus(remotePostId: string, ctx: AdapterAccountContext): Promise<{ state: "processing" | "published" | "failed"; error?: PublishErrorInfo }>;
  deletePost?(remotePostId: string, ctx: AdapterAccountContext): Promise<void>;
  normalizeError(error: unknown): PublishErrorInfo;
}
