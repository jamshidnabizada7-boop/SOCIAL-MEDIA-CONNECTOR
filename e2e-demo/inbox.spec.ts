import { expect, test } from "@playwright/test";
test("demo inbox works on mobile and persists a local reply without API requests", async ({ page }) => {
  const apiRequests: string[] = [], errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/v1/")) apiRequests.push(url.pathname);
    // This test has no API server and never contacts a provider or external service.
    return url.origin === "http://127.0.0.1:3180" && !url.pathname.startsWith("/v1/") ? route.continue() : route.abort();
  });
  await page.goto("/signin");
  await page.getByRole("button", { name: "Continue as Maya (demo workspace)" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/inbox");
  await expect(page.getByText(/Demo inbox · Sample interactions/)).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Mobile navigation" })).toHaveCount(0);
  const alex = page.getByRole("button", { name: /Alex Morgan/ });
  await expect(alex).toBeVisible(); await alex.click();
  await expect(page.getByRole("heading", { name: "Alex Morgan" })).toBeVisible();
  await page.getByLabel("Reply", { exact: true }).fill("Thanks for checking in — demo browser reply.");
  await page.getByRole("button", { name: "Save demo reply" }).click();
  await expect(page.getByLabel("Reply delivery").getByText(/Reply confirmed/)).toBeVisible();
  await page.reload(); await alex.click();
  await expect(page.getByLabel("Conversation messages").getByText("Thanks for checking in — demo browser reply.")).toBeVisible();
  await page.screenshot({ path: "test-results/demo-inbox-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Back to inbox" }).click();
  await page.getByLabel("Search interactions").fill("walkthrough");
  await expect(page.getByRole("button", { name: /Sam Rivera/ })).toBeVisible();
  await expect(alex).toHaveCount(0);
  expect(apiRequests).toEqual([]); expect(errors).toEqual([]);
});
