import { test, expect } from "@playwright/test";

test("universal search finds accounts and content, filters without more calls and has honest native fallbacks", async ({
  page,
}) => {
  const errors: string[] = [];
  const searches: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (r.url().endsWith("/feed/search/all")) searches.push(r.url());
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/signup");
  await page.getByLabel("Full name").fill("Search Browser Tester");
  await page.getByLabel("Work email").fill(`search-${Date.now()}@e2e.test`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("correct-horse-battery");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page).toHaveURL(/\/(onboarding|dashboard)$/);
  await page.goto("/dashboard");
  await page.getByLabel("Search people, posts and videos").fill("Creator");
  await page.getByLabel("Search people, posts and videos").press("Enter");
  await expect(page).toHaveURL(/\/search\?q=Creator$/);
  const people = page.getByRole("region", {
    name: "People and account results",
  });
  await expect(
    people.getByRole("link", { name: "Search Creator", exact: true }),
  ).toBeVisible({ timeout: 40000 });
  await expect(
    people.getByRole("link", { name: "Search Creator", exact: true }),
  ).toHaveAttribute(
    "href",
    "https://bsky.app/profile/did%3Aplc%3Asearchcreator",
  );
  await expect(
    page.getByRole("region", { name: "Content results" }),
  ).toBeVisible();
  const calls = searches.length;
  await page
    .getByRole("button", { name: "People & accounts", exact: true })
    .click();
  await expect(people).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Content results" }),
  ).toHaveCount(0);
  await page
    .getByRole("group", { name: "Search platforms" })
    .getByRole("button", { name: "TikTok", exact: true })
    .click();
  await expect(
    page.getByText("No matching results in these sources", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Search on TikTok", exact: true }),
  ).toHaveAttribute("href", "https://www.tiktok.com/search?q=Creator");
  expect(searches).toHaveLength(calls);
  await page
    .getByRole("button", { name: "Show all sources and result types" })
    .click();
  await expect(people).toBeVisible();
  await page.screenshot({
    path: ".local/search-evidence/search-api-desktop.png",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("link", { name: "Search across platforms", exact: true })
    .click();
  await page
    .getByLabel("Search people and content", { exact: true })
    .fill("Creator");
  await page.getByRole("button", { name: "Submit universal search" }).click();
  await expect(people).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  await page.screenshot({
    path: ".local/search-evidence/search-api-mobile.png",
  });
  await page.route("**/feed/search/all", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "unavailable", message: "Search fixture outage" },
      }),
    }),
  );
  await page
    .getByRole("button", { name: "Refresh results", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Search fixture outage" }),
  ).toBeVisible();
  await expect(people).toHaveCount(0);
  await expect(page.getByText(/Demo search/)).toHaveCount(0);
  expect(errors).toEqual([]);
});
