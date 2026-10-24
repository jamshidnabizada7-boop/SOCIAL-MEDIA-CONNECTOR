import { pgTable, text, timestamp, integer } from "drizzle-orm/pg-core";

/**
 * Circuit-breaker state per provider (plan §32). When a provider starts
 * failing systemically, jobs for it are delayed — not hammered — until a
 * controlled retry window opens. Persisted so all workers agree and admins
 * can inspect it.
 */
export const providerHealthState = pgTable("provider_health_state", {
  providerId: text("provider_id").primaryKey(),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  /** Circuit open until this moment; null = closed. */
  circuitOpenUntil: timestamp("circuit_open_until", { withTimezone: true }),
  lastErrorCode: text("last_error_code"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
