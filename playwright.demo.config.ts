import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e-demo", workers: 1, retries: 0, timeout: 60000,
  use: { baseURL: "http://127.0.0.1:3180", viewport: { width: 390, height: 844 }, trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: { command: "node scripts/e2e-web.mjs --demo", url: "http://127.0.0.1:3180", timeout: 180000, reuseExistingServer: false },
});
