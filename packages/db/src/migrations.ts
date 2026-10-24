import type { DatabaseHandle } from "./index.js";
import { migrationsFolder } from "./index.js";
import { seedReferenceData } from "./seed-data.js";

/** Applies pending migrations, then (re)seeds reference data. Safe to run on every deploy. */
export async function runMigrations(handle: DatabaseHandle): Promise<void> {
  const folder = migrationsFolder();
  if (handle.driver === "pglite") {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(handle.db as never, { migrationsFolder: folder });
  } else {
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    await migrate(handle.db as never, { migrationsFolder: folder });
  }
  await seedReferenceData(handle.db);
}
