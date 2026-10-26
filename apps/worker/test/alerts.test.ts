import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createDatabase, providerHealthState, publishAttempts, publishJobs, publishTargets, posts, socialAccounts, workspaces, runMigrations, type DatabaseHandle } from "@aria/db";
import { createOperationsMonitor } from "../src/alerts.js";
import { eq } from "drizzle-orm";
import path from "node:path";
import { rmSync } from "node:fs";

let handle: DatabaseHandle;
const dataDir = path.resolve(process.cwd(), `.test-data/alerts-${Date.now()}`);
beforeAll(async () => {
  handle = await createDatabase({ dataDir });
  await runMigrations(handle);
}, 60_000);
afterAll(async () => {
  await handle?.close();
  rmSync(dataDir, { recursive: true, force: true });
});

it("reports an open circuit, suppresses repeats, and reports a recurrence after recovery", async () => {
  const now = Date.now();
  const report = vi.fn();
  const check = createOperationsMonitor(report);
  await handle.db.insert(providerHealthState).values({ providerId: "mastodon", circuitOpenUntil: new Date(now + 120_000) });
  await check(handle.db, now);
  await check(handle.db, now + 30_000);
  expect(report).toHaveBeenCalledTimes(1);
  expect(report).toHaveBeenCalledWith({ code: "provider_circuit_open", provider: "mastodon" });
  await handle.db.update(providerHealthState).set({ circuitOpenUntil: null });
  await check(handle.db, now + 40_000);
  await handle.db.update(providerHealthState).set({ circuitOpenUntil: new Date(now + 120_000) }).where(eq(providerHealthState.providerId, "mastodon"));
  await check(handle.db, now + 50_000);
  expect(report).toHaveBeenCalledTimes(2);
});

it("alerts only after the failure-rate sample reaches ten terminal attempts", async () => {
  await handle.db.update(providerHealthState).set({ circuitOpenUntil: null });
  const db = handle.db;
  const [workspace] = await db.insert(workspaces).values({ name: "Alerts", slug: "alerts", planId: "free" }).returning();
  const [account] = await db.insert(socialAccounts).values({ workspaceId: workspace.id, providerId: "mastodon", displayName: "Alert", handle: "@alert", externalAccountId: "alerts" }).returning();
  const [post] = await db.insert(posts).values({ workspaceId: workspace.id }).returning();
  const [target] = await db.insert(publishTargets).values({ postId: post.id, accountId: account.id, providerId: "mastodon", idempotencyKey: "alert-target" }).returning();
  const [job] = await db.insert(publishJobs).values({ targetId: target.id }).returning();
  const now = Date.now();
  await db.insert(publishAttempts).values(Array.from({ length: 9 }, (_, i) => ({ jobId: job.id, targetId: target.id, attemptNo: i + 1, finishedAt: new Date(now), success: i > 0, outcome: i > 0 ? "published" : "failed" })));
  const report = vi.fn();
  const check = createOperationsMonitor(report);
  await check(db, now);
  expect(report).not.toHaveBeenCalled();
  await db.insert(publishAttempts).values({ jobId: job.id, targetId: target.id, attemptNo: 10, finishedAt: new Date(now), success: false, outcome: "failed" });
  await check(db, now);
  await check(db, now + 10_000);
  expect(report).toHaveBeenCalledTimes(1);
  expect(report).toHaveBeenCalledWith({ code: "publish_failure_rate_high", total: 10, failed: 2 });
});
