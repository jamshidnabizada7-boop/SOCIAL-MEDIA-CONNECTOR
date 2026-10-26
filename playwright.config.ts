import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  workers: 1,
  retries: 0,
  use: { baseURL: "http://127.0.0.1:3180", timezoneId: "UTC", trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: [
    { command: "node --import tsx scripts/e2e-server.mts", url: "http://127.0.0.1:4180/health", timeout: 90_000, reuseExistingServer: false },
    { command: "node scripts/e2e-web.mjs", url: "http://127.0.0.1:3180", timeout: 180_000, reuseExistingServer: false },
  ],
});
