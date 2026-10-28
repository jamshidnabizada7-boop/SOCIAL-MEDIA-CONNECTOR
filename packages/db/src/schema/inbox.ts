import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  InboxEventType,
  InboxPreferences,
  InboxReplyState,
  InboxSender,
} from "@aria/shared-types";
import { socialAccounts } from "./accounts.js";
import { users, workspaces } from "./identity.js";

export const socialInboxItems = pgTable(
  "social_inbox_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => socialAccounts.id, { onDelete: "cascade" }),
    providerId: text("provider_id").notNull(),
    externalId: text("external_id").notNull(),
    type: text("type").$type<InboxEventType>().notNull(),
    sender: jsonb("sender").$type<InboxSender>().notNull(),
    text: text("text").notNull(),
    nativeUrl: text("native_url"),
    conversationId: text("conversation_id"),
    post: jsonb("post").$type<{
      id: string;
      text?: string;
      url?: string;
      thumbnailUrl?: string;
    }>(),
    /** Minimal reply references only; never a raw provider response or token. */
    replyContext: jsonb("reply_context")
      .$type<Record<string, string | string[]>>()
      .notNull()
      .default({}),
    replyAllowed: boolean("reply_allowed").notNull().default(false),
    replyReason: text("reply_reason"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastActivityAt: timestamp("last_activity_at", {
      withTimezone: true,
    }).notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: uuid("resolved_by").references(() => users.id, {
      onDelete: "set null",
    }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    assignedTo: uuid("assigned_to").references(() => users.id, {
      onDelete: "set null",
    }),
    repliedAt: timestamp("replied_at", { withTimezone: true }),
    lastHandledBy: uuid("last_handled_by").references(() => users.id, {
      onDelete: "set null",
    }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    contextRequestedAt: timestamp("context_requested_at", {
      withTimezone: true,
    }),
    contextRefreshedAt: timestamp("context_refreshed_at", {
      withTimezone: true,
    }),
  },
  (t) => [
    foreignKey({
      columns: [t.accountId, t.workspaceId],
      foreignColumns: [socialAccounts.id, socialAccounts.workspaceId],
    }).onDelete("cascade"),
    unique("inbox_account_event_unique").on(t.accountId, t.externalId),
    unique("inbox_id_workspace_unique").on(t.id, t.workspaceId),
    index("inbox_workspace_activity_idx").on(
      t.workspaceId,
      t.lastActivityAt,
      t.id,
    ),
    index("inbox_workspace_account_type_idx").on(
      t.workspaceId,
      t.accountId,
      t.type,
    ),
    index("inbox_workspace_unread_idx").on(
      t.workspaceId,
      t.readAt,
      t.archivedAt,
    ),
    index("inbox_workspace_assignment_idx").on(
      t.workspaceId,
      t.assignedTo,
      t.resolvedAt,
    ),
  ],
);

export const socialInboxMessages = pgTable(
  "social_inbox_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    itemId: uuid("item_id").notNull(),
    externalId: text("external_id").notNull(),
    direction: text("direction").$type<"incoming" | "outgoing">().notNull(),
    sender: jsonb("sender").$type<InboxSender>().notNull(),
    text: text("text").notNull(),
    nativeUrl: text("native_url"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    deleted: boolean("deleted").notNull().default(false),
  },
  (t) => [
    foreignKey({
      columns: [t.itemId, t.workspaceId],
      foreignColumns: [socialInboxItems.id, socialInboxItems.workspaceId],
    }).onDelete("cascade"),
    unique("inbox_message_external_unique").on(t.itemId, t.externalId),
    index("inbox_messages_thread_idx").on(
      t.workspaceId,
      t.itemId,
      t.occurredAt,
    ),
  ],
);

export const socialReplyActions = pgTable(
  "social_reply_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    itemId: uuid("item_id").notNull(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => socialAccounts.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    idempotencyKey: uuid("idempotency_key").notNull(),
    text: text("text").notNull(),
    state: text("state").$type<InboxReplyState>().notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    lockedBy: uuid("locked_by"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    providerMessageId: text("provider_message_id"),
    nativeUrl: text("native_url"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      columns: [t.itemId, t.workspaceId],
      foreignColumns: [socialInboxItems.id, socialInboxItems.workspaceId],
    }).onDelete("cascade"),
    unique("inbox_reply_idempotency_unique").on(
      t.workspaceId,
      t.idempotencyKey,
    ),
    index("inbox_reply_queue_idx").on(t.state, t.runAt, t.leaseExpiresAt),
    index("inbox_reply_thread_idx").on(t.workspaceId, t.itemId, t.createdAt),
  ],
);

export const socialSyncState = pgTable(
  "social_sync_state",
  {
    accountId: uuid("account_id")
      .primaryKey()
      .references(() => socialAccounts.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    cursor: jsonb("cursor")
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    status: text("status").notNull().default("pending"),
    failureCount: integer("failure_count").notNull().default(0),
    nextSyncAt: timestamp("next_sync_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    lastRequestedAt: timestamp("last_requested_at", { withTimezone: true }),
    lastError: text("last_error"),
    lockedBy: uuid("locked_by"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  },
  (t) => [index("inbox_sync_due_idx").on(t.nextSyncAt, t.leaseExpiresAt)],
);

export const socialInboxPreferences = pgTable(
  "social_inbox_preferences",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    preferences: jsonb("preferences").$type<InboxPreferences>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] })],
);

export const socialInboxWebhooks = pgTable(
  "social_inbox_webhooks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    providerId: text("provider_id").notNull(),
    digest: text("digest").notNull(),
    matchedAccounts: integer("matched_accounts").notNull().default(0),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("inbox_webhook_dedupe_unique").on(t.providerId, t.digest),
    index("inbox_webhook_retention_idx").on(t.receivedAt),
  ],
);
