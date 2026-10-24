import { defaultFetch, fetchJson, type FetchLike } from "./http.js";

/**
 * YouTube Data API v3 client (publishing).
 * Verified 2026-10-02: resumable upload via upload/youtube, scope
 * youtube.upload, privacyStatus public/private/unlisted, retry on 5xx.
 */

const UPLOAD_BASE = "https://www.googleapis.com/upload/youtube/v3/videos";
const API_BASE = "https://www.googleapis.com/youtube/v3";

export interface YoutubeVideoMeta {
  title: string;
  description: string;
  privacyStatus: "public" | "private" | "unlisted";
  categoryId?: string;
  madeForKids?: boolean;
  tags?: string[];
}

/** Step 1: initiate a resumable session. Returns the upload URL (Location). */
export async function youtubeInitUpload(
  accessToken: string,
  meta: YoutubeVideoMeta,
  bytesLength: number,
  mime: string,
  opts?: { fetchImpl?: FetchLike }
): Promise<{ uploadUrl: string }> {
  const doFetch = opts?.fetchImpl ?? defaultFetch;
  const res = await doFetch(`${UPLOAD_BASE}?uploadType=resumable&part=snippet,status`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Length": String(bytesLength),
      "X-Upload-Content-Type": mime,
    },
    body: JSON.stringify({
      snippet: {
        title: meta.title,
        description: meta.description,
        ...(meta.categoryId ? { categoryId: meta.categoryId } : {}),
        ...(meta.tags?.length ? { tags: meta.tags } : {}),
      },
      status: {
        privacyStatus: meta.privacyStatus,
        ...(meta.madeForKids !== undefined ? { selfDeclaredMadeForKids: meta.madeForKids } : {}),
      },
    }),
    signal: opts?.fetchImpl ? undefined : undefined,
  });
  const text = await res.text();
  if (!res.ok || !res.headers.get("location")) {
    throw Object.assign(new Error(`YouTube upload init failed (${res.status})`), {
      status: res.status,
      provider: "YouTube",
      body: text.slice(0, 300),
    });
  }
  return { uploadUrl: res.headers.get("location")! };
}

/** Step 2: upload the bytes to the session URL in one request. */
export async function youtubePutVideo(
  uploadUrl: string,
  bytes: Uint8Array,
  mime: string,
  opts?: { fetchImpl?: FetchLike }
): Promise<{ id: string; status?: { privacyStatus?: string } }> {
  const doFetch = opts?.fetchImpl ?? defaultFetch;
  const res = await doFetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": mime, "Content-Length": String(bytes.byteLength) },
    body: Buffer.from(bytes),
  });
  const text = await res.text();
  if (!res.ok) {
    throw Object.assign(new Error(`YouTube upload failed (${res.status})`), {
      status: res.status,
      provider: "YouTube",
      body: text.slice(0, 300),
    });
  }
  return JSON.parse(text);
}

export interface YoutubeProcessingStatus {
  uploadStatus: string;
  processingStatus: string;
}

export async function youtubeGetStatus(
  accessToken: string,
  videoId: string,
  opts?: { fetchImpl?: FetchLike }
): Promise<YoutubeProcessingStatus> {
  const res = await fetchJson<{ items: Array<{ status?: { uploadStatus?: string }; processingDetails?: { processingStatus?: string } }> }>(
    "YouTube",
    `${API_BASE}/videos?part=status,processingDetails&id=${encodeURIComponent(videoId)}`,
    { headers: { Authorization: `Bearer ${accessToken}` }, fetchImpl: opts?.fetchImpl }
  );
  const item = res.items?.[0];
  return {
    uploadStatus: item?.status?.uploadStatus ?? "unknown",
    processingStatus: item?.processingDetails?.processingStatus ?? "unknown",
  };
}

export async function youtubeDeleteVideo(
  accessToken: string,
  videoId: string,
  opts?: { fetchImpl?: FetchLike }
): Promise<void> {
  await fetchJson("YouTube", `${API_BASE}/videos?id=${encodeURIComponent(videoId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
    fetchImpl: opts?.fetchImpl,
  });
}
