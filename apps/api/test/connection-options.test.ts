import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { rmSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { createDatabase, migrationsFolder, plans, socialProviders, socialAccounts, oauthStates, providerAppConfigs, workspaceMembers } from "@aria/db";
import { migrate } from "drizzle-orm/pglite/migrator";
import { PROVIDERS, type ConnectionOption } from "@aria/shared-types";
import { setProviderCredentials, fetchProfile, blueskyCreateSession } from "@aria/providers-core";
import type { FastifyInstance } from "fastify";

vi.mock("@aria/providers-core", async (importOriginal) => ({
  ...await importOriginal<typeof import("@aria/providers-core")>(),
  exchangeCodeForTokens: vi.fn(async () => ({ accessToken: "fixture-token", scopes: ["pages_manage_posts"] })),
  fetchProfile: vi.fn(),
  blueskyCreateSession: vi.fn(),
}));

const dataDir = path.resolve(process.cwd(), `.test-data/connections-${Date.now()}`);
let app: FastifyInstance;
let cookie: string;
let workspaceId: string;
let userId: string;
beforeAll(async () => {
  process.env.ARIA_DATA_DIR = dataDir;
  process.env.ARIA_ENCRYPTION_KEY = "3f2a8c9e1b7d5f4a8c9e1b7d5f4a8c9e1b7d5f4a8c9e1b7d5f4a8c9e1b7d5f4a";
  for (const key of ["THREADS_APP_ID", "THREADS_APP_SECRET", "FACEBOOK_APP_ID", "FACEBOOK_APP_SECRET"]) delete process.env[key];
  const db = await createDatabase({ dataDir });
  await migrate(db.db as never, { migrationsFolder: migrationsFolder() });
  await db.db.insert(plans).values({ id: "free", name: "Free", maxBrands: 1, maxMembers: 5, storageGb: 1 });
  await db.db.insert(socialProviders).values(Object.values(PROVIDERS).map(p => ({ id: p.id, name: p.name, capabilities: p.capabilities })));
  await db.close();
  const { buildServer } = await import("../src/server.js");
  app = await buildServer();
  const reg = await app.inject({ method: "POST", url: "/v1/auth/register", payload: { email: "connections@test.example", password: "correct-horse-battery", name: "Connections" } });
  expect(reg.statusCode).toBe(201);
  cookie = reg.cookies.map(c => `${c.name}=${c.value}`).join("; ");
  userId = reg.json().user.id;
  const ws = await app.inject({ method: "POST", url: "/v1/workspaces", headers: { cookie, origin: "http://localhost:3000" }, payload: { name: "Connection tests" } });
  expect(ws.statusCode).toBe(201);
  workspaceId = ws.json().workspace.id;
}, 60_000);
afterAll(async () => { await app?.close(); rmSync(dataDir, { recursive: true, force: true }); });

const options = () => app.inject({ method: "GET", url: "/v1/workspaces/current/connection-options", headers: { cookie } });
const authorize = (provider: string) => app.inject({ method: "GET", url: `/v1/oauth/${provider}/authorize?workspaceId=${workspaceId}&format=json`, headers: { cookie } });

describe("connection availability", () => {
  it("reports all ten networks without presenting missing setup or TikTok as connectable", async () => {
    const res = await options();
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const rows = res.json().options as ConnectionOption[];
    expect(rows).toHaveLength(10);
    expect(rows.find(o => o.provider === "threads")?.status).toBe("setup_required");
    expect(rows.find(o => o.provider === "tiktok")?.status).toBe("unsupported");
    expect(rows.filter(o => ["bluesky", "mastodon"].includes(o.provider)).every(o => o.status === "available")).toBe(true);
    expect(res.body).not.toMatch(/clientSecret|clientId|docs\//);
  });
  it("rejects blocked authorize requests before creating OAuth state", async () => {
    expect((await authorize("tiktok")).json().error.code).toBe("provider_unsupported");
    expect((await authorize("threads")).json().error.code).toBe("provider_unconfigured");
    expect((await authorize("not-a-provider")).statusCode).toBe(404);
    expect((await authorize("__proto__")).statusCode).toBe(404);
    expect(await app.database.db.select().from(oauthStates)).toHaveLength(0);
  });
  it("shares Meta credentials with Instagram but isolates corrupt credentials", async () => {
    await setProviderCredentials(app.database.db, "facebook", { clientId: "test-client", clientSecret: "test-secret" });
    let rows = (await options()).json().options as ConnectionOption[];
    expect(rows.filter(o => ["facebook", "instagram"].includes(o.provider)).every(o => o.status === "available")).toBe(true);
    await app.database.db.update(providerAppConfigs).set({ clientSecretEnc: "corrupt" }).where(eq(providerAppConfigs.providerId, "facebook"));
    rows = (await options()).json().options;
    expect(rows.find(o => o.provider === "facebook")?.status).toBe("setup_required");
    expect(rows.find(o => o.provider === "bluesky")?.status).toBe("available");
  });
  it("allows OAuth reconnection at capacity but does not report success for a rejected new account", async () => {
    await setProviderCredentials(app.database.db, "facebook", { clientId: "test-client", clientSecret: "test-secret" });
    await app.database.db.update(plans).set({ maxChannels: 1 }).where(eq(plans.id, "free"));
    await app.database.db.insert(socialAccounts).values({ workspaceId, providerId: "facebook", externalAccountId: "page1", displayName: "Test Page", handle: "test-page" });
    vi.mocked(fetchProfile).mockResolvedValue({ externalAccountId: "page1", displayName: "Test Page", handle: "test-page" });
    const start = await authorize("facebook");
    expect(start.statusCode).toBe(200);
    const callback = await app.inject({ method: "GET", url: `/v1/oauth/callback/facebook?code=fixture&state=${start.json().state}` });
    expect(callback.headers.location).toContain("connected=facebook");
    vi.mocked(fetchProfile).mockResolvedValue({ externalAccountId: "page2", displayName: "Another Page", handle: "another-page" });
    const another = await authorize("facebook");
    const rejected = await app.inject({ method: "GET", url: `/v1/oauth/callback/facebook?code=fixture&state=${another.json().state}` });
    expect(rejected.headers.location).toContain("connect=error&reason=plan_limit");
    expect(await app.database.db.select().from(socialAccounts)).toHaveLength(1);
    await app.database.db.delete(socialAccounts).where(eq(socialAccounts.workspaceId, workspaceId));
  });
  it("allows an existing Bluesky account to reconnect at capacity while rejecting a new identity", async () => {
    await app.database.db.insert(socialAccounts).values({ workspaceId, providerId: "bluesky", externalAccountId: "did:plc:existing", displayName: "Existing", handle: "existing.bsky.social" });
    vi.mocked(blueskyCreateSession).mockResolvedValue({ did: "did:plc:existing", handle: "existing.bsky.social", accessJwt: "fixture-access", refreshJwt: "fixture-refresh" });
    const request = () => app.inject({ method: "POST", url: "/v1/accounts/bluesky/connect", headers: { cookie, origin: "http://localhost:3000" }, payload: { workspaceId, handle: "existing.bsky.social", appPassword: "unused-test-password" } });
    expect((await request()).statusCode).toBe(201);
    vi.mocked(blueskyCreateSession).mockResolvedValue({ did: "did:plc:new", handle: "new.bsky.social", accessJwt: "fixture-access", refreshJwt: "fixture-refresh" });
    expect((await request()).statusCode).toBe(402);
    expect(await app.database.db.select().from(socialAccounts)).toHaveLength(1);
  });
  it("honors maintenance on both OAuth and app-password routes", async () => {
    await app.database.db.update(socialProviders).set({ status: "maintenance" }).where(eq(socialProviders.id, "mastodon"));
    expect((await authorize("mastodon")).json().error.code).toBe("provider_unavailable");
    await app.database.db.update(socialProviders).set({ status: "disabled" }).where(eq(socialProviders.id, "bluesky"));
    const res = await app.inject({ method: "POST", url: "/v1/accounts/bluesky/connect", headers: { cookie, origin: "http://localhost:3000" }, payload: { workspaceId, handle: "example.bsky.social", appPassword: "unused-test-password" } });
    expect(res.json().error.code).toBe("provider_unavailable");
  });
  it("requires authentication, workspace membership and the connect permission", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/workspaces/current/connection-options" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/v1/workspaces/00000000-0000-4000-8000-000000000001/connection-options", headers: { cookie } })).statusCode).toBe(404);
    await app.database.db.update(workspaceMembers).set({ role: "viewer" }).where(eq(workspaceMembers.userId, userId));
    expect((await options()).statusCode).toBe(403);
  });
});
