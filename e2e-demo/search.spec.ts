import { test, expect } from "@playwright/test";

test("global and mobile search work with labelled demo results and fit small screens", async ({
  page,
}) => {
  const errors: string[] = [],
    providerCalls: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (
      r.url().includes("/v1/") ||
      /https:\/\/(public\.api\.bsky|mastodon|www\.googleapis)/.test(r.url())
    )
      providerCalls.push(r.url());
  });
  await page.goto("/signin");
  await page
    .getByRole("button", { name: "Continue as Maya (demo workspace)" })
    .click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page
    .getByRole("link", { name: "Search across platforms", exact: true })
    .click();
  await page
    .getByLabel("Search people and content", { exact: true })
    .fill("sample");
  await page.getByRole("button", { name: "Submit universal search" }).click();
  await expect(
    page.getByText(/Demo search · Sample accounts and posts/),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "People and account results" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "People & accounts", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Content results" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Videos", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Content results" }),
  ).toBeVisible();
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
  }
  await page.getByLabel("Search people, posts and videos").fill("sample");
  await page.getByLabel("Search people, posts and videos").press("Enter");
  await expect(page).toHaveURL(/\/search\?q=sample$/);
  await expect(
    page.getByRole("region", { name: "People and account results" }),
  ).toBeVisible();
  await page.screenshot({
    path: ".local/search-evidence/search-demo-desktop.png",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: ".local/search-evidence/search-demo-mobile.png",
  });
  expect(providerCalls).toEqual([]);
  expect(errors).toEqual([]);
});
