import type {
  AdapterAccountContext,
  AdapterPublishInput,
  AdapterPublishResult,
  PublishErrorInfo,
  SocialProviderAdapter,
} from "./contract.js";
import {
  mastodonInstanceInfo,
  mastodonPostStatus,
  mastodonDeleteStatus,
  mastodonUploadMedia,
  mastodonWaitMedia,
  ProviderHttpError,
} from "@aria/providers-core";
import { PROVIDERS } from "@aria/shared-types";

/**
 * Mastodon adapter (Phase 2 — first real integration).
 * Federated: publishes against the account's own instance using the user's
 * OAuth token. Uses the instance's Idempotency-Key support as a second
 * duplicate-protection layer on top of the engine's guard.
 */

function caps() {
  return PROVIDERS.mastodon.capabilities;
}

function httpError(e: unknown): PublishErrorInfo {
  if (e instanceof ProviderHttpError) {
    return {
      code: `mastodon_http_${e.status}`,
      title: e.status === 401 ? "Mastodon token was revoked" : "The instance rejected the request",
      message:
        e.status === 401
          ? "This token is no longer valid. Reconnect the account."
          : e.status === 422
            ? "The instance declined the content (size or type limits vary by server)."
            : e.message,
      retryable: e.status >= 500 || e.status === 429,
      technical: e.body,
    };
  }
  return {
    code: "mastodon_error",
    title: "Mastodon publish failed",
    message: (e as Error).message ?? "Unknown error",
    retryable: false,
  };
}

export const mastodonAdapter: SocialProviderAdapter = {
  id: "mastodon",
  capabilities: caps,
  validateContent(input) {
    const limit = caps().maxCaptionLength; // instance-specific check at publish
    if (input.content.caption.length > limit) {
      return {
        code: "caption_too_long",
        title: "Caption exceeds this instance's limit",
        message: `${input.content.caption.length} characters — most instances allow ${limit} (read per-instance at publish).`,
        retryable: false,
      };
    }
    if (input.content.media.length > caps().maxImages) {
      return {
        code: "too_many_images",
        title: "Too many attachments",
        message: `Mastodon allows at most ${caps().maxImages} media attachments.`,
        retryable: false,
      };
    }
    for (const m of input.content.media) {
      if (m.kind === "document") {
        return {
          code: "document_not_supported",
          title: "This instance can't host documents",
          message: "Mastodon supports image and video attachments only.",
          retryable: false,
        };
      }
      if (m.kind === "video") {
        return {
          code: "video_not_yet_supported",
          title: "Video publishing is not enabled yet",
          message: "Video attachments are on the media-engine roadmap. Remove the video or deselect this account.",
          retryable: false,
        };
      }
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
    if (!ctx.accessToken || !ctx.instanceUrl) {
      throw Object.assign(new Error("Mastodon account is missing its token or instance"), { code: "no_session" });
    }
    if (!media.data) {
      throw Object.assign(new Error(`Stored media content is missing (${media.filename}). non_retryable`), {
        code: "media_content_missing",
      });
    }
    const uploaded = await mastodonUploadMedia(ctx.instanceUrl, ctx.accessToken, {
      bytes: media.data,
      mime: media.mime ?? "application/octet-stream",
      filename: media.filename,
      description: media.altText,
    });
    await mastodonWaitMedia(ctx.instanceUrl, ctx.accessToken, uploaded.id);
    ctx.log("mastodon media uploaded", { mediaId: uploaded.id });
    return { remoteMediaId: uploaded.id };
  },
  async createPost(input, ctx: AdapterAccountContext): Promise<AdapterPublishResult> {
    if (!ctx.accessToken || !ctx.instanceUrl) {
      throw Object.assign(new Error("Mastodon account is missing its token or instance"), { code: "no_session" });
    }
    // Respect the instance's own character limit — it may differ from 500.
    const info = await mastodonInstanceInfo(ctx.instanceUrl);
    if (input.content.caption.length > info.maxTootChars) {
      throw Object.assign(
        new Error(
          `Caption is ${input.content.caption.length} characters; ${new URL(ctx.instanceUrl).host} allows ${info.maxTootChars}. non_retryable`
        ),
        { code: "caption_too_long_instance" }
      );
    }
    const mediaIds = input.content.media
      .map((m) => m.remoteMediaId)
      .filter((id): id is string => !!id);
    const result = await mastodonPostStatus(
      ctx.instanceUrl,
      ctx.accessToken,
      {
        status: input.content.caption || undefined,
        mediaIds: mediaIds.length > 0 ? mediaIds : undefined,
        visibility: (input.settings.visibility as "public" | "unlisted" | "private" | "direct") ?? "public",
        language: typeof input.settings.language === "string" ? input.settings.language : undefined,
        idempotencyKey: typeof input.settings.__idempotencyKey === "string" ? input.settings.__idempotencyKey : undefined,
      }
    );
    ctx.log("mastodon status created", { id: result.id });
    if (result.scheduled_at) {
      return { providerPostId: result.id, permalink: undefined, asyncProcessing: true };
    }
    return {
      providerPostId: result.id,
      permalink: result.url,
    };
  },
  async getPostStatus() {
    return { state: "published" as const };
  },
  async deletePost(remotePostId, ctx) {
    if (!ctx.accessToken || !ctx.instanceUrl) throw new Error("Mastodon account is missing its token or instance");
    await mastodonDeleteStatus(ctx.instanceUrl, ctx.accessToken, remotePostId);
  },
  normalizeError: httpError,
};
