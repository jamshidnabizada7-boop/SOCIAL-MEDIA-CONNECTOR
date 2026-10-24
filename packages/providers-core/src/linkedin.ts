import { fetchJson, type FetchLike } from "./http.js";

/**
 * LinkedIn versioned REST client (Posts API, verified 2026-09-30).
 * Requires LinkedIn-Version header (YYYYMM) and X-Restli-Protocol-Version.
 * Media: registerUpload → PUT bytes → URN referenced in the post.
 */

const REST = "https://api.linkedin.com/rest";
const DEFAULT_VERSION = process.env.LINKEDIN_API_VERSION ?? "202609";

function linkedinHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    "LinkedIn-Version": DEFAULT_VERSION,
    "X-Restli-Protocol-Version": "2.0.0",
  };
}

export interface LinkedInUploadRegistration {
  uploadUrl: string;
  assetUrn: string;
}

export type LinkedInRecipe =
  | "urn:li:digitalmediaRecipe:feedshare-image"
  | "urn:li:digitalmediaRecipe:feedshare-video"
  | "urn:li:digitalmediaRecipe:feedshare-document";

export async function linkedinRegisterUpload(
  accessToken: string,
  ownerUrn: string,
  recipe: LinkedInRecipe,
  bytesLength: number,
  opts?: { fetchImpl?: FetchLike }
): Promise<LinkedInUploadRegistration> {
  const res = await fetchJson<{ value: { asset: string; uploadMechanism: { "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest": { uploadUrl: string } } } }>(
    "LinkedIn",
    `${REST}/assets?action=registerUpload`,
    {
      method: "POST",
      headers: { ...linkedinHeaders(accessToken), "Content-Type": "application/json" },
      body: JSON.stringify({
        registerUploadRequest: {
          recipes: [recipe],
          owner: ownerUrn,
          serviceRelationships: [
            { relationshipType: "urn:li:str:IS_FOR_EXPORT", identifier: "urn:li:str:IS_FOR_EXPORT" },
          ],
          supportedUploadMechanism: ["SYNCHRONOUS_UPLOAD"],
          fileSize: bytesLength,
        },
      }),
      fetchImpl: opts?.fetchImpl,
    }
  );
  return {
    uploadUrl: res.value.uploadMechanism["com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"].uploadUrl,
    assetUrn: res.value.asset,
  };
}

export async function linkedinPutBytes(
  uploadUrl: string,
  bytes: Uint8Array,
  mime: string,
  opts?: { fetchImpl?: FetchLike }
): Promise<void> {
  const doFetch = opts?.fetchImpl ?? fetch;
  const res = await doFetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": mime }, // upload URL is pre-authorized via the registration token
    body: Buffer.from(bytes),
  });
  if (!res.ok) {
    throw Object.assign(new Error(`LinkedIn media upload failed (${res.status})`), {
      status: res.status,
      provider: "LinkedIn",
    });
  }
}

export interface LinkedInPostInput {
  authorUrn: string; // urn:li:person:{id} or urn:li:organization:{id}
  commentary: string;
  mediaUrn?: string; // urn:li:image:{id} | urn:li:video:{id} | urn:li:document:{id}
  mediaTitle?: string;
  visibility?: "PUBLIC" | "CONNECTIONS" | "LOGGED_IN";
}

export async function linkedinCreatePost(
  accessToken: string,
  input: LinkedInPostInput,
  opts?: { fetchImpl?: FetchLike }
): Promise<{ postUrn: string }> {
  const body: Record<string, unknown> = {
    author: input.authorUrn,
    commentary: input.commentary,
    visibility: input.visibility ?? "PUBLIC",
    distribution: {
      feedDistribution: "MAIN_FEED",
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };
  if (input.mediaUrn) {
    body.content = {
      media: { id: input.mediaUrn, ...(input.mediaTitle ? { title: input.mediaTitle } : {}) },
    };
  }
  const doFetch = opts?.fetchImpl ?? fetch;
  const res = await doFetch(REST + "/posts", {
    method: "POST",
    headers: {
      ...linkedinHeaders(accessToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw Object.assign(new Error(`LinkedIn post creation failed (${res.status})`), {
      status: res.status,
      provider: "LinkedIn",
      body: text.slice(0, 300),
    });
  }
  return { postUrn: res.headers.get("x-restli-id") ?? "" };
}

export async function linkedinDeletePost(
  accessToken: string,
  postUrn: string,
  opts?: { fetchImpl?: FetchLike }
): Promise<void> {
  await fetchJson("LinkedIn", `${REST}/posts/${encodeURIComponent(postUrn)}`, {
    method: "DELETE",
    headers: { ...linkedinHeaders(accessToken), "X-RestLi-Method": "DELETE" },
    fetchImpl: opts?.fetchImpl,
  });
}

/** Member profile via OpenID Connect (verified 2026-09-30, profile.ts mirrors). */
export async function linkedinPersonUrn(accessToken: string, opts?: { fetchImpl?: FetchLike }): Promise<string> {
  const res = await fetchJson<{ sub: string }>("LinkedIn", "https://api.linkedin.com/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
    fetchImpl: opts?.fetchImpl,
  });
  return `urn:li:person:${res.sub}`;
}
