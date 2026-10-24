import { createDatabase, type DatabaseHandle } from "@aria/db";
import type { FastifyInstance } from "fastify";
import { config } from "../config.js";

declare module "fastify" {
  interface FastifyInstance {
    database: DatabaseHandle;
  }
}

/**
 * Opens the database directly in buildServer (before routes register) rather
 * than inside a plugin — Fastify plugin decorations are only guaranteed after
 * boot, and route modules capture the handle at registration time.
 */
export async function openAppDatabase(app: FastifyInstance): Promise<DatabaseHandle> {
  const handle = await createDatabase({
    url: config.DATABASE_URL,
    dataDir: config.ARIA_DATA_DIR,
  });
  app.decorate("database", handle);
  app.log.info({ driver: handle.driver }, "database ready");
  app.addHook("onClose", async () => {
    await handle.close();
  });
  return handle;
}
