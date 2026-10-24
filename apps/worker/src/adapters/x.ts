import type {
  AdapterAccountContext,
  AdapterPublishInput,
  AdapterPublishResult,
  PublishErrorInfo,
  SocialProviderAdapter,
} from "./contract.js";
import {
  xCreateTweet,
  xDeleteTweet,
  xUploadMediaBytes,
  ProviderHttpError,
} from "@aria/providers-core";
import { PROVIDERS } from "@aria/shared-types";

/**
 * X adapter. Pay-per-usage (verified 2026-10-02: $0.015 per post create) —
 * spending is gated behind X_POSTING_ENABLED=true so a misconfiguration can't
 * silently bill. Images ≤4 / video ≤1 through chunked upload.
 */

function caps() {
  return PROVIDERS.x.capabilities;
}

function postingEnabled(): boolean {
  return process.env.X_POSTING_ENABLED === "true";
}

function httpError(e: unknown): PublishErrorInfo {
  if (e instanceof ProviderHttpError) {
    return {
      code: `x_http_${e.status}`,
      title: "X rejected the request",
      message: e.status === 401 || e.status === 403 ? "Token problem — reconnect the account." : e.message,
      retryable: e.status >= 500 || e.status === 429,
      technical: e.body,
    };
  }
  return {
    code: "x_error",
    title: "X publish failed",
    message: (e as Error).message ?? "Unknown error",
    retryable: false,
  };
}

export const xAdapter: SocialProviderAdapter = {
  id: "x",
  capabilities: caps,
  validateContent(input) {
    if (!postingEnabled()) {
      return {
        code: "x_posting_disabled",
        title: "X publishing is disabled on this server",
        message:
          "X charges per post ($0.015/create). Set X_POSTING_ENABLED=true to accept metered spend, or deselect X.",
        retryable: false,
      };
    }
    const len = [...input.content.caption].length;
    if (len > caps().maxCaptionLength) {
      return {
        code: "caption_too_long",
        title: "Caption exceeds X's 280-character limit",
        message: `${len} characters — X allows 280.`,
        retryable: false,
      };
    }
    const videos = input.content.media.filter((m) => m.kind === "video");
    const images = input.content.media.filter((m) => m.kind === "image");
    if (videos.length > 1) {
      return {
        code: "too_many_videos",
        title: "X takes one video per post",
        message: "Remove the extra videos.",
        retryable: false,
      };
    }
    if (videos.length === 1 && images.length > 0) {
      return {
        code: "media_mix_invalid",
        title: "X takes a video OR images, not both",
        message: "Remove one or the other.",
        retryable: false,
      };
    }
    if (images.length > caps().maxImages) {
      return {
        code: "too_many_images",
        title: "X takes at most 4 images",
        message: `Found ${images.length}.`,
        retryable: false,
      };
    }
    for (const m of input.content.media) {
      if (!m.data) {
        return {
          code: "media_content_missing",
          title: "Media content is unavailable",
          message: `The stored content for “${m.filename}” could not be loaded. Re-upload the file.`,
          retryable: false,
        };
      }
    }
    return null;
  },
  async uploadMedia(media, ctx: AdapterAccountContext) {
    if (!ctx.accessToken) throw Object.assign(new Error("No X token"), { code: "no_session" });
    if (!media.data) throw Object.assign(new Error("Media content missing"), { code: "media_content_missing" });
    const remoteMediaId = await xUploadMediaBytes(ctx.accessToken, media.data, media.mime ?? "image/jpeg");
    return { remoteMediaId };
  },
  async createPost(input, ctx: AdapterAccountContext): Promise<AdapterPublishResult> {
    if (!ctx.accessToken) throw Object.assign(new Error("No X token"), { code: "no_session" });
    const mediaIds = input.content.media.map((m) => m.remoteMediaId).filter((id): id is string => !!id);
    const result = await xCreateTweet(ctx.accessToken, {
      text: input.content.caption,
      mediaIds: mediaIds.length > 0 ? mediaIds : undefined,
    });
    return {
      providerPostId: result.tweetId,
      permalink: `https://x.com/i/web/status/${result.tweetId}`,
    };
  },
  async getPostStatus() {
    return { state: "published" as const };
  },
  async deletePost(remotePostId, ctx) {
    if (!ctx.accessToken) throw new Error("No X token");
    await xDeleteTweet(ctx.accessToken, remotePostId);
  },
  normalizeError: httpError,
};
