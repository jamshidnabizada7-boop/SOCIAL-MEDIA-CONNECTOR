import { fetchJson, postForm, ProviderHttpError, type FetchLike } from "./http.js";

/**
 * Threads API client (verified 2026-09-30: permissions threads_basic +
 * threads_content_publish; until advanced access is approved, publishing is
 * limited to your own account and app testers).
 *
 * Container→publish flow; media containers require PUBLIC image/video URLs
 * (Threads fetches them itself) — local storage bytes can't be handed over,
 * so image/video publishing is gated on a public media base URL.
 */

const GRAPH = "https://graph.threads.net/v1.0";

export type ThreadsMediaType = "TEXT" | "IMAGE" | "VIDEO" | "CAROUSEL";

export interface ThreadsContainer {
  creationId: string;
}

export async function threadsCreateContainer(
  threadsUserId: string,
  accessToken: string,
  input: {
    mediaType: ThreadsMediaType;
    text?: string;
    imageUrl?: string;
    videoUrl?: string;
    altText?: string;
    isCarouselItem?: boolean;
    children?: string[];
  },
  opts?: { fetchImpl?: FetchLike }
): Promise<ThreadsContainer> {
  const body: Record<string, string> = { media_type: input.mediaType };
  if (input.text) body.text = input.text;
  if (input.imageUrl) body.image_url = input.imageUrl;
  if (input.videoUrl) body.video_url = input.videoUrl;
  if (input.altText) body.alt_text = input.altText;
  if (input.isCarouselItem) body.is_carousel_item = "true";
  if (input.children) body.children = input.children.join(",");
  const result = await postForm<{ id: string }>("Threads", `${GRAPH}/${threadsUserId}/threads`, body, {
    headers: { Authorization: `Bearer ${accessToken}` },
    timeoutMs: 60_000,
    fetchImpl: opts?.fetchImpl,
  });
  if (typeof result.id !== "string" || !result.id.trim()) throw new Error("Threads did not return a media container ID.");
  return { creationId: result.id };
}

export async function threadsContainerStatus(
  threadsUserId: string,
  accessToken: string,
  creationId: string,
  opts?: { fetchImpl?: FetchLike }
): Promise<{ statusCode: "IN_PROGRESS" | "FINISHED" | "EXPIRED" | "ERROR" | "PUBLISHED" }> {
  const result = await fetchJson<{ status: "IN_PROGRESS" | "FINISHED" | "EXPIRED" | "ERROR" | "PUBLISHED" }>("Threads", `${GRAPH}/${creationId}?fields=status`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    fetchImpl: opts?.fetchImpl,
  });
  return { statusCode: result.status };
}

export async function threadsPublish(
  threadsUserId: string,
  accessToken: string,
  creationId: string,
  opts?: { fetchImpl?: FetchLike }
): Promise<{ postId: string }> {
  return postForm<{ id: string }>("Threads", `${GRAPH}/${threadsUserId}/threads_publish`, { creation_id: creationId }, {
    headers: { Authorization: `Bearer ${accessToken}` },
    fetchImpl: opts?.fetchImpl,
  }).then((r) => {
    if (typeof r.id !== "string" || !r.id.trim()) throw new ProviderHttpError("Threads did not confirm the published post ID.", 0, "Threads");
    return { postId: r.id };
  });
}

export async function threadsPostPermalink(postId: string, accessToken: string, opts?: { fetchImpl?: FetchLike }): Promise<string | undefined> {
  const result = await fetchJson<{ permalink?: string }>("Threads", `${GRAPH}/${postId}?fields=permalink`, {
    headers: { Authorization: `Bearer ${accessToken}` }, fetchImpl: opts?.fetchImpl,
  });
  return result.permalink;
}

export async function threadsDeletePost(
  threadsUserId: string,
  accessToken: string,
  postId: string,
  opts?: { fetchImpl?: FetchLike }
): Promise<void> {
  await fetchJson("Threads", `${GRAPH}/${postId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
    fetchImpl: opts?.fetchImpl,
  });
}
