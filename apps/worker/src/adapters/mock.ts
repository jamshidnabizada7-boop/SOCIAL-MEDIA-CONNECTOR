import type { AdapterAccountContext, AdapterPublishInput, AdapterPublishResult, AdapterMedia, PublishErrorInfo } from "./contract.js";
import type { SocialProviderAdapter } from "./contract.js";
export type { SocialProviderAdapter };
import { PROVIDER_LIST } from "@aria/shared-types";
import type { ProviderCapabilities, ProviderId } from "@aria/shared-types";

/**
 * Mock adapter — implements the full adapter contract so the publishing
 * pipeline is end-to-end testable without any provider credentials.
 * Behavior: deterministic; video platforms (tiktok/youtube) report async
 * processing that resolves on the second status check.
 */

const processingCalls = new Map<string, number>();

function capabilitiesFor(id: ProviderId): ProviderCapabilities {
  return (
    PROVIDER_LIST.find((p) => p.id === id)?.capabilities ?? {
      formats: { text: true, image: true, video: false, document: false, carousel: false },
      altText: false,
      linkPreview: false,
      hashtags: true,
      firstComment: false,
      thumbnail: false,
      customCover: false,
      privacyControl: false,
      schedule: true,
      directPublish: true,
      manualPublishFallback: false,
      comments: false,
      analytics: false,
      deletion: false,
      editing: false,
      aiDisclosure: false,
      brandedContent: false,
      maxCaptionLength: 2000,
      maxImages: 1,
      maxVideoDurationSec: 600,
      maxVideoBytes: 1_000_000_000,
      maxImageBytes: 8_000_000,
      aspectRatios: [],
    }
  );
}

function validate(input: AdapterPublishInput, caps: ProviderCapabilities): PublishErrorInfo | null {
  const { caption, media, title } = input.content;
  if (!caps.formats.text && media.length === 0) {
    return {
      code: "media_required",
      title: "This network requires media",
      message: `${caps.maxCaptionLength >= 2200 ? "Posts" : "Video posts"} to this network must include media.`,
      retryable: false,
    };
  }
  if (caption.length > caps.maxCaptionLength) {
    return {
      code: "caption_too_long",
      title: "Caption exceeds the network limit",
      message: `${caption.length} characters — the network allows ${caps.maxCaptionLength}.`,
      retryable: false,
    };
  }
  if (caps.formats.video && !caps.formats.image && media.length > 0 && !media.some((m) => m.kind === "video")) {
    return {
      code: "video_required",
      title: "This network requires a video for this post",
      message: "Only video posts are supported.",
      retryable: false,
    };
  }
  if (caps.formats.video && !caps.formats.image && media.length === 0 && !caps.formats.text) {
    return {
      code: "video_required",
      title: "This network requires a video for this post",
      message: "Only video posts are supported.",
      retryable: false,
    };
  }
  if ((caps as { note?: string }).note?.includes("Title") && !title) {
    return {
      code: "title_required",
      title: "A title is required",
      message: "This network requires a title for video uploads.",
      retryable: false,
    };
  }
  return null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makeMockAdapter(id: ProviderId): SocialProviderAdapter {
  return {
    id,
    capabilities() {
      return capabilitiesFor(id);
    },
    validateContent(input) {
      return validate(input, capabilitiesFor(id));
    },
    async uploadMedia(media: AdapterMedia, ctx: AdapterAccountContext) {
      await sleep(media.kind === "video" ? 200 : 80);
      ctx.log("mock media uploaded", { mediaId: media.mediaId });
      return { remoteMediaId: `mock_${id}_${media.mediaId}` };
    },
    async createPost(input: AdapterPublishInput, ctx: AdapterAccountContext): Promise<AdapterPublishResult> {
      await sleep(150);
      const providerPostId = `mockpost_${id}_${Math.random().toString(36).slice(2, 10)}`;
      const isVideoPlatform = id === "tiktok" || id === "youtube";
      ctx.log("mock post created", { providerPostId, async: isVideoPlatform });
      return {
        providerPostId,
        permalink: `https://example.invalid/${id}/${providerPostId}`,
        asyncProcessing: isVideoPlatform && input.content.media.some((m) => m.kind === "video"),
        providerRequestId: `req_${providerPostId}`,
      };
    },
    async getPostStatus(remotePostId: string) {
      const calls = (processingCalls.get(remotePostId) ?? 0) + 1;
      processingCalls.set(remotePostId, calls);
      return calls >= 2 ? { state: "published" as const } : { state: "processing" as const };
    },
    normalizeError(error: unknown): PublishErrorInfo {
      const e = error as Error;
      return {
        code: "mock_provider_error",
        title: "Mock provider failure",
        message: e?.message ?? "Unknown error",
        retryable: true,
        technical: e?.stack?.slice(0, 500),
      };
    },
  };
}

const mockAdapters = new Map<ProviderId, SocialProviderAdapter>();

export function getMockAdapter(id: ProviderId): SocialProviderAdapter {
  let a = mockAdapters.get(id);
  if (!a) {
    a = makeMockAdapter(id);
    mockAdapters.set(id, a);
  }
  return a;
}
