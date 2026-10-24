import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import path from "node:path";
import { createDatabase, migrationsFolder, plans } from "@aria/db";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { buildServer } from "../src/server.js";
import type { FastifyInstance } from "fastify";

// Minimal valid 1x1 PNG.
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

function multipartBody(filename: string, content: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(`--boundary\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`),
    content,
    Buffer.from(`\r\n--boundary--\r\n`),
  ]);
}

let app: FastifyInstance;
let cookie = "";
let workspaceId = "";
const dataDir = path.resolve(process.cwd(), `.test-data/media-${Date.now()}`);
const storageDir = path.resolve(process.cwd(), `.test-storage/media-${Date.now()}`);

beforeAll(async () => {
  process.env.ARIA_DATA_DIR = dataDir;
  process.env.ARIA_STORAGE_DIR = storageDir;
  process.env.ARIA_ENCRYPTION_KEY ??= "3f2a8c9e1b7d5f4a8c9e1b7d5f4a8c9e1b7d5f4a8c9e1b7d5f4a8c9e1b7d5f4a";
  const probe = await createDatabase({ dataDir });
  await migratePglite(probe.db as never, { migrationsFolder: migrationsFolder() });
  await probe.db.insert(plans).values({ id: "free", name: "Free", maxBrands: 1, maxMembers: 1, storageGb: 1 }).onConflictDoNothing();
  await probe.close();

  app = await buildServer();
  await app.ready();

  const reg = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: { email: "media@flow.test", password: "correct-horse-battery", name: "Media Tester" },
  });
  cookie = reg.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const ws = await app.inject({
    method: "POST",
    url: "/v1/workspaces",
    headers: { cookie },
    payload: { name: "Media WS" },
  });
  workspaceId = ws.json().workspace.id;
}, 60_000);

afterAll(async () => {
  await app.close();
  for (const dir of [dataDir, storageDir]) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* windows file locks; cleanup is best-effort */
    }
  }
});

describe("media module", () => {
  it("uploads an image with sniffed type and inspected dimensions", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/workspaces/${workspaceId}/media/upload`,
      headers: { cookie, "content-type": "multipart/form-data; boundary=boundary" },
      payload: multipartBody("pixel.png", PNG_1X1),
    });
    expect(res.statusCode).toBe(201);
    const media = res.json().media;
    expect(media.detectedMime).toBe("image/png");
    expect(media.width).toBe(1);
    expect(media.height).toBe(1);
    expect(media.storageKey).toBeTruthy();
  });

  it("deduplicates identical uploads by checksum", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/workspaces/${workspaceId}/media/upload`,
      headers: { cookie, "content-type": "multipart/form-data; boundary=boundary" },
      payload: multipartBody("again.png", PNG_1X1),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().deduplicated).toBe(true);
  });

  it("lists media with raw URLs and serves content to members", async () => {
    const list = await app.inject({
      method: "GET",
      url: `/v1/workspaces/${workspaceId}/media`,
      headers: { cookie },
    });
    expect(list.statusCode).toBe(200);
    const items = list.json().media;
    expect(items.length).toBeGreaterThan(0);
    const raw = await app.inject({
      method: "GET",
      url: items[0].url,
      headers: { cookie },
    });
    expect(raw.statusCode).toBe(200);
    expect(raw.headers["content-type"]).toBe("image/png");
  });

  it("rejects unauthenticated raw access", async () => {
    const list = await app.inject({
      method: "GET",
      url: `/v1/workspaces/${workspaceId}/media`,
      headers: { cookie },
    });
    const url = list.json().media[0].url;
    const raw = await app.inject({ method: "GET", url });
    expect(raw.statusCode).toBe(401);
  });

  it("updates alt text", async () => {
    const list = await app.inject({
      method: "GET",
      url: `/v1/workspaces/${workspaceId}/media`,
      headers: { cookie },
    });
    const id = list.json().media[0].id;
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workspaces/${workspaceId}/media/${id}`,
      headers: { cookie },
      payload: { altText: "A single pixel of hope" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().media.altText).toBe("A single pixel of hope");
  });

  it("deletes unused media", async () => {
    const list = await app.inject({
      method: "GET",
      url: `/v1/workspaces/${workspaceId}/media`,
      headers: { cookie },
    });
    const id = list.json().media[0].id;
    const del = await app.inject({
      method: "DELETE",
      url: `/v1/workspaces/${workspaceId}/media/${id}`,
      headers: { cookie },
    });
    expect(del.statusCode).toBe(204);
    const after = await app.inject({
      method: "GET",
      url: `/v1/workspaces/${workspaceId}/media`,
      headers: { cookie },
    });
    expect(after.json().media.some((m: { id: string }) => m.id === id)).toBe(false);
  });
});
