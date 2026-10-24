import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users, workspaces } from "./identity.js";

/**
 * Pending OAuth authorizations. The `state` parameter is the CSRF defense:
 * generated server-side, bound to (provider, workspace, user), single-use and
 * short-lived. PKCE verifiers for providers that support them live here too.
 */
export const oauthStates = pgTable(
  "oauth_states",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    state: text("state").notNull().unique(),
    providerId: text("provider_id").notNull(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id"),
    /** Provider-specific context — e.g. the Mastodon instance base URL. */
    instanceUrl: text("instance_url"),
    codeVerifier: text("code_verifier"),
    redirectUri: text("redirect_uri").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("oauth_states_expires_idx").on(t.expiresAt)]
);
