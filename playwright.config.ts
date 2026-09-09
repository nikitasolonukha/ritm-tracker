import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  use: { baseURL: "http://127.0.0.1:3000", trace: "retain-on-failure" },
  webServer: { command: "pnpm dev --hostname 127.0.0.1", url: "http://127.0.0.1:3000/login", reuseExistingServer: true, timeout: 120_000 },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }, { name: "iphone", use: { ...devices["iPhone 13"] } }],
});
