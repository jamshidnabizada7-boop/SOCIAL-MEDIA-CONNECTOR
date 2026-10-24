import type {
  AdapterAccountContext,
  AdapterPublishInput,
  AdapterPublishResult,
  PublishErrorInfo,
  SocialProviderAdapter,
} from "./contract.js";
import {
  facebookPostToFeed,
  facebookUploadPhoto,
  facebookUploadVideo,
  facebookDeletePost,
  ProviderHttpError,
} from "@aria/providers-core";
import { PROVIDERS } from "@aria/shared-types";

/**
 * Facebook Pages adapter. Page token from the vault; text/link via /feed,
 * photos via multipart binary (works from local storage), video via the
 * graph-video endpoint. Only the Page's own posts are editable later.
 */

function caps() {
  return PROVIDERS.facebook.capabilities;
}

function httpError(e: unknown): PublishErrorInfo {
  if (e instanceof ProviderHttpError) {
    return {
      code: `facebook_http_${e.status}`,
      title: "Facebook rejected the request",
      message: e.status === 190 ? "The Page token expired — reconnect the account." : e.message,
      retryable: e.status >= 500 || e.status === 429,
      technical: e.body,
    };
  }
  return {
    code: "facebook_error",
    title: "Facebook publish failed",
    message: (e as Error).message ?? "Unknown error",
    retryable: false,
  };
}

export const facebookAdapter: SocialProviderAdapter = {
  id: "facebook",
  capabilities: caps,
  validateContent(input) {
    const media = input.content.media;
    if (media.length > caps().maxImages + 1) {
      return {
        code: "too_many_media",
        title: "Too many attachments for Facebook",
        message: "Facebook supports one video or a photo set per post.",
        retryable: false,
      };
    }
    for (const m of media) {
      if (m.kind === "document") {
        return {
          code: "document_not_supported",
          title: "Facebook can't host documents",
          message: "Remove the document or deselect Facebook.",
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
  async uploadMedia() {
    // Facebook uploads happen inline in createPost (photo/video endpoints).
    return { remoteMediaId: "" };
  },
  async createPost(input, ctx: AdapterAccountContext): Promise<AdapterPublishResult> {
    if (!ctx.accessToken) throw Object.assign(new Error("No Facebook Page token"), { code: "no_session" });
    const pageId = ctx.externalAccountId;
    const media = input.content.media;
    const first = media[0];

    if (first?.kind === "video") {
      const video = await facebookUploadVideo(pageId, ctx.accessToken, {
        bytes: first.data!,
        mime: first.mime ?? "video/mp4",
        filename: first.filename,
        description: input.content.caption,
      });
      return {
        providerPostId: video.videoId,
        permalink: `https://facebook.com/${video.videoId}`,
        asyncProcessing: true,
      };
    }

    if (first?.kind === "image") {
      const photo = await facebookUploadPhoto(pageId, ctx.accessToken, {
        bytes: first.data!,
        mime: first.mime ?? "image/jpeg",
        filename: first.filename,
        caption: input.content.caption,
      });
      return {
        providerPostId: photo.postId || photo.photoId,
        permalink: `https://facebook.com/${photo.postId || photo.photoId}`,
      };
    }

    const feed = await facebookPostToFeed(pageId, ctx.accessToken, {
      message: input.content.caption || undefined,
      link: input.content.link,
    });
    return {
      providerPostId: feed.postId,
      permalink: `https://facebook.com/${feed.postId}`,
    };
  },
  async getPostStatus() {
    return { state: "published" as const };
  },
  async deletePost(remotePostId, ctx) {
    if (!ctx.accessToken) throw new Error("No Facebook Page token");
    await facebookDeletePost(remotePostId, ctx.accessToken);
  },
  normalizeError: httpError,
};
