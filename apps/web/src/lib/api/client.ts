"use client";

/**
 * Typed fetch wrapper for the Aria API. Cookies carry the session
 * (SameSite=Lax, httpOnly) — requests must include credentials.
 */

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  (process.env.NODE_ENV === "production" ? "" : "http://localhost:4100");

export const DATA_MODE: "mock" | "api" =
  process.env.NEXT_PUBLIC_DATA_MODE === "mock"
    ? "mock"
    : process.env.NEXT_PUBLIC_DATA_MODE === "api" ||
        process.env.NODE_ENV === "production"
      ? "api"
      : "mock";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Resolve the legacy alias to the workspace the signed-in UI actually selected. */
function selectedWorkspacePath(path: string): string {
  if (typeof window === "undefined") return path;
  const id = window.localStorage.getItem("aria-workspace");
  if (
    !id ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  )
    return path;
  return path
    .replace(/^\/v1\/workspaces\/current(?=\/|\?|$)/, `/v1/workspaces/${id}`)
    .replace(/([?&]workspaceId=)current(?=&|$)/g, `$1${id}`);
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const { timeoutMs = 15_000, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${API_URL}${selectedWorkspacePath(path)}`, {
      ...rest,
      credentials: "include",
      signal: controller.signal,
      headers: {
        ...(rest.body !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
        ...(rest.headers ?? {}),
      },
    });
  } catch (err) {
    throw new ApiError(
      0,
      "network",
      "Could not reach the server. Check your connection and try again.",
    );
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let body: Record<string, unknown>;
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new Error("invalid response");
  } catch {
    throw new ApiError(
      res.status,
      "invalid_response",
      "The server returned an unreadable response. Please try again.",
    );
  }
  if (!res.ok) {
    const err = (body.error ?? {}) as { code?: string; message?: string };
    throw new ApiError(
      res.status,
      err.code ?? "error",
      err.message ?? res.statusText,
    );
  }
  return body as T;
}

export const apiGet = <T>(path: string) => apiFetch<T>(path);
export const apiPost = <T>(path: string, body?: unknown) =>
  apiFetch<T>(path, {
    method: "POST",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
export const apiPatch = <T>(path: string, body?: unknown) =>
  apiFetch<T>(path, {
    method: "PATCH",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
export const apiPut = <T>(path: string, body?: unknown) =>
  apiFetch<T>(path, {
    method: "PUT",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
export const apiDelete = <T>(path: string) =>
  apiFetch<T>(path, { method: "DELETE" });

export async function apiUpload<T>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_URL}${selectedWorkspacePath(path)}`, {
    method: "POST",
    credentials: "include",
    body: form,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (body.error ?? {}) as { code?: string; message?: string };
    throw new ApiError(
      res.status,
      err.code ?? "error",
      err.message ?? res.statusText,
    );
  }
  return body as T;
}
