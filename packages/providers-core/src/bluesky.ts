import { fetchJson, type FetchLike } from "./http.js";

/**
 * Bluesky (AT Protocol) client — app-password session flow.
 * App passwords are the officially supported self-serve integration path;
 * no developer app or review is required.
 *
 * NOTE: atproto OAuth (DPoP) is the newer recommended flow; app passwords
 * remain documented and supported. Revisit when we add scope granularity.
 */

export interface BlueskySession {
  accessJwt: string;
  refreshJwt: string;
  did: string;
  handle: string;
}

export const DEFAULT_BLUESKY_INSTANCE = process.env.BLUESKY_INSTANCE ?? "https://bsky.social";

export async function blueskyCreateSession(
  handle: string,
  appPassword: string,
  opts?: { instanceUrl?: string; fetchImpl?: FetchLike }
): Promise<BlueskySession> {
  const instance = opts?.instanceUrl ?? DEFAULT_BLUESKY_INSTANCE;
  return fetchJson<BlueskySession>("Bluesky", `${instance}/xrpc/com.atproto.server.createSession`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: handle, password: appPassword }),
    fetchImpl: opts?.fetchImpl,
  });
}

export async function blueskyRefreshSession(
  refreshJwt: string,
  opts?: { instanceUrl?: string; fetchImpl?: FetchLike }
): Promise<BlueskySession> {
  const instance = opts?.instanceUrl ?? DEFAULT_BLUESKY_INSTANCE;
  return fetchJson<BlueskySession>("Bluesky", `${instance}/xrpc/com.atproto.server.refreshSession`, {
    method: "POST",
    headers: { Authorization: `Bearer ${refreshJwt}` },
    fetchImpl: opts?.fetchImpl,
  });
}

export async function blueskyDeleteSession(
  accessJwt: string,
  opts?: { instanceUrl?: string; fetchImpl?: FetchLike }
): Promise<void> {
  const instance = opts?.instanceUrl ?? DEFAULT_BLUESKY_INSTANCE;
  await fetchJson("Bluesky", `${instance}/xrpc/com.atproto.server.deleteSession`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessJwt}` },
    fetchImpl: opts?.fetchImpl,
  });
}

export interface BlueskyImage {
  bytes: Uint8Array;
  mime: string;
  alt?: string;
}

export interface BlueskyPostInput {
  did: string;
  text: string;
  images?: BlueskyImage[];
  language?: string[];
  createdAt?: string;
  link?: string; // attached as an external-link embed when present
}

export interface BlueskyCreatedRecord {
  uri: string;
  cid: string;
}

/** Publishes one post (optionally with images / an external link card). */
export async function blueskyCreatePost(
  session: { accessJwt: string; did: string },
  input: BlueskyPostInput,
  opts?: { instanceUrl?: string; fetchImpl?: FetchLike }
): Promise<BlueskyCreatedRecord> {
  const instance = opts?.instanceUrl ?? DEFAULT_BLUESKY_INSTANCE;
  const record: Record<string, unknown> = {
    $type: "app.bsky.feed.post",
    text: input.text,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
  if (input.language?.length) record.langs = input.language;

  if (input.images?.length) {
    const blobs = [];
    for (const img of input.images) {
      const blob = await fetchJson<{ blob: unknown }>("Bluesky", `${instance}/xrpc/com.atproto.repo.uploadBlob`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.accessJwt}`,
          "Content-Type": img.mime,
        },
        body: Buffer.from(img.bytes),
        timeoutMs: 30_000,
        fetchImpl: opts?.fetchImpl,
      });
      blobs.push({
        alt: img.alt ?? "",
        image: { $type: "blob", ref: (blob.blob as { ref?: unknown }).ref ?? blob.blob, mimeType: img.mime, size: img.bytes.byteLength },
      });
    }
    record.embed = { $type: "app.bsky.embed.images", images: blobs };
  } else if (input.link) {
    // Minimal external-link card: fetch-less (no OG scraping here) — title/description
    // default to the URL until the media engine adds link metadata.
    record.embed = {
      $type: "app.bsky.embed.external",
      external: { uri: input.link, title: input.link, description: "" },
    };
  }

  return fetchJson<BlueskyCreatedRecord>("Bluesky", `${instance}/xrpc/com.atproto.repo.createRecord`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.accessJwt}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      repo: input.did,
      collection: "app.bsky.feed.post",
      record,
    }),
    fetchImpl: opts?.fetchImpl,
  });
}

export async function blueskyDeletePost(
  session: { accessJwt: string; did: string },
  postUri: string,
  opts?: { instanceUrl?: string; fetchImpl?: FetchLike }
): Promise<void> {
  const instance = opts?.instanceUrl ?? DEFAULT_BLUESKY_INSTANCE;
  const rkey = postUri.split("/").pop() ?? "";
  await fetchJson("Bluesky", `${instance}/xrpc/com.atproto.repo.deleteRecord`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessJwt}`, "Content-Type": "application/json" },
    body: JSON.stringify({ repo: session.did, collection: "app.bsky.feed.post", rkey }),
    fetchImpl: opts?.fetchImpl,
  });
}
