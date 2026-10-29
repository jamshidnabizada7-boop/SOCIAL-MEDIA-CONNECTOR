import { test, expect, type Page } from "@playwright/test";

const api = "http://127.0.0.1:4180";
async function signup(page: Page) {
  await page.goto("/signup");
  await page.getByLabel("Full name").fill("Workspace Tester");
  await page.getByLabel("Work email").fill(`workspace-${Date.now()}@e2e.test`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("correct-horse-battery");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page).toHaveURL(/\/(onboarding|dashboard)$/);
}

test("workspace sidebar switches real data and new drafts to the selected workspace", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signup(page);
  const me = await (await page.request.get(`${api}/v1/auth/me`)).json();
  const first = me.workspaces[0].workspaceId as string;
  const secondResponse = await page.request.post(`${api}/v1/workspaces`, {
    data: { name: "Second Studio", timezone: "UTC", locale: "en" },
  });
  expect(secondResponse.status()).toBe(201);
  const second = (await secondResponse.json()).workspace.id as string;
  for (const [id, title] of [
    [first, "First studio draft"],
    [second, "Second studio draft"],
  ]) {
    expect(
      (
        await page.request.post(`${api}/v1/workspaces/${id}/posts`, {
          data: { title, caption: `Fixture content for ${title}` },
        })
      ).status(),
    ).toBe(201);
  }
  await page.goto("/posts");
  await expect(
    page.getByRole("main").getByText("First studio draft", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Switch workspace", exact: true })
    .click();
  const chooser = page.getByRole("group", { name: "Choose workspace" });
  await expect(
    chooser.getByRole("button", { name: /Workspace's workspace/ }),
  ).toHaveAttribute("aria-pressed", "true");
  const secondRead = page.waitForResponse((r) =>
    r.url().includes(`/v1/workspaces/${second}/posts`),
  );
  await chooser.getByRole("button", { name: /Second Studio/ }).click();
  expect((await secondRead).status()).toBe(200);
  await expect(
    page.getByRole("button", { name: "Switch workspace", exact: true }),
  ).toContainText("Second Studio");
  await expect(
    page.getByRole("main").getByText("Second studio draft", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("main").getByText("First studio draft", { exact: true }),
  ).toHaveCount(0);
  await page.goto("/composer");
  await page
    .getByLabel("Caption", { exact: true })
    .fill("Created in the selected studio");
  const creation = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      r.url().endsWith(`/v1/workspaces/${second}/posts`),
  );
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  expect((await creation).status()).toBe(201);
  await expect(page).toHaveURL(/\/posts\?tab=drafts$/);
  const secondPosts = await (
    await page.request.get(`${api}/v1/workspaces/${second}/posts`)
  ).json();
  expect(
    secondPosts.posts.some(
      (p: { caption: string }) =>
        p.caption === "Created in the selected studio",
    ),
  ).toBe(true);
  const firstPosts = await (
    await page.request.get(`${api}/v1/workspaces/${first}/posts`)
  ).json();
  expect(
    firstPosts.posts.some(
      (p: { caption: string }) =>
        p.caption === "Created in the selected studio",
    ),
  ).toBe(false);
  expect(errors).toEqual([]);
});

test("workspace-list outage keeps the authenticated page and offers a retry", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route(`${api}/v1/workspaces`, (route) =>
    route.request().method() === "GET"
      ? route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            error: {
              code: "fixture_outage",
              message: "Workspace list fixture outage",
            },
          }),
        })
      : route.continue(),
  );
  await signup(page);
  await page.goto("/feed");
  await expect(
    page.getByRole("heading", { name: "Home Feed", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Switch workspace", exact: true })
    .click();
  const chooser = page.getByRole("group", { name: "Choose workspace" });
  await expect(chooser.getByRole("alert")).toContainText(
    "Workspace list fixture outage",
  );
  await page.unroute(`${api}/v1/workspaces`);
  await chooser.getByRole("button", { name: "Retry workspace list" }).click();
  await expect(chooser.getByRole("alert")).toHaveCount(0);
  await expect(
    chooser.getByRole("button", { name: /Workspace's workspace/ }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(errors).toEqual([]);
});
