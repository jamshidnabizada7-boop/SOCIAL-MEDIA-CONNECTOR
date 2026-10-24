import { createDatabase } from "./index.js";
import { seedReferenceData } from "./seed-data.js";

/** Seeds plans, providers and feature flags. Idempotent — safe to run repeatedly. */
const { db, close } = await createDatabase();
console.log("Seeding plans, providers and feature flags …");
await seedReferenceData(db);
console.log("Seed complete.");
await close();
