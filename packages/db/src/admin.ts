import { eq } from "drizzle-orm";
import { createDatabase } from "./index.js";
import { users } from "./schema/index.js";

/**
 * Platform-admin bootstrap:
 *   npm run admin -- grant  you@example.com
 *   npm run admin -- revoke you@example.com
 *   npm run admin -- list
 * In production: docker compose … exec api npx tsx packages/db/src/admin.ts grant you@example.com
 */
const [command, emailArg] = process.argv.slice(2);
const { db, close } = await createDatabase();

try {
  if (command === "list") {
    const admins = await db.select({ email: users.email, name: users.name }).from(users).where(eq(users.isPlatformAdmin, true));
    console.log(admins.length ? admins.map((a) => `${a.email}  (${a.name})`).join("\n") : "No platform admins.");
  } else if ((command === "grant" || command === "revoke") && emailArg) {
    const email = emailArg.trim().toLowerCase();
    const [row] = await db
      .update(users)
      .set({ isPlatformAdmin: command === "grant", updatedAt: new Date() })
      .where(eq(users.email, email))
      .returning({ email: users.email });
    if (!row) {
      console.error(`No account for ${email}. Sign up in the app first, then run this again.`);
      process.exitCode = 1;
    } else {
      console.log(`${command === "grant" ? "Granted" : "Revoked"} platform admin: ${row.email}`);
    }
  } else {
    console.error("Usage: admin grant <email> | admin revoke <email> | admin list");
    process.exitCode = 1;
  }
} finally {
  await close();
}
