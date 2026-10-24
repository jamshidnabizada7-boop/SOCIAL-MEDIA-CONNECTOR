import { and, eq } from "drizzle-orm";
import type { AriaDatabase } from "@aria/db";
import { providerAppConfigs } from "@aria/db";
import { encryptSecret, decryptSecret } from "@aria/db";
import { fetchJson, type FetchLike } from "./http.js";
import { normalizeInstance } from "./oauth.js";

/**
 * Mastodon client. Federated: every call takes the account's instance base
 * URL. Limits (character count, media sizes) are read from /api/v2/instance —
 * never hardcoded.
 */

export interface MastodonApp {
  clientId: string;
  clientSecret: string;
}

export interface MastodonToken {
  access_token: string;
  token_type: string;
  scope: string;
  created_at: number;
}

export interface MastodonAccount {
  id: string;
  username: string;
  display_name: string;
  url?: string;
}

export interface MastodonInstanceConfig {
  uri: string;
  maxTootChars: number;
  imageMatrixLimit?: number;
  videoSizeLimit?: number;
  imageSizeLimit?: number;
}

export async function mastodonInstanceInfo(
  instanceInput: string,
  opts?: { fetchImpl?: FetchLike }
): Promise<MastodonInstanceConfig> {
  const instance = normalizeInstance(instanceInput);
  const v2 = await fetchJson<Record<string, unknown>>("Mastodon", `${instance}/api/v2/instance`, {
    fetchImpl: opts?.fetchImpl,
  }).catch(() => null);
  const v1 = await fetchJson<Record<string, unknown>>("Mastodon", `${instance}/api/v1/instance`, {
    fetchImpl: opts?.fetchImpl,
  });
  const cfg = (v2?.configuration ?? {}) as Record<string, unknown>;
  const statuses = (cfg.statuses ?? {}) as Record<string, unknown>;
  const media = (cfg.media_attachments ?? {}) as Record<string, unknown>;
  return {
    uri: (v1.uri as string) ?? instance,
    maxTootChars: (statuses.max_characters as number) ?? 500,
    imageSizeLimit: media.image_size_limit as number | undefined,
    videoSizeLimit: media.video_size_limit as number | undefined,
    imageMatrixLimit: media.image_matrix_limit as number | undefined,
  };
}

export async function mastodonVerifyCredentials(
  instanceInput: string,
  accessToken: string,
  opts?: { fetchImpl?: FetchLike }
): Promise<MastodonAccount> {
  const instance = normalizeInstance(instanceInput);
  return fetchJson<MastodonAccount>("Mastodon", `${instance}/api/v1/accounts/verify_credentials`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    fetchImpl: opts?.fetchImpl,
  });
}

export async function mastodonUploadMedia(
  instanceInput: string,
  accessToken: string,
  file: { bytes: Uint8Array; mime: string; filename: string; description?: string },
  opts?: { fetchImpl?: FetchLike }
): Promise<{ id: string; url?: string }> {
  const instance = normalizeInstance(instanceInput);
  const form = new FormData();
  const blob = new Blob([new Uint8Array(file.bytes)], { type: file.mime });
  form.append("file", blob, file.filename);
  if (file.description) form.append("description", file.description);
  return fetchJson<{ id: string; url?: string }>("Mastodon", `${instance}/api/v2/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
    timeoutMs: 60_000,
    fetchImpl: opts?.fetchImpl,
  });
}

/** Poll an async media upload until processed (or attempts run out). */
export async function mastodonWaitMedia(
  instanceInput: string,
  accessToken: string,
  mediaId: string,
  opts?: { fetchImpl?: FetchLike; attempts?: number }
): Promise<void> {
  const instance = normalizeInstance(instanceInput);
  const attempts = opts?.attempts ?? 10;
  for (let i = 0; i < attempts; i++) {
    const media = await fetchJson<{ id: string; url?: string }>("Mastodon", `${instance}/api/v1/media/${mediaId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      fetchImpl: opts?.fetchImpl,
    });
    if (media.url) return;
    await new Promise((r) => setTimeout(r, 700));
  }
  throw new Error("Media processing timed out at the instance");
}

export interface MastodonStatusInput {
  status?: string;
  mediaIds?: string[];
  visibility?: "public" | "unlisted" | "private" | "direct";
  sensitive?: boolean;
  spoilerText?: string;
  language?: string;
  /** Server-side scheduling (must be ≥5 min ahead). Our scheduler handles
   * timing itself; this is used only when the user pins a platform time. */
  scheduledAt?: string;
  /** Duplicate protection — the instance stores these for up to 1 hour. */
  idempotencyKey?: string;
}

export interface MastodonPostedStatus {
  id: string;
  url?: string;
  uri?: string;
  scheduled_at?: string | null;
}

export async function mastodonPostStatus(
  instanceInput: string,
  accessToken: string,
  input: MastodonStatusInput,
  opts?: { fetchImpl?: FetchLike }
): Promise<MastodonPostedStatus> {
  const instance = normalizeInstance(instanceInput);
  const body: Record<string, unknown> = {};
  if (input.status !== undefined) body.status = input.status;
  if (input.mediaIds?.length) body.media_ids = input.mediaIds;
  if (input.visibility) body.visibility = input.visibility;
  if (input.sensitive !== undefined) body.sensitive = input.sensitive;
  if (input.spoilerText) body.spoiler_text = input.spoilerText;
  if (input.language) body.language = input.language;
  if (input.scheduledAt) body.scheduled_at = input.scheduledAt;

  return fetchJson<MastodonPostedStatus>("Mastodon", `${instance}/api/v1/statuses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(input.idempotencyKey ? { "Idempotency-Key": input.idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
    fetchImpl: opts?.fetchImpl,
  });
}

export async function mastodonDeleteStatus(
  instanceInput: string,
  accessToken: string,
  statusId: string,
  opts?: { fetchImpl?: FetchLike }
): Promise<void> {
  const instance = normalizeInstance(instanceInput);
  await fetchJson("Mastodon", `${instance}/api/v1/statuses/${statusId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
    fetchImpl: opts?.fetchImpl,
  });
}

export async function mastodonRevokeToken(
  instanceInput: string,
  clientId: string,
  clientSecret: string,
  token: string,
  opts?: { fetchImpl?: FetchLike }
): Promise<void> {
  const instance = normalizeInstance(instanceInput);
  const { postForm } = await import("./http.js");
  await postForm("Mastodon", `${instance}/oauth/revoke`, {
    client_id: clientId,
    client_secret: clientSecret,
    token,
  }, { fetchImpl: opts?.fetchImpl }).catch(() => {
    // Revocation is best-effort; disconnecting locally is the source of truth.
  });
}

export { normalizeInstance };

/* ---------------------- Persistent per-instance app ---------------------- */

const appCache = new Map<string, MastodonApp>();

function redirectUriForMastodon(): string {
  return `${process.env.APP_BASE_URL ?? "http://localhost:4100"}/v1/oauth/callback/mastodon`;
}

/**
 * Returns (registering on first use) the Aria Hub client app for an instance.
 * Persisted in provider_app_configs so tokens survive process restarts and can
 * be revoked later with the original client credentials.
 */
export async function ensureMastodonApp(
  db: AriaDatabase,
  instanceInput: string,
  opts?: { fetchImpl?: FetchLike }
): Promise<MastodonApp> {
  const instance = normalizeInstance(instanceInput);
  const cached = appCache.get(instance);
  if (cached) return cached;
  const rows = await db
    .select()
    .from(providerAppConfigs)
    .where(and(eq(providerAppConfigs.providerId, "mastodon"), eq(providerAppConfigs.instanceUrl, instance)))
    .limit(1);
  if (rows[0]) {
    const app = { clientId: rows[0].clientId, clientSecret: decryptSecret(rows[0].clientSecretEnc) };
    appCache.set(instance, app);
    return app;
  }
  const registered = await fetchJson<{ client_id: string; client_secret: string }>("Mastodon", `${instance}/api/v1/apps`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Aria Hub",
      redirect_uris: [redirectUriForMastodon()],
      scopes: "read write:statuses write:media",
      website: process.env.APP_WEBSITE ?? "https://app.ariahub.co",
    }),
    fetchImpl: opts?.fetchImpl,
  });
  await db
    .insert(providerAppConfigs)
    .values({
      providerId: "mastodon",
      instanceUrl: instance,
      clientId: registered.client_id,
      clientSecretEnc: encryptSecret(registered.client_secret),
      scopes: ["read", "write:statuses", "write:media"],
    })
    .onConflictDoNothing();
  const app = { clientId: registered.client_id, clientSecret: registered.client_secret };
  appCache.set(instance, app);
  return app;
}
