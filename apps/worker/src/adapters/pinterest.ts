import type {
  AdapterAccountContext,
  AdapterPublishInput,
  AdapterPublishResult,
  PublishErrorInfo,
  SocialProviderAdapter,
} from "./contract.js";
import {
  pinterestCreatePin,
  pinterestDeletePin,
  pinterestMediaStatus,
  pinterestUploadMedia,
  ProviderHttpError,
} from "@aria/providers-core";
import { PROVIDERS } from "@aria/shared-types";

/**
 * Pinterest adapter. Every Pin needs a board (variant setting) and media —
 * image or video bytes through /v5/media, waited to SUCCEEDED.
 */

function caps() {
  return PROVIDERS.pinterest.capabilities;
}

function httpError(e: unknown): PublishErrorInfo {
  if (e instanceof ProviderHttpError) {
    return {
      code: `pinterest_http_${e.status}`,
      title: "Pinterest rejected the request",
      message: e.status === 401 || e.status === 403 ? "Token problem — reconnect the account." : e.message,
      retryable: e.status >= 500 || e.status === 429,
      technical: e.body,
    };
  }
  return {
    code: "pinterest_error",
    title: "Pinterest publish failed",
    message: (e as Error).message ?? "Unknown error",
    retryable: false,
  };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export const pinterestAdapter: SocialProviderAdapter = {
  id: "pinterest",
  capabilities: caps,
  validateContent(input) {
    const settings = input.settings as { boardId?: string };
    if (!settings.boardId) {
      return {
        code: "board_required",
        title: "Pinterest needs a board",
        message: "Every Pin publishes to a board — pick one in the Pinterest customization tab.",
        retryable: false,
      };
    }
    if (input.content.media.length === 0) {
      return {
        code: "media_required",
        title: "Pinterest requires media",
        message: "Pins are image or video posts — attach one.",
        retryable: false,
      };
    }
    const first = input.content.media[0];
    if (!first.data) {
      return {
        code: "media_content_missing",
        title: "Media content is unavailable",
        message: `The stored content for “${first.filename}” could not be loaded. Re-upload the file.`,
        retryable: false,
      };
    }
    if (input.content.media.length > 1) {
      return {
        code: "too_many_media",
        title: "Pinterest takes a single image or video per Pin",
        message: "Remove the extra media.",
        retryable: false,
      };
    }
    return null;
  },
  async uploadMedia(media, ctx: AdapterAccountContext) {
    if (!ctx.accessToken) throw Object.assign(new Error("No Pinterest token"), { code: "no_session" });
    if (!media.data) throw Object.assign(new Error("Media content missing"), { code: "media_content_missing" });
    const uploaded = await pinterestUploadMedia(ctx.accessToken, {
      bytes: media.data,
      mime: media.mime ?? "image/jpeg",
      filename: media.filename,
    });
    // Wait for Pinterest processing (bounded).
    for (let i = 0; i < 15; i++) {
      const status = await pinterestMediaStatus(ctx.accessToken, uploaded.mediaId).catch(() => null);
      if (status?.status === "succeeded") return { remoteMediaId: uploaded.mediaId };
      if (status?.status === "failed") {
        throw Object.assign(new Error("Pinterest failed to process the media"), { status: 422 });
      }
      await sleep(1200);
    }
    return { remoteMediaId: uploaded.mediaId };
  },
  async createPost(input, ctx: AdapterAccountContext): Promise<AdapterPublishResult> {
    if (!ctx.accessToken) throw Object.assign(new Error("No Pinterest token"), { code: "no_session" });
    const settings = input.settings as { boardId?: string };
    const first = input.content.media[0];
    const pin = await pinterestCreatePin(ctx.accessToken, {
      boardId: settings.boardId ?? "",
      title: input.content.title ?? undefined,
      description: input.content.caption || undefined,
      link: input.content.link,
      mediaId: first?.remoteMediaId,
    });
    return {
      providerPostId: pin.pinId,
      permalink: pin.link ?? `https://pinterest.com/pin/${pin.pinId}`,
    };
  },
  async getPostStatus() {
    return { state: "published" as const };
  },
  async deletePost(remotePostId, ctx) {
    if (!ctx.accessToken) throw new Error("No Pinterest token");
    await pinterestDeletePin(ctx.accessToken, remotePostId);
  },
  normalizeError: httpError,
};
