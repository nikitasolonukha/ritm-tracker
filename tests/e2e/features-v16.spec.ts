import { expect, test, type Page } from "@playwright/test";

/** Версия 1.6: сон по кнопкам «Лёг» и «Проснулся», упражнение, добавленное в ходе тренировки, и рекорд в момент записи. */

const progress = (page: Page) => page.locator(".workoutProgress");

async function startFromToday(page: Page) {
  await page.goto("/today");
  await page.getByRole("button", { name: "Начать тренировку" }).click();
  const confirm = page.getByRole("button", { name: "Всё равно начать" });
  if (await confirm.isVisible({ timeout: 800 }).catch(() => false)) await confirm.click();
  await expect(progress(page)).toBeVisible();
}

async function recordFirstSet(page: Page, reps = "8") {
  const inputs = page.locator(".repsControl input");
  for (let index = 0; index < await inputs.count(); index += 1) await inputs.nth(index).fill(reps);
  await page.getByRole("button", { name: /^Записать/ }).click();
  const skip = page.getByRole("button", { name: /Пропустить отдых/ });
  if (await skip.isVisible().catch(() => false)) await skip.click();
}

test("sleep: turn on, mark bedtime and wake, hours and week bars appear and stay after reload", async ({ page }) => {
  // 23:00 по Москве, через 7,5 часа будет 06:30
  await page.clock.install({ time: new Date("2026-10-16T20:00:00.000Z") });
  await page.goto("/today");
  const card = page.locator(".sleepCard");
  await expect(card).toContainText("Сон");
  await card.getByRole("button", { name: "Считать сон" }).click();
  await expect(card.getByRole("button", { name: "Лёг спать" })).toBeVisible();
  // служебные привычки не попадают в план дня
  await expect(page.locator(".habitList")).not.toContainText("Лёг спать");
  await card.getByRole("button", { name: "Лёг спать" }).click();
  await expect(card).toContainText("Лёг в 23:00");
  await page.clock.fastForward("07:30:00");
  // экран был открыт всю ночь: «Сегодня» сам перешёл на новую дату
  await expect(page.getByRole("heading", { name: "Сегодня" })).toBeVisible();
  await expect(page.getByText("17 октября", { exact: true })).toBeVisible();
  await card.getByRole("button", { name: "Проснулся", exact: true }).click();
  await expect(card).toContainText("Эта ночь: 7 ч 30 мин");
  await expect(card).toContainText("в среднем 7 ч 30 мин");
  await expect(card.getByRole("button", { name: /^Проснулся в 06:30/ })).toBeVisible();
  await expect(card.locator(".sleepBars span")).toHaveCount(1);
  await page.reload();
  await expect(page.locator(".sleepCard")).toContainText("Эта ночь: 7 ч 30 мин");
  // повторное нажатие отменяет отметку
  await page.locator(".sleepCard").getByRole("button", { name: /^Проснулся в 06:30/ }).click();
  await expect(page.locator(".sleepCard")).not.toContainText("Эта ночь");
  await expect(page.locator(".sleepCard")).toContainText("Лёг в 23:00");
});

test("an exercise added during the workout is recorded and stays out of the program", async ({ page }) => {
  await startFromToday(page);
  await page.getByRole("button", { name: "Меню тренировки" }).click();
  await page.getByRole("button", { name: /^Добавить упражнение/ }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("searchbox", { name: "Название упражнения" }).fill("Разгибания ног");
  await sheet.getByRole("button", { name: /^Добавить «Разгибания ног»/ }).click();
  await expect(page.getByRole("heading", { name: "Разгибания ног" })).toBeVisible();
  await expect(page.getByText("Упражнение 4 из 4", { exact: true })).toBeVisible();
  await expect(progress(page)).toContainText("Подход 1 из 3");
  await recordFirstSet(page, "12");
  await expect(progress(page)).toContainText("Подход 2 из 3");
  // сверху видны табы: четвёртое упражнение появилось, в программе его нет
  await expect(page.getByRole("button", { name: /^Упражнение 4: Разгибания ног/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Разгибания ног" })).toBeVisible();
  await page.goto("/workouts");
  await page.locator("a.programCard").first().click();
  await expect(page.getByText("Разгибания ног")).toHaveCount(0);
});

test("a right/left exercise can be added as a pair", async ({ page }) => {
  await startFromToday(page);
  await page.getByRole("button", { name: "Меню тренировки" }).click();
  await page.getByRole("button", { name: /^Добавить упражнение/ }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: "Правая и левая отдельно" }).click();
  await sheet.getByRole("searchbox", { name: "Название упражнения" }).fill("Тяга одной рукой");
  await sheet.getByRole("button", { name: /^Добавить «Тяга одной рукой»/ }).click();
  await expect(page.getByRole("heading", { name: "Тяга одной рукой" })).toBeVisible();
  await expect(page.locator(".repsControl input")).toHaveCount(2);
  await expect(progress(page)).toContainText("Подход 1 из 3");
});

test("a new weight record is announced right after recording the set", async ({ page }) => {
  // первая тренировка: 5 кг в первом подходе
  await startFromToday(page);
  const plus = page.getByRole("button", { name: "Увеличить вес", exact: true });
  await plus.click();
  await plus.click();
  await recordFirstSet(page);
  await expect(page.locator(".wkRecord")).toHaveCount(0);
  await page.getByRole("button", { name: "Меню тренировки" }).click();
  await page.getByRole("button", { name: /^Завершить досрочно/ }).click();
  await page.getByRole("button", { name: "Подтвердить завершение" }).click();
  await page.getByRole("link", { name: "Готово" }).click();
  // вторая: 7,5 кг, это больше прошлого
  await startFromToday(page);
  const plusAgain = page.getByRole("button", { name: "Увеличить вес", exact: true });
  for (let step = 0; step < 3; step += 1) await plusAgain.click();
  await expect(page.locator(".workWeight strong")).toHaveText("7.5");
  const inputs = page.locator(".repsControl input");
  await inputs.first().fill("8");
  await page.getByRole("button", { name: /^Записать/ }).click();
  await expect(page.locator(".wkRecord")).toContainText("Рекорд веса: 7,5 кг (было 5)");
});
