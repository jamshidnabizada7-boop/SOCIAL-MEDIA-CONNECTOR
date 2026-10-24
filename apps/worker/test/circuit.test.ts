import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import path from "node:path";
import { createDatabase, migrationsFolder, plans } from "@aria/db";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import type { DatabaseHandle } from "@aria/db";
import { isCircuitOpen, loadCircuit, recordOutcome } from "../src/reliability/circuit.js";

/**
 * Circuit breaker against a real embedded Postgres — the state machine runs
 * through actual drizzle upserts, not a fake.
 */

let handle: DatabaseHandle;
const dataDir = path.resolve(process.cwd(), `.test-data/circuit-${Date.now()}`);

beforeAll(async () => {
  handle = await createDatabase({ dataDir });
  await migratePglite(handle.db as never, { migrationsFolder: migrationsFolder() });
  await handle.db.insert(plans).values({ id: "free", name: "Free", maxBrands: 1, maxMembers: 1, storageGb: 1 }).onConflictDoNothing();
}, 60_000);

afterAll(async () => {
  await handle.close();
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    /* windows locks */
  }
});

describe("circuit breaker", () => {
  it("stays closed while failures are below the threshold", async () => {
    for (let i = 0; i < 4; i++) {
      await recordOutcome(handle.db, "instagram", { ok: false, errorCode: "http_503", providerError: true });
    }
    expect(await isCircuitOpen(handle.db, "instagram")).toBeNull();
  });

  it("opens after five consecutive provider failures", async () => {
    await recordOutcome(handle.db, "instagram", { ok: false, errorCode: "http_503", providerError: true });
    const open = await isCircuitOpen(handle.db, "instagram");
    expect(open).not.toBeNull();
    expect(open!.getTime()).toBeGreaterThan(Date.now());
    const snap = await loadCircuit(handle.db, "instagram");
    expect(snap.consecutiveFailures).toBe(5);
    expect(snap.lastErrorCode).toBe("http_503");
  });

  it("does not trip on content or token failures (account-specific)", async () => {
    for (let i = 0; i < 10; i++) {
      await recordOutcome(handle.db, "x", { ok: false, errorCode: "caption_too_long", providerError: false });
    }
    expect(await isCircuitOpen(handle.db, "x")).toBeNull();
    const snap = await loadCircuit(handle.db, "x");
    expect(snap.consecutiveFailures).toBe(0);
  });

  it("resets on success", async () => {
    for (let i = 0; i < 5; i++) {
      await recordOutcome(handle.db, "tiktok", { ok: false, errorCode: "http_503", providerError: true });
    }
    expect(await isCircuitOpen(handle.db, "tiktok")).not.toBeNull();
    await recordOutcome(handle.db, "tiktok", { ok: true });
    const snap = await loadCircuit(handle.db, "tiktok");
    expect(snap.consecutiveFailures).toBe(0);
    expect(snap.circuitOpenUntil).toBeNull();
  });
});
