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
  threadsPostPermalink,
  ProviderHttpError,
} from "@aria/providers-core";
import { PROVIDERS } from "@aria/shared-types";
import { waitForMetaContainer } from "./meta-container.js";

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
    code: (e as { code?: string }).code ?? "threads_error",
    title: "Threads publish failed",
    message: (e as Error).message ?? "Unknown error",
    retryable: false,
  };
}

export const threadsAdapter: SocialProviderAdapter = {
  id: "threads",
  capabilities: caps,
  validateContent(input) {
    if (input.content.media.length > caps().maxImages) return {
      code: "too_many_media", title: "Too many Threads attachments", message: `Use at most ${caps().maxImages} images or videos.`, retryable: false,
    };
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
    const children: string[] = [];
    if (input.content.media.length > 1) {
      for (const item of input.content.media) {
        const child = await threadsCreateContainer(ctx.externalAccountId, ctx.accessToken, {
          mediaType: item.kind === "video" ? "VIDEO" : "IMAGE",
          imageUrl: item.kind === "image" ? item.publicUrl : undefined,
          videoUrl: item.kind === "video" ? item.publicUrl : undefined,
          altText: item.altText,
          isCarouselItem: true,
        });
        children.push(child.creationId);
      }
      await Promise.all(children.map(id => waitForMetaContainer("Threads", () => threadsContainerStatus(ctx.externalAccountId, ctx.accessToken!, id))));
    }
    const media = input.content.media[0];
    const container = await threadsCreateContainer(ctx.externalAccountId, ctx.accessToken, {
      mediaType: children.length ? "CAROUSEL" : media ? (media.kind === "video" ? "VIDEO" : "IMAGE") : "TEXT",
      text: input.content.caption || undefined,
      children: children.length ? children : undefined,
      altText: children.length ? undefined : media?.altText,
      imageUrl:
        !children.length && media?.kind === "image" && media.publicUrl
          ? media.publicUrl
          : undefined,
      videoUrl:
        !children.length && media?.kind === "video" && media.publicUrl
          ? media.publicUrl
          : undefined,
    });
    await waitForMetaContainer("Threads", () => threadsContainerStatus(ctx.externalAccountId, ctx.accessToken!, container.creationId));
    const published = await threadsPublish(ctx.externalAccountId, ctx.accessToken, container.creationId);
    const permalink = await threadsPostPermalink(published.postId, ctx.accessToken).catch(() => undefined);
    return { providerPostId: published.postId, permalink };
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
