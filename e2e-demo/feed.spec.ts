import { test, expect } from "@playwright/test";
test("demo Feed has labelled samples, working filters and persistent personal bookmarks without provider requests", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (r) => {
    if (
      r.url().includes("/v1/") ||
      /https:\/\/(.*\.)?(youtube|tiktok|bsky|mastodon)/.test(r.url())
    )
      requests.push(r.url());
  });
  await page.goto("/signin");
  await page
    .getByRole("button", { name: "Continue as Maya (demo workspace)" })
    .click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/feed");
  await expect(
    page.getByRole("status").filter({ hasText: "Demo feed" }),
  ).toBeVisible();
  await expect(page.locator("article[data-feed-id]").first()).toBeVisible();
  await page
    .locator("article[data-feed-id]")
    .first()
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await page.getByRole("tab", { name: "Saved", exact: true }).click();
  await expect(page.locator("article[data-feed-id]")).toHaveCount(1);
  await page.reload();
  await page.getByRole("tab", { name: "Saved", exact: true }).click();
  await expect(page.locator("article[data-feed-id]")).toHaveCount(1);
  await page.getByRole("tab", { name: "For You", exact: true }).click();
  await page.getByText("Search & filters", {exact:true}).click();
  await page.getByLabel("Filter platform").selectOption("youtube");
  await expect
    .poll(() => page.locator("article[data-feed-id]").count())
    .toBeGreaterThan(0);
  await expect(page.locator("article").first()).toContainText("YouTube");
  await page.screenshot({
    path: ".local/feed-evidence/universal-feed-demo-mobile.png",
    fullPage: true,
  });
  expect(requests).toEqual([]);
});
