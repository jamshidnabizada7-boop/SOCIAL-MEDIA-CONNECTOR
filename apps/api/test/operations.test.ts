import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import path from "node:path";
import { rmSync } from "node:fs";
import { createDatabase, rateLimitBuckets, runMigrations } from "@aria/db";
import { sanitizeTelemetryEvent } from "@aria/shared-types";
import { databaseRateLimitStore } from "../src/lib/rate-limit-store.js";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";

const dataDir = path.resolve(process.cwd(), `.test-data/operations-${Date.now()}`);
let app: FastifyInstance;
beforeAll(async () => {
  process.env.ARIA_DATA_DIR = dataDir;
  const handle = await createDatabase({ dataDir });
  await runMigrations(handle);
  await handle.close();
  const { buildServer } = await import("../src/server.js");
  app = await buildServer();
  await app.ready();
}, 60_000);
afterAll(async () => {
  await app?.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("operational readiness", () => {
  it("returns 503 when the database cannot be reached", async () => {
    expect((await app.inject("/health")).statusCode).toBe(200);
    const mock = vi.spyOn(app.database.db, "execute").mockRejectedValueOnce(new Error("database down"));
    const res = await app.inject("/health");
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ status: "unhealthy", db: "error" });
    mock.mockRestore();
  });

  it("shares atomic budgets across instances, isolates routes, and expires windows", async () => {
    const Store = databaseRateLimitStore(app.database.db);
    const a = new Store().child({ timeWindow: 60_000, routeInfo: { method: "POST", url: "/login" } });
    const b = new Store().child({ timeWindow: 60_000, routeInfo: { method: "POST", url: "/login" } });
    const increment = (store: typeof a) => new Promise<{ current: number; ttl: number }>((resolve, reject) => {
      store.incr("192.0.2.1", (err, value) => err ? reject(err) : resolve(value!));
    });
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => increment(i % 2 ? a : b)));
    expect(results.map((r) => r.current).sort((x, y) => x - y)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(results.every((r) => r.ttl > 0 && r.ttl <= 60_000)).toBe(true);
    const [bucket] = await app.database.db.select().from(rateLimitBuckets);
    expect(bucket.key).not.toContain("192.0.2.1");
    const other = new Store().child({ timeWindow: 60_000, routeInfo: { method: "POST", url: "/signup" } });
    expect((await increment(other)).current).toBe(1);
    // Recreating the store (process restart) keeps the existing count.
    expect((await increment(new Store().child({ routeInfo: { method: "POST", url: "/login" } }))).current).toBe(21);
    await app.database.db.update(rateLimitBuckets).set({ expiresAt: new Date(0) }).where(eq(rateLimitBuckets.key, bucket.key));
    expect((await increment(a)).current).toBe(1);
  });

  it("enforces route rate limits through Fastify with the API error envelope", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const response = await app.inject({ method: "POST", url: "/v1/auth/login", payload: {} });
      statuses.push(response.statusCode);
      if (i === 10) expect(response.json().error.code).toBe("rate_limited");
    }
    expect(statuses).toEqual([...Array(10).fill(400), 429]);
  });

  it("removes sensitive error-report metadata and credential-bearing URLs", () => {
    const report = sanitizeTelemetryEvent({
      request: { headers: { cookie: "private" }, data: { password: "private" } },
      user: { email: "private" }, breadcrumbs: [{ data: "private" }], extra: { token: "private" },
      message: "GET https://user:password@example.com/reset?token=private#secret Bearer private access_token=private",
      exception: { values: [{ value: 'password: private', stacktrace: { frames: [{ vars: { token: "private" } }] } }] },
    });
    expect(JSON.stringify(report)).not.toContain("private");
    expect(report.message).toContain("https://example.com/reset");
    expect(report).not.toHaveProperty("request");
  });
});
