import { defineConfig } from "@playwright/test";

const browserName = process.env.PRODUCT_QA_BROWSER === "webkit" ? "webkit" : "chromium";

export default defineConfig({
  testDir: ".",
  testMatch: "product-flow.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 600_000,
  expect: { timeout: 15_000 },
  reporter: "line",
  outputDir: `../../.private/product-qa-results-${browserName}`,
  projects: [{ name: `product-${browserName}`, use: { browserName } }],
  use: {
    baseURL: process.env.PRODUCT_QA_URL ?? "http://localhost:3005",
    serviceWorkers: "allow",
    viewport: { width: 390, height: 844 },
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
