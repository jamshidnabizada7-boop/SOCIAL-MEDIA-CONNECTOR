import { test, expect, type Page } from "@playwright/test";

async function openDemo(page: Page) {
  await page.goto("/signin");
  await page
    .getByRole("button", { name: "Continue as Maya (demo workspace)" })
    .click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(
    page.getByRole("heading", { name: "Publishing Schedule" }),
  ).toBeVisible();
}

test("Stitch screens keep working at phone, tablet and desktop widths", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openDemo(page);
  for (const width of [320, 390, 768, 1280, 1600]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of [
      "/dashboard",
      "/feed",
      "/explore",
      "/composer",
      "/accounts",
      "/inbox",
      "/videos",
    ]) {
      await page.goto(route);
      await expect(page.getByRole("main")).toBeVisible();
      if (route === "/composer")
        await expect(page.getByLabel("Caption", { exact: true })).toBeVisible();
      if (route === "/accounts")
        await expect(
          page.getByRole("heading", { name: "Connected Channels" }),
        ).toBeVisible();
      if (route === "/inbox")
        await expect(
          page.getByRole("button", { name: /Alex Morgan/ }),
        ).toBeVisible();
      if (["/feed", "/explore", "/videos"].includes(route))
        await expect(
          page.locator("article[data-feed-id]").first(),
        ).toBeVisible();
      const overflow = await page.evaluate(() => ({
        width: innerWidth,
        scroll: document.documentElement.scrollWidth,
        elements: Array.from(document.querySelectorAll("main *"))
          .filter((el) => el.getBoundingClientRect().right > innerWidth + 1)
          .slice(0, 8)
          .map((el) => ({ tag: el.tagName, class: el.className })),
      }));
      expect(
        overflow.scroll,
        `${route} overflows at ${width}px: ${JSON.stringify(overflow.elements)}`,
      ).toBeLessThanOrEqual(width + 1);
      if (width === 390) await page.screenshot({path:`.local/stitch-evidence/${route.slice(1)}-mobile.png`});
    }
  }
  expect(errors).toEqual([]);
});

test("mobile navigation, creator follows and conversation context are usable", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openDemo(page);
  const nav = page.getByRole("navigation", { name: "Primary mobile" });
  await nav.getByRole("link", { name: "Explore", exact: true }).click();
  await expect(page).toHaveURL(/\/explore$/);
  const spotlight = page.getByRole("region", { name: "Creator Spotlight" });
  await expect(spotlight).toBeVisible();
  await page.getByRole("button", { name: "Filter discovery content" }).click();
  await page
    .getByLabel("Filter platform", { exact: true })
    .selectOption("bluesky");
  await expect(page.locator("article[data-feed-id]").first()).toContainText(
    "Bluesky",
  );
  await page.getByLabel("Filter platform", { exact: true }).selectOption("");
  await page.getByRole("button", { name: "Filter discovery content" }).click();
  await spotlight
    .getByRole("button", { name: /^Follow .* in Aria Hub$/ })
    .first()
    .click();
  await expect(
    spotlight
      .getByRole("button", { name: /^Unfollow .* in Aria Hub$/ })
      .first(),
  ).toBeVisible();
  await nav.getByRole("link", { name: "Inbox", exact: true }).click();
  await page.getByRole("button", { name: /Alex Morgan/ }).click();
  const opener = page.getByRole("button", {
    name: "Conversation details",
    exact: true,
  });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Conversation details" });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("heading", { name: "Connection & delivery" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Close dialog" }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect
    .poll(() =>
      page.evaluate(
        () => document.activeElement?.closest('[role="dialog"]') !== null,
      ),
    )
    .toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe(
    "hidden",
  );
  await page
    .getByLabel("Reply", { exact: true })
    .fill("A draft survives opening context.");
  await opener.click();
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await expect(page.getByLabel("Reply", { exact: true })).toHaveValue(
    "A draft survives opening context.",
  );
  await page.getByRole("button", { name: "Back to inbox" }).click();
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.getByRole("button", { name: /Alex Morgan/ }).click();
  await expect(
    page.getByRole("complementary", { name: "Creator context" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Conversation" }),
  ).toBeVisible();
  await page.screenshot({path:".local/stitch-evidence/inbox-desktop.png"});
  await page
    .getByRole("button", { name: "Switch workspace", exact: true })
    .click();
  const workspaces = page.getByRole("group", { name: "Choose workspace" });
  await expect(workspaces).toBeVisible();
  const bounds = await workspaces.boundingBox();
  expect(bounds?.y).toBeGreaterThanOrEqual(0);
  expect((bounds?.y || 0) + (bounds?.height || 0)).toBeLessThanOrEqual(1000);
  await page.keyboard.press("Escape");
  await expect(workspaces).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("studio calendar and mobile destination selection use real local state", async ({
  page,
}) => {
  await openDemo(page);
  await page.getByRole("button", { name: "Next week", exact: true }).click();
  await page.getByRole("button", { name: "Today", exact: true }).click();
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  await expect(
    page.getByRole("button", { name: today, exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("link", { name: "New Post / Campaign", exact: true })
    .click();
  await expect(
    page.getByRole("navigation", { name: "Post creation steps" }),
  ).toBeVisible();
  const destination = page.getByRole("checkbox", {
    name: /ariahub.bsky.social/,
  });
  // Select a seeded channel by its actual accessible account label.
  const anyDestination = (await destination.count())
    ? destination
    : page.locator('.composer-destinations [role="checkbox"]').first();
  const before = await anyDestination.getAttribute("aria-checked");
  await anyDestination.click();
  await expect(anyDestination).toHaveAttribute(
    "aria-checked",
    before === "true" ? "false" : "true",
  );
  await page
    .getByLabel("Caption", { exact: true })
    .fill("Caption remains editable after redesign.");
  await expect(page.getByLabel("Caption", { exact: true })).toHaveValue(
    "Caption remains editable after redesign.",
  );
});
