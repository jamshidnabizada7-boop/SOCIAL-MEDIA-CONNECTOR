import { pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

/**
 * Developer-app registrations the platform makes *with providers*.
 * Mastodon is per-instance and self-serve: at first connect we register an
 * Aria Hub client app on the user's instance and persist the credentials so
 * tokens can be refreshed and revoked later. Env-configured providers (Meta,
 * LinkedIn, …) don't need rows here.
 */
export const providerAppConfigs = pgTable(
  "provider_app_configs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    providerId: text("provider_id").notNull(),
    /** Instance base URL for federated providers; "*" for global ones. */
    instanceUrl: text("instance_url").notNull().default("*"),
    clientId: text("client_id").notNull(),
    clientSecretEnc: text("client_secret_enc").notNull(),
    scopes: text("scopes").array().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("provider_app_configs_unique").on(t.providerId, t.instanceUrl)]
);
