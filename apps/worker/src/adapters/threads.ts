import type {
  AdapterAccountContext,
  AdapterPublishResult,
  PublishErrorInfo,
  SocialProviderAdapter,
} from "./contract.js";
import {
  threadsContainerStatus,
  threadsCreateContainer,
  threadsDeletePost,
  threadsPublish,
  ProviderHttpError,
} from "@aria/providers-core";
import { PROVIDERS } from "@aria/shared-types";

/**
 * Threads adapter. Text posts publish directly; image/video containers need
 * PUBLIC image/video URLs (Threads fetches them itself) — the engine
 * supplies each item's signed, expiring publicUrl served by the API.
 */

function caps() {
  return PROVIDERS.threads.capabilities;
}

function httpError(e: unknown): PublishErrorInfo {
  if (e instanceof ProviderHttpError) {
    return {
      code: `threads_http_${e.status}`,
      title: "Threads rejected the request",
      message: e.status === 401 ? "Token problem — reconnect the account." : e.message,
      retryable: e.status >= 500 || e.status === 429,
      technical: e.body,
    };
  }
  return {
    code: "threads_error",
    title: "Threads publish failed",
    message: (e as Error).message ?? "Unknown error",
    retryable: false,
  };
}

export const threadsAdapter: SocialProviderAdapter = {
  id: "threads",
  capabilities: caps,
  validateContent(input) {
    const len = input.content.caption.length;
    if (len > caps().maxCaptionLength) {
      return {
        code: "caption_too_long",
        title: "Caption exceeds Threads' 500-character limit",
        message: `${len} characters.`,
        retryable: false,
      };
    }
    for (const m of input.content.media) {
      if (m.kind === "document") {
        return {
          code: "document_not_supported",
          title: "Threads can't host documents",
          message: "Remove the document or deselect Threads.",
          retryable: false,
        };
      }
      if (!m.publicUrl) {
        return {
          code: "public_url_required",
          title: "Media on Threads needs a public URL",
          message:
            "Threads fetches media from a public URL, so the API needs a public https address (APP_BASE_URL). Configure it, or post text-only.",
          retryable: false,
        };
      }
    }
    return null;
  },
  async uploadMedia() {
    return { remoteMediaId: "" }; // containers reference public URLs
  },
  async createPost(input, ctx: AdapterAccountContext): Promise<AdapterPublishResult> {
    if (!ctx.accessToken) throw Object.assign(new Error("No Threads token"), { code: "no_session" });
    const media = input.content.media[0];
    const container = await threadsCreateContainer(ctx.externalAccountId, ctx.accessToken, {
      mediaType: media ? (media.kind === "video" ? "VIDEO" : "IMAGE") : "TEXT",
      text: input.content.caption || undefined,
      imageUrl:
        media?.kind === "image" && media.publicUrl
          ? media.publicUrl
          : undefined,
      videoUrl:
        media?.kind === "video" && media.publicUrl
          ? media.publicUrl
          : undefined,
    });
    // Wait for the container to finish processing (≤60s, poll per minute per docs).
    for (let i = 0; i < 6; i++) {
      const status = await threadsContainerStatus(ctx.externalAccountId, ctx.accessToken, container.creationId).catch(() => null);
      if (status?.statusCode === "FINISHED") break;
      if (status?.statusCode === "ERROR" || status?.statusCode === "EXPIRED") {
        throw Object.assign(new Error(`Threads container ${status.statusCode}`), { status: 422 });
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    const published = await threadsPublish(ctx.externalAccountId, ctx.accessToken, container.creationId);
    return {
      providerPostId: published.postId,
      permalink: `https://threads.net/@${ctx.externalAccountId}/post/${published.postId}`,
    };
  },
  async getPostStatus() {
    return { state: "published" as const };
  },
  async deletePost(remotePostId, ctx) {
    if (!ctx.accessToken) throw new Error("No Threads token");
    await threadsDeletePost(ctx.externalAccountId, ctx.accessToken, remotePostId);
  },
  normalizeError: httpError,
};
