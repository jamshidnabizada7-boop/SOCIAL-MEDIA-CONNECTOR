import { createDatabase, migrationsFolder } from "./index.js";

const { db, driver, close } = await createDatabase();
const folder = migrationsFolder();
console.log(`Applying migrations (${driver}) from ${folder} …`);
if (driver === "pglite") {
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  await migrate(db as never, { migrationsFolder: folder });
} else {
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");
  await migrate(db as never, { migrationsFolder: folder });
}
console.log("Migrations applied.");
await close();
