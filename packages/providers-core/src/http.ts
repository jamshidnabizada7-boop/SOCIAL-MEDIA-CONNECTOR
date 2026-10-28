export class ProviderHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly provider: string,
    readonly body?: string,
    /** Parsed from Retry-After (seconds or HTTP-date) — plan §30. */
    readonly retryAfterSec?: number,
  ) {
    super(message);
    this.name = "ProviderHttpError";
  }
}

export interface FetchLike {
  (url: string, init?: RequestInit): Promise<Response>;
}

export const defaultFetch: FetchLike = (url, init) => fetch(url, init);

/**
 * JSON fetch wrapper for provider APIs. Timeouts are enforced; provider error
 * bodies are summarized (never echo tokens — they are stripped from anything
 * we might log).
 */
export async function fetchJson<T>(
  provider: string,
  url: string,
  init: RequestInit & {
    timeoutMs?: number;
    fetchImpl?: FetchLike;
    maxResponseBytes?: number;
  } = {},
): Promise<T> {
  const {
    timeoutMs = 15_000,
    fetchImpl = defaultFetch,
    maxResponseBytes,
    ...rest
  } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      ...rest,
      signal: rest.signal ?? controller.signal,
    });
    let text: string;
    if (maxResponseBytes && res.body) {
      const reader = res.body.getReader(),
        chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maxResponseBytes) {
            await reader.cancel();
            throw new ProviderHttpError(
              "Provider response exceeded the metadata size limit.",
              502,
              provider,
            );
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      text = new TextDecoder().decode(bytes);
    } else text = await res.text();
    if (!res.ok) {
      const snippet = text
        .replace(/[A-Za-z0-9_-]{25,}/g, "[redacted]")
        .slice(0, 300);
      const retryHeader = res.headers.get("retry-after");
      let retryAfterSec: number | undefined;
      if (retryHeader) {
        const asSeconds = Number(retryHeader);
        retryAfterSec = Number.isFinite(asSeconds)
          ? Math.max(1, Math.round(asSeconds))
          : Math.max(
              1,
              Math.round((new Date(retryHeader).getTime() - Date.now()) / 1000),
            );
      }
      throw new ProviderHttpError(
        `${provider} responded ${res.status}`,
        res.status,
        provider,
        snippet,
        retryAfterSec,
      );
    }
    return (text ? JSON.parse(text) : {}) as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function postForm<T>(
  provider: string,
  url: string,
  form: Record<string, string>,
  opts: {
    timeoutMs?: number;
    fetchImpl?: FetchLike;
    headers?: Record<string, string>;
  } = {},
): Promise<T> {
  return fetchJson<T>(provider, url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...opts.headers,
    },
    body: new URLSearchParams(form).toString(),
    timeoutMs: opts.timeoutMs,
    fetchImpl: opts.fetchImpl,
  });
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
