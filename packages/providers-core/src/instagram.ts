import { graphBase } from "./config.js";
import { fetchJson, type FetchLike } from "./http.js";

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
    aiGenerated?: boolean;
  },
  opts?: { fetchImpl?: FetchLike }
): Promise<{ creationId: string }> {
  const body: Record<string, unknown> = {};
  if (input.mediaType) body.media_type = input.mediaType;
  if (input.imageUrl) body.image_url = input.imageUrl;
  if (input.videoUrl) body.video_url = input.videoUrl;
  if (input.caption) body.caption = input.caption;
  if (input.altText) body.alt_text = input.altText;
  if (input.isCarouselItem) body.is_carousel_item = true;
  if (input.aiGenerated) body.is_ai_generated = true;
  return fetchJson<IgContainer>("Instagram", `${graphBase()}/${igUserId}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    timeoutMs: 60_000,
    fetchImpl: opts?.fetchImpl,
  });
}

export async function igContainerStatus(
  creationId: string,
  accessToken: string,
  opts?: { fetchImpl?: FetchLike }
): Promise<{ statusCode: "IN_PROGRESS" | "FINISHED" | "EXPIRED" | "ERROR" | "PUBLISHED" }> {
  return fetchJson("Instagram", `${graphBase()}/${creationId}?fields=status_code`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    fetchImpl: opts?.fetchImpl,
  });
}

export async function igPublishContainer(
  igUserId: string,
  accessToken: string,
  creationId: string,
  opts?: { fetchImpl?: FetchLike }
): Promise<{ mediaId: string }> {
  return fetchJson<{ id: string }>("Instagram", `${graphBase()}/${igUserId}/media_publish`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ creation_id: creationId }),
    fetchImpl: opts?.fetchImpl,
  }).then((r) => ({ mediaId: r.id }));
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
