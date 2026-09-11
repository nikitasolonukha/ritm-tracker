import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/workout-demo.spec.ts",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:3005", channel: process.env.PLAYWRIGHT_CHANNEL || "chrome", trace: "retain-on-failure" },
  webServer: {
    command: "node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3005",
    url: "http://127.0.0.1:3005/workouts",
    reuseExistingServer: false,
    timeout: 120_000,
    env: { RITM_DEMO_MODE: "1", NODE_ENV: "development" },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } },
    { name: "iphone", use: { ...devices["iPhone 13"], browserName: "chromium", channel: process.env.PLAYWRIGHT_CHANNEL || "chrome", viewport: { width: 390, height: 844 } } },
  ],
});
