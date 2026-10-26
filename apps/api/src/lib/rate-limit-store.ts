import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { rateLimitBuckets, type AriaDatabase } from "@aria/db";

type Options = { timeWindow?: number; routeInfo?: { method?: string | string[]; url?: string } };
type Callback = (error: Error | null, result?: { current: number; ttl: number }) => void;

/** Fastify's store contract; atomic upserts share budgets across API replicas. */
export function databaseRateLimitStore(db: AriaDatabase) {
  return class DatabaseRateLimitStore {
    constructor(private options: Options = {}, private scope = "global") {}

    child(raw: object): DatabaseRateLimitStore {
      const options = raw as Options;
      const route = options.routeInfo;
      return new DatabaseRateLimitStore(options, `${route?.method ?? "all"}:${route?.url ?? "global"}`);
    }

    incr(ip: string, callback: Callback, timeWindow = this.options.timeWindow ?? 60_000): void {
      const key = createHash("sha256").update(`${this.scope}:${ip}`).digest("hex");
      const expiry = sql`statement_timestamp() + ${timeWindow} * interval '1 millisecond'`;
      void db.insert(rateLimitBuckets).values({ key, hits: 1, expiresAt: expiry })
        .onConflictDoUpdate({
          target: rateLimitBuckets.key,
          set: {
            hits: sql`case when ${rateLimitBuckets.expiresAt} <= statement_timestamp() then 1 else ${rateLimitBuckets.hits} + 1 end`,
            expiresAt: sql`case when ${rateLimitBuckets.expiresAt} <= statement_timestamp() then ${expiry} else ${rateLimitBuckets.expiresAt} end`,
          },
        })
        .returning({ current: rateLimitBuckets.hits, ttl: sql<number>`greatest(0, extract(epoch from (${rateLimitBuckets.expiresAt} - statement_timestamp())) * 1000)::integer` })
        .then(([result]) => callback(null, result), (err: Error) => callback(err));
    }
  };
}
