import { fetchJson, type FetchLike } from "./http.js";

/**
 * Pinterest API v5 client. Pins require a board (validation enforces a board
 * selection in the variant settings). Media: upload bytes to /v5/media, poll
 * to SUCCEEDED, reference by media_id.
 */

const API = "https://api.pinterest.com/v5";

export async function pinterestUploadMedia(
  accessToken: string,
  file: { bytes: Uint8Array; mime: string; filename: string },
  opts?: { fetchImpl?: FetchLike }
): Promise<{ mediaId: string }> {
  const form = new FormData();
  form.append("media_type", file.mime.startsWith("video") ? "video" : "image");
  form.append("file", new Blob([new Uint8Array(file.bytes)], { type: file.mime }), file.filename);
  return fetchJson<{ media_id: string }>("Pinterest", `${API}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
    timeoutMs: 120_000,
    fetchImpl: opts?.fetchImpl,
  }).then((r) => ({ mediaId: r.media_id }));
}

export async function pinterestMediaStatus(
  accessToken: string,
  mediaId: string,
  opts?: { fetchImpl?: FetchLike }
): Promise<{ status: "succeeded" | "failed" | "processing" }> {
  return fetchJson<{ status: "succeeded" | "failed" | "processing" }>(
    "Pinterest",
    `${API}/media/${mediaId}`,
    { headers: { Authorization: `Bearer ${accessToken}` }, fetchImpl: opts?.fetchImpl }
  );
}

export interface PinterestPinInput {
  boardId: string;
  title?: string;
  description?: string;
  link?: string;
  mediaId?: string;
  imageUrl?: string;
}

export async function pinterestCreatePin(
  accessToken: string,
  input: PinterestPinInput,
  opts?: { fetchImpl?: FetchLike }
): Promise<{ pinId: string; link?: string }> {
  const mediaSource = input.mediaId
    ? { source_type: "media_id", media_id: input.mediaId }
    : { source_type: "image_url", url: input.imageUrl! };
  return fetchJson<{ id: string; link?: string }>("Pinterest", `${API}/pins`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      board_id: input.boardId,
      ...(input.title ? { title: input.title } : {}),
      ...(input.description ? { description: input.description } : {}),
      ...(input.link ? { link: input.link } : {}),
      media_source: mediaSource,
    }),
    fetchImpl: opts?.fetchImpl,
  }).then((r) => ({ pinId: r.id, link: r.link }));
}

export async function pinterestDeletePin(
  accessToken: string,
  pinId: string,
  opts?: { fetchImpl?: FetchLike }
): Promise<void> {
  await fetchJson("Pinterest", `${API}/pins/${pinId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
    fetchImpl: opts?.fetchImpl,
  });
}

export interface PinterestBoard {
  id: string;
  name: string;
}

export async function pinterestListBoards(
  accessToken: string,
  opts?: { fetchImpl?: FetchLike }
): Promise<PinterestBoard[]> {
  return fetchJson<{ items: PinterestBoard[] }>("Pinterest", `${API}/boards`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    fetchImpl: opts?.fetchImpl,
  }).then((r) => r.items ?? []);
}
