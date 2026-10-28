import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import {
  auditLogs,
  socialAccounts,
  socialInboxItems as items,
  socialInboxMessages as messages,
  socialInboxPreferences as preferences,
  socialReplyActions as actions,
  socialSyncState,
  users,
  workspaceMembers,
} from "@aria/db";
import {
  DEFAULT_INBOX_PREFERENCES,
  INBOX_EVENT_TYPES,
  roleHasPermission,
  type InboxItem,
  type ProviderId,
} from "@aria/shared-types";
import {
  engagementCapabilities,
  type EngagementAccount,
} from "@aria/providers-core";
import { requireWorkspacePermission } from "../../plugins/auth.js";
import { writeAudit } from "../../lib/audit.js";

const ids = z.object({
  workspaceId: z.string().uuid(),
  itemId: z.string().uuid().optional(),
});
const listInput = z.object({
  view: z
    .enum([
      "all",
      "unread",
      "needs_reply",
      "assigned",
      "unassigned",
      "unresolved",
      "resolved",
      "archived",
    ])
    .default("all"),
  types: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",") : undefined))
    .pipe(z.array(z.enum(INBOX_EVENT_TYPES)).max(8).optional()),
  accountIds: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",") : undefined))
    .pipe(z.array(z.string().uuid()).max(100).optional()),
  provider: z
    .enum([
      "facebook",
      "instagram",
      "threads",
      "linkedin",
      "tiktok",
      "youtube",
      "x",
      "pinterest",
      "bluesky",
      "mastodon",
    ])
    .optional(),
  search: z.string().trim().max(200).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
const changeInput = z.object({
  operation: z.enum([
    "read",
    "unread",
    "resolve",
    "reopen",
    "archive",
    "unarchive",
    "assign",
  ]),
  assignedTo: z.string().uuid().nullable().optional(),
});
const bulkInput = changeInput.extend({
  ids: z.array(z.string().uuid()).min(1).max(100),
});
type AccountRow = typeof socialAccounts.$inferSelect;
export function engagementAccount(a: AccountRow): EngagementAccount {
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
const iso = (d: Date | null) => d?.toISOString() ?? null;
function dto(
  row: typeof items.$inferSelect,
  account: AccountRow,
  replyState: InboxItem["replyState"] = null,
): InboxItem {
  const cap = engagementCapabilities(engagementAccount(account));
  const replyAllowed =
    row.replyAllowed && !row.deletedAt && cap.replyTypes.includes(row.type);
  const mentionCharacters =
    account.providerId === "mastodon"
      ? Array.from(
          ((row.replyContext.recipients as string[]) || [])
            .map((r) => `@${r} `)
            .join(""),
        ).length
      : 0;
  return {
    id: row.id,
    accountId: row.accountId,
    accountName: account.displayName,
    provider: row.providerId as ProviderId,
    externalId: row.externalId,
    type: row.type,
    sender: row.sender,
    text: row.text,
    nativeUrl: row.nativeUrl,
    post: row.post,
    occurredAt: row.occurredAt.toISOString(),
    lastActivityAt: row.lastActivityAt.toISOString(),
    readAt: iso(row.readAt),
    resolvedAt: iso(row.resolvedAt),
    resolvedBy: row.resolvedBy,
    archivedAt: iso(row.archivedAt),
    assignedTo: row.assignedTo,
    repliedAt: iso(row.repliedAt),
    lastHandledBy: row.lastHandledBy,
    deletedAt: iso(row.deletedAt),
    replyAllowed: !!replyAllowed,
    replyCharacterLimit: Math.max(0, cap.maxReplyLength - mentionCharacters),
    replyReason: row.deletedAt
      ? "This interaction is no longer available."
      : replyAllowed
        ? null
        : cap.status !== "available" || cap.missingReplyScopes.length
          ? cap.reason
          : row.replyReason || cap.reason,
    replyState,
  };
}
export function registerInboxRoutes(app: FastifyInstance): void {
  const db = app.database.db;
  const base = "/v1/workspaces/:workspaceId/inbox";
  const view = { preHandler: requireWorkspacePermission(app, "view_inbox") };
  const manage = {
    preHandler: requireWorkspacePermission(app, "manage_inbox"),
  };
  const fail = (code: string, message: string) => ({
    error: { code, message },
  });
  const find = async (workspaceId: string, itemId: string) =>
    (
      await db
        .select({ item: items, account: socialAccounts })
        .from(items)
        .innerJoin(
          socialAccounts,
          and(
            eq(items.accountId, socialAccounts.id),
            eq(items.workspaceId, socialAccounts.workspaceId),
          ),
        )
        .where(and(eq(items.workspaceId, workspaceId), eq(items.id, itemId)))
        .limit(1)
    )[0];

  app.get(base, view, async (req, reply) => {
    const { workspaceId } = ids.parse(req.params);
    const input = listInput.parse(req.query);
    const conditions: SQL[] = [eq(items.workspaceId, workspaceId)];
    if (input.view === "archived") conditions.push(isNotNull(items.archivedAt));
    else conditions.push(isNull(items.archivedAt));
    if (input.view === "unread") conditions.push(isNull(items.readAt));
    if (input.view === "needs_reply")
      conditions.push(
        isNull(items.repliedAt),
        isNull(items.resolvedAt),
        eq(items.replyAllowed, true),
        isNull(items.deletedAt),
      );
    if (input.view === "unresolved") conditions.push(isNull(items.resolvedAt));
    if (input.view === "resolved") conditions.push(isNotNull(items.resolvedAt));
    if (input.view === "assigned")
      conditions.push(eq(items.assignedTo, req.user!.id));
    if (input.view === "unassigned") conditions.push(isNull(items.assignedTo));
    if (input.types?.length) conditions.push(inArray(items.type, input.types));
    if (input.accountIds?.length)
      conditions.push(inArray(items.accountId, input.accountIds));
    if (input.provider) conditions.push(eq(items.providerId, input.provider));
    if (input.search)
      conditions.push(
        or(
          ilike(items.text, `%${input.search.replace(/[\\%_]/g, "\\$&")}%`),
          ilike(
            sql`${items.sender}->>'name'`,
            `%${input.search.replace(/[\\%_]/g, "\\$&")}%`,
          ),
        )!,
      );
    if (input.from)
      conditions.push(gte(items.occurredAt, new Date(input.from)));
    if (input.to) conditions.push(lte(items.occurredAt, new Date(input.to)));
    const where = and(...conditions);
    const [rows, total] = await Promise.all([
      db
        .select({ item: items, account: socialAccounts })
        .from(items)
        .innerJoin(
          socialAccounts,
          and(
            eq(items.accountId, socialAccounts.id),
            eq(items.workspaceId, socialAccounts.workspaceId),
          ),
        )
        .where(where)
        .orderBy(desc(items.lastActivityAt), desc(items.id))
        .limit(input.limit)
        .offset((input.page - 1) * input.limit),
      db.select({ n: count() }).from(items).where(where),
    ]);
    const latest = rows.length
      ? await db
          .selectDistinctOn([actions.itemId])
          .from(actions)
          .where(
            and(
              eq(actions.workspaceId, workspaceId),
              inArray(
                actions.itemId,
                rows.map((r) => r.item.id),
              ),
            ),
          )
          .orderBy(actions.itemId, desc(actions.createdAt))
      : [];
    return reply.send({
      items: rows.map((r) =>
        dto(
          r.item,
          r.account,
          latest.find((a) => a.itemId === r.item.id)?.state,
        ),
      ),
      total: total[0].n,
      page: input.page,
      limit: input.limit,
    });
  });
  app.get(`${base}/counts`, view, async (req) => {
    const { workspaceId } = ids.parse(req.params);
    const [totals, groups] = await Promise.all([
      db
        .select({
          all: sql<number>`count(*) filter (where ${items.archivedAt} is null)::int`,
          unread: sql<number>`count(*) filter (where ${items.archivedAt} is null and ${items.readAt} is null)::int`,
          needsReply: sql<number>`count(*) filter (where ${items.archivedAt} is null and ${items.repliedAt} is null and ${items.resolvedAt} is null and ${items.replyAllowed} and ${items.deletedAt} is null)::int`,
          unresolved: sql<number>`count(*) filter (where ${items.archivedAt} is null and ${items.resolvedAt} is null)::int`,
          resolved: sql<number>`count(*) filter (where ${items.archivedAt} is null and ${items.resolvedAt} is not null)::int`,
          assigned: sql<number>`count(*) filter (where ${items.archivedAt} is null and ${items.assignedTo} = ${req.user!.id})::int`,
          archived: sql<number>`count(*) filter (where ${items.archivedAt} is not null)::int`,
        })
        .from(items)
        .where(eq(items.workspaceId, workspaceId)),
      db
        .select({
          account: items.accountId,
          provider: items.providerId,
          n: count(),
        })
        .from(items)
        .where(
          and(
            eq(items.workspaceId, workspaceId),
            isNull(items.archivedAt),
            isNull(items.readAt),
          ),
        )
        .groupBy(items.accountId, items.providerId),
    ]);
    const byAccount: Record<string, number> = {},
      byProvider: Record<string, number> = {};
    for (const g of groups) {
      byAccount[g.account] = g.n;
      byProvider[g.provider] = (byProvider[g.provider] || 0) + g.n;
    }
    return { ...totals[0], byAccount, byProvider };
  });
  app.get(`${base}/accounts`, view, async (req) => {
    const { workspaceId } = ids.parse(req.params);
    const rows = await db
      .select({ a: socialAccounts, sync: socialSyncState })
      .from(socialAccounts)
      .leftJoin(
        socialSyncState,
        and(
          eq(socialAccounts.id, socialSyncState.accountId),
          eq(socialAccounts.workspaceId, socialSyncState.workspaceId),
        ),
      )
      .where(eq(socialAccounts.workspaceId, workspaceId));
    return {
      accounts: rows.map(({ a, sync }) => ({
        id: a.id,
        name: a.displayName,
        handle: a.handle,
        provider: a.providerId,
        capability: engagementCapabilities(engagementAccount(a)),
        lastSyncedAt: iso(sync?.lastSyncedAt ?? null),
        nextSyncAt: iso(sync?.nextSyncAt ?? null),
        syncStatus:
          sync?.status ??
          (engagementCapabilities(engagementAccount(a)).implemented
            ? "pending"
            : "not_implemented"),
        syncError: sync?.lastError ?? null,
      })),
    };
  });
  app.get(`${base}/members`, view, async (req) => {
    const { workspaceId } = ids.parse(req.params);
    return {
      members: await db
        .select({ id: users.id, name: users.name })
        .from(workspaceMembers)
        .innerJoin(users, eq(users.id, workspaceMembers.userId))
        .where(
          and(
            eq(workspaceMembers.workspaceId, workspaceId),
            eq(workspaceMembers.status, "active"),
            eq(users.status, "active"),
          ),
        )
        .orderBy(asc(users.name)),
    };
  });
  app.get(`${base}/preferences`, view, async (req) => {
    const { workspaceId } = ids.parse(req.params);
    const [row] = await db
      .select()
      .from(preferences)
      .where(
        and(
          eq(preferences.workspaceId, workspaceId),
          eq(preferences.userId, req.user!.id),
        ),
      );
    return row?.preferences ?? DEFAULT_INBOX_PREFERENCES;
  });
  app.patch(`${base}/preferences`, view, async (req) => {
    const { workspaceId } = ids.parse(req.params);
    const value = z
      .object({
        enabledTypes: z.array(z.enum(INBOX_EVENT_TYPES)).max(8),
        priorityTypes: z.array(z.enum(INBOX_EVENT_TYPES)).max(8),
      })
      .strict()
      .parse(req.body);
    await db
      .insert(preferences)
      .values({ workspaceId, userId: req.user!.id, preferences: value })
      .onConflictDoUpdate({
        target: [preferences.workspaceId, preferences.userId],
        set: { preferences: value },
      });
    return value;
  });
  app.post(`${base}/sync`, manage, async (req) => {
    const { workspaceId } = ids.parse(req.params);
    const input = z
      .object({ accountIds: z.array(z.string().uuid()).max(100).optional() })
      .parse(req.body ?? {});
    const accounts = await db
      .select()
      .from(socialAccounts)
      .where(
        and(
          eq(socialAccounts.workspaceId, workspaceId),
          input.accountIds?.length
            ? inArray(socialAccounts.id, input.accountIds)
            : undefined,
        ),
      );
    let queued = 0;
    for (const account of accounts) {
      if (
        engagementCapabilities(engagementAccount(account)).status !==
        "available"
      )
        continue;
      const now = new Date();
      const changed = await db
        .insert(socialSyncState)
        .values({ workspaceId, accountId: account.id, lastRequestedAt: now })
        .onConflictDoUpdate({
          target: socialSyncState.accountId,
          set: { nextSyncAt: now, lastRequestedAt: now },
          setWhere: and(
            eq(socialSyncState.workspaceId, workspaceId),
            or(
              isNull(socialSyncState.lastRequestedAt),
              lte(
                socialSyncState.lastRequestedAt,
                new Date(Date.now() - 30000),
              ),
            ),
          ),
        })
        .returning({ id: socialSyncState.accountId });
      queued += changed.length;
    }
    return {
      queued,
      message: queued
        ? "Synchronization queued."
        : "No eligible accounts, or sync was requested in the last 30 seconds.",
    };
  });
  app.post(`${base}/bulk`, view, async (req, reply) => {
    const { workspaceId } = ids.parse(req.params);
    const input = bulkInput.parse(req.body);
    if (
      !["read", "unread"].includes(input.operation) &&
      !roleHasPermission(req.member!.role, "manage_inbox")
    )
      return reply
        .code(403)
        .send(fail("forbidden", "Your role cannot manage inbox items."));
    const uniqueIds = [...new Set(input.ids)];
    return db.transaction(async (tx) => {
      const rows = await tx
        .select({ id: items.id })
        .from(items)
        .where(
          and(eq(items.workspaceId, workspaceId), inArray(items.id, uniqueIds)),
        )
        .for("update");
      if (rows.length !== uniqueIds.length)
        return reply
          .code(404)
          .send(fail("not_found", "One or more interactions were not found."));
      if (input.operation === "assign" && input.assignedTo) {
        const [member] = await tx
          .select({ id: users.id })
          .from(workspaceMembers)
          .innerJoin(users, eq(users.id, workspaceMembers.userId))
          .where(
            and(
              eq(workspaceMembers.workspaceId, workspaceId),
              eq(workspaceMembers.userId, input.assignedTo),
              eq(workspaceMembers.status, "active"),
              eq(users.status, "active"),
            ),
          );
        if (!member)
          return reply
            .code(400)
            .send(
              fail(
                "invalid_assignee",
                "Choose an active member of this workspace.",
              ),
            );
      }
      if (input.operation === "assign" && input.assignedTo === undefined)
        return reply
          .code(400)
          .send(fail("invalid_assignee", "An assignee or null is required."));
      const now = new Date();
      const patch: Partial<typeof items.$inferInsert> = {
        lastHandledBy: req.user!.id,
      };
      if (input.operation === "read" || input.operation === "unread")
        patch.readAt = input.operation === "read" ? now : null;
      if (input.operation === "resolve" || input.operation === "reopen") {
        patch.resolvedAt = input.operation === "resolve" ? now : null;
        patch.resolvedBy = input.operation === "resolve" ? req.user!.id : null;
      }
      if (input.operation === "archive" || input.operation === "unarchive")
        patch.archivedAt = input.operation === "archive" ? now : null;
      if (input.operation === "assign") patch.assignedTo = input.assignedTo;
      await tx
        .update(items)
        .set(patch)
        .where(
          and(eq(items.workspaceId, workspaceId), inArray(items.id, uniqueIds)),
        );
      for (const id of uniqueIds)
        await writeAudit(tx, {
          workspaceId,
          actorUserId: req.user!.id,
          action: `inbox.${input.operation}`,
          targetType: "inbox_item",
          targetId: id,
          metadata:
            input.operation === "assign"
              ? { assignedTo: input.assignedTo }
              : {},
        });
      return { updated: rows.length };
    });
  });
  app.get(`${base}/:itemId`, view, async (req, reply) => {
    const { workspaceId, itemId } = ids.required().parse(req.params);
    const row = await find(workspaceId, itemId);
    if (!row)
      return reply.code(404).send(fail("not_found", "Interaction not found."));
    const [thread, replies, activity] = await Promise.all([
      db
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.workspaceId, workspaceId),
            eq(messages.itemId, itemId),
          ),
        )
        .orderBy(asc(messages.occurredAt))
        .limit(250),
      db
        .select()
        .from(actions)
        .where(
          and(eq(actions.workspaceId, workspaceId), eq(actions.itemId, itemId)),
        )
        .orderBy(desc(actions.createdAt))
        .limit(100),
      db
        .select({
          action: auditLogs.action,
          actorId: auditLogs.actorUserId,
          at: auditLogs.createdAt,
        })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.workspaceId, workspaceId),
            eq(auditLogs.targetType, "inbox_item"),
            eq(auditLogs.targetId, itemId),
          ),
        )
        .orderBy(desc(auditLogs.createdAt))
        .limit(50),
    ]);
    return {
      item: dto(row.item, row.account, replies[0]?.state),
      messages: thread.map((m) => ({
        id: m.id,
        externalId: m.externalId,
        direction: m.direction,
        text: m.text,
        sender: m.sender,
        occurredAt: m.occurredAt.toISOString(),
        url: m.nativeUrl ?? undefined,
        deleted: m.deleted,
      })),
      actions: replies.map((a) => ({
        id: a.id,
        itemId: a.itemId,
        text: a.text,
        state: a.state,
        createdBy: a.createdBy,
        createdAt: a.createdAt.toISOString(),
        completedAt: iso(a.completedAt),
        errorCode: a.errorCode,
        errorMessage: a.errorMessage,
        providerMessageId: a.providerMessageId,
        nativeUrl: a.nativeUrl,
      })),
      activity: activity.map((a) => ({ ...a, at: a.at.toISOString() })),
      contextRefreshedAt: iso(row.item.contextRefreshedAt),
    };
  });
  app.post(`${base}/:itemId/refresh`, view, async (req, reply) => {
    const { workspaceId, itemId } = ids.required().parse(req.params);
    const row = await find(workspaceId, itemId);
    if (!row)
      return reply.code(404).send(fail("not_found", "Interaction not found."));
    if (
      engagementCapabilities(engagementAccount(row.account)).status !==
      "available"
    )
      return reply
        .code(409)
        .send(
          fail(
            "unavailable",
            "Reconnect with inbox permissions before refreshing.",
          ),
        );
    const now = new Date();
    const requested = await db
      .update(items)
      .set({ contextRequestedAt: now })
      .where(
        and(
          eq(items.id, itemId),
          eq(items.workspaceId, workspaceId),
          or(
            isNull(items.contextRequestedAt),
            lte(items.contextRequestedAt, new Date(Date.now() - 30000)),
          ),
        ),
      )
      .returning({ id: items.id });
    if (!requested.length) return reply.code(202).send({ queued: true });
    await db
      .insert(socialSyncState)
      .values({ workspaceId, accountId: row.account.id })
      .onConflictDoUpdate({
        target: socialSyncState.accountId,
        set: { nextSyncAt: now },
        setWhere: eq(socialSyncState.workspaceId, workspaceId),
      });
    return reply.code(202).send({ queued: true });
  });
  app.post(
    `${base}/:itemId/reply`,
    {
      preHandler: requireWorkspacePermission(app, "reply_inbox"),
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      const { workspaceId, itemId } = ids.required().parse(req.params);
      const input = z
        .object({
          text: z.string().trim().min(1).max(10000),
          idempotencyKey: z.string().uuid(),
        })
        .strict()
        .parse(req.body);
      return db.transaction(async (tx) => {
        const [row] = await tx
          .select({ item: items, account: socialAccounts })
          .from(items)
          .innerJoin(
            socialAccounts,
            and(
              eq(items.accountId, socialAccounts.id),
              eq(items.workspaceId, socialAccounts.workspaceId),
            ),
          )
          .where(and(eq(items.workspaceId, workspaceId), eq(items.id, itemId)))
          .for("update");
        if (!row)
          return reply
            .code(404)
            .send(fail("not_found", "Interaction not found."));
        const [previous] = await tx
          .select()
          .from(actions)
          .where(
            and(
              eq(actions.workspaceId, workspaceId),
              eq(actions.idempotencyKey, input.idempotencyKey),
            ),
          );
        if (previous) {
          if (previous.itemId !== itemId || previous.text !== input.text)
            return reply
              .code(409)
              .send(
                fail(
                  "idempotency_conflict",
                  "This request key belongs to a different reply.",
                ),
              );
          return reply
            .code(202)
            .send({ actionId: previous.id, state: previous.state });
        }
        const cap = engagementCapabilities(engagementAccount(row.account));
        if (!dto(row.item, row.account).replyAllowed)
          return reply
            .code(409)
            .send(
              fail("reply_unavailable", row.item.replyReason || cap.reason),
            );
        const mentionPrefix =
          row.account.providerId === "mastodon"
            ? ((row.item.replyContext.recipients as string[]) || [])
                .map((s) => `@${s} `)
                .join("")
            : "";
        if (Array.from(mentionPrefix + input.text).length > cap.maxReplyLength)
          return reply
            .code(400)
            .send(
              fail(
                "reply_too_long",
                `The reply including recipient mentions must fit ${cap.maxReplyLength} characters.`,
              ),
            );
        const [pending] = await tx
          .select({ id: actions.id })
          .from(actions)
          .where(
            and(
              eq(actions.workspaceId, workspaceId),
              eq(actions.itemId, itemId),
              inArray(actions.state, ["queued", "sending", "unknown"]),
            ),
          );
        if (pending)
          return reply
            .code(409)
            .send(
              fail(
                "reply_pending",
                "A reply is pending or has an unknown outcome. Check its status before sending another.",
              ),
            );
        const [action] = await tx
          .insert(actions)
          .values({
            workspaceId,
            itemId,
            accountId: row.account.id,
            createdBy: req.user!.id,
            idempotencyKey: input.idempotencyKey,
            text: input.text,
          })
          .onConflictDoNothing({
            target: [actions.workspaceId, actions.idempotencyKey],
          })
          .returning({ id: actions.id });
        if (!action)
          return reply
            .code(409)
            .send(
              fail(
                "idempotency_conflict",
                "This request key already belongs to another reply. Reload its delivery status.",
              ),
            );
        await tx
          .update(items)
          .set({ lastActivityAt: new Date() })
          .where(and(eq(items.id, itemId), eq(items.workspaceId, workspaceId)));
        await writeAudit(tx, {
          workspaceId,
          actorUserId: req.user!.id,
          action: "inbox.reply_queued",
          targetType: "inbox_item",
          targetId: itemId,
          metadata: { actionId: action.id },
        });
        return reply.code(202).send({ actionId: action.id, state: "queued" });
      });
    },
  );
}
