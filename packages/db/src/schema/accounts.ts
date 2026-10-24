import { relations } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type { ProviderCapabilities } from "@aria/shared-types";
import {
  connectionState,
  mediaKind,
  mediaStatus,
  providerApproval,
  providerStatus,
} from "./enums.js";
import { brands, users, workspaces } from "./identity.js";

/* --------------------------- Provider registry ---------------------------- */

export const socialProviders = pgTable("social_providers", {
  id: text("id").primaryKey(), // facebook | instagram | threads | linkedin | tiktok | youtube | x | pinterest | bluesky | mastodon
  name: text("name").notNull(),
  status: providerStatus("status").notNull().default("active"),
  approval: providerApproval("approval").notNull().default("approved"),
  apiVersion: text("api_version"),
  capabilities: jsonb("capabilities").$type<ProviderCapabilities>().notNull(),
  /** Date the capability set was last verified against official docs. */
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const socialAccounts = pgTable(
  "social_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id").references(() => brands.id, { onDelete: "set null" }),
    providerId: text("provider_id")
      .notNull()
      .references(() => socialProviders.id),
    /** The provider's own account/page/channel id. */
    externalAccountId: text("external_account_id").notNull(),
    displayName: text("display_name").notNull(),
    handle: text("handle").notNull(),
    avatarHue: integer("avatar_hue").notNull().default(200),
    connection: connectionState("connection").notNull().default("healthy"),
    connectionNote: text("connection_note"),
    /** Federated/instance-based providers (Mastodon) store their server here. */
    instanceUrl: text("instance_url"),
    followers: integer("followers").notNull().default(0),
    scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
    connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
    lastRefreshedAt: timestamp("last_refreshed_at", { withTimezone: true }),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("social_accounts_unique").on(t.workspaceId, t.providerId, t.externalAccountId),
    index("social_accounts_workspace_idx").on(t.workspaceId),
  ]
);

/**
 * Encrypted credential vault. Tokens are AES-256-GCM ciphertext under
 * ARIA_ENCRYPTION_KEY; they are never returned to the frontend and never
 * logged (see packages/db/src/crypto.ts).
 */
export const oauthCredentials = pgTable("oauth_credentials", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id")
    .notNull()
    .unique()
    .references(() => socialAccounts.id, { onDelete: "cascade" }),
  accessTokenEnc: text("access_token_enc").notNull(),
  refreshTokenEnc: text("refresh_token_enc"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
  keyVersion: integer("key_version").notNull().default(1),
  rotatedAt: timestamp("rotated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* --------------------------------- Media ---------------------------------- */

export const mediaAssets = pgTable(
  "media_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id").references(() => brands.id, { onDelete: "set null" }),
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    kind: mediaKind("kind").notNull(),
    filename: text("filename").notNull(),
    mime: text("mime").notNull(),
    /** Content type as detected by inspection — may differ from the extension. */
    detectedMime: text("detected_mime").notNull(),
    bytes: bigint("bytes", { mode: "number" }).notNull(),
    width: integer("width"),
    height: integer("height"),
    aspectRatio: text("aspect_ratio"),
    durationSec: integer("duration_sec"),
    codec: text("codec"),
    audioCodec: text("audio_codec"),
    fps: integer("fps"),
    checksum: text("checksum").notNull(),
    /** Object-storage key (local disk / S3 key in later phases). */
    storageKey: text("storage_key"),
    status: mediaStatus("status").notNull().default("ready"),
    altText: text("alt_text"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("media_assets_workspace_idx").on(t.workspaceId, t.createdAt),
    index("media_assets_checksum_idx").on(t.workspaceId, t.checksum),
  ]
);

/**
 * Derived media (crops, compressions, trims). The original upload is never
 * modified — fixes always create a variant.
 */
export const mediaVariants = pgTable("media_variants", {
  id: uuid("id").primaryKey().defaultRandom(),
  mediaId: uuid("media_id")
    .notNull()
    .references(() => mediaAssets.id, { onDelete: "cascade" }),
  purpose: text("purpose").notNull(), // e.g. "instagram_4:5", "tiktok_trim"
  providerId: text("provider_id"),
  storageKey: text("storage_key"),
  bytes: bigint("bytes", { mode: "number" }),
  width: integer("width"),
  height: integer("height"),
  aspectRatio: text("aspect_ratio"),
  durationSec: integer("duration_sec"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------- Relations ------------------------------- */

export const socialAccountsRelations = relations(socialAccounts, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [socialAccounts.workspaceId],
    references: [workspaces.id],
  }),
  brand: one(brands, { fields: [socialAccounts.brandId], references: [brands.id] }),
  provider: one(socialProviders, {
    fields: [socialAccounts.providerId],
    references: [socialProviders.id],
  }),
  credential: one(oauthCredentials),
  mediaAssets: many(mediaAssets),
}));

export const oauthCredentialsRelations = relations(oauthCredentials, ({ one }) => ({
  account: one(socialAccounts, {
    fields: [oauthCredentials.accountId],
    references: [socialAccounts.id],
  }),
}));

export const mediaAssetsRelations = relations(mediaAssets, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [mediaAssets.workspaceId],
    references: [workspaces.id],
  }),
  variants: many(mediaVariants),
}));

export const mediaVariantsRelations = relations(mediaVariants, ({ one }) => ({
  asset: one(mediaAssets, {
    fields: [mediaVariants.mediaId],
    references: [mediaAssets.id],
  }),
}));

export const socialProvidersRelations = relations(socialProviders, ({ many }) => ({
  accounts: many(socialAccounts),
}));
