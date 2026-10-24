import type {
  AdapterAccountContext,
  AdapterPublishInput,
  AdapterPublishResult,
  PublishErrorInfo,
  SocialProviderAdapter,
} from "./contract.js";
import {
  blueskyCreatePost,
  blueskyDeletePost,
  blueskyRefreshSession,
  ProviderHttpError,
} from "@aria/providers-core";
import { PROVIDERS } from "@aria/shared-types";

/**
 * Bluesky adapter (Phase 2 — first real integration).
 * App-password sessions; text + external-link cards now. Image/video embeds
 * arrive with media storage (Phase 3) and are rejected with a translated,
 * non-retryable error until then — never silently dropped.
 */

function caps() {
  return PROVIDERS.bluesky.capabilities;
}

function graphemeLength(text: string): number {
  // Approximation via code points; Intl.Segmenter where available.
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const seg = new (Intl as never as { Segmenter: new () => { segment: (s: string) => Iterable<unknown> } }).Segmenter();
    return [...seg.segment(text)].length;
  }
  return [...text].length;
}

function httpError(e: unknown): PublishErrorInfo {
  if (e instanceof ProviderHttpError) {
    return {
      code: `bluesky_http_${e.status}`,
      title: e.status === 401 ? "Bluesky session expired" : "Bluesky rejected the request",
      message:
        e.status === 401
          ? "The stored session could not be refreshed. Reconnect the account."
          : e.message,
      retryable: e.status >= 500 || e.status === 429,
      technical: e.body,
    };
  }
  return {
    code: "bluesky_error",
    title: "Bluesky publish failed",
    message: (e as Error).message ?? "Unknown error",
    retryable: false,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const blueskyAdapter: SocialProviderAdapter = {
  id: "bluesky",
  capabilities: caps,
  validateContent(input) {
    const len = graphemeLength(input.content.caption);
    if (len > caps().maxCaptionLength) {
      return {
        code: "caption_too_long",
        title: "Caption exceeds Bluesky's 300-character limit",
        message: `${len} graphemes — Bluesky allows 300.`,
        retryable: false,
      };
    }
    if (input.content.media.length > caps().maxImages) {
      return {
        code: "too_many_images",
        title: "Too many images for Bluesky",
        message: `Bluesky allows at most ${caps().maxImages} images.`,
        retryable: false,
      };
    }
    for (const m of input.content.media) {
      if (m.kind === "video") {
        return {
          code: "video_not_yet_supported",
          title: "Bluesky video publishing is not enabled yet",
          message: "Video uploads to Bluesky are on the media-engine roadmap. Remove the video or deselect Bluesky.",
          retryable: false,
        };
      }
      if (m.kind === "image") {
        if (!m.data) {
          return {
            code: "media_content_missing",
            title: "Image content is unavailable",
            message: `The stored content for “${m.filename}” could not be loaded. Re-upload the image.`,
            retryable: false,
          };
        }
        if (m.data.byteLength > caps().maxImageBytes) {
          return {
            code: "image_too_large",
            title: "Image is larger than Bluesky allows",
            message: `“${m.filename}” is ${(m.data.byteLength / 1024).toFixed(0)} KB — Bluesky allows about ${Math.round(caps().maxImageBytes / 1024)} KB per image.`,
            retryable: false,
          };
        }
      }
    }
    return null;
  },
  async uploadMedia(media) {
    // Blobs upload inline during createPost (AT Protocol model).
    return { remoteMediaId: media.mediaId };
  },
  async createPost(input, ctx: AdapterAccountContext): Promise<AdapterPublishResult> {
    if (!ctx.accessToken) {
      throw Object.assign(new Error("No Bluesky session for this account"), { code: "no_session" });
    }
    // Session JWTs live ~2h; the engine refreshes before publish when needed.
    const images = input.content.media
      .filter((m) => m.kind === "image" && m.data)
      .map((m) => ({ bytes: m.data!, mime: m.mime ?? "image/jpeg", alt: m.altText }));
    const result = await blueskyCreatePost(
      { accessJwt: ctx.accessToken, did: ctx.externalAccountId },
      {
        did: ctx.externalAccountId,
        text: input.content.caption,
        link: input.content.link,
        images: images.length > 0 ? images : undefined,
      }
    );
    ctx.log("bluesky post created", { uri: result.uri });
    return {
      providerPostId: result.uri,
      permalink: `https://bsky.app/profile/${ctx.externalAccountId}/post/${result.uri.split("/").pop()}`,
      providerRequestId: result.cid,
    };
  },
  async getPostStatus() {
    // Records are created synchronously on AT Protocol.
    await sleep(0);
    return { state: "published" as const };
  },
  async deletePost(remotePostId, ctx) {
    if (!ctx.accessToken) throw new Error("No Bluesky session for this account");
    await blueskyDeletePost(
      { accessJwt: ctx.accessToken, did: ctx.externalAccountId },
      remotePostId
    );
  },
  normalizeError: httpError,
};

/** Re-exported for the refresh service test. */
export { blueskyRefreshSession };
