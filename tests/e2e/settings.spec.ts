import { expect, test } from "@playwright/test";

test("settings keep decimal drafts and separate sections without overflow", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Программа", exact: true }).click();
  await page.locator(".exerciseDisclosure summary").first().click();
  const weight = page.getByRole("textbox", { name: "Вес", exact: true }).first();
  await weight.fill("");
  await weight.pressSequentially("12,");
  await expect(weight).toHaveValue("12,");
  await weight.pressSequentially("5");
  await expect(weight).toHaveValue("12,5");
  await weight.press("Tab");
  await expect(weight).toHaveValue("12.5");
  await page.reload();
  await page.getByRole("tab", { name: "Программа", exact: true }).click();
  await page.locator(".exerciseDisclosure summary").first().click();
  await expect(weight).toHaveValue("12.5");
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test("Telegram status failure is not called an expired link", async ({ page }) => {
  await page.route("**/api/telegram/link", (route) => route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"storage_unavailable"}' }));
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Telegram", exact: true }).click();
  await expect(page.getByText("Нет связи с сервером", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Подключить Telegram", exact: true })).toBeVisible();
});
