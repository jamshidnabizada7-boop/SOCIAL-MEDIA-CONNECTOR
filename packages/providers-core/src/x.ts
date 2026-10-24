import { fetchJson, type FetchLike } from "./http.js";

/**
 * X API v2 client (pay-per-usage, verified 2026-10-02: Post create $0.015).
 * Chunked media upload (INIT → APPEND×N → FINALIZE) then tweet creation.
 * Spending is metered — the adapter gates on X_POSTING_ENABLED.
 */

const API = "https://api.x.com/2";

export interface XMediaInit {
  mediaId: string;
  processingInfo?: unknown;
}

export async function xMediaInit(
  accessToken: string,
  totalBytes: number,
  mediaType: string,
  opts?: { fetchImpl?: FetchLike }
): Promise<XMediaInit> {
  const res = await fetchJson<Record<string, string>>("X", `${API}/media/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      command: "INIT",
      total_bytes: String(totalBytes),
      media_type: mediaType,
      media_category: mediaType.startsWith("video") ? "tweet_video" : "tweet_image",
    }).toString(),
    fetchImpl: opts?.fetchImpl,
  });
  return { mediaId: res.media_id_string ?? res.media_id };
}

export async function xMediaAppend(
  accessToken: string,
  mediaId: string,
  segmentIndex: number,
  chunk: Uint8Array,
  opts?: { fetchImpl?: FetchLike }
): Promise<void> {
  const form = new FormData();
  form.append("command", "APPEND");
  form.append("media_id", mediaId);
  form.append("segment_index", String(segmentIndex));
  form.append("media_data", Buffer.from(chunk).toString("base64"));
  await fetchJson("X", `${API}/media/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
    timeoutMs: 120_000,
    fetchImpl: opts?.fetchImpl,
  });
}

export async function xMediaFinalize(
  accessToken: string,
  mediaId: string,
  opts?: { fetchImpl?: FetchLike }
): Promise<{ processingInfo?: unknown }> {
  return fetchJson("X", `${API}/media/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ command: "FINALIZE", media_id: mediaId }).toString(),
    fetchImpl: opts?.fetchImpl,
  });
}

export async function xCreateTweet(
  accessToken: string,
  input: { text: string; mediaIds?: string[]; replyTo?: string },
  opts?: { fetchImpl?: FetchLike }
): Promise<{ tweetId: string }> {
  const body: Record<string, unknown> = { text: input.text };
  if (input.mediaIds?.length) body.media = { media_ids: input.mediaIds };
  if (input.replyTo) body.reply = { in_reply_to_tweet_id: input.replyTo };
  const res = await fetchJson<{ data: { id: string } }>("X", `${API}/tweets`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    fetchImpl: opts?.fetchImpl,
  });
  return { tweetId: res.data.id };
}

export async function xDeleteTweet(
  accessToken: string,
  tweetId: string,
  opts?: { fetchImpl?: FetchLike }
): Promise<void> {
  await fetchJson("X", `${API}/tweets/${tweetId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
    fetchImpl: opts?.fetchImpl,
  });
}

export async function xMe(accessToken: string, opts?: { fetchImpl?: FetchLike }): Promise<{ id: string; username: string }> {
  const res = await fetchJson<{ data: { id: string; username: string } }>("X", `${API}/users/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    fetchImpl: opts?.fetchImpl,
  });
  return res.data;
}

/** Uploads bytes through INIT/APPEND/FINALIZE in 4 MB chunks. */
export async function xUploadMediaBytes(
  accessToken: string,
  bytes: Uint8Array,
  mime: string,
  opts?: { fetchImpl?: FetchLike }
): Promise<string> {
  const init = await xMediaInit(accessToken, bytes.byteLength, mime, opts);
  const CHUNK = 4 * 1024 * 1024;
  let index = 0;
  for (let offset = 0; offset < bytes.byteLength; offset += CHUNK) {
    await xMediaAppend(accessToken, init.mediaId, index++, bytes.subarray(offset, offset + CHUNK), opts);
  }
  await xMediaFinalize(accessToken, init.mediaId, opts);
  return init.mediaId;
}
