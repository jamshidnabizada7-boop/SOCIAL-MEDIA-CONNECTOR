import { test, expect } from "@playwright/test";

test("sign up, connect Bluesky, upload an image, schedule and confirm exactly one delivery", async ({ page, request }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/signup");
  await page.getByLabel("Full name").fill("Browser Tester");
  await page.getByLabel("Work email").fill(`browser-${Date.now()}@e2e.test`);
  await page.getByLabel("Password", { exact: true }).fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page).toHaveURL(/\/(onboarding|dashboard)$/);
  await page.goto("/accounts");
  await page.getByRole("button", { name: /connect account/i }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: /Bluesky/ }).click();
  await page.getByLabel("Handle", { exact: true }).fill("e2e.bsky.social");
  await page.getByLabel("App password", { exact: true }).fill("fixture-app-password");
  await page.getByRole("button", { name: "Connect with app password" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goto("/composer");
  const destination = page.getByRole("checkbox", { name: /e2e.bsky.social/ });
  await expect(destination).toBeVisible();
  if ((await destination.getAttribute("aria-checked")) !== "true") await destination.click();
  await page.getByLabel("Caption", { exact: true }).fill("Scheduled browser verification");
  await page.locator('input[type="file"]').setInputFiles({
    name: "browser-image.png", mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5S8AAAAASUVORK5CYII=", "base64"),
  });
  await expect(page.getByRole("button", { name: "Remove browser-image.png from post" })).toBeVisible();
  await page.getByRole("button", { name: "Schedule", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Schedule post" });
  // datetime-local accepts seconds; this test runs in UTC independently of the host time zone.
  const when = new Date(Date.now() + 65_000).toISOString().slice(0, 19);
  await dialog.getByLabel("Publish at").fill(when);
  await dialog.getByLabel("Time zone", { exact: true }).selectOption("UTC");
  const scheduled = page.waitForResponse((r) => r.url().endsWith("/schedule") && r.request().method() === "POST");
  await dialog.getByRole("button", { name: "Schedule", exact: true }).click();
  const response = await scheduled;
  expect(response.status(), await response.text()).toBe(200);
  await expect(page).toHaveURL(/\/posts\/[0-9a-f-]+$/);
  await expect.poll(async () => (await (await request.get("http://127.0.0.1:4182/_stats")).json()).records.length, { timeout: 90_000 }).toBe(1);
  const stats = await (await request.get("http://127.0.0.1:4182/_stats")).json();
  expect(stats.uploads).toBe(1);
  expect(stats.records[0].record.text).toBe("Scheduled browser verification");
  expect(stats.records[0].record.embed.images).toHaveLength(1);
  await expect(page.getByText("Published", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("main").getByText("Browser Tester", { exact: false })).toBeVisible();
  await expect(page.locator('a[href^="https://bsky.app/profile/"]')).toBeVisible();
  await page.screenshot({ path: "test-results/published.png", fullPage: true });
  await page.reload();
  await expect(page.getByText("Published", { exact: true }).first()).toBeVisible();
  expect((await (await request.get("http://127.0.0.1:4182/_stats")).json()).records).toHaveLength(1);
  expect(errors).toEqual([]);
});
