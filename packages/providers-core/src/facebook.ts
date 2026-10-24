import { fetchJson, type FetchLike } from "./http.js";

/**
 * Facebook Pages publishing client (Graph API v23.0, verified 2026-09-30).
 * Page token required; photos/videos accept multipart binary (bytes) so local
 * storage works without public URLs.
 */

const GRAPH = "https://graph.facebook.com/v23.0";

export async function facebookPostToFeed(
  pageId: string,
  pageToken: string,
  input: { message?: string; link?: string },
  opts?: { fetchImpl?: FetchLike }
): Promise<{ postId: string }> {
  const form: Record<string, string> = {};
  if (input.message) form.message = input.message;
  if (input.link) form.link = input.link;
  return fetchJson<{ post_id?: string; id?: string }>("Facebook", `${GRAPH}/${pageId}/feed`, {
    method: "POST",
    headers: { Authorization: `Bearer ${pageToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(form),
    fetchImpl: opts?.fetchImpl,
  }).then((r) => ({ postId: r.post_id ?? r.id ?? "" }));
}

export async function facebookUploadPhoto(
  pageId: string,
  pageToken: string,
  file: { bytes: Uint8Array; mime: string; filename: string; caption?: string },
  opts?: { fetchImpl?: FetchLike }
): Promise<{ postId: string; photoId: string }> {
  const form = new FormData();
  form.append("source", new Blob([new Uint8Array(file.bytes)], { type: file.mime }), file.filename);
  if (file.caption) form.append("caption", file.caption);
  return fetchJson<{ post_id?: string; id?: string }>("Facebook", `${GRAPH}/${pageId}/photos`, {
    method: "POST",
    headers: { Authorization: `Bearer ${pageToken}` },
    body: form,
    timeoutMs: 120_000,
    fetchImpl: opts?.fetchImpl,
  }).then((r) => ({ postId: (r as { post_id?: string }).post_id ?? (r as { id?: string }).id ?? "", photoId: (r as { id?: string }).id ?? "" }));
}

export async function facebookUploadVideo(
  pageId: string,
  pageToken: string,
  file: { bytes: Uint8Array; mime: string; filename: string; description?: string },
  opts?: { fetchImpl?: FetchLike }
): Promise<{ videoId: string }> {
  const form = new FormData();
  form.append("source", new Blob([new Uint8Array(file.bytes)], { type: file.mime }), file.filename);
  if (file.description) form.append("description", file.description);
  return fetchJson<{ id: string }>("Facebook", `https://graph-video.facebook.com/v23.0/${pageId}/videos`, {
    method: "POST",
    headers: { Authorization: `Bearer ${pageToken}` },
    body: form,
    timeoutMs: 300_000,
    fetchImpl: opts?.fetchImpl,
  }).then((r) => ({ videoId: r.id }));
}

export async function facebookDeletePost(
  postId: string,
  pageToken: string,
  opts?: { fetchImpl?: FetchLike }
): Promise<void> {
  await fetchJson("Facebook", `${GRAPH}/${postId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${pageToken}` },
    fetchImpl: opts?.fetchImpl,
  });
}
