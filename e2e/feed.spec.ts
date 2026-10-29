import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
async function signup(page: Page) {
  await page.goto("/signup");
  await page.getByLabel("Full name").fill("Feed Browser Tester");
  await page.getByLabel("Work email").fill(`feed-${Date.now()}@e2e.test`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("correct-horse-battery");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page).toHaveURL(/\/(onboarding|dashboard)$/);
}
async function networkFixtures(page: Page) {
  await page.route("https://video.bsky.app/**", (route) => {
    const name = new URL(route.request().url()).pathname.split("/").at(-1)!;
    if (!/^(playlist\.m3u8|init\.mp4|segment[0-2]\.m4s)$/.test(name))
      return route.abort();
    return route.fulfill({
      path: path.resolve("e2e/fixtures/autoplay", name),
      contentType: name.endsWith("m3u8")
        ? "application/vnd.apple.mpegurl"
        : "video/mp4",
      headers: { "access-control-allow-origin": "*" },
    });
  });
  await page.route("https://cdn.fixture.test/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="#b5d9cb"/></svg>',
    }),
  );
  await page.route(
    /https:\/\/(embed\.bsky\.app|www\.youtube-nocookie\.com|www\.tiktok\.com)\//,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<html><body>Official player URL fixture — no provider playback request</body></html>",
      }),
  );
}
test("mixed API feed paginates without duplicates and persists user saves and creator follows", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await networkFixtures(page);
  await signup(page);
  await page.goto("/feed");
  await expect(
    page.getByRole("heading", { name: "Home Feed", exact: true }),
  ).toBeVisible();
  await expect(page.locator("article[data-feed-id]").first()).toBeVisible({
    timeout: 40000,
  });
  const first = await page
    .locator("article[data-feed-id]")
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-feed-id")));
  expect(first.length).toBeGreaterThan(1);
  expect(
    await page.locator("article").filter({ hasText: "Bluesky" }).count(),
  ).toBeGreaterThan(0);
  expect(
    await page.locator("article").filter({ hasText: "Mastodon" }).count(),
  ).toBeGreaterThan(0);
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
  await expect(page.locator("article[data-feed-id]").first()).toBeVisible();
  await page
    .locator("article[data-feed-id]")
    .first()
    .getByRole("button", { name: "Follow in Aria Hub" })
    .click();
  await page.getByRole("tab", { name: "Following / Creators" }).click();
  await expect(page.locator("article[data-feed-id]").first()).toBeVisible();
  await page.getByRole("tab", { name: "For You", exact: true }).click();
  await page
    .getByRole("button", { name: "Load more", exact: true })
    .scrollIntoViewIfNeeded();
  await expect
    .poll(() => page.locator("article[data-feed-id]").count())
    .toBeGreaterThan(12);
  const loaded = await page
    .locator("article[data-feed-id]")
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-feed-id")));
  expect(new Set(loaded).size).toBe(loaded.length);
  expect(errors).toEqual([]);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: ".local/feed-evidence/universal-feed-desktop.png",
    fullPage: false,
  });
});
test("mobile Feed navigation, official single-player lifecycle, video arrows and API failure are real", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await networkFixtures(page);
  await signup(page);
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("dialog", { name: "Mobile navigation" })
    .getByRole("link", { name: "Home", exact: true })
    .click();
  await expect(page).toHaveURL(/\/feed$/);
  await expect(
    page.getByRole("dialog", { name: "Mobile navigation" }),
  ).toHaveCount(0);
  await expect(page.locator("article[data-feed-id]").first()).toBeVisible({
    timeout: 40000,
  });
  await page.getByRole("tab", { name: "Videos", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Immersive video browsing" }),
  ).toBeVisible();
  const video = page.locator('video[data-aria-video="bluesky"]');
  await expect(video).toHaveCount(1);
  await expect
    .poll(() =>
      video.evaluate(
        (el: HTMLVideoElement) => !el.paused && el.currentTime > 0 && el.muted,
      ),
    )
    .toBe(true);
  await expect(
    page.getByRole("button", { name: "Load Bluesky player" }),
  ).toHaveCount(0);
  const previous = await video.elementHandle();
  await page.getByRole("button", { name: "Next video", exact: true }).click();
  await expect(page.locator("iframe")).toHaveCount(0);
  await expect
    .poll(() => previous!.evaluate((el: HTMLVideoElement) => el.paused))
    .toBe(true);
  await expect(video).toHaveCount(1);
  await expect
    .poll(() =>
      video.evaluate(
        (el: HTMLVideoElement) => !el.paused && el.currentTime > 0 && el.muted,
      ),
    )
    .toBe(true);
  await page.getByRole("region", { name: "Video feed", exact: true }).focus();
  await page.keyboard.press("ArrowDown");
  await page.screenshot({
    path: ".local/feed-evidence/universal-feed-mobile-video.png",
    fullPage: false,
  });
  await page.getByRole("tab", { name: "Posts", exact: true }).click();
  await page.route("**/v1/workspaces/*/feed?**", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "unavailable", message: "Feed fixture outage" },
      }),
    }),
  );
  await page.getByRole("tab", { name: "Explore", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Feed could not be loaded" }),
  ).toContainText("Feed fixture outage");
  await expect(page.locator("article[data-feed-id]")).toHaveCount(0);
  await expect(page.getByText("Sample content", { exact: true })).toHaveCount(
    0,
  );
});
