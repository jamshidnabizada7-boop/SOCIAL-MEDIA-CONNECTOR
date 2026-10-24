import type {
  AdapterAccountContext,
  AdapterPublishInput,
  AdapterPublishResult,
  AdapterMedia,
  PublishErrorInfo,
  SocialProviderAdapter,
} from "./contract.js";
import {
  linkedinCreatePost,
  linkedinDeletePost,
  linkedinPutBytes,
  linkedinRegisterUpload,
  ProviderHttpError,
} from "@aria/providers-core";
import { PROVIDERS } from "@aria/shared-types";

/**
 * LinkedIn adapter. Member or organization posting; media through the
 * registerUpload → PUT → URN flow (Images/Videos/Documents recipes).
 * The author URN comes from variant settings — the OAuth token speaks for the
 * member, and organization posts use an org URN the user picks.
 */

function caps() {
  return PROVIDERS.linkedin.capabilities;
}

function httpError(e: unknown): PublishErrorInfo {
  if (e instanceof ProviderHttpError) {
    return {
      code: `linkedin_http_${e.status}`,
      title: "LinkedIn rejected the request",
      message: e.status === 403 ? "Access denied — the product/permission isn't approved yet." : e.message,
      retryable: e.status >= 500 || e.status === 429,
      technical: e.body,
    };
  }
  return {
    code: "linkedin_error",
    title: "LinkedIn publish failed",
    message: (e as Error).message ?? "Unknown error",
    retryable: false,
  };
}

function authorUrn(ctx: AdapterAccountContext, input: AdapterPublishInput): string {
  const settings = input.settings as { authorUrn?: string };
  if (settings.authorUrn) return settings.authorUrn;
  return `urn:li:person:${ctx.externalAccountId}`;
}

function mediaRecipe(kind: AdapterMedia["kind"]) {
  switch (kind) {
    case "video":
      return "urn:li:digitalmediaRecipe:feedshare-video" as const;
    case "document":
      return "urn:li:digitalmediaRecipe:feedshare-document" as const;
    default:
      return "urn:li:digitalmediaRecipe:feedshare-image" as const;
  }
}

export const linkedinAdapter: SocialProviderAdapter = {
  id: "linkedin",
  capabilities: caps,
  validateContent(input) {
    const media = input.content.media;
    if (media.length > 1) {
      return {
        code: "too_many_media",
        title: "LinkedIn takes a single media per post",
        message: "One image/video/document for now — MultiImage posts need the MultiImage API pass.",
        retryable: false,
      };
    }
    for (const m of media) {
      if (!m.data) {
        return {
          code: "media_content_missing",
          title: "Media content is unavailable",
          message: `The stored content for “${m.filename}” could not be loaded. Re-upload the file.`,
          retryable: false,
        };
      }
      if (m.kind === "video" && m.data.byteLength > caps().maxVideoBytes) {
        return {
          code: "media_too_large",
          title: "Media exceeds LinkedIn's size limit",
          message: `“${m.filename}” is over ${Math.round(caps().maxVideoBytes / 1024 / 1024)} MB.`,
          retryable: false,
        };
      }
    }
    return null;
  },
  async uploadMedia(media, ctx: AdapterAccountContext) {
    if (!ctx.accessToken) throw Object.assign(new Error("No LinkedIn token"), { code: "no_session" });
    if (!media.data) {
      throw Object.assign(new Error(`Stored media content is missing (${media.filename}). non_retryable`), {
        code: "media_content_missing",
      });
    }
    // The upload owner defaults to the connected member — the same author the
    // post uses unless a variant overrides it.
    const ownerUrn = `urn:li:person:${ctx.externalAccountId}`;
    const reg = await linkedinRegisterUpload(ctx.accessToken, ownerUrn, mediaRecipe(media.kind), media.data.byteLength);
    await linkedinPutBytes(reg.uploadUrl, media.data, media.mime ?? "application/octet-stream");
    return { remoteMediaId: reg.assetUrn };
  },
  async createPost(input, ctx: AdapterAccountContext): Promise<AdapterPublishResult> {
    if (!ctx.accessToken) throw Object.assign(new Error("No LinkedIn token"), { code: "no_session" });
    const settings = input.settings as { authorUrn?: string; visibility?: "PUBLIC" | "CONNECTIONS" };
    const first = input.content.media[0];
    const result = await linkedinCreatePost(ctx.accessToken, {
      authorUrn: authorUrn(ctx, input),
      commentary: input.content.caption,
      mediaUrn: first?.remoteMediaId,
      mediaTitle: first?.filename,
      visibility: settings.visibility ?? "PUBLIC",
    });
    return {
      providerPostId: result.postUrn,
      permalink: result.postUrn ? `https://www.linkedin.com/feed/update/${result.postUrn}` : undefined,
    };
  },
  async getPostStatus() {
    return { state: "published" as const };
  },
  async deletePost(remotePostId, ctx) {
    if (!ctx.accessToken) throw new Error("No LinkedIn token");
    await linkedinDeletePost(ctx.accessToken, remotePostId);
  },
  normalizeError: httpError,
};
