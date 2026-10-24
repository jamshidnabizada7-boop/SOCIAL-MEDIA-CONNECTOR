import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

/**
 * Local Postgres wire server over the embedded PGlite engine.
 *
 * A single process owns the data directory and serves it over the Postgres
 * wire protocol on 127.0.0.1 — so the API and the worker (separate processes)
 * can share the same local database safely, with zero cloud services and
 * nothing leaving this machine.
 *
 * Usage: npm run dev:db  (leave running during local development)
 * Clients connect with: postgresql://aria:aria@127.0.0.1:5438/ariahub
 */

const dataDir =
  process.env.ARIA_DATA_DIR ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.local/ariahub-pg");

const port = Number(process.env.ARIA_PG_PORT ?? 5438);

mkdirSync(dataDir, { recursive: true });
console.log(`[aria-db] opening embedded postgres at ${dataDir}`);
const client = new PGlite(dataDir);
const server = new PGLiteSocketServer({ db: client, port, host: "127.0.0.1" });
await server.start();
console.log(`[aria-db] ready — postgres://aria:aria@127.0.0.1:${port}/ariahub`);

const shutdown = async () => {
  console.log("[aria-db] shutting down");
  await client.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
