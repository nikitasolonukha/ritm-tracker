import { expect, test, type Page } from "@playwright/test";

/** Записывает текущий подход: заполняет повторы у всех видимых полей (у пары их два) и ждёт конца отдыха или пропускает его. */
async function completeCurrentSet(page: Page) {
  const inputs = page.locator(".repsControl input");
  for (let index = 0; index < await inputs.count(); index += 1) await inputs.nth(index).fill("6");
  await page.getByRole("button", { name: /^Записать/ }).click();
  const skip = page.getByRole("button", { name: /Пропустить отдых/ });
  if (await skip.isVisible().catch(() => false)) await skip.click();
}

/** Записывает подходы упражнения, пока на экране есть кнопка «Записать». Возвращает число записанных логических подходов. */
async function completeExercise(page: Page) {
  let recorded = 0;
  while (await page.getByRole("button", { name: /^Записать/ }).isVisible().catch(() => false)) {
    await completeCurrentSet(page);
    recorded += 1;
    expect(recorded).toBeLessThanOrEqual(20);
  }
  return recorded;
}

test("demo workout runs from saved plan through summary", async ({ page }, testInfo) => {
  await page.goto("/workouts");
  await expect(page.getByRole("heading", { name: "Тренировки" })).toBeVisible();
  await page.locator("a.programCard").first().click();
  await expect(page.getByRole("heading", { name: "Тренировка" }).first()).toBeVisible();
  await expect(page.getByText("4×8", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: /Начать тренировку/ }).click();
  await expect(page.getByText("Подход 1 из 4", { exact: true }).first()).toBeVisible();
  await expect(page.locator(".repsControl input")).toHaveAttribute("placeholder", "8");
  await page.screenshot({ path: `artifacts/ui-review-final/${testInfo.project.name}-active.png`, fullPage: true });

  const recorded: number[] = [];
  for (let exerciseIndex = 0; exerciseIndex < 3; exerciseIndex += 1) {
    if (exerciseIndex === 2) await expect(page.getByText("Подход 1 из 2", { exact: true }).first()).toBeVisible();
    recorded.push(await completeExercise(page));
    if (exerciseIndex < 2) await page.getByRole("button", { name: /Следующее упражнение/ }).click();
  }
  // Первые два упражнения — по 4 подхода, третье (правая и левая сторона) — 2 подхода по две части.
  expect(recorded).toEqual([4, 4, 2]);

  await page.getByRole("button", { name: /^Завершить тренировку$/ }).click();
  await page.getByRole("button", { name: "Подтвердить завершение" }).click();
  await expect(page.getByText("Тренировка завершена", { exact: true })).toBeVisible();
  // 4 + 4 + 2 логических подхода; пара считается одним подходом, а не двумя
  await expect(page.locator(".summaryMetrics")).toContainText("10");
  await page.screenshot({ path: `artifacts/ui-review-final/${testInfo.project.name}-summary.png`, fullPage: true });
});

test("changing the weight never adds a set and a pair is recorded as one", async ({ page }) => {
  await page.goto("/workouts");
  await page.locator("a.programCard").first().click();
  await page.getByRole("button", { name: /Начать тренировку/ }).click();
  const progress = page.locator(".workoutProgress");
  await expect(progress).toContainText("Подход 1 из 4");
  const plus = page.getByRole("button", { name: /^Увеличить вес/ }).first();
  for (let index = 0; index < 4; index += 1) await plus.click();
  await expect(page.getByRole("button", { name: /^Увеличить вес/ }).first()).toBeVisible();
  await expect(progress).toContainText("Подход 1 из 4");
  await page.locator(".repsControl input").fill("8");
  await page.getByRole("button", { name: /^Записать/ }).click();
  await expect(progress).toContainText("Подход 2 из 4");
  await page.getByRole("button", { name: /Пропустить отдых/ }).click();
  await expect(progress).toContainText("Подход 2 из 4");
});
