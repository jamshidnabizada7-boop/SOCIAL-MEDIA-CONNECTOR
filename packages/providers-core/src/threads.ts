import { fetchJson, type FetchLike } from "./http.js";

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
  },
  opts?: { fetchImpl?: FetchLike }
): Promise<ThreadsContainer> {
  const body: Record<string, unknown> = { media_type: input.mediaType };
  if (input.text) body.text = input.text;
  if (input.imageUrl) body.image_url = input.imageUrl;
  if (input.videoUrl) body.video_url = input.videoUrl;
  return fetchJson<ThreadsContainer>("Threads", `${GRAPH}/${threadsUserId}/threads`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    timeoutMs: 60_000,
    fetchImpl: opts?.fetchImpl,
  });
}

export async function threadsContainerStatus(
  threadsUserId: string,
  accessToken: string,
  creationId: string,
  opts?: { fetchImpl?: FetchLike }
): Promise<{ statusCode: "IN_PROGRESS" | "FINISHED" | "EXPIRED" | "ERROR" }> {
  return fetchJson("Threads", `${GRAPH}/${creationId}?fields=status`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    fetchImpl: opts?.fetchImpl,
  });
}

export async function threadsPublish(
  threadsUserId: string,
  accessToken: string,
  creationId: string,
  opts?: { fetchImpl?: FetchLike }
): Promise<{ postId: string }> {
  return fetchJson<{ id: string }>("Threads", `${GRAPH}/${threadsUserId}/threads_publish`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ creation_id: creationId }),
    fetchImpl: opts?.fetchImpl,
  }).then((r) => ({ postId: r.id }));
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
