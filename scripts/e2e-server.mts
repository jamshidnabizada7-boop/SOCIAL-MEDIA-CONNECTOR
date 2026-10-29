// Local-only provider fixture plus real API/worker and a dedicated Postgres wire server.
// No real account, email, billing or telemetry service is called by this harness.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { createDatabase, runMigrations } from "@aria/db";
import { feedFixture } from "./feed-fixtures.mts";

mkdirSync(".local", { recursive: true });
const dataDir = mkdtempSync(path.resolve(".local/e2e-"));
// CI uses native PostgreSQL. PGlite's multi-connection wire multiplexer can
// interleave extended-protocol messages under concurrent API/worker traffic.
// Only an explicitly named local fixture database may be supplied here.
const nativeUrl = process.env.ARIA_E2E_DATABASE_URL;
if (nativeUrl) {
  const target = new URL(nativeUrl);
  if (!['postgres:', 'postgresql:'].includes(target.protocol) ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) ||
      target.pathname !== '/ariahub_e2e') {
    throw new Error('ARIA_E2E_DATABASE_URL must target the local ariahub_e2e fixture database.');
  }
}
const env = {
  ...process.env, NODE_ENV: "development", LOG_LEVEL: "error",
  DATABASE_URL: nativeUrl || "postgres://aria:aria@127.0.0.1:4183/ariahub",
  ARIA_ENCRYPTION_KEY: "e2".repeat(32), ARIA_STORAGE_DIR: path.join(dataDir, "storage"),
  APP_BASE_URL: "http://127.0.0.1:4180", WEB_ORIGIN: "http://127.0.0.1:3180",
  HOST: "127.0.0.1", PORT: "4180", WORKER_HEALTH_PORT: "4181",
  BLUESKY_INSTANCE: "http://127.0.0.1:4182", ARIA_ALLOW_PRIVATE_INSTANCES: "true",
  ARIA_ADAPTER_MODE: "real", SENTRY_DSN: "", SMTP_URL: "", STRIPE_SECRET_KEY: "",
  ARIA_FEED_FIXTURE_ORIGIN: "http://127.0.0.1:4182", YOUTUBE_DATA_API_KEY: "fixture-only-key",
};
const client = nativeUrl ? null : new PGlite(path.join(dataDir, "db"));
const wire = client ? new PGLiteSocketServer({ db: client, port: 4183, host: "127.0.0.1", maxConnections: 32 }) : null;
await wire?.start();
console.log(`E2E ${nativeUrl ? 'PostgreSQL' : 'embedded wire'} server ready; applying migrations`);
const handle = await createDatabase({ url: env.DATABASE_URL });
await runMigrations(handle);
console.log("E2E migrations complete");
await handle.close();

const records: unknown[] = [];
const inboxReplies = new Map<string, unknown>();
const inboxAt = new Date().toISOString();
const incomingPost = { uri: "at://did:plc:friend/app.bsky.feed.post/question", cid: "fixture-question", author: { did: "did:plc:friend", handle: "friend.bsky.social", displayName: "Inbox Friend" }, record: { text: "Can you share the onboarding guide?", createdAt: inboxAt } };
let uploads = 0;
const fixture = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const bytes = Buffer.concat(chunks);
  res.setHeader("content-type", "application/json");
  const send = (value: unknown) => res.end(JSON.stringify(value));
  if(req.url?.startsWith("/feed-fixture/")){
    const url=new URL(req.url,"http://127.0.0.1:4182"),parts=url.pathname.split("/");
    return send(feedFixture(parts[2],"/"+parts.slice(3).join("/"),url.searchParams));
  }
  switch (req.url?.split("?")[0]) {
    case "/_stats": return send({ records, uploads, inboxReplies: [...inboxReplies.values()] });
    case "/xrpc/app.bsky.notification.listNotifications":
      return send({ notifications: [{ ...incomingPost, reason: "mention", indexedAt: inboxAt }] });
    case "/xrpc/app.bsky.feed.getPostThread":
      return send({ thread: { post: incomingPost, replies: [] } });
    case "/xrpc/com.atproto.repo.putRecord": {
      const body = JSON.parse(bytes.toString());
      inboxReplies.set(body.rkey, body);
      return send({ uri: `at://did:plc:e2e/app.bsky.feed.post/${body.rkey}`, cid: `fixture-${body.rkey}` });
    }
    case "/xrpc/com.atproto.server.createSession":
    case "/xrpc/com.atproto.server.refreshSession":
      return send({ accessJwt: "fixture-access", refreshJwt: "fixture-refresh", did: "did:plc:e2e", handle: "e2e.bsky.social" });
    case "/xrpc/com.atproto.repo.uploadBlob":
      uploads++;
      return send({ blob: { ref: { $link: "fixture-image" }, mimeType: req.headers["content-type"], size: bytes.length } });
    case "/xrpc/com.atproto.repo.createRecord":
      records.push(JSON.parse(bytes.toString()));
      return send({ uri: `at://did:plc:e2e/app.bsky.feed.post/${records.length}`, cid: `fixture-${records.length}` });
    default:
      res.statusCode = 404;
      return send({ error: "Unexpected fixture request", path: req.url });
  }
});
await new Promise<void>((resolve) => fixture.listen(4182, "127.0.0.1", resolve));
const children = ["apps/api/src/server.ts", "apps/worker/src/index.ts"].map((script) =>
  spawn(process.execPath, ["--import", "tsx", script], { env, stdio: "inherit", windowsHide: true }));
let stopping = false;
async function stop(code: number) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  fixture.close();
  await wire?.stop();
  await client?.close();
  process.exit(code);
}
for (const child of children) child.once("exit", (code) => { if (!stopping) void stop(code ?? 1); });
process.once("SIGINT", () => void stop(0));
process.once("SIGTERM", () => void stop(0));
console.log(`E2E data isolated at ${dataDir}`);
