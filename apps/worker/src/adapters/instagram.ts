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
  ProviderHttpError,
} from "@aria/providers-core";
import { PROVIDERS } from "@aria/shared-types";

/**
 * Instagram adapter. Container→publish flow with PUBLIC media URLs
 * (JPEG-only for photos, verified 2026-09-30); gated on
 * APP_PUBLIC_MEDIA_BASE_URL for the same reason as Threads.
 */

function caps() {
  return PROVIDERS.instagram.capabilities;
}

function publicMediaBase(): string | null {
  return process.env.APP_PUBLIC_MEDIA_BASE_URL ?? null;
}

function httpError(e: unknown): PublishErrorInfo {
  if (e instanceof ProviderHttpError) {
    return {
      code: `instagram_http_${e.status}`,
      title: "Instagram rejected the request",
      message: e.status === 190 ? "Token expired — reconnect the account." : e.message,
      retryable: e.status >= 500 || e.status === 429,
      technical: e.body,
    };
  }
  return {
    code: "instagram_error",
    title: "Instagram publish failed",
    message: (e as Error).message ?? "Unknown error",
    retryable: false,
  };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export const instagramAdapter: SocialProviderAdapter = {
  id: "instagram",
  capabilities: caps,
  validateContent(input) {
    const settings = input.settings as { altText?: string };
    const media = input.content.media;
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
      if (m.kind === "image" && m.mime && !m.mime.startsWith("image/jpeg")) {
        return {
          code: "unsupported_format",
          title: "Instagram accepts JPEG images via URL containers",
          message: `“${m.filename}” is ${m.mime}. Convert to JPEG, or wait for the binary upload pass.`,
          retryable: false,
        };
      }
      if (!publicMediaBase()) {
        return {
          code: "public_url_required",
          title: "Media on Instagram needs a public URL",
          message:
            "Instagram fetches media from a public URL. Set APP_PUBLIC_MEDIA_BASE_URL (a reachable origin serving your storage), or deselect Instagram.",
          retryable: false,
        };
      }
      void settings;
    }
    return null;
  },
  async uploadMedia() {
    return { remoteMediaId: "" }; // containers reference public URLs
  },
  async createPost(input, ctx: AdapterAccountContext): Promise<AdapterPublishResult> {
    if (!ctx.accessToken) throw Object.assign(new Error("No Instagram token"), { code: "no_session" });
    const base = publicMediaBase();
    if (!base && input.content.media.length > 0) {
      throw Object.assign(
        new Error("Instagram media needs APP_PUBLIC_MEDIA_BASE_URL configured. non_retryable"),
        { code: "public_url_required" }
      );
    }
    const isCarousel = input.content.media.length > 1;
    const settings = input.settings as { altText?: string; aiGenerated?: boolean };
    const caption = input.content.caption;

    const childIds: string[] = [];
    if (isCarousel) {
      for (const m of input.content.media) {
        const container = await igCreateMediaContainer(
          ctx.externalAccountId,
          ctx.accessToken,
          {
            mediaType: m.kind === "video" ? "VIDEO" : "IMAGE",
            imageUrl: m.kind === "image" && m.storageKey ? `${base}/${m.storageKey}` : undefined,
            videoUrl: m.kind === "video" && m.storageKey ? `${base}/${m.storageKey}` : undefined,
            isCarouselItem: true,
          }
        );
        childIds.push(container.creationId);
      }
      await sleep(1200); // docs: children must finish before the carousel container
    }

    const mainContainer = await igCreateMediaContainer(
      ctx.externalAccountId,
      ctx.accessToken,
      isCarousel
        ? {
            mediaType: "CAROUSEL",
            caption,
            aiGenerated: input.aiDisclosed,
          }
        : {
            mediaType: input.content.media[0]?.kind === "video" ? "REELS" : "IMAGE",
            imageUrl:
              input.content.media[0]?.kind === "image" && input.content.media[0].storageKey
                ? `${base}/${input.content.media[0].storageKey}`
                : undefined,
            videoUrl:
              input.content.media[0]?.kind === "video" && input.content.media[0].storageKey
                ? `${base}/${input.content.media[0].storageKey}`
                : undefined,
            caption,
            altText: settings.altText,
            aiGenerated: input.aiDisclosed,
          }
    );
    if (childIds.length > 0) {
      // Attach children — Graph API v23 expects a comma list on the carousel container.
      await fetch(`${`https://graph.facebook.com/v23.0`}/${mainContainer.creationId}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${ctx.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ children: childIds.join(",") }),
      });
    }

    // Poll container status (docs: once per minute, ≤5 minutes).
    let ready = false;
    for (let i = 0; i < 5; i++) {
      const status = await igContainerStatus(mainContainer.creationId, ctx.accessToken).catch(() => null);
      if (status?.statusCode === "FINISHED") {
        ready = true;
        break;
      }
      if (status?.statusCode === "ERROR" || status?.statusCode === "EXPIRED") {
        throw Object.assign(new Error(`Instagram container ${status.statusCode}`), { status: 422 });
      }
      await sleep(3000);
    }
    if (!ready && isCarousel) {
      throw Object.assign(new Error("Instagram carousel container did not finish in time"), { status: 504 });
    }

    const published = await igPublishContainer(ctx.externalAccountId, ctx.accessToken, mainContainer.creationId);
    return {
      providerPostId: published.mediaId,
      permalink: `https://instagram.com/p/${published.mediaId.slice(0, 11)}`,
    };
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
