import { expect, test } from "@playwright/test";

test("private home redirects to login without configuration", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/\/login\?reason=not-configured/);
  await expect(page.getByRole("heading", { name: "Вход" })).toBeVisible();
});

test("webhook is not redirected to browser login", async ({ request }) => {
  const response = await request.post("/api/telegram/webhook", { data: { update_id: 1 } });
  expect(response.status()).toBe(401);
  expect(await response.json()).toEqual({ error: "unauthorized" });
});
