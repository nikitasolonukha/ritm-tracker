import { expect, test, type Page } from "@playwright/test";

async function completeCurrentSet(page: Page) {
  await page.locator(".repsControl input").fill("6");
  await page.getByRole("button", { name: /Записать/ }).click();
  const rest = page.getByText("Отдых", { exact: true }).first();
  if (await rest.isVisible().catch(() => false)) await page.getByRole("button", { name: /Пропустить отдых/ }).click();
}

test("demo workout runs from saved 4x8 plan through summary", async ({ page }, testInfo) => {
  await page.goto("/workouts");
  await expect(page.getByRole("heading", { name: "Тренировки" })).toBeVisible();
  await page.locator("a.programCard").first().click();
  await expect(page.getByRole("heading", { name: "Тренировка" }).first()).toBeVisible();
  await expect(page.getByText("4×8", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: /Начать тренировку/ }).click();
  await expect(page.getByText("Подход 1 из 4", { exact: true }).first()).toBeVisible();
  await expect(page.locator(".repsControl input")).toHaveAttribute("placeholder", "8");
  await page.screenshot({ path: `artifacts/ui-review-final/${testInfo.project.name}-active.png`, fullPage: true });

  for (let exerciseIndex = 0; exerciseIndex < 3; exerciseIndex += 1) {
    if (exerciseIndex === 2) await expect(page.getByText("Подход 1 из 2", { exact: true }).first()).toBeVisible();
    for (let setIndex = 0; setIndex < 4; setIndex += 1) await completeCurrentSet(page);
    if (exerciseIndex < 2) await page.getByRole("button", { name: /Следующее упражнение/ }).click();
  }

  await page.getByRole("button", { name: /^Завершить тренировку$/ }).click();
  await page.getByRole("button", { name: "Подтвердить завершение" }).click();
  await expect(page.getByText("Тренировка завершена", { exact: true })).toBeVisible();
  await page.screenshot({ path: `artifacts/ui-review-final/${testInfo.project.name}-summary.png`, fullPage: true });
});
