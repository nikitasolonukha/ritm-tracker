import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  use: { baseURL: "http://127.0.0.1:3002", trace: "retain-on-failure" },
  webServer: { command: "node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3002", url: "http://127.0.0.1:3002/login", reuseExistingServer: true, timeout: 120_000 },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], channel: process.env.PLAYWRIGHT_CHANNEL || undefined } },
    { name: "iphone", use: { ...devices["iPhone 13"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
