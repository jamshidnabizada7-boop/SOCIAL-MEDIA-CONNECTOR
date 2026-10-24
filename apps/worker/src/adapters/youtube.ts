import type {
  AdapterAccountContext,
  AdapterPublishResult,
  PublishErrorInfo,
  SocialProviderAdapter,
} from "./contract.js";
import {
  youtubeInitUpload,
  youtubePutVideo,
  youtubeGetStatus,
  youtubeDeleteVideo,
  ProviderHttpError,
} from "@aria/providers-core";
import { PROVIDERS } from "@aria/shared-types";

/**
 * YouTube adapter. Title (≤100) + video required (plan-verified facts);
 * upload through a resumable session; asyncProcessing while the platform
 * encodes — status reconciled via videos.list or webhooks.
 */

const DEFAULT_CATEGORY = "22"; // People & Blogs

function caps() {
  return PROVIDERS.youtube.capabilities;
}

function httpError(e: unknown): PublishErrorInfo {
  if (e instanceof ProviderHttpError) {
    return {
      code: `youtube_http_${e.status}`,
      title: e.status === 401 || e.status === 403 ? "YouTube access problem" : "YouTube rejected the upload",
      message:
        e.status === 403
          ? "Access denied — check the quota and that the channel authorized the youtube.upload scope."
          : e.message,
      retryable: e.status >= 500 || e.status === 429,
      technical: e.body,
    };
  }
  return {
    code: "youtube_error",
    title: "YouTube publish failed",
    message: (e as Error).message ?? "Unknown error",
    retryable: false,
  };
}

export const youtubeAdapter: SocialProviderAdapter = {
  id: "youtube",
  capabilities: caps,
  validateContent(input) {
    const media = input.content.media;
    const title = input.content.title?.trim();
    if (!title) {
      return {
        code: "title_required",
        title: "YouTube needs a title",
        message: "Videos on YouTube require a title of up to 100 characters.",
        retryable: false,
      };
    }
    if (title.length > 100) {
      return {
        code: "title_too_long",
        title: "YouTube titles are capped at 100 characters",
        message: `The title is ${title.length} characters.`,
        retryable: false,
      };
    }
    if (media.length !== 1 || media[0].kind !== "video") {
      return {
        code: "video_required",
        title: "YouTube requires exactly one video",
        message: "Text/image posts aren't supported on YouTube.",
        retryable: false,
      };
    }
    if (!media[0].data) {
      return {
        code: "media_content_missing",
        title: "Video content is unavailable",
        message: `The stored content for “${media[0].filename}” could not be loaded. Re-upload the video.`,
        retryable: false,
      };
    }
    return null;
  },
  async uploadMedia() {
    return { remoteMediaId: "" }; // upload happens in createPost via the session
  },
  async createPost(input, ctx: AdapterAccountContext): Promise<AdapterPublishResult> {
    if (!ctx.accessToken) throw Object.assign(new Error("No YouTube token"), { code: "no_session" });
    const video = input.content.media[0];
    if (!video.data) throw Object.assign(new Error("Video bytes missing"), { code: "media_content_missing" });

    const settings = input.settings as {
      visibility?: "public" | "private" | "unlisted";
      madeForKids?: boolean;
      categoryId?: string;
      tags?: string[];
    };
    const meta = {
      title: input.content.title!.slice(0, 100),
      description: [input.content.caption, input.content.link].filter(Boolean).join("\n\n"),
      privacyStatus: settings.visibility ?? "public",
      madeForKids: settings.madeForKids,
      categoryId: settings.categoryId ?? DEFAULT_CATEGORY,
      tags: settings.tags,
    };
    const mime = video.mime ?? "video/mp4";

    const { uploadUrl } = await youtubeInitUpload(ctx.accessToken, meta, video.data.byteLength, mime);
    const result = await youtubePutVideo(uploadUrl, video.data, mime);
    ctx.log("youtube video uploaded", { videoId: result.id });
    return {
      providerPostId: result.id,
      permalink: `https://youtube.com/watch?v=${result.id}`,
      asyncProcessing: true, // platform encodes after upload
      providerRequestId: result.id,
    };
  },
  async getPostStatus(remotePostId, ctx) {
    if (!ctx.accessToken) return { state: "processing" };
    const status = await youtubeGetStatus(ctx.accessToken, remotePostId).catch(() => null);
    if (!status) return { state: "processing" };
    if (status.uploadStatus === "processed" || status.uploadStatus === "public") {
      return { state: "published" as const };
    }
    if (status.uploadStatus === "deleted" || status.uploadStatus === "error") {
      return {
        state: "failed" as const,
        error: {
          code: "youtube_processing_failed",
          title: "YouTube processing failed",
          message: `Upload status: ${status.uploadStatus}.`,
          retryable: false,
        },
      };
    }
    return { state: "processing" as const };
  },
  async deletePost(remotePostId, ctx) {
    if (!ctx.accessToken) throw new Error("No YouTube token");
    await youtubeDeleteVideo(ctx.accessToken, remotePostId);
  },
  normalizeError: httpError,
};
