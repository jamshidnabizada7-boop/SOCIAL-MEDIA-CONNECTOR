import { fetchJson, ProviderHttpError } from "../http.js";
import { assertPublicHost, assertSafeUrlShape } from "../net-guard.js";
import type { EngagementContext } from "./contract.js";

export function safeSocialUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password)
      return undefined;
    assertSafeUrlShape(url);
    return url.toString();
  } catch {
    return undefined;
  }
}
export function socialText(value: unknown, max = 50000): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}
export function plainHtml(value: unknown): string {
  return socialText(value)
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?\s*>|<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(
      /&(amp|lt|gt|quot|apos|#39|nbsp);/g,
      (_, entity: string) =>
        ({
          amp: "&",
          lt: "<",
          gt: ">",
          quot: '"',
          apos: "'",
          "#39": "'",
          nbsp: " ",
        })[entity] ?? "",
    )
    .trim();
}
export function socialDate(value: unknown): string {
  const date = new Date(typeof value === "string" ? value : "");
  if (!Number.isFinite(date.getTime()))
    throw new Error("invalid_event_timestamp");
  return date.toISOString();
}
export async function accountOrigin(
  ctx: EngagementContext,
  fallback?: string,
): Promise<string> {
  const origin = new URL(ctx.account.instanceUrl || fallback || "");
  await assertPublicHost(origin.origin);
  return origin.origin;
}
export async function engagementFetch<T>(
  ctx: EngagementContext,
  url: string,
  init: RequestInit = {},
): Promise<T> {
  try {
    return await fetchJson<T>(ctx.account.provider, url, {
      ...init,
      redirect: "error",
      headers: {
        Authorization: `Bearer ${ctx.accessToken}`,
        ...(ctx.account.provider === "bluesky" &&
        new URL(url).pathname.includes("/xrpc/app.bsky.")
          ? { "atproto-proxy": "did:web:api.bsky.app#bsky_appview" }
          : {}),
        ...init.headers,
      },
      fetchImpl: ctx.fetchImpl,
      timeoutMs: 20000,
    });
  } catch (error) {
    if (
      error instanceof ProviderHttpError &&
      ["facebook", "instagram"].includes(ctx.account.provider)
    ) {
      const code = Number(error.body?.match(/"code"\s*:\s*(\d+)/)?.[1]);
      const subcode = Number(
        error.body?.match(/"error_subcode"\s*:\s*(\d+)/)?.[1],
      );
      const status = [102, 190].includes(code)
        ? 401
        : [10, 200, 294].includes(code)
          ? 403
          : [4, 17, 32, 613].includes(code)
            ? 429
            : code === 100 && subcode === 33
              ? 404
              : error.status;
      throw new ProviderHttpError(
        `Meta inbox request failed (${status})`,
        status,
        ctx.account.provider,
        undefined,
        error.retryAfterSec,
      );
    }
    throw error;
  }
}
