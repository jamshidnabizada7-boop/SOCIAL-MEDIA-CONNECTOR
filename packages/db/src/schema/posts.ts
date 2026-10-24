import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import {
  jobState,
  postState,
  targetState,
} from "./enums.js";
import { brands, users, workspaces } from "./identity.js";
import { mediaAssets, socialAccounts } from "./accounts.js";

/* --------------------------------- Posts ---------------------------------- */

export const posts = pgTable(
  "posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id").references(() => brands.id, { onDelete: "set null" }),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    /** Internal label — never published. */
    title: text("title").notNull().default(""),
    caption: text("caption").notNull().default(""),
    link: text("link"),
    campaign: text("campaign"),
    labels: text("labels").array().notNull().default([]),
    timezone: text("timezone").notNull().default("UTC"),
    state: postState("state").notNull().default("draft"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    aiDisclosed: boolean("ai_disclosed").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("posts_workspace_state_idx").on(t.workspaceId, t.state),
    index("posts_workspace_scheduled_idx").on(t.workspaceId, t.scheduledAt),
  ]
);

export const postMedia = pgTable(
  "post_media",
  {
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    mediaId: uuid("media_id")
      .notNull()
      .references(() => mediaAssets.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.postId, t.mediaId] })]
);

/** Immutable content snapshots frozen at schedule/publish time. */
export const postVersions = pgTable(
  "post_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    frozenAt: timestamp("frozen_at", { withTimezone: true }).notNull().defaultNow(),
    caption: text("caption").notNull(),
    mediaIds: uuid("media_ids").array().notNull().default([]),
    byUserId: uuid("by_user_id").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [unique("post_versions_unique").on(t.postId, t.version)]
);

/** Platform-specific overrides; rows exist only where the user changed something. */
export const postVariants = pgTable(
  "post_variants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    providerId: text("provider_id").notNull(),
    caption: text("caption"),
    title: text("title"),
    firstComment: text("first_comment"),
    /** e.g. pinterest board, tiktok privacy, youtube visibility/madeForKids. */
    settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("post_variants_unique").on(t.postId, t.providerId)]
);

/* ----------------------------- Publish targets ----------------------------- */

export const publishTargets = pgTable(
  "publish_targets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => socialAccounts.id, { onDelete: "cascade" }),
    providerId: text("provider_id").notNull(),
    state: targetState("state").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    /** Stable identity for duplicate protection: a target publishes at most once. */
    idempotencyKey: text("idempotency_key").notNull().unique(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    remoteUrl: text("remote_url"),
    lastError: jsonb("last_error").$type<{
      code: string;
      title: string;
      message: string;
      hint?: string;
      retryable: boolean;
      technical?: string;
    } | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("publish_targets_post_idx").on(t.postId),
    index("publish_targets_state_idx").on(t.state),
  ]
);

/* ---------------------------- Jobs & scheduling ---------------------------- */

export const publishJobs = pgTable(
  "publish_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    targetId: uuid("target_id")
      .notNull()
      .references(() => publishTargets.id, { onDelete: "cascade" }),
    queue: text("queue").notNull().default("publish"),
    state: jobState("state").notNull().default("pending"),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    lockedBy: text("locked_by"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    /** A claimed (active) job whose lease lapsed belongs to a crashed worker and is re-claimed by the sweep. */
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("publish_jobs_state_runat_idx").on(t.state, t.runAt)]
);

export const publishAttempts = pgTable("publish_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id")
    .notNull()
    .references(() => publishJobs.id, { onDelete: "cascade" }),
  targetId: uuid("target_id")
    .notNull()
    .references(() => publishTargets.id, { onDelete: "cascade" }),
  attemptNo: integer("attempt_no").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  success: boolean("success"),
  /** skipped_duplicate is recorded here too — proof the guard ran. */
  outcome: text("outcome"), // published | skipped_duplicate | retry_scheduled | failed | token_expired
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  providerRequestId: text("provider_request_id"),
  detail: jsonb("detail").$type<Record<string, unknown>>(),
});

/** The provider's copy of a published post. */
export const remotePosts = pgTable("remote_posts", {
  id: uuid("id").primaryKey().defaultRandom(),
  targetId: uuid("target_id")
    .notNull()
    .unique()
    .references(() => publishTargets.id, { onDelete: "cascade" }),
  providerPostId: text("provider_post_id").notNull(),
  permalink: text("permalink"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  raw: jsonb("raw").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Recurring posting windows per workspace. */
export const queueSlots = pgTable("queue_slots", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  dayOfWeek: smallint("day_of_week").notNull(), // 0=Sunday … 6=Saturday
  time: text("time").notNull(), // "HH:mm"
  providerIds: text("provider_ids").array().notNull().default([]),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------- Relations ------------------------------- */

export const postsRelations = relations(posts, ({ one, many }) => ({
  workspace: one(workspaces, { fields: [posts.workspaceId], references: [workspaces.id] }),
  brand: one(brands, { fields: [posts.brandId], references: [brands.id] }),
  author: one(users, { fields: [posts.authorId], references: [users.id] }),
  media: many(postMedia),
  variants: many(postVariants),
  versions: many(postVersions),
  targets: many(publishTargets),
}));

export const publishTargetsRelations = relations(publishTargets, ({ one, many }) => ({
  post: one(posts, { fields: [publishTargets.postId], references: [posts.id] }),
  account: one(socialAccounts, {
    fields: [publishTargets.accountId],
    references: [socialAccounts.id],
  }),
  jobs: many(publishJobs),
}));

export const publishJobsRelations = relations(publishJobs, ({ one, many }) => ({
  target: one(publishTargets, {
    fields: [publishJobs.targetId],
    references: [publishTargets.id],
  }),
  attempts: many(publishAttempts),
}));

export const postMediaRelations = relations(postMedia, ({ one }) => ({
  post: one(posts, { fields: [postMedia.postId], references: [posts.id] }),
  media: one(mediaAssets, { fields: [postMedia.mediaId], references: [mediaAssets.id] }),
}));

export const postVariantsRelations = relations(postVariants, ({ one }) => ({
  post: one(posts, { fields: [postVariants.postId], references: [posts.id] }),
}));

export const postVersionsRelations = relations(postVersions, ({ one }) => ({
  post: one(posts, { fields: [postVersions.postId], references: [posts.id] }),
}));
