import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { rmSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { createDatabase, migrationsFolder, plans, publishTargets, socialAccounts, socialProviders, users } from "@aria/db";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import type { FastifyInstance } from "fastify";

/**
 * Security regressions: tenant isolation on every post route, invite-only
 * access, login lockout, password reset, CSRF origin check, SSRF guard.
 * Outgoing email is captured instead of sent so tests can follow links.
 */

const sent = vi.hoisted(() => [] as Array<{ to: string; subject: string; text: string }>);
vi.mock("../src/lib/mailer.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/mailer.js")>();
  return {
    ...actual,
    sendMail: vi.fn(async (_log: unknown, msg: { to: string; subject: string; text: string }) => {
      sent.push(msg);
      return { delivered: true };
    }),
  };
});

let app: FastifyInstance;
const dataDir = path.resolve(process.cwd(), `.test-data/security-${Date.now()}`);
const ORIGIN = "http://localhost:3000";

interface Actor {
  cookie: string;
  userId: string;
  workspaceId: string;
}

function cookieOf(res: { cookies: Array<{ name: string; value: string }> }): string {
  return res.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

function tokenFrom(text: string, param: string): string {
  const match = text.match(new RegExp(`[?&]${param}=([A-Za-z0-9]+)`));
  if (!match) throw new Error(`no ${param} in: ${text}`);
  return match[1];
}

async function signup(email: string, workspaceName?: string): Promise<Actor> {
  const reg = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: { email, password: "correct-horse-battery", name: email.split("@")[0] },
  });
  expect(reg.statusCode).toBe(201);
  const cookie = cookieOf(reg);
  let workspaceId = "";
  if (workspaceName) {
    const ws = await app.inject({ method: "POST", url: "/v1/workspaces", headers: { cookie, origin: ORIGIN }, payload: { name: workspaceName } });
    expect(ws.statusCode).toBe(201);
    workspaceId = ws.json().workspace.id;
  }
  return { cookie, userId: reg.json().user.id, workspaceId };
}

let alice: Actor;
let mallory: Actor;
let alicePostId = "";
let aliceTargetId = "";
let aliceAccountId = "";

beforeAll(async () => {
  process.env.ARIA_DATA_DIR = dataDir;
  process.env.ARIA_ENCRYPTION_KEY ??= "3f2a8c9e1b7d5f4a8c9e1b7d5f4a8c9e1b7d5f4a8c9e1b7d5f4a8c9e1b7d5f4a";
  const probe = await createDatabase({ dataDir });
  await migratePglite(probe.db as never, { migrationsFolder: migrationsFolder() });
  await probe.db.insert(plans).values({ id: "free", name: "Free", maxBrands: 1, maxMembers: 5, storageGb: 1 }).onConflictDoNothing();
  await probe.db
    .insert(socialProviders)
    .values({
      id: "mastodon",
      name: "Mastodon",
      capabilities: {
        formats: { text: true, image: true, video: true, document: false, carousel: false },
        altText: true, linkPreview: true, hashtags: true, firstComment: false, thumbnail: false, customCover: false,
        privacyControl: true, schedule: true, directPublish: true, manualPublishFallback: false, comments: true,
        analytics: false, deletion: true, editing: true, aiDisclosure: false, brandedContent: false,
        maxCaptionLength: 500, maxImages: 4, maxVideoDurationSec: 60, maxVideoBytes: 4e7, maxImageBytes: 8e6, aspectRatios: [],
      },
    })
    .onConflictDoNothing();
  await probe.close();

  const { buildServer } = await import("../src/server.js");
  app = await buildServer();
  await app.ready();

  alice = await signup("alice@sec.test", "Alice WS");
  mallory = await signup("mallory@sec.test", "Mallory WS");

  const [acc] = await app.database.db
    .insert(socialAccounts)
    .values({ workspaceId: alice.workspaceId, providerId: "mastodon", externalAccountId: "a1", displayName: "Alice", handle: "@alice", connection: "healthy", scopes: [] })
    .returning();
  aliceAccountId = acc.id;
  const created = await app.inject({
    method: "POST",
    url: `/v1/workspaces/${alice.workspaceId}/posts`,
    headers: { cookie: alice.cookie, origin: ORIGIN },
    payload: { caption: "private", accountIds: [acc.id] },
  });
  expect(created.statusCode).toBe(201);
  alicePostId = created.json().post.id;
  aliceTargetId = created.json().post.targets[0].id;
}, 60_000);

afterAll(async () => {
  await app?.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("tenant isolation", () => {
  // Mallory addresses Alice's post through Mallory's OWN workspace — the
  // membership check passes, so only per-query scoping can stop this.
  const routes = () => [
    { method: "GET" as const, url: `/v1/workspaces/${mallory.workspaceId}/posts/${alicePostId}` },
    { method: "PATCH" as const, url: `/v1/workspaces/${mallory.workspaceId}/posts/${alicePostId}`, payload: { caption: "pwned" } },
    { method: "POST" as const, url: `/v1/workspaces/${mallory.workspaceId}/posts/${alicePostId}/publish` },
    { method: "POST" as const, url: `/v1/workspaces/${mallory.workspaceId}/posts/${alicePostId}/schedule`, payload: { scheduledAt: new Date(Date.now() + 3_600_000).toISOString() } },
    { method: "POST" as const, url: `/v1/workspaces/${mallory.workspaceId}/posts/${alicePostId}/cancel` },
    { method: "POST" as const, url: `/v1/workspaces/${mallory.workspaceId}/posts/${alicePostId}/targets/${aliceTargetId}/retry` },
    { method: "POST" as const, url: `/v1/workspaces/${mallory.workspaceId}/posts/${alicePostId}/add-to-queue` },
    { method: "DELETE" as const, url: `/v1/workspaces/${mallory.workspaceId}/posts/${alicePostId}` },
    { method: "POST" as const, url: `/v1/workspaces/${mallory.workspaceId}/accounts/${aliceAccountId}/refresh` },
    { method: "DELETE" as const, url: `/v1/workspaces/${mallory.workspaceId}/accounts/${aliceAccountId}` },
  ];

  it("returns 404 for another workspace's post, target and account on every route", async () => {
    for (const r of routes()) {
      const res = await app.inject({ ...r, headers: { cookie: mallory.cookie, origin: ORIGIN } });
      expect(res.statusCode, `${r.method} ${r.url}`).toBe(404);
    }
  });

  it("left Alice's post untouched", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/workspaces/${alice.workspaceId}/posts/${alicePostId}`,
      headers: { cookie: alice.cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().post.caption).toBe("private");
    expect(res.json().post.state).toBe("draft");
    const target = (await app.database.db.select().from(publishTargets).where(eq(publishTargets.id, aliceTargetId)))[0];
    expect(target.state).toBe("pending");
  });

  it("answers 404 (not 500) for malformed ids", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/workspaces/${alice.workspaceId}/posts/not-a-uuid`,
      headers: { cookie: alice.cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});

it("does not claim a confirmation email was sent when the transport fails", async () => {
  const actor = await signup("mail-failure@sec.test");
  const { sendMail } = await import("../src/lib/mailer.js");
  vi.mocked(sendMail).mockResolvedValueOnce({ delivered: false });
  const response = await app.inject({ method: "POST", url: "/v1/auth/resend-verification", headers: { cookie: actor.cookie, origin: ORIGIN } });
  expect(response.statusCode).toBe(503);
  expect(response.json().error.code).toBe("email_unavailable");
});

describe("invitations", () => {
  let bob: Actor;
  let inviteToken = "";

  it("an invited user has no access until they accept", async () => {
    sent.length = 0;
    const inv = await app.inject({
      method: "POST",
      url: `/v1/workspaces/${alice.workspaceId}/members`,
      headers: { cookie: alice.cookie, origin: ORIGIN },
      payload: { email: "bob@sec.test", role: "editor" },
    });
    expect(inv.statusCode).toBe(201);
    const mail = sent.find((m) => m.to === "bob@sec.test");
    expect(mail).toBeTruthy();
    inviteToken = tokenFrom(mail!.text, "token");

    bob = await signup("bob@sec.test");
    const denied = await app.inject({
      method: "GET",
      url: `/v1/workspaces/${alice.workspaceId}/posts`,
      headers: { cookie: bob.cookie },
    });
    expect(denied.statusCode).toBe(404);
  });

  it("only the invited email can accept", async () => {
    const wrong = await app.inject({
      method: "POST",
      url: `/v1/invitations/${inviteToken}/accept`,
      headers: { cookie: mallory.cookie, origin: ORIGIN },
    });
    expect(wrong.statusCode).toBe(403);
  });

  it("accepting grants access and burns the token", async () => {
    const preview = await app.inject({ method: "GET", url: `/v1/invitations/${inviteToken}` });
    expect(preview.json().invitation.workspaceName).toBe("Alice WS");
    const ok = await app.inject({
      method: "POST",
      url: `/v1/invitations/${inviteToken}/accept`,
      headers: { cookie: bob.cookie, origin: ORIGIN },
    });
    expect(ok.statusCode).toBe(200);
    const allowed = await app.inject({
      method: "GET",
      url: `/v1/workspaces/${alice.workspaceId}/posts`,
      headers: { cookie: bob.cookie },
    });
    expect(allowed.statusCode).toBe(200);
    const again = await app.inject({
      method: "POST",
      url: `/v1/invitations/${inviteToken}/accept`,
      headers: { cookie: bob.cookie, origin: ORIGIN },
    });
    expect(again.statusCode).toBe(404);
  });

  it("non-owners cannot grant admin", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/workspaces/${alice.workspaceId}/members`,
      headers: { cookie: bob.cookie, origin: ORIGIN },
      payload: { email: "eve@sec.test", role: "admin" },
    });
    // Editors can't manage the team at all; either way no admin is minted.
    expect([403]).toContain(res.statusCode);
  });
});

describe("authentication hardening", () => {
  it("locks the account after repeated failures", async () => {
    await signup("lock@sec.test");
    let last = 0;
    for (let i = 0; i < 6; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: { email: "lock@sec.test", password: "wrong-password" },
        remoteAddress: `10.0.0.${i + 1}`,
      });
      last = res.statusCode;
    }
    expect(last).toBe(429);
    const correct = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "lock@sec.test", password: "correct-horse-battery" },
      remoteAddress: "10.0.1.1",
    });
    expect(correct.statusCode).toBe(429);
  }, 60_000);

  it("resets a password with the mailed single-use token and unlocks", async () => {
    sent.length = 0;
    const forgot = await app.inject({ method: "POST", url: "/v1/auth/forgot-password", payload: { email: "lock@sec.test" } });
    expect(forgot.statusCode).toBe(200);
    const unknown = await app.inject({ method: "POST", url: "/v1/auth/forgot-password", payload: { email: "nobody@sec.test" } });
    expect(unknown.statusCode).toBe(200); // no account enumeration
    const mail = sent.find((m) => m.to === "lock@sec.test");
    const token = tokenFrom(mail!.text, "token");

    const reset = await app.inject({ method: "POST", url: "/v1/auth/reset-password", payload: { token, password: "a-brand-new-passphrase" } });
    expect(reset.statusCode).toBe(200);
    const reuse = await app.inject({ method: "POST", url: "/v1/auth/reset-password", payload: { token, password: "another-passphrase" } });
    expect(reuse.statusCode).toBe(400);

    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "lock@sec.test", password: "a-brand-new-passphrase" },
      remoteAddress: "10.0.2.1",
    });
    expect(login.statusCode).toBe(200);
  }, 60_000);

  it("verifies email with the mailed token", async () => {
    sent.length = 0;
    const v = await signup("verify@sec.test");
    const me1 = await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie: v.cookie } });
    expect(me1.json().user.emailVerified).toBe(false);
    const mail = sent.find((m) => m.to === "verify@sec.test");
    const token = tokenFrom(mail!.text, "token");
    const res = await app.inject({ method: "POST", url: "/v1/auth/verify-email", payload: { token } });
    expect(res.statusCode).toBe(200);
    const row = (await app.database.db.select().from(users).where(eq(users.id, v.userId)))[0];
    expect(row.emailVerifiedAt).toBeTruthy();
  });
});

describe("CSRF origin check", () => {
  it("rejects cookie-authenticated writes from a foreign origin", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/workspaces/${alice.workspaceId}/posts`,
      headers: { cookie: alice.cookie, origin: "https://evil.example" },
      payload: { caption: "csrf" },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("SSRF guard", () => {
  it("refuses private and plain-http instance addresses", async () => {
    const { assertPublicHost, normalizeInstance } = await import("@aria/providers-core");
    expect(() => normalizeInstance("http://mastodon.social")).toThrow();
    expect(() => normalizeInstance("https://127.0.0.1")).toThrow();
    expect(() => normalizeInstance("https://169.254.169.254")).toThrow();
    expect(() => normalizeInstance("https://localhost")).toThrow();
    expect(() => normalizeInstance("https://[::1]")).toThrow();
    await expect(assertPublicHost("https://10.1.2.3")).rejects.toThrow();
  });

  it("blocks a Mastodon instance lookup against an internal address", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/oauth/mastodon/instance?instance=https://127.0.0.1:4100",
      headers: { cookie: alice.cookie },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("invalid_instance");
  });
});

describe("webhook gateway", () => {
  it("echoes hub.challenge only for the configured verify token", async () => {
    process.env.WEBHOOK_VERIFY_TOKEN_FACEBOOK = "verify-me";
    const ok = await app.inject({
      method: "GET",
      url: "/v1/webhooks/facebook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345",
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toBe("12345");
    const bad = await app.inject({
      method: "GET",
      url: "/v1/webhooks/facebook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=12345",
    });
    expect(bad.statusCode).toBe(403);
  });

  it("does not store the payload of an unsigned delivery", async () => {
    process.env.WEBHOOK_SECRET_FACEBOOK = "s3cret";
    const { socialProviders: providersTable } = await import("@aria/db");
    const mastodonRow = (await app.database.db.select().from(providersTable).where(eq(providersTable.id, "mastodon")))[0];
    await app.database.db
      .insert(providersTable)
      .values({ id: "facebook", name: "Facebook", capabilities: mastodonRow.capabilities })
      .onConflictDoNothing();
    const res = await app.inject({
      method: "POST",
      url: "/v1/webhooks/facebook",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ id: "evt_unsigned", secret: "attacker-data" }),
    });
    expect(res.statusCode).toBe(401);
    const { webhookEvents } = await import("@aria/db");
    const rows = await app.database.db.select().from(webhookEvents).where(eq(webhookEvents.providerId, "facebook"));
    expect(rows.every((r) => !JSON.stringify(r.payload).includes("attacker-data"))).toBe(true);
    expect(rows.every((r) => r.dedupeKey === null)).toBe(true);
  });
});

describe("post lifecycle", () => {
  it("stores per-network variants and AI disclosure", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/workspaces/${alice.workspaceId}/posts`,
      headers: { cookie: alice.cookie, origin: ORIGIN },
      payload: {
        caption: "with variants",
        accountIds: [aliceAccountId],
        aiDisclosed: true,
        variants: [{ providerId: "youtube", title: "My video", settings: { visibility: "unlisted" } }],
      },
    });
    expect(res.statusCode).toBe(201);
    const post = res.json().post;
    expect(post.aiDisclosed).toBe(true);
    expect(post.variants).toHaveLength(1);
    expect(post.variants[0].title).toBe("My video");
    expect(post.variants[0].settings.visibility).toBe("unlisted");
  });

  it("rescheduling leaves exactly one live job per destination", async () => {
    const created = await app.inject({
      method: "POST",
      url: `/v1/workspaces/${alice.workspaceId}/posts`,
      headers: { cookie: alice.cookie, origin: ORIGIN },
      payload: { caption: "reschedule me", accountIds: [aliceAccountId] },
    });
    const postId = created.json().post.id;
    const targetId = created.json().post.targets[0].id;
    for (const hours of [2, 5, 9]) {
      const r = await app.inject({
        method: "POST",
        url: `/v1/workspaces/${alice.workspaceId}/posts/${postId}/schedule`,
        headers: { cookie: alice.cookie, origin: ORIGIN },
        payload: { scheduledAt: new Date(Date.now() + hours * 3_600_000).toISOString() },
      });
      expect(r.statusCode).toBe(200);
    }
    const { publishJobs } = await import("@aria/db");
    const jobs = await app.database.db.select().from(publishJobs).where(eq(publishJobs.targetId, targetId));
    const live = jobs.filter((j) => j.state === "pending" || j.state === "delayed");
    expect(live).toHaveLength(1);
    expect(Math.round((live[0].runAt.getTime() - Date.now()) / 3_600_000)).toBe(9);

    const canceled = await app.inject({
      method: "POST",
      url: `/v1/workspaces/${alice.workspaceId}/posts/${postId}/cancel`,
      headers: { cookie: alice.cookie, origin: ORIGIN },
    });
    expect(canceled.statusCode).toBe(200);
    const after = await app.database.db.select().from(publishJobs).where(eq(publishJobs.targetId, targetId));
    expect(after.filter((j) => j.state === "pending" || j.state === "delayed")).toHaveLength(0);
  });

  it("can change a draft's destinations", async () => {
    const [second] = await app.database.db
      .insert(socialAccounts)
      .values({ workspaceId: alice.workspaceId, providerId: "mastodon", externalAccountId: "a2", displayName: "Alice 2", handle: "@alice2", connection: "healthy", scopes: [] })
      .returning();
    const created = await app.inject({
      method: "POST",
      url: `/v1/workspaces/${alice.workspaceId}/posts`,
      headers: { cookie: alice.cookie, origin: ORIGIN },
      payload: { caption: "move me", accountIds: [aliceAccountId] },
    });
    const postId = created.json().post.id;
    const patched = await app.inject({
      method: "PATCH",
      url: `/v1/workspaces/${alice.workspaceId}/posts/${postId}`,
      headers: { cookie: alice.cookie, origin: ORIGIN },
      payload: { accountIds: [second.id] },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().post.targets.map((t: { accountId: string }) => t.accountId)).toEqual([second.id]);
  });
});

describe("billing", () => {
  it("never grants a paid plan without payment", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/workspaces/${alice.workspaceId}/billing/plan`,
      headers: { cookie: alice.cookie, origin: ORIGIN },
      payload: { planId: "agency" },
    });
    expect(res.statusCode).toBe(400);
    const checkout = await app.inject({
      method: "POST",
      url: `/v1/workspaces/${alice.workspaceId}/billing/checkout`,
      headers: { cookie: alice.cookie, origin: ORIGIN },
      payload: { planId: "pro" },
    });
    expect(checkout.statusCode).toBe(503); // Stripe not configured in tests
  });

  it("verifies Stripe webhook signatures over the raw body", async () => {
    const { createHmac } = await import("node:crypto");
    const { verifyStripeSignature } = await import("../src/lib/stripe.js");
    const body = JSON.stringify({ id: "evt_1", type: "ping" });
    const t = Math.floor(Date.now() / 1000);
    const sig = createHmac("sha256", "whsec_test").update(`${t}.${body}`).digest("hex");
    expect(verifyStripeSignature(body, `t=${t},v1=${sig}`, "whsec_test")).toBe(true);
    expect(verifyStripeSignature(body + " ", `t=${t},v1=${sig}`, "whsec_test")).toBe(false);
    expect(verifyStripeSignature(body, `t=${t - 3600},v1=${sig}`, "whsec_test")).toBe(false);

    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    const bad = await app.inject({
      method: "POST",
      url: "/v1/billing/webhook",
      headers: { "content-type": "application/json", "stripe-signature": `t=${t},v1=deadbeef` },
      payload: body,
    });
    expect(bad.statusCode).toBe(400);
    const good = await app.inject({
      method: "POST",
      url: "/v1/billing/webhook",
      headers: { "content-type": "application/json", "stripe-signature": `t=${t},v1=${sig}` },
      payload: body,
    });
    expect(good.statusCode).toBe(200);
  });
});

describe("account lifecycle", () => {
  it("exports workspace data without credentials", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/workspaces/${alice.workspaceId}/export`,
      headers: { cookie: alice.cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toContain("attachment");
    const body = res.json();
    expect(body.posts.length).toBeGreaterThan(0);
    expect(res.body).not.toMatch(/accessTokenEnc|refreshTokenEnc|passwordHash/);
  });

  it("blocks deleting an account that owns a shared workspace until ownership moves", async () => {
    const del = await app.inject({
      method: "DELETE",
      url: "/v1/auth/me",
      headers: { cookie: alice.cookie, origin: ORIGIN },
      payload: { password: "correct-horse-battery" },
    });
    expect(del.statusCode).toBe(409); // Bob joined Alice's workspace earlier
  });

  it("deletes a solo account and its workspace, stopping scheduled posts", async () => {
    const solo = await signup("solo@sec.test", "Solo WS");
    const [acc] = await app.database.db
      .insert(socialAccounts)
      .values({ workspaceId: solo.workspaceId, providerId: "mastodon", externalAccountId: "s1", displayName: "Solo", handle: "@solo", connection: "healthy", scopes: [] })
      .returning();
    const created = await app.inject({
      method: "POST",
      url: `/v1/workspaces/${solo.workspaceId}/posts`,
      headers: { cookie: solo.cookie, origin: ORIGIN },
      payload: { caption: "later", accountIds: [acc.id], scheduledAt: new Date(Date.now() + 3_600_000).toISOString() },
    });
    const targetId = created.json().post.targets[0].id;
    const wrong = await app.inject({
      method: "DELETE",
      url: "/v1/auth/me",
      headers: { cookie: solo.cookie, origin: ORIGIN },
      payload: { password: "nope" },
    });
    expect(wrong.statusCode).toBe(400);
    const del = await app.inject({
      method: "DELETE",
      url: "/v1/auth/me",
      headers: { cookie: solo.cookie, origin: ORIGIN },
      payload: { password: "correct-horse-battery" },
    });
    expect(del.statusCode).toBe(204);
    const { publishJobs, workspaces } = await import("@aria/db");
    const jobs = await app.database.db.select().from(publishJobs).where(eq(publishJobs.targetId, targetId));
    expect(jobs.every((j) => j.state === "dead_letter")).toBe(true);
    const ws = (await app.database.db.select().from(workspaces).where(eq(workspaces.id, solo.workspaceId)))[0];
    expect(ws.deletedAt).toBeTruthy();
    const me = await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie: solo.cookie } });
    expect(me.statusCode).toBe(401);
  });
});
