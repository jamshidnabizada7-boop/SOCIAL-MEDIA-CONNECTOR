import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdirSync } from "node:fs";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import * as schema from "./schema/index.js";

export * from "./schema/index.js";
export * from "./crypto.js";

export type AriaDatabase = NodePgDatabase<typeof schema>;
/** Union preserved for driver-specific escape hatches. */
export type AnyAriaDatabase = NodePgDatabase<typeof schema> | PgliteDatabase<typeof schema>;
export type DatabaseDriver = "postgres" | "pglite";

export interface DatabaseHandle {
  db: AriaDatabase;
  driver: DatabaseDriver;
  close(): Promise<void>;
}

/**
 * Database factory.
 *
 * - If DATABASE_URL is set, connects to that Postgres (docker-compose or any
 *   managed Postgres the user provisions).
 * - Otherwise uses PGlite: a real embedded Postgres persisted under the repo's
 *   `.local/` directory — everything stays on this machine by default.
 */
export async function createDatabase(options?: {
  url?: string;
  dataDir?: string;
}): Promise<DatabaseHandle> {
  const url = options?.url ?? process.env.DATABASE_URL;
  if (url) {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: url, max: 10 });
    const db = drizzle(pool, { schema });
    return {
      db,
      driver: "postgres",
      close: async () => {
        await pool.end();
      },
    };
  }

  const dataDir =
    options?.dataDir ??
    process.env.ARIA_DATA_DIR ??
    // packages/db/src|dist → repo root/.local/ariahub-pg
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.local/ariahub-pg");

  const { mkdirSync } = await import("node:fs");
  mkdirSync(dataDir, { recursive: true });
  const { PGlite } = await import("@electric-sql/pglite");
  const client = new PGlite(dataDir);
  const { drizzle: drizzlePglite } = await import("drizzle-orm/pglite");
  const db = drizzlePglite(client, { schema }) as unknown as NodePgDatabase<typeof schema>;
  return {
    db,
    driver: "pglite",
    close: async () => {
      await client.close();
    },
  };
}

export function migrationsFolder(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../drizzle");
}
