import { test, expect, type Page } from "@playwright/test";
async function signup(page: Page) {
  await page.goto("/signup");
  await page.getByLabel("Full name").fill("Inbox Browser Tester");
  await page.getByLabel("Work email").fill(`inbox-${Date.now()}@e2e.test`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("correct-horse-battery");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page).toHaveURL(/\/(onboarding|dashboard)$/);
}
test("mobile navigation opens, scrolls, closes and unlocks the page", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signup(page);
  await page.goto("/dashboard");
  const drawer = page.getByRole("dialog", { name: "Mobile navigation" });
  const opener = page.getByRole("button", { name: "Open navigation" });
  await expect(opener).toBeVisible();
  await expect(drawer).toHaveCount(0);
  await opener.click();
  await expect(drawer).toBeVisible();
  await drawer
    .getByRole("link", { name: "Billing", exact: true })
    .scrollIntoViewIfNeeded();
  await expect(
    drawer.getByRole("link", { name: "Billing", exact: true }),
  ).toBeVisible();
  await drawer.getByRole("button", { name: "Sign out", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(
    drawer.getByRole("button", { name: "Close navigation" }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    drawer.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeFocused();
  await expect
    .poll(() => page.evaluate(() => document.body.style.overflow))
    .toBe("hidden");
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expect
    .poll(() => page.evaluate(() => document.body.style.overflow))
    .not.toBe("hidden");
  await opener.click();
  await drawer.getByRole("button", { name: "Close navigation" }).click();
  await expect(drawer).toHaveCount(0);
  await opener.click();
  await page.mouse.click(370, 300);
  await expect(drawer).toHaveCount(0);
  await opener.click();
  await drawer.getByRole("link", { name: "Inbox", exact: true }).click();
  await expect(page).toHaveURL(/\/inbox$/);
  await expect(drawer).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Social Inbox" }),
  ).toBeVisible();
  await opener.click();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(drawer).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(drawer).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => document.body.style.overflow))
    .not.toBe("hidden");
  await page.screenshot({
    path: "test-results/mobile-inbox.png",
    fullPage: true,
  });
});
test("ingests a fixture interaction, handles it and confirms exactly one reply", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signup(page);
  await page.goto("/accounts");
  await page
    .getByRole("button", { name: /connect account/i })
    .first()
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /Bluesky/ })
    .click();
  await page.getByLabel("Handle", { exact: true }).fill("e2e.bsky.social");
  await page
    .getByLabel("App password", { exact: true })
    .fill("fixture-app-password");
  await page.getByRole("button", { name: "Connect with app password" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goto("/inbox");
  const interaction = page.getByRole("button", {
    name: /Inbox Friend.*Can you share/s,
  });
  await expect(interaction).toBeVisible({ timeout: 30000 });
  await interaction.click();
  await expect(
    page.getByRole("heading", { name: "Inbox Friend" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Mark read", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Mark unread", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Assigned to", { exact: true })
    .selectOption({ label: "Inbox Browser Tester" });
  await page
    .getByLabel("Reply", { exact: true })
    .fill("Here is the onboarding guide — fixture reply.");
  await page.getByRole("button", { name: "Send reply", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await (await request.get("http://127.0.0.1:4182/_stats")).json())
          .inboxReplies.length,
      { timeout: 30000 },
    )
    .toBe(1);
  await expect(
    page
      .getByLabel("Reply delivery")
      .getByText("Reply confirmed", { exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await expect(
    page.getByRole("button", { name: "Resolve", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Resolve", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Reopen", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/inbox-desktop.png",
    fullPage: true,
  });
  await page.reload();
  await expect(interaction).toBeVisible();
  await interaction.click();
  await expect(
    page
      .getByLabel("Reply delivery")
      .getByText("Reply confirmed", { exact: true }),
  ).toBeVisible();
  expect(
    (await (await request.get("http://127.0.0.1:4182/_stats")).json())
      .inboxReplies,
  ).toHaveLength(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "Back to inbox" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Back to inbox" }).click();
  await expect(interaction).toBeVisible();
  expect(errors).toEqual([]);
});
test("API inbox errors remain errors and never display demo interactions", async ({
  page,
}) => {
  await signup(page);
  await page.route("**/v1/workspaces/*/inbox**", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "fixture_outage",
          message: "Inbox unavailable for verification",
        },
      }),
    }),
  );
  await page.goto("/inbox");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Inbox unavailable for verification",
  );
  await expect(page.getByText("Alex Morgan", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Demo inbox/)).toHaveCount(0);
});
