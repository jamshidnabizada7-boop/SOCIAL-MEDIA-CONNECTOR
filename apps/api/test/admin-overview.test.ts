import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import path from "node:path";
import { createDatabase, featureFlags, migrationsFolder, plans, socialProviders } from "@aria/db";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { buildServer } from "../src/server.js";
import type { FastifyInstance } from "fastify";

/**
 * Admin overview endpoint: merges providers, circuit state, 7-day error
 * rates, jobs, DLQ, webhooks, flags and audit into one response.
 */

let app: FastifyInstance;
let adminCookie = "";
let memberCookie = "";
const dataDir = path.resolve(process.cwd(), `.test-data/admin-${Date.now()}`);

beforeAll(async () => {
  process.env.ARIA_DATA_DIR = dataDir;
  process.env.ARIA_ENCRYPTION_KEY ??= "3f2a8c9e1b7d5f4a8c9e1b7d5f4a8c9e1b7d5f4a8c9e1b7d5f4a8c9e1b7d5f4a8c";
  const probe = await createDatabase({ dataDir });
  await migratePglite(probe.db as never, { migrationsFolder: migrationsFolder() });
  await probe.db.insert(plans).values({ id: "free", name: "Free", maxBrands: 1, maxMembers: 1, storageGb: 1 }).onConflictDoNothing();
  await probe.db.insert(socialProviders).values({ id: "x", name: "X", approval: "approved", capabilities: {} as never }).onConflictDoNothing();
  await probe.db.insert(featureFlags).values({ key: "test_flag", description: "t", enabled: false }).onConflictDoNothing();
  await probe.close();

  app = await buildServer();
  await app.ready();

  const reg = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: { email: "admin@flow.test", password: "correct-horse-battery", name: "Admin" },
  });
  adminCookie = reg.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  // Promote to platform admin directly.
  await app.database.db.execute(`update users set is_platform_admin = true where email = 'admin@flow.test'`);

  const reg2 = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: { email: "member@flow.test", password: "correct-horse-battery", name: "Member" },
  });
  memberCookie = reg2.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}, 60_000);

afterAll(async () => {
  await app.close();
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    /* windows locks */
  }
});

describe("admin overview", () => {
  it("guards the endpoint", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/overview" });
    expect(res.statusCode).toBe(401);
    const member = await app.inject({
      method: "GET",
      url: "/v1/admin/overview",
      headers: { cookie: memberCookie },
    });
    expect(member.statusCode).toBe(403);
  });

  it("returns merged providers, flags and audit for admins", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/admin/overview",
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(200);
    const data = res.json();
    expect(data.providers.some((p: { provider: string }) => p.provider === "x")).toBe(true);
    expect(data.flags.length).toBeGreaterThan(0);
    expect(Array.isArray(data.audit)).toBe(true);
  });

  it("updates provider status with an audit entry", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/admin/providers/x/status",
      headers: { cookie: adminCookie },
      payload: { status: "degraded" },
    });
    expect(res.statusCode).toBe(200);
    const check = await app.inject({
      method: "GET",
      url: "/v1/admin/overview",
      headers: { cookie: adminCookie },
    });
    const x = check.json().providers.find((p: { provider: string }) => p.provider === "x");
    expect(x.status).toBe("degraded");
    const audit = check.json().audit;
    expect(audit.some((a: { action: string }) => a.action === "admin.provider_status")).toBe(true);
  });
});
