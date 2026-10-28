import { createHmac, randomUUID } from "node:crypto";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import {
  createDatabase,
  runMigrations,
  socialAccounts,
  socialInboxItems as items,
  socialInboxMessages as messages,
  socialInboxWebhooks,
  socialReplyActions as actions,
  socialSyncState as sync,
  workspaceMembers,
  workspaces,
  users,
} from "@aria/db";
import { buildServer } from "../src/server.js";
import {
  processInboxReply,
  processInboxSync,
  retainInbox,
  inboxTick,
  storeInboxEvents,
} from "../../worker/src/inbox.js";
import {
  setProviderCredentials,
  type EngagementAccount,
  type EngagementEvent,
  type FetchLike,
} from "@aria/providers-core";

let app: FastifyInstance,
  cookie: string,
  ws: string,
  userId: string,
  a: EngagementAccount,
  itemId: string;
let viewerCookie: string,
  viewerId: string,
  outsiderWs: string,
  outsiderItem: string;
const event: EngagementEvent = {
  externalId: "reply:at://did:plc:friend/app.bsky.feed.post/incoming",
  type: "reply",
  sender: { id: "did:plc:friend", name: "Friend", handle: "friend.test" },
  text: "Where is the guide?",
  occurredAt: new Date().toISOString(),
  replyAllowed: true,
  replyContext: {
    uri: "at://did:plc:friend/app.bsky.feed.post/incoming",
    cid: "parent",
    rootUri: "at://did:plc:self/app.bsky.feed.post/root",
    rootCid: "root",
  },
};
const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status });
const options = (fetchImpl: FetchLike) => ({
  context: async (account: EngagementAccount) => ({
    account,
    accessToken: "fixture-only",
    fetchImpl,
  }),
});
const get = (suffix = "", session = cookie, workspace = ws) =>
  app.inject({
    method: "GET",
    url: `/v1/workspaces/${workspace}/inbox${suffix}`,
    headers: { cookie: session },
  });
const post = (
  suffix: string,
  payload: unknown = {},
  session = cookie,
  workspace = ws,
) =>
  app.inject({
    method: "POST",
    url: `/v1/workspaces/${workspace}/inbox${suffix}`,
    headers: { cookie: session },
    payload,
  });
beforeAll(async () => {
  delete process.env.DATABASE_URL;
  process.env.ARIA_DATA_DIR = path.resolve(
    process.cwd(),
    `.test-data/inbox-${Date.now()}`,
  );
  process.env.ARIA_ALLOW_PRIVATE_INSTANCES = "true";
  process.env.LOG_LEVEL = "error";
  process.env.ARIA_ENCRYPTION_KEY = "f1".repeat(32);
  const handle = await createDatabase({ dataDir: process.env.ARIA_DATA_DIR });
  await runMigrations(handle);
  await handle.close();
  app = await buildServer();
  await app.ready();
  async function register(email: string) {
    const result = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { email, name: email, password: "correct-horse-battery" },
    });
    return {
      cookie: result.cookies.map((c) => `${c.name}=${c.value}`).join("; "),
      userId: result.json().user.id as string,
    };
  }
  ({ cookie, userId } = await register("inbox-owner@test.aria"));
  const viewer = await register("inbox-viewer@test.aria");
  viewerCookie = viewer.cookie;
  viewerId = viewer.userId;
  const [workspace] = await app.database.db
    .insert(workspaces)
    .values({
      name: "Inbox fixture",
      slug: `inbox-${Date.now()}`,
      planId: "pro",
    })
    .returning();
  ws = workspace.id;
  await app.database.db.insert(workspaceMembers).values([
    { workspaceId: ws, userId, role: "owner", status: "active" },
    { workspaceId: ws, userId: viewerId, role: "viewer", status: "active" },
  ]);
  const [row] = await app.database.db
    .insert(socialAccounts)
    .values({
      workspaceId: ws,
      providerId: "bluesky",
      externalAccountId: "did:plc:self",
      displayName: "Fixture",
      handle: "self.test",
      scopes: ["app password"],
      instanceUrl: "http://127.0.0.1:4182",
    })
    .returning();
  a = {
    id: row.id,
    workspaceId: ws,
    provider: "bluesky",
    externalAccountId: row.externalAccountId,
    displayName: row.displayName,
    handle: row.handle,
    scopes: row.scopes,
    connection: row.connection,
    instanceUrl: row.instanceUrl!,
  };
  await storeInboxEvents(app.database.db, a, [event]);
  itemId = (
    await app.database.db.select().from(items).where(eq(items.workspaceId, ws))
  )[0].id;
  const [other] = await app.database.db
    .insert(workspaces)
    .values({ name: "Other", slug: `other-inbox-${Date.now()}`, planId: "pro" })
    .returning();
  outsiderWs = other.id;
  const [otherAccount] = await app.database.db
    .insert(socialAccounts)
    .values({
      workspaceId: outsiderWs,
      providerId: "bluesky",
      externalAccountId: "other",
      displayName: "Other",
      handle: "other.test",
    })
    .returning();
  await storeInboxEvents(
    app.database.db,
    { ...a, id: otherAccount.id, workspaceId: outsiderWs },
    [event],
  );
  outsiderItem = (
    await app.database.db
      .select()
      .from(items)
      .where(eq(items.workspaceId, outsiderWs))
  )[0].id;
}, 60000);
afterAll(async () => {
  await app?.close();
});

describe("workspace-scoped inbox and durable delivery", () => {
  async function replyFixture(
    provider: "bluesky" | "mastodon" | "youtube",
    extra: Partial<typeof actions.$inferInsert> = {},
  ) {
    const suffix = randomUUID();
    const [row] = await app.database.db
      .insert(socialAccounts)
      .values({
        workspaceId: ws,
        providerId: provider,
        externalAccountId: `fixture-${suffix}`,
        displayName: "Worker fixture",
        handle: "self.test",
        scopes:
          provider === "youtube"
            ? ["https://www.googleapis.com/auth/youtube.force-ssl"]
            : ["read", "write:statuses"],
        instanceUrl: "http://127.0.0.1:4182",
      })
      .returning();
    const ea = {
      ...a,
      id: row.id,
      provider,
      externalAccountId: row.externalAccountId,
      scopes: row.scopes,
    };
    await storeInboxEvents(app.database.db, ea, [
      {
        ...event,
        externalId: `fixture-${suffix}`,
        replyContext:
          provider === "youtube"
            ? { parentId: "fixture-parent" }
            : provider === "mastodon"
              ? {
                  statusId: "123",
                  recipients: ["friend@test.social"],
                  visibility: "direct",
                }
              : event.replyContext,
      },
    ]);
    const [item] = await app.database.db
      .select()
      .from(items)
      .where(eq(items.accountId, row.id));
    const [action] = await app.database.db
      .insert(actions)
      .values({
        workspaceId: ws,
        accountId: row.id,
        itemId: item.id,
        createdBy: userId,
        idempotencyKey: randomUUID(),
        text: "Worker fixture reply",
        ...extra,
      })
      .returning();
    return { account: ea, item, action };
  }
  it("applies the migration, bounds requests and never exposes reply context or tokens", async () => {
    const res = await get("?limit=1&search=guide");
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toHaveLength(1);
    expect(res.json().total).toBe(1);
    expect(JSON.stringify(res.json())).not.toMatch(
      /replyContext|accessToken|fixture-only/,
    );
    expect((await get("?limit=1000")).statusCode).toBe(400);
    expect((await get("?types=invalid")).statusCode).toBe(400);
    expect((await get(`/${itemId}`)).json().messages).toHaveLength(1);
  });
  it("does not leak other workspaces through list, detail, bulk, thread or replies", async () => {
    expect((await get("", cookie, outsiderWs)).statusCode).toBe(404);
    expect((await get(`/${outsiderItem}`)).statusCode).toBe(404);
    expect((await post(`/${outsiderItem}/refresh`)).statusCode).toBe(404);
    expect(
      (
        await post(`/${outsiderItem}/reply`, {
          text: "x",
          idempotencyKey: randomUUID(),
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await post("/bulk", { ids: [itemId, outsiderItem], operation: "read" }))
        .statusCode,
    ).toBe(404);
    expect((await get(`/${itemId}`)).json().item.readAt).toBeNull();
    expect((await get("", "")).statusCode).toBe(401);
  });
  it("enforces roles and active-workspace assignees", async () => {
    expect((await get("", viewerCookie)).statusCode).toBe(200);
    expect(
      (
        await post(
          `/${itemId}/reply`,
          { text: "x", idempotencyKey: randomUUID() },
          viewerCookie,
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await post(
          "/bulk",
          { ids: [itemId], operation: "resolve" },
          viewerCookie,
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await post("/bulk", {
          ids: [itemId],
          operation: "assign",
          assignedTo: randomUUID(),
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await post("/bulk", {
          ids: [itemId],
          operation: "assign",
          assignedTo: viewerId,
        })
      ).statusCode,
    ).toBe(200);
  });
  it("deduplicates sync events while preserving independent handling state", async () => {
    await post("/bulk", { ids: [itemId], operation: "read" });
    await post("/bulk", { ids: [itemId], operation: "resolve" });
    await storeInboxEvents(app.database.db, a, [
      { ...event, text: "Updated guide question" },
      event,
    ]);
    const detail = (await get(`/${itemId}`)).json();
    expect(detail.item.readAt).toBeTruthy();
    expect(detail.item.resolvedAt).toBeTruthy();
    expect(detail.item.assignedTo).toBe(viewerId);
    expect(detail.item.repliedAt).toBeNull();
    expect(detail.messages).toHaveLength(1);
    expect((await get("/counts")).json().unread).toBe(0);
    await post("/bulk", { ids: [itemId], operation: "reopen" });
    await post("/bulk", { ids: [itemId], operation: "unread" });
  });
  it("persists per-user preferences without disabling team ingestion", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workspaces/${ws}/inbox/preferences`,
      headers: { cookie },
      payload: { enabledTypes: ["reply"], priorityTypes: ["reply"] },
    });
    expect(res.statusCode).toBe(200);
    expect((await get("/preferences")).json().enabledTypes).toEqual(["reply"]);
    expect(
      (await get("/preferences", viewerCookie)).json().enabledTypes.length,
    ).toBeGreaterThan(1);
  });
  it("queues idempotently and confirms provider delivery without resolving or reading the item", async () => {
    const key = randomUUID(),
      input = { text: "Here is the guide", idempotencyKey: key };
    const queued = await post(`/${itemId}/reply`, input);
    expect(queued.statusCode).toBe(202);
    expect((await post(`/${itemId}/reply`, input)).json().actionId).toBe(
      queued.json().actionId,
    );
    expect(
      (await post(`/${itemId}/reply`, { ...input, text: "Changed" }))
        .statusCode,
    ).toBe(409);
    let sends = 0;
    await processInboxReply(
      app.database.db,
      options(async (_u, init) => {
        sends++;
        const body = JSON.parse(String(init?.body));
        expect(body.record.reply.root.cid).toBe("root");
        return json({
          uri: "at://did:plc:self/app.bsky.feed.post/answer",
          cid: "confirmed",
        });
      }),
    );
    await processInboxReply(
      app.database.db,
      options(async () => {
        throw new Error("must not resend");
      }),
    );
    expect(sends).toBe(1);
    const detail = (await get(`/${itemId}`)).json();
    expect(detail.actions[0].state).toBe("confirmed");
    expect(detail.item.repliedAt).toBeTruthy();
    expect(detail.item.readAt).toBeNull();
    expect(detail.item.resolvedAt).toBeNull();
    expect(
      detail.messages.filter(
        (m: { direction: string }) => m.direction === "outgoing",
      ),
    ).toHaveLength(1);
  });
  it("rechecks author membership after queueing, before sending", async () => {
    const result = await post(`/${itemId}/reply`, {
      text: "Revoked before delivery",
      idempotencyKey: randomUUID(),
    });
    expect(result.statusCode).toBe(202);
    await app.database.db
      .update(workspaceMembers)
      .set({ role: "viewer" })
      .where(
        and(
          eq(workspaceMembers.workspaceId, ws),
          eq(workspaceMembers.userId, userId),
        ),
      );
    let called = false;
    await processInboxReply(
      app.database.db,
      options(async () => {
        called = true;
        return json({});
      }),
    );
    expect(called).toBe(false);
    expect((await get(`/${itemId}`)).json().actions[0].state).toBe("failed");
    await app.database.db
      .update(workspaceMembers)
      .set({ role: "owner" })
      .where(
        and(
          eq(workspaceMembers.workspaceId, ws),
          eq(workspaceMembers.userId, userId),
        ),
      );
  });
  it("marks uncertain YouTube delivery unknown and blocks another reply", async () => {
    const [ya] = await app.database.db
      .insert(socialAccounts)
      .values({
        workspaceId: ws,
        providerId: "youtube",
        externalAccountId: "channel",
        displayName: "Channel",
        handle: "channel",
        scopes: ["https://www.googleapis.com/auth/youtube.force-ssl"],
      })
      .returning();
    await storeInboxEvents(
      app.database.db,
      { ...a, id: ya.id, provider: "youtube", externalAccountId: "channel" },
      [
        {
          ...event,
          externalId: "yt-comment",
          type: "comment",
          replyContext: { parentId: "comment" },
        },
      ],
    );
    const [yi] = await app.database.db
      .select()
      .from(items)
      .where(eq(items.accountId, ya.id));
    expect(
      (
        await post(`/${yi.id}/reply`, {
          text: "Uncertain",
          idempotencyKey: randomUUID(),
        })
      ).statusCode,
    ).toBe(202);
    let calls = 0;
    const opts = options(async () => {
      calls++;
      throw new Error("transport lost after send");
    });
    await processInboxReply(app.database.db, opts);
    await processInboxReply(app.database.db, opts);
    expect(calls).toBe(1);
    expect((await get(`/${yi.id}`)).json().actions[0].state).toBe("unknown");
    expect(
      (
        await post(`/${yi.id}/reply`, {
          text: "Again",
          idempotencyKey: randomUUID(),
        })
      ).statusCode,
    ).toBe(409);
  });
  it("commits cursors with events, retains cursors on errors and throttles manual sync", async () => {
    await app.database.db
      .insert(sync)
      .values({ workspaceId: ws, accountId: a.id });
    await processInboxSync(
      app.database.db,
      options(async () =>
        json({
          notifications: [
            {
              uri: "at://did:plc:friend/app.bsky.feed.post/new",
              cid: "new",
              reason: "mention",
              author: { did: "did:plc:friend", handle: "friend.test" },
              record: { text: "New mention" },
              indexedAt: "2026-10-28T01:00:00Z",
            },
          ],
        }),
      ),
    );
    const [s] = await app.database.db
      .select()
      .from(sync)
      .where(eq(sync.accountId, a.id));
    expect(s.cursor.after).toBe("2026-10-28T01:00:00Z");
    expect(s.status).toBe("healthy");
    await app.database.db
      .update(sync)
      .set({ nextSyncAt: new Date(0) })
      .where(eq(sync.accountId, a.id));
    await processInboxSync(
      app.database.db,
      options(async () => json({}, 429)),
    );
    const [failed] = await app.database.db
      .select()
      .from(sync)
      .where(eq(sync.accountId, a.id));
    expect(failed.cursor).toEqual(s.cursor);
    expect(failed.failureCount).toBe(1);
    expect(failed.nextSyncAt.getTime()).toBeGreaterThan(Date.now());
    expect((await post("/sync", { accountIds: [a.id] })).json().queued).toBe(1);
    expect((await post("/sync", { accountIds: [a.id] })).json().queued).toBe(0);
  });
  it("enforces composite workspace foreign keys for conversation messages", async () => {
    await expect(
      app.database.db.insert(messages).values({
        workspaceId: outsiderWs,
        itemId,
        externalId: "bad",
        direction: "incoming",
        text: "bad",
        sender: { id: "bad", name: "bad" },
        occurredAt: new Date(),
      }),
    ).rejects.toThrow();
    const [n] = await app.database.db
      .select({ n: sql<number>`count(*)::int` })
      .from(actions)
      .where(eq(actions.workspaceId, outsiderWs));
    expect(n.n).toBe(0);
    expect(
      (
        await app.database.db.select().from(users).where(eq(users.id, userId))
      )[0],
    ).toBeTruthy();
  });
  it("rejects cross-workspace account ownership at the database boundary", async () => {
    await expect(
      app.database.db.insert(items).values({
        workspaceId: outsiderWs,
        accountId: a.id,
        providerId: "bluesky",
        externalId: "cross-owner",
        type: "mention",
        sender: event.sender,
        text: "invalid",
        occurredAt: new Date(),
        lastActivityAt: new Date(),
      }),
    ).rejects.toThrow();
  });
  it("verifies Meta webhook signatures over exact bytes and durably deduplicates wakeups", async () => {
    const secret = "fixture-app-secret-only";
    await setProviderCredentials(app.database.db, "facebook", {
      clientId: "fixture",
      clientSecret: secret,
    });
    const [fa] = await app.database.db
      .insert(socialAccounts)
      .values({
        workspaceId: ws,
        providerId: "facebook",
        externalAccountId: "12345",
        displayName: "Page",
        handle: "page",
        scopes: [],
      })
      .returning();
    const raw = JSON.stringify({
      object: "page",
      entry: [
        {
          id: "12345",
          changes: [
            {
              field: "feed",
              value: { message: "Private fixture text must not be stored raw" },
            },
          ],
        },
      ],
    });
    const signature = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
    const send = (body: string, sig: string) =>
      app.inject({
        method: "POST",
        url: "/v1/webhooks/inbox/facebook",
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256": sig,
        },
        payload: body,
      });
    expect((await send(raw, "sha256=" + "0".repeat(64))).statusCode).toBe(401);
    expect((await send(raw + " ", signature)).statusCode).toBe(401);
    const accepted = await send(raw, signature);
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().duplicate).toBe(false);
    expect((await send(raw, signature)).json().duplicate).toBe(true);
    const rows = await app.database.db.select().from(socialInboxWebhooks);
    expect(rows).toHaveLength(1);
    expect(rows[0].matchedAccounts).toBe(1);
    expect(JSON.stringify(rows)).not.toContain("Private fixture text");
    expect(
      (
        await app.database.db
          .select()
          .from(sync)
          .where(eq(sync.accountId, fa.id))
      )[0].workspaceId,
    ).toBe(ws);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/webhooks/inbox/x",
          payload: {},
        })
      ).statusCode,
    ).toBe(404);
  });
  it("verifies Meta subscription challenges only with the configured token", async () => {
    process.env.INBOX_WEBHOOK_VERIFY_TOKEN = "fixture-verify";
    expect(
      (
        await app.inject({
          url: "/v1/webhooks/inbox/instagram?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=challenge",
        })
      ).statusCode,
    ).toBe(403);
    const res = await app.inject({
      url: "/v1/webhooks/inbox/instagram?hub.mode=subscribe&hub.verify_token=fixture-verify&hub.challenge=challenge",
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("challenge");
  });
  it("claims a reply exclusively across concurrent workers", async () => {
    const fixture = await replyFixture("bluesky");
    let calls = 0;
    const opts = options(async () => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return json({
        uri: "at://did:plc:self/app.bsky.feed.post/exclusive",
        cid: "exclusive",
      });
    });
    await Promise.all([
      processInboxReply(app.database.db, opts),
      processInboxReply(app.database.db, opts),
    ]);
    expect(calls).toBe(1);
    expect(
      (
        await app.database.db
          .select()
          .from(actions)
          .where(eq(actions.id, fixture.action.id))
      )[0].state,
    ).toBe("confirmed");
  });
  it("recovers an expired sending lease without resending beyond provider idempotency", async () => {
    const fixture = await replyFixture("mastodon", {
      state: "sending",
      leaseExpiresAt: new Date(0),
      lockedBy: randomUUID(),
      attempts: 1,
      createdAt: new Date(Date.now() - 2 * 3600000),
    });
    let calls = 0;
    await processInboxReply(
      app.database.db,
      options(async () => {
        calls++;
        return json({ id: "unexpected" });
      }),
    );
    expect(calls).toBe(0);
    expect(
      (
        await app.database.db
          .select()
          .from(actions)
          .where(eq(actions.id, fixture.action.id))
      )[0].state,
    ).toBe("unknown");
  });
  it("backs off explicit rate-limit rejections without creating another remote reply", async () => {
    const fixture = await replyFixture("youtube");
    let calls = 0;
    const opts = options(async () => {
      calls++;
      return new Response("{}", {
        status: 429,
        headers: { "Retry-After": "120" },
      });
    });
    await processInboxReply(app.database.db, opts);
    await processInboxReply(app.database.db, opts);
    const [action] = await app.database.db
      .select()
      .from(actions)
      .where(eq(actions.id, fixture.action.id));
    expect(calls).toBe(1);
    expect(action.state).toBe("queued");
    expect(action.runAt.getTime()).toBeGreaterThan(Date.now() + 110000);
    await app.database.db
      .update(actions)
      .set({ state: "failed" })
      .where(eq(actions.id, action.id));
  });
  it("marks a provider tombstone unavailable and prevents further replies", async () => {
    const fixture = await replyFixture("bluesky", { state: "failed" });
    await app.database.db
      .update(sync)
      .set({ nextSyncAt: new Date(Date.now() + 86400000) });
    await app.database.db
      .insert(sync)
      .values({ accountId: fixture.account.id, workspaceId: ws });
    await app.database.db
      .update(items)
      .set({ contextRequestedAt: new Date() })
      .where(eq(items.id, fixture.item.id));
    await processInboxSync(
      app.database.db,
      options(async (u) =>
        u.includes("getPostThread")
          ? json({ thread: { notFound: true } })
          : json({ notifications: [] }),
      ),
    );
    const [item] = await app.database.db
      .select()
      .from(items)
      .where(eq(items.id, fixture.item.id));
    expect(item.deletedAt).toBeTruthy();
    expect(item.replyAllowed).toBe(false);
    expect(
      (
        await post(`/${item.id}/reply`, {
          text: "Must not send",
          idempotencyKey: randomUUID(),
        })
      ).statusCode,
    ).toBe(409);
  });
  it("rolls back partial ingestion and cascades bounded retention and disconnect cleanup", async () => {
    const before = (await get()).json().total;
    await expect(
      app.database.db.transaction(async (tx) => {
        await storeInboxEvents(tx, a, [
          { ...event, externalId: "must-roll-back" },
        ]);
        throw new Error("fixture transaction failure");
      }),
    ).rejects.toThrow("fixture transaction failure");
    expect((await get()).json().total).toBe(before);
    const fixture = await replyFixture("bluesky", { state: "failed" });
    await app.database.db
      .update(items)
      .set({ lastActivityAt: new Date(Date.now() - 400 * 86400000) })
      .where(eq(items.id, fixture.item.id));
    await retainInbox(app.database.db);
    expect(
      await app.database.db
        .select()
        .from(items)
        .where(eq(items.id, fixture.item.id)),
    ).toHaveLength(0);
    expect(
      await app.database.db
        .select()
        .from(messages)
        .where(eq(messages.itemId, fixture.item.id)),
    ).toHaveLength(0);
    expect(
      await app.database.db
        .select()
        .from(actions)
        .where(eq(actions.id, fixture.action.id)),
    ).toHaveLength(0);
    const disconnected = await replyFixture("bluesky", { state: "failed" });
    await app.database.db
      .delete(socialAccounts)
      .where(eq(socialAccounts.id, disconnected.account.id));
    expect(
      await app.database.db
        .select()
        .from(items)
        .where(eq(items.id, disconnected.item.id)),
    ).toHaveLength(0);
    expect(
      await app.database.db
        .select()
        .from(actions)
        .where(eq(actions.id, disconnected.action.id)),
    ).toHaveLength(0);
  });
  it("discovers eligible accounts even behind a full batch of missing grants", async () => {
    await app.database.db
      .update(sync)
      .set({ nextSyncAt: new Date(Date.now() + 86400000) });
    const stamp = Date.now();
    await app.database.db
      .insert(socialAccounts)
      .values(
        Array.from({ length: 51 }, (_, i) => ({
          workspaceId: ws,
          providerId: "facebook",
          externalAccountId: String(stamp + i),
          displayName: "Blocked fixture",
          handle: "blocked",
          scopes: [],
        })),
      );
    const fixture = await replyFixture("bluesky", { state: "failed" });
    const opts = options(async () => json({ notifications: [] }));
    await inboxTick(app.database.db, opts);
    await inboxTick(app.database.db, opts);
    expect(
      (
        await app.database.db
          .select()
          .from(sync)
          .where(eq(sync.accountId, fixture.account.id))
      )[0],
    ).toBeTruthy();
  });
});
