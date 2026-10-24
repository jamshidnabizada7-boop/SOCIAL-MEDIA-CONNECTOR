process.env.ARIA_ENCRYPTION_KEY ??= "3f2a8c9e1b7d5f4a8c9e1b7d5f4a8c9e1b7d5f4a8c9e1b7d5f4a8c9e1b7d5f4a";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { createDatabase, runMigrations, type DatabaseHandle, sessions, users, workspaces } from "@aria/db";
import { runMaintenance, WORKSPACE_PURGE_AFTER_MS } from "../src/maintenance.js";

const dataDir = path.resolve(process.cwd(), `.test-data/maintenance-${Date.now()}`);
process.env.ARIA_STORAGE_DIR = path.join(dataDir, "storage");

describe("maintenance", () => {
  let handle: DatabaseHandle;

  beforeAll(async () => {
    handle = await createDatabase({ dataDir });
    await runMigrations(handle);
  }, 60_000);

  afterAll(async () => {
    await handle.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("purges workspaces deleted more than 30 days ago, keeps recent ones", async () => {
    const db = handle.db;
    const [old] = await db
      .insert(workspaces)
      .values({ name: "Old", slug: `old-${Date.now()}`, deletedAt: new Date(Date.now() - WORKSPACE_PURGE_AFTER_MS - 60_000) })
      .returning();
    const [recent] = await db
      .insert(workspaces)
      .values({ name: "Recent", slug: `recent-${Date.now()}`, deletedAt: new Date(Date.now() - 86_400_000) })
      .returning();
    const [live] = await db.insert(workspaces).values({ name: "Live", slug: `live-${Date.now()}` }).returning();

    const result = await runMaintenance(db);
    expect(result.workspacesPurged).toBe(1);
    const remaining = (await db.select({ id: workspaces.id }).from(workspaces)).map((w) => w.id);
    expect(remaining).not.toContain(old.id);
    expect(remaining).toContain(recent.id);
    expect(remaining).toContain(live.id);
  });

  it("prunes expired sessions", async () => {
    const db = handle.db;
    const [user] = await db.insert(users).values({ email: `m-${Date.now()}@test.aria`, name: "M" }).returning();
    await db.insert(sessions).values({ userId: user.id, tokenHash: `h-${Date.now()}`, expiresAt: new Date(Date.now() - 1000) });
    await runMaintenance(db);
    expect(await db.select().from(sessions).where(eq(sessions.userId, user.id))).toHaveLength(0);
  });
});
