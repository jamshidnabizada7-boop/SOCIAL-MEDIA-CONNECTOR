import { createDatabase } from "./index.js";
import { runMigrations } from "./migrations.js";

const handle = await createDatabase();
console.log(`Applying migrations (${handle.driver}) …`);
await runMigrations(handle);
console.log("Migrations applied and reference data seeded.");
await handle.close();
