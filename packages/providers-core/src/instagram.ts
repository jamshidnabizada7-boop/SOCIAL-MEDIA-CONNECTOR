import { graphBase } from "./config.js";
import { fetchJson, postForm, ProviderHttpError, type FetchLike } from "./http.js";

/**
 * Instagram Graph API publishing client (verified 2026-09-30).
 * Container→publish flow; media containers need PUBLIC image/video URLs
 * (JPEG only for photos; resumable binary upload is Facebook-login-only).
 * Gated on a public media base URL like Threads.
 */



export interface IgContainer {
  creationId: string;
}

export async function igCreateMediaContainer(
  igUserId: string,
  accessToken: string,
  input: {
    mediaType?: "IMAGE" | "VIDEO" | "REELS" | "STORIES" | "CAROUSEL";
    imageUrl?: string;
    videoUrl?: string;
    caption?: string;
    altText?: string;
    isCarouselItem?: boolean;
    children?: string[];
    aiGenerated?: boolean;
  },
  opts?: { fetchImpl?: FetchLike }
): Promise<{ creationId: string }> {
  const body: Record<string, string> = {};
  // Photo containers use image_url; IMAGE is not an Instagram media_type.
  if (input.mediaType && input.mediaType !== "IMAGE") body.media_type = input.mediaType;
  if (input.imageUrl) body.image_url = input.imageUrl;
  if (input.videoUrl) body.video_url = input.videoUrl;
  if (input.caption) body.caption = input.caption;
  if (input.altText) body.alt_text = input.altText;
  if (input.isCarouselItem) body.is_carousel_item = "true";
  if (input.children) body.children = input.children.join(",");
  if (input.aiGenerated) body.is_ai_generated = "true";
  const result = await postForm<{ id: string }>("Instagram", `${graphBase()}/${igUserId}/media`, body, {
    headers: { Authorization: `Bearer ${accessToken}` },
    timeoutMs: 60_000,
    fetchImpl: opts?.fetchImpl,
  });
  if (typeof result.id !== "string" || !result.id.trim()) throw new Error("Instagram did not return a media container ID.");
  return { creationId: result.id };
}

export async function igContainerStatus(
  creationId: string,
  accessToken: string,
  opts?: { fetchImpl?: FetchLike }
): Promise<{ statusCode: "IN_PROGRESS" | "FINISHED" | "EXPIRED" | "ERROR" | "PUBLISHED" }> {
  const result = await fetchJson<{ status_code: "IN_PROGRESS" | "FINISHED" | "EXPIRED" | "ERROR" | "PUBLISHED" }>("Instagram", `${graphBase()}/${creationId}?fields=status_code`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    fetchImpl: opts?.fetchImpl,
  });
  return { statusCode: result.status_code };
}

export async function igPublishContainer(
  igUserId: string,
  accessToken: string,
  creationId: string,
  opts?: { fetchImpl?: FetchLike }
): Promise<{ mediaId: string }> {
  return postForm<{ id: string }>("Instagram", `${graphBase()}/${igUserId}/media_publish`, { creation_id: creationId }, {
    headers: { Authorization: `Bearer ${accessToken}` },
    fetchImpl: opts?.fetchImpl,
  }).then((r) => {
    if (typeof r.id !== "string" || !r.id.trim()) throw new ProviderHttpError("Instagram did not confirm the published media ID.", 0, "Instagram");
    return { mediaId: r.id };
  });
}

export async function igMediaPermalink(mediaId: string, accessToken: string, opts?: { fetchImpl?: FetchLike }): Promise<string | undefined> {
  const result = await fetchJson<{ permalink?: string }>("Instagram", `${graphBase()}/${mediaId}?fields=permalink`, {
    headers: { Authorization: `Bearer ${accessToken}` }, fetchImpl: opts?.fetchImpl,
  });
  return result.permalink;
}

export async function igDeleteMedia(
  mediaId: string,
  accessToken: string,
  opts?: { fetchImpl?: FetchLike }
): Promise<void> {
  await fetchJson("Instagram", `${graphBase()}/${mediaId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
    fetchImpl: opts?.fetchImpl,
  });
}
