import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import {
  auditLogs,
  socialAccounts,
  socialInboxItems as items,
  socialInboxMessages as messages,
  socialInboxWebhooks,
  socialReplyActions as actions,
  socialSyncState as sync,
  users,
  workspaceMembers,
  workspaces,
  type AriaDatabase,
  type DbOrTx,
} from "@aria/db";
import {
  roleHasPermission,
  type ProviderId,
  type InboxMessage,
} from "@aria/shared-types";
import {
  engagementCapabilities,
  getEngagementAdapter,
  ProviderHttpError,
  resolveAccessToken,
  type EngagementAccount,
  type EngagementContext,
  type EngagementEvent,
} from "@aria/providers-core";

const LEASE = 10 * 60000;
const due = (now: Date) =>
  or(isNull(sync.leaseExpiresAt), lte(sync.leaseExpiresAt, now));
function account(a: typeof socialAccounts.$inferSelect): EngagementAccount {
  return {
    id: a.id,
    workspaceId: a.workspaceId,
    provider: a.providerId as ProviderId,
    externalAccountId: a.externalAccountId,
    displayName: a.displayName,
    handle: a.handle,
    scopes: a.scopes,
    connection: a.connection,
    instanceUrl: a.instanceUrl ?? undefined,
  };
}
function event(i: typeof items.$inferSelect): EngagementEvent {
  return {
    externalId: i.externalId,
    type: i.type,
    sender: i.sender,
    text: i.text,
    occurredAt: i.occurredAt.toISOString(),
    nativeUrl: i.nativeUrl ?? undefined,
    conversationId: i.conversationId ?? undefined,
    post: i.post ?? undefined,
    replyAllowed: i.replyAllowed,
    replyReason: i.replyReason ?? undefined,
    replyContext: i.replyContext,
  };
}
function failure(error: unknown) {
  if (error instanceof ProviderHttpError)
    return {
      code: `provider_${error.status}`,
      auth: error.status === 401,
      permission: error.status === 403,
      missing: [404, 410].includes(error.status),
      rate: error.status === 429,
      ambiguous: error.status >= 500,
      delay: Math.min(
        86400000,
        Math.max(30000, (error.retryAfterSec || 60) * 1000),
      ),
      message:
        error.status === 401
          ? "Account authorization expired. Reconnect this account."
          : error.status === 403
            ? "The provider denied inbox access. Check granted permissions and app approval."
            : error.status === 429
              ? "Provider rate limit reached. Synchronization will resume automatically."
              : `Provider request failed (${error.status}).`,
    };
  return {
    code: "provider_unavailable",
    auth: false,
    permission: false,
    missing: false,
    rate: false,
    ambiguous: true,
    delay: 60000,
    message:
      "Provider response unavailable or invalid. Check the native platform before repeating an uncertain reply.",
  };
}
async function storeMessage(
  db: DbOrTx,
  workspaceId: string,
  itemId: string,
  m: InboxMessage,
) {
  await db
    .insert(messages)
    .values({
      workspaceId,
      itemId,
      externalId: m.externalId,
      direction: m.direction,
      sender: m.sender,
      text: m.text,
      nativeUrl: m.url,
      occurredAt: new Date(m.occurredAt),
      deleted: !!m.deleted,
    })
    .onConflictDoUpdate({
      target: [messages.itemId, messages.externalId],
      set: {
        sender: m.sender,
        text: m.text,
        nativeUrl: m.url ?? null,
        deleted: !!m.deleted,
      },
    });
}
/** Provider events and their cursor commit together. Repeated events preserve handling state. */
export async function storeInboxEvents(
  db: DbOrTx,
  a: EngagementAccount,
  events: EngagementEvent[],
) {
  for (const e of events) {
    const occurredAt = new Date(e.occurredAt);
    if (
      !Number.isFinite(occurredAt.getTime()) ||
      !e.externalId ||
      e.externalId.length > 1000 ||
      e.sender.id === a.externalAccountId
    )
      continue;
    const [item] = await db
      .insert(items)
      .values({
        workspaceId: a.workspaceId,
        accountId: a.id,
        providerId: a.provider,
        externalId: e.externalId,
        type: e.type,
        sender: e.sender,
        text: e.text,
        nativeUrl: e.nativeUrl,
        conversationId: e.conversationId,
        post: e.post,
        replyContext: e.replyContext,
        replyAllowed: e.replyAllowed,
        replyReason: e.replyReason,
        occurredAt,
        lastActivityAt: occurredAt,
        deletedAt: e.deleted ? new Date() : null,
      })
      .onConflictDoUpdate({
        target: [items.accountId, items.externalId],
        set: {
          sender: e.sender,
          text: e.text,
          nativeUrl: e.nativeUrl ?? null,
          post: e.post ?? null,
          replyContext: e.replyContext,
          replyAllowed: e.replyAllowed,
          replyReason: e.replyReason ?? null,
          deletedAt: e.deleted ? new Date() : null,
        },
        setWhere: eq(items.workspaceId, a.workspaceId),
      })
      .returning({ id: items.id });
    if (item)
      await storeMessage(db, a.workspaceId, item.id, {
        id: e.externalId,
        externalId:
          typeof e.replyContext.uri === "string"
            ? e.replyContext.uri
            : e.externalId,
        direction: "incoming",
        sender: e.sender,
        text: e.text,
        occurredAt: e.occurredAt,
        url: e.nativeUrl,
        deleted: e.deleted,
      });
  }
}
export interface InboxWorkerOptions {
  /** Tests inject a fixture token resolver; production always uses the encrypted vault. */
  context?: (a: EngagementAccount) => Promise<EngagementContext>;
}
async function contextFor(
  db: AriaDatabase,
  a: EngagementAccount,
  opts: InboxWorkerOptions,
) {
  if (opts.context) return opts.context(a);
  return {
    account: a,
    accessToken: (await resolveAccessToken(db, a.id)).accessToken,
  };
}
async function audit(
  db: DbOrTx,
  workspaceId: string,
  actorUserId: string,
  itemId: string,
  action: string,
  actionId: string,
) {
  await db.insert(auditLogs).values({
    workspaceId,
    actorUserId,
    actorType: "user",
    action,
    targetType: "inbox_item",
    targetId: itemId,
    metadata: { actionId },
  });
}
export async function processInboxReply(
  db: AriaDatabase,
  opts: InboxWorkerOptions = {},
): Promise<boolean> {
  const now = new Date();
  const [candidate] = await db
    .select({ action: actions, a: socialAccounts, item: items })
    .from(actions)
    .innerJoin(
      socialAccounts,
      and(
        eq(actions.accountId, socialAccounts.id),
        eq(actions.workspaceId, socialAccounts.workspaceId),
      ),
    )
    .innerJoin(
      items,
      and(
        eq(actions.itemId, items.id),
        eq(actions.workspaceId, items.workspaceId),
        eq(actions.accountId, items.accountId),
      ),
    )
    .where(
      and(
        or(
          and(eq(actions.state, "queued"), lte(actions.runAt, now)),
          and(eq(actions.state, "sending"), lte(actions.leaseExpiresAt, now)),
        ),
      ),
    )
    .orderBy(asc(actions.runAt))
    .limit(1);
  if (!candidate) return false;
  const { action, a, item } = candidate;
  const lock = randomUUID();
  const claimed = await db
    .update(actions)
    .set({
      state: "sending",
      lockedBy: lock,
      leaseExpiresAt: new Date(Date.now() + LEASE),
      attempts: sql`${actions.attempts} + 1`,
    })
    .where(
      and(
        eq(actions.id, action.id),
        eq(actions.state, action.state),
        or(isNull(actions.leaseExpiresAt), lte(actions.leaseExpiresAt, now)),
      ),
    )
    .returning({ id: actions.id });
  if (!claimed.length) return true;
  const ownership = and(
    eq(actions.id, action.id),
    eq(actions.workspaceId, action.workspaceId),
    eq(actions.lockedBy, lock),
  );
  const adapter = getEngagementAdapter(a.providerId as ProviderId);
  const safeRetry =
    !!adapter &&
    Date.now() - action.createdAt.getTime() < adapter.idempotencyWindowMs;
  const finish = async (
    state: "failed" | "unknown",
    code: string,
    message: string,
  ) => {
    await db
      .update(actions)
      .set({
        state,
        errorCode: code,
        errorMessage: message,
        completedAt: new Date(),
        lockedBy: null,
        leaseExpiresAt: null,
      })
      .where(ownership);
  };
  // An expired sending lease may mean the previous process sent successfully and died.
  if (
    !safeRetry &&
    (action.state === "sending" ||
      (action.attempts > 0 && action.errorCode !== "provider_429"))
  ) {
    await finish(
      "unknown",
      "delivery_unknown",
      "Delivery may have happened and the provider idempotency window expired. Check the native conversation; automatic resend is disabled.",
    );
    return true;
  }
  const [member] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(
      and(
        eq(workspaceMembers.workspaceId, action.workspaceId),
        eq(workspaceMembers.userId, action.createdBy),
        eq(workspaceMembers.status, "active"),
        eq(users.status, "active"),
        isNull(workspaces.deletedAt),
      ),
    )
    .limit(1);
  const cap = engagementCapabilities(account(a));
  if (
    !adapter ||
    !member ||
    !roleHasPermission(member.role, "reply_inbox") ||
    !item.replyAllowed ||
    item.deletedAt ||
    !cap.replyTypes.includes(item.type)
  ) {
    await finish(
      "failed",
      "reply_permission_revoked",
      "Reply delivery is no longer permitted. Check workspace membership, account connection, and inbox scopes.",
    );
    return true;
  }
  let dispatched = false;
  try {
    const ctx = await contextFor(db, account(a), opts);
    dispatched = true;
    const result = await adapter.sendReply(ctx, {
      actionId: action.id,
      text: action.text,
      createdAt: action.createdAt.toISOString(),
      event: event(item),
    });
    if (!result.externalId) throw new Error("reply_outcome_unknown");
    await db.transaction(async (tx) => {
      const done = await tx
        .update(actions)
        .set({
          state: "confirmed",
          providerMessageId: result.externalId,
          nativeUrl: result.nativeUrl,
          completedAt: new Date(),
          errorCode: null,
          errorMessage: null,
          lockedBy: null,
          leaseExpiresAt: null,
        })
        .where(ownership)
        .returning({ id: actions.id });
      if (!done.length) return;
      await storeMessage(tx, action.workspaceId, item.id, {
        id: result.externalId,
        externalId: result.externalId,
        direction: "outgoing",
        text: action.text,
        sender: {
          id: a.externalAccountId,
          name: a.displayName,
          handle: a.handle,
        },
        occurredAt: new Date().toISOString(),
        url: result.nativeUrl,
      });
      await tx
        .update(items)
        .set({
          repliedAt: new Date(),
          lastActivityAt: new Date(),
          lastHandledBy: action.createdBy,
        })
        .where(
          and(eq(items.id, item.id), eq(items.workspaceId, action.workspaceId)),
        );
      await audit(
        tx,
        action.workspaceId,
        action.createdBy,
        item.id,
        "inbox.reply_confirmed",
        action.id,
      );
    });
  } catch (error) {
    const f = failure(error);
    // Only explicit rate-limit rejections or provider idempotency permit automatic resend.
    if (
      action.attempts < 4 &&
      (f.rate || (dispatched && safeRetry && f.ambiguous))
    ) {
      await db
        .update(actions)
        .set({
          state: "queued",
          runAt: new Date(
            Date.now() + f.delay * Math.max(1, 2 ** action.attempts),
          ),
          errorCode: f.code,
          errorMessage: f.message,
          lockedBy: null,
          leaseExpiresAt: null,
        })
        .where(ownership);
    } else
      await finish(
        dispatched && f.ambiguous ? "unknown" : "failed",
        f.code,
        f.message,
      );
  }
  return true;
}
export async function processInboxSync(
  db: AriaDatabase,
  opts: InboxWorkerOptions = {},
): Promise<boolean> {
  const now = new Date();
  const [candidate] = await db
    .select({ s: sync, a: socialAccounts })
    .from(sync)
    .innerJoin(
      socialAccounts,
      and(
        eq(sync.accountId, socialAccounts.id),
        eq(sync.workspaceId, socialAccounts.workspaceId),
      ),
    )
    .innerJoin(workspaces, eq(workspaces.id, socialAccounts.workspaceId))
    .where(
      and(lte(sync.nextSyncAt, now), due(now), isNull(workspaces.deletedAt)),
    )
    .orderBy(asc(sync.nextSyncAt))
    .limit(1);
  if (!candidate) return false;
  const { s, a } = candidate;
  const lock = randomUUID();
  const ownership = and(
    eq(sync.accountId, a.id),
    eq(sync.workspaceId, a.workspaceId),
    eq(sync.lockedBy, lock),
  );
  const claimed = await db
    .update(sync)
    .set({
      lockedBy: lock,
      leaseExpiresAt: new Date(Date.now() + LEASE),
      status: "syncing",
    })
    .where(
      and(
        eq(sync.accountId, a.id),
        eq(sync.workspaceId, a.workspaceId),
        due(now),
      ),
    )
    .returning({ id: sync.accountId });
  if (!claimed.length) return true;
  const adapter = getEngagementAdapter(a.providerId as ProviderId);
  if (!adapter || engagementCapabilities(account(a)).status !== "available") {
    await db
      .update(sync)
      .set({
        status: "blocked",
        lastError: "Reconnect with the required inbox permissions.",
        nextSyncAt: new Date(Date.now() + 3600000),
        lockedBy: null,
        leaseExpiresAt: null,
      })
      .where(ownership);
    return true;
  }
  try {
    const ctx = await contextFor(db, account(a), opts);
    const result = await adapter.syncEvents(ctx, s.cursor);
    await db.transaction(async (tx) => {
      const [owned] = await tx
        .select()
        .from(sync)
        .where(ownership)
        .for("update");
      if (!owned) return;
      // Recheck account/workspace after the network call (disconnect/delete may race it).
      const [active] = await tx
        .select({ id: socialAccounts.id })
        .from(socialAccounts)
        .innerJoin(workspaces, eq(workspaces.id, socialAccounts.workspaceId))
        .where(
          and(
            eq(socialAccounts.id, a.id),
            eq(socialAccounts.workspaceId, a.workspaceId),
            isNull(workspaces.deletedAt),
          ),
        );
      if (!active) return;
      await storeInboxEvents(tx, account(a), result.events);
      await tx
        .update(sync)
        .set({
          cursor: result.cursor,
          failureCount: 0,
          status: "healthy",
          lastError: null,
          lastSyncedAt: new Date(),
          nextSyncAt: new Date(Date.now() + (result.hasMore ? 5000 : 120000)),
        })
        .where(ownership);
    });
    const pending = await db
      .select()
      .from(items)
      .where(
        and(
          eq(items.workspaceId, a.workspaceId),
          eq(items.accountId, a.id),
          isNull(items.deletedAt),
          sql`${items.contextRequestedAt} is not null and (${items.contextRefreshedAt} is null or ${items.contextRequestedAt} > ${items.contextRefreshedAt})`,
        ),
      )
      .orderBy(asc(items.contextRequestedAt))
      .limit(2);
    for (const item of pending) {
      try {
        const thread = await adapter.getConversation(ctx, event(item));
        await db.transaction(async (tx) => {
          const [owned] = await tx
            .select({ id: sync.accountId })
            .from(sync)
            .where(ownership)
            .for("update");
          if (!owned) return;
          for (const m of thread.slice(0, 100))
            await storeMessage(tx, a.workspaceId, item.id, m);
          await tx
            .update(items)
            .set({ contextRefreshedAt: new Date() })
            .where(
              and(
                eq(items.id, item.id),
                eq(items.workspaceId, a.workspaceId),
                eq(items.accountId, a.id),
              ),
            );
        });
      } catch (error) {
        if (failure(error).missing)
          await db
            .update(items)
            .set({
              deletedAt: new Date(),
              replyAllowed: false,
              replyReason: "The provider no longer exposes this interaction.",
            })
            .where(
              and(eq(items.id, item.id), eq(items.workspaceId, a.workspaceId)),
            );
        else throw error;
      }
    }
    await db
      .update(sync)
      .set({ lockedBy: null, leaseExpiresAt: null })
      .where(ownership);
  } catch (error) {
    const f = failure(error);
    await db
      .update(sync)
      .set({
        status: f.auth || f.permission ? "blocked" : "error",
        lastError: f.message,
        failureCount: s.failureCount + 1,
        nextSyncAt: new Date(
          Date.now() +
            Math.min(3600000, f.delay * 2 ** Math.min(s.failureCount, 6)),
        ),
        lockedBy: null,
        leaseExpiresAt: null,
      })
      .where(ownership);
    if (f.auth)
      await db
        .update(socialAccounts)
        .set({
          connection: "needs_reauth",
          connectionNote: "Inbox authorization expired. Reconnect the account.",
        })
        .where(
          and(
            eq(socialAccounts.id, a.id),
            eq(socialAccounts.workspaceId, a.workspaceId),
          ),
        );
  }
  return true;
}
/** Runs inside the existing worker; no polling from browser requests or additional service. */
export async function inboxTick(
  db: AriaDatabase,
  opts: InboxWorkerOptions = {},
): Promise<void> {
  const discovered = await db
    .select({ a: socialAccounts })
    .from(socialAccounts)
    .innerJoin(workspaces, eq(socialAccounts.workspaceId, workspaces.id))
    .leftJoin(sync, eq(sync.accountId, socialAccounts.id))
    .where(
      and(
        isNull(workspaces.deletedAt),
        isNull(sync.accountId),
        inArray(socialAccounts.providerId, [
          "bluesky",
          "mastodon",
          "youtube",
          "facebook",
          "instagram",
        ]),
      ),
    )
    .limit(50);
  for (const { a } of discovered) {
    const capability = engagementCapabilities(account(a));
    // Record blocked accounts too, so a batch of missing grants cannot starve later accounts.
    await db
      .insert(sync)
      .values({
        accountId: a.id,
        workspaceId: a.workspaceId,
        status: capability.status === "available" ? "pending" : "blocked",
        nextSyncAt: new Date(
          Date.now() + (capability.status === "available" ? 0 : 3600000),
        ),
        lastError: capability.status === "available" ? null : capability.reason,
      })
      .onConflictDoNothing();
  }
  await processInboxReply(db, opts);
  await processInboxSync(db, opts);
}
export async function retainInbox(db: AriaDatabase): Promise<void> {
  const configured = Number(process.env.INBOX_RETENTION_DAYS || 90);
  const days = Number.isFinite(configured)
    ? Math.max(7, Math.min(365, configured))
    : 90;
  await db
    .delete(items)
    .where(lt(items.lastActivityAt, new Date(Date.now() - days * 86400000)));
  await db
    .delete(socialInboxWebhooks)
    .where(
      lt(socialInboxWebhooks.receivedAt, new Date(Date.now() - 7 * 86400000)),
    );
}
