import type {
  AdapterAccountContext,
  AdapterPublishResult,
  PublishErrorInfo,
  SocialProviderAdapter,
} from "./contract.js";
import {
  igContainerStatus,
  igCreateMediaContainer,
  igDeleteMedia,
  igPublishContainer,
  igMediaPermalink,
  ProviderHttpError,
} from "@aria/providers-core";
import { PROVIDERS } from "@aria/shared-types";
import { waitForMetaContainer } from "./meta-container.js";

/**
 * Instagram adapter. Container→publish flow with PUBLIC media URLs
 * (JPEG-only for photos, verified 2026-09-30). The engine supplies each
 * item's signed, expiring publicUrl served by the API.
 */

function caps() {
  return PROVIDERS.instagram.capabilities;
}

function httpError(e: unknown): PublishErrorInfo {
  if (e instanceof ProviderHttpError) {
    return {
      code: `instagram_http_${e.status}`,
      title: "Instagram rejected the request",
      message: e.status === 401 ? "Token expired — reconnect the account." : e.message,
      retryable: e.status >= 500 || e.status === 429,
      technical: e.body,
    };
  }
  return {
    code: (e as { code?: string }).code ?? "instagram_error",
    title: "Instagram publish failed",
    message: (e as Error).message ?? "Unknown error",
    retryable: false,
  };
}

export const instagramAdapter: SocialProviderAdapter = {
  id: "instagram",
  capabilities: caps,
  validateContent(input) {
    const media = input.content.media;
    if (input.content.caption.length > caps().maxCaptionLength) return {
      code: "caption_too_long", title: "Instagram caption is too long", message: `Use at most ${caps().maxCaptionLength} characters.`, retryable: false,
    };
    if (media.length === 0) {
      return {
        code: "media_required",
        title: "Instagram requires an image or video",
        message: "Text-only posts aren't supported on Instagram.",
        retryable: false,
      };
    }
    if (media.length > 10) {
      return {
        code: "too_many_media",
        title: "Instagram carousels cap at 10 items",
        message: `Found ${media.length}.`,
        retryable: false,
      };
    }
    for (const m of media) {
      if (m.kind === "document") return {
        code: "document_not_supported", title: "Instagram requires images or video", message: "Remove the document or deselect Instagram.", retryable: false,
      };
      if (m.kind === "image" && m.mime && !m.mime.startsWith("image/jpeg")) {
        return {
          code: "unsupported_format",
          title: "Instagram accepts JPEG images via URL containers",
          message: `“${m.filename}” is ${m.mime}. Convert to JPEG, or wait for the binary upload pass.`,
          retryable: false,
        };
      }
      if (!m.publicUrl) {
        return {
          code: "public_url_required",
          title: "Media on Instagram needs a public URL",
          message:
            "Instagram fetches media from a public URL, so the API needs a public https address (APP_BASE_URL). Configure it, or deselect Instagram.",
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
    if (!ctx.accessToken) throw Object.assign(new Error("No Instagram token"), { code: "no_session" });
    if (input.content.media.some((m) => !m.publicUrl)) {
      throw Object.assign(
        new Error("Instagram media needs a public https API address (APP_BASE_URL). non_retryable"),
        { code: "public_url_required" }
      );
    }
    const isCarousel = input.content.media.length > 1;
    const settings = input.settings as { altText?: string };
    const caption = input.content.caption;

    const childIds: string[] = [];
    if (isCarousel) {
      for (const m of input.content.media) {
        const container = await igCreateMediaContainer(
          ctx.externalAccountId,
          ctx.accessToken,
          {
            mediaType: m.kind === "video" ? "VIDEO" : "IMAGE",
            imageUrl: m.kind === "image" ? m.publicUrl : undefined,
            videoUrl: m.kind === "video" ? m.publicUrl : undefined,
            isCarouselItem: true,
            altText: m.kind === "image" ? m.altText ?? settings.altText : undefined,
          }
        );
        childIds.push(container.creationId);
      }
      await Promise.all(childIds.map(id => waitForMetaContainer("Instagram", () => igContainerStatus(id, ctx.accessToken!))));
    }

    const mainContainer = await igCreateMediaContainer(
      ctx.externalAccountId,
      ctx.accessToken,
      isCarousel
        ? {
            mediaType: "CAROUSEL",
            caption,
            children: childIds,
            aiGenerated: input.aiDisclosed,
          }
        : {
            mediaType: input.content.media[0]?.kind === "video" ? "REELS" : "IMAGE",
            imageUrl:
              input.content.media[0]?.kind === "image" && input.content.media[0].publicUrl
                ? input.content.media[0].publicUrl
                : undefined,
            videoUrl:
              input.content.media[0]?.kind === "video" && input.content.media[0].publicUrl
                ? input.content.media[0].publicUrl
                : undefined,
            caption,
            altText: input.content.media[0]?.kind === "image" ? input.content.media[0].altText ?? settings.altText : undefined,
            aiGenerated: input.aiDisclosed,
          }
    );
    await waitForMetaContainer("Instagram", () => igContainerStatus(mainContainer.creationId, ctx.accessToken!));

    const published = await igPublishContainer(ctx.externalAccountId, ctx.accessToken, mainContainer.creationId);
    // A failed optional lookup must never retry an already-successful publish.
    const permalink = await igMediaPermalink(published.mediaId, ctx.accessToken).catch(() => undefined);
    return { providerPostId: published.mediaId, permalink };
  },
  async getPostStatus() {
    return { state: "published" as const };
  },
  async deletePost(remotePostId, ctx) {
    if (!ctx.accessToken) throw new Error("No Instagram token");
    await igDeleteMedia(remotePostId, ctx.accessToken);
  },
  normalizeError: httpError,
};
