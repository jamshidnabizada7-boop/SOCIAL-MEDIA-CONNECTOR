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
  FeedPreferences,
  FeedSourceConfig,
  FeedSourceKind,
  UniversalFeedItem,
} from "@aria/shared-types";
import { socialAccounts } from "./accounts.js";
import { users, workspaces } from "./identity.js";

/** Public discovery subscriptions are personal. Account subscriptions also require active workspace membership. */
export const feedSources = pgTable(
  "feed_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, {
      onDelete: "cascade",
    }),
    accountId: uuid("account_id"),
    provider: text("provider").notNull(),
    kind: text("kind").$type<FeedSourceKind>().notNull(),
    label: text("label").notNull(),
    sourceKey: text("source_key").notNull(),
    config: jsonb("config").$type<FeedSourceConfig>().notNull().default({}),
    topics: text("topics").array().notNull().default([]),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("feed_source_owner_key").on(t.userId, t.sourceKey),
    index("feed_sources_owner_workspace").on(t.userId, t.workspaceId),
    foreignKey({
      columns: [t.accountId, t.workspaceId],
      foreignColumns: [socialAccounts.id, socialAccounts.workspaceId],
    }).onDelete("cascade"),
  ],
);

export const feedItems = pgTable(
  "feed_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => feedSources.id, { onDelete: "cascade" }),
    providerPostId: text("provider_post_id").notNull(),
    content: jsonb("content").$type<UniversalFeedItem>().notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    unique("feed_items_source_post").on(t.sourceId, t.providerPostId),
    index("feed_items_source_expiry").on(t.sourceId, t.expiresAt),
    index("feed_items_expiry").on(t.expiresAt),
  ],
);

export const feedPreferences = pgTable("feed_preferences", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  preferences: jsonb("preferences").$type<FeedPreferences>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const feedFollows = pgTable(
  "feed_follows",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    authorId: text("author_id").notNull(),
    sourceId: uuid("source_id").references(() => feedSources.id, {
      onDelete: "cascade",
    }),
    followedAt: timestamp("followed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.provider, t.authorId] })],
);
export const feedSaved = pgTable(
  "feed_saved",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => feedItems.id, { onDelete: "cascade" }),
    savedAt: timestamp("saved_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.itemId] })],
);
export const feedInteractions = pgTable(
  "feed_interactions",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => feedItems.id, { onDelete: "cascade" }),
    hidden: boolean("hidden").notNull().default(false),
    reportedUnavailable: boolean("reported_unavailable")
      .notNull()
      .default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.itemId] })],
);
export const feedSyncState = pgTable(
  "feed_sync_state",
  {
    sourceId: uuid("source_id")
      .primaryKey()
      .references(() => feedSources.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    nextSyncAt: timestamp("next_sync_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    leaseId: uuid("lease_id"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    failures: integer("failures").notNull().default(0),
    error: text("error"),
  },
  (t) => [index("feed_sync_due").on(t.nextSyncAt, t.leaseExpiresAt)],
);
/** Frozen ID order, never a copy of media. Recheck ownership/availability on every page. */
export const feedSessions = pgTable(
  "feed_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    filterKey: text("filter_key").notNull(),
    itemIds: jsonb("item_ids").$type<string[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("feed_sessions_owner_expiry").on(t.userId, t.expiresAt),
    index("feed_sessions_expiry").on(t.expiresAt),
  ],
);
