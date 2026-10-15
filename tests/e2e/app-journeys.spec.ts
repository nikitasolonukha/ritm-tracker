import { expect, test, type Page } from "@playwright/test";

/** Сквозные сценарии в демо-режиме (RITM_DEMO_MODE=1): без сервера, на стартовых данных. */

const progress = (page: Page) => page.locator(".workoutProgress");

async function recordCurrentSet(page: Page, reps = "8") {
  const inputs = page.locator(".repsControl input");
  for (let index = 0; index < await inputs.count(); index += 1) await inputs.nth(index).fill(reps);
  await page.getByRole("button", { name: /^Записать/ }).click();
  const skip = page.getByRole("button", { name: /Пропустить отдых/ });
  if (await skip.isVisible().catch(() => false)) await skip.click();
}

test("workout survives a reload, takes an extra set and finishes early into the journal", async ({ page }) => {
  await page.goto("/today");
  await page.getByRole("button", { name: "Начать тренировку" }).click();
  await expect(progress(page)).toContainText("Подход 1 из 4");

  await recordCurrentSet(page);
  await recordCurrentSet(page);
  await expect(progress(page)).toContainText("Подход 3 из 4");

  await page.reload();
  await expect(progress(page)).toContainText("Подход 3 из 4");
  await expect(page.locator(".workoutTimer")).toBeVisible();

  await page.getByRole("button", { name: "Меню тренировки" }).click();
  await page.getByRole("button", { name: /^Добавить подход/ }).click();
  await expect(progress(page)).toContainText("Подход 3 из 5");

  await page.getByRole("button", { name: "Меню тренировки" }).click();
  await page.getByRole("button", { name: /^Завершить досрочно/ }).click();
  await page.getByRole("button", { name: "Подтвердить завершение" }).click();
  await expect(page.getByText("Завершена частично", { exact: true })).toBeVisible();
  await expect(page.locator(".summaryMetrics")).toContainText("2");
  await page.getByRole("link", { name: "Готово" }).click();
  await expect(page).toHaveURL(/\/today$/);

  await page.goto("/journal");
  const card = page.locator("a.historyCard").first();
  await expect(card).toContainText("2 подхода");
  await card.click();
  await expect(page.getByRole("heading", { name: "Тренировка", exact: true }).first()).toBeVisible();
});

test("a recorded set can be corrected and deleted from the journal sheet", async ({ page }) => {
  await page.goto("/today");
  await page.getByRole("button", { name: "Начать тренировку" }).click();
  await recordCurrentSet(page, "8");
  await page.getByRole("button", { name: "Меню тренировки" }).click();
  await page.getByRole("button", { name: /^Завершить досрочно/ }).click();
  await page.getByRole("button", { name: "Подтвердить завершение" }).click();
  await page.getByRole("link", { name: "Открыть в журнале" }).click();

  await page.getByRole("button", { name: /^Править подход 1/ }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Фактические повторы", exact: true }).fill("12");
  await dialog.getByRole("button", { name: "Сохранить исправление" }).click();
  await expect(page.getByText("Исправление сохранено на устройстве.")).toBeVisible();
  await expect(page.locator(".setRow").first()).toContainText("× 12");

  await expect(page.locator(".setRow")).toHaveCount(12);
  await page.getByRole("button", { name: /^Править подход 1/ }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Удалить подход" }).click();
  await page.getByRole("dialog").filter({ hasText: "Подтвердите удаление" }).getByRole("button", { name: "Удалить" }).click();
  await expect(page.getByText("Подход удалён из записи.")).toBeVisible();
  await expect(page.locator(".setRow")).toHaveCount(11);
  // Без записанных подходов тренировка пропадает из списка журнала.
  await page.goto("/journal");
  await expect(page.locator("a.historyCard")).toHaveCount(0);
});

test("habits can be done, skipped and undone, rings follow", async ({ page }) => {
  await page.goto("/today");
  const wake = page.locator(".habitRow").filter({ hasText: "Подъём" });
  await wake.locator(".habitMain").click();
  await expect(wake).toContainText("Выполнено");
  await expect(page.getByText("1 из 5 выполнено", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Отменить отметку Подъём", exact: true }).click();
  await expect(page.getByText("0 из 5 выполнено", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Пропустить Подъём", exact: true }).click();
  await expect(wake).toContainText("Пропущено");
  await page.reload();
  await expect(page.locator(".habitRow").filter({ hasText: "Подъём" })).toContainText("Пропущено");
});

test("reminders: switch on, pick after-action delay, keep it after reload", async ({ page }) => {
  await page.goto("/settings?section=telegram");
  await page.getByLabel("Напоминание: Утренний приём пищи").check();
  const group = page.getByRole("group", { name: "Когда напоминать: Утренний приём пищи" });
  await group.getByRole("button", { name: "В своё время" }).waitFor();
  await page.getByLabel("Время напоминания: Утренний приём пищи").fill("08:30");
  await expect(page.getByText("каждый день в 08:30")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Напоминание: Утренний приём пищи")).toBeChecked();
  await expect(page.getByText("каждый день в 08:30")).toBeVisible();
});

test("progress sections, calendar months and exercise search work", async ({ page }) => {
  await page.goto("/progress");
  await expect(page.getByRole("navigation", { name: "Разделы прогресса" })).toBeVisible();
  await page.getByRole("link", { name: "Календарь", exact: true }).click();
  const title = page.locator(".calendarHead h2");
  const current = await title.innerText();
  await page.getByRole("button", { name: "Предыдущий месяц" }).click();
  await expect(title).not.toHaveText(current);
  await page.getByRole("button", { name: "Следующий месяц" }).click();
  await expect(title).toHaveText(current);
  await page.getByRole("link", { name: "Упражнения", exact: true }).click();
  await page.getByRole("searchbox", { name: "Найти упражнение" }).fill("нет такого упражнения");
  await expect(page.getByText("Ничего не найдено.")).toBeVisible();
});

test("no screen scrolls sideways on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  for (const route of ["/today", "/workouts", "/progress", "/journal", "/calendar", "/exercises", "/settings", "/settings?section=program", "/settings?section=telegram", "/settings?section=data", "/journal/import"]) {
    await page.goto(route);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, route).toBeLessThanOrEqual(0);
  }
});
