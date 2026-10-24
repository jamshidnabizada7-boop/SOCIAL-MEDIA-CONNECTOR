import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import {
  notificationSeverity,
  webhookStatus,
} from "./enums.js";
import { posts, publishTargets } from "./posts.js";
import { socialAccounts, socialProviders } from "./accounts.js";
import { users, workspaces } from "./identity.js";

/* -------------------------------- Analytics -------------------------------- */

export const analyticsSnapshots = pgTable(
  "analytics_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => socialAccounts.id, { onDelete: "cascade" }),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    /** Normalized + provider-native metrics; never coerce missing to zero. */
    metrics: jsonb("metrics").$type<Record<string, number | null>>().notNull(),
  },
  (t) => [index("analytics_snapshots_account_idx").on(t.accountId, t.capturedAt)]
);

export const postMetrics = pgTable(
  "post_metrics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    targetId: uuid("target_id")
      .notNull()
      .references(() => publishTargets.id, { onDelete: "cascade" }),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    impressions: integer("impressions"),
    reach: integer("reach"),
    likes: integer("likes"),
    comments: integer("comments"),
    shares: integer("shares"),
    clicks: integer("clicks"),
    engagements: integer("engagements"),
    watchTimeMin: integer("watch_time_min"),
    raw: jsonb("raw").$type<Record<string, unknown>>(),
  },
  (t) => [index("post_metrics_target_idx").on(t.targetId, t.capturedAt)]
);

/* ----------------------- Notifications & platform -------------------------- */

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** null = visible to every workspace member. */
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // post_failed | needs_reauth | …
    severity: notificationSeverity("severity").notNull().default("info"),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    postId: uuid("post_id").references(() => posts.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").references(() => socialAccounts.id, { onDelete: "cascade" }),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("notifications_workspace_idx").on(t.workspaceId, t.createdAt)]
);

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    providerId: text("provider_id")
      .notNull()
      .references(() => socialProviders.id),
    type: text("type").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    signatureValid: boolean("signature_valid").notNull().default(false),
    status: webhookStatus("status").notNull().default("pending"),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    /** Provider event id for replay/duplicate protection. */
    dedupeKey: text("dedupe_key").unique(),
  },
  (t) => [index("webhook_events_provider_idx").on(t.providerId, t.receivedAt)]
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, {
      onDelete: "cascade",
    }),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    actorType: text("actor_type").notNull().default("user"), // user | system
    action: text("action").notNull(), // e.g. user.login, workspace.created, post.published
    targetType: text("target_type"),
    targetId: text("target_id"),
    targetLabel: text("target_label"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_logs_workspace_idx").on(t.workspaceId, t.createdAt)]
);

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  prefix: text("prefix").notNull(), // shown in UI
  keyHash: text("key_hash").notNull().unique(),
  scopes: text("scopes").array().notNull().default([]),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const featureFlags = pgTable("feature_flags", {
  key: text("key").primaryKey(),
  description: text("description").notNull().default(""),
  enabled: boolean("enabled").notNull().default(false),
  rollout: text("rollout").notNull().default("internal"), // internal | beta | percentage | all
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------- Relations ------------------------------- */

export const notificationsRelations = relations(notifications, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [notifications.workspaceId],
    references: [workspaces.id],
  }),
  post: one(posts, { fields: [notifications.postId], references: [posts.id] }),
  account: one(socialAccounts, {
    fields: [notifications.accountId],
    references: [socialAccounts.id],
  }),
}));

export const postMetricsRelations = relations(postMetrics, ({ one }) => ({
  target: one(publishTargets, {
    fields: [postMetrics.targetId],
    references: [publishTargets.id],
  }),
}));

export const analyticsSnapshotsRelations = relations(analyticsSnapshots, ({ one }) => ({
  account: one(socialAccounts, {
    fields: [analyticsSnapshots.accountId],
    references: [socialAccounts.id],
  }),
}));
