import { expect, test, type Page } from "@playwright/test";

/** Версия 1.6: сон по кнопкам «Лёг» и «Проснулся», упражнение, добавленное в ходе тренировки, и рекорд в момент записи. */

const progress = (page: Page) => page.locator(".workoutProgress");

/** Выбор в списке: на телефоне обычный select, на компьютере собственное меню. */
async function pick(page: Page, scope: ReturnType<Page["locator"]>, label: string, optionText: string) {
  const field = scope.locator("label", { hasText: label });
  const native = field.locator("select");
  if (await native.isVisible().catch(() => false)) { await native.selectOption({ label: optionText }); return; }
  await field.locator(".appSelectButton").click();
  await page.locator(".appSelectMenu button", { hasText: optionText }).click();
}

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

test("warm-up sets from the program come first, are skipped or recorded without a timer, and stay out of the stats", async ({ page }) => {
  await page.goto("/settings?section=program");
  const editor = page.locator(".exerciseDisclosure:visible").first();
  await editor.locator("summary").click();
  await pick(page, editor, "Разминка перед подходами", "2 подхода");
  await startFromToday(page);
  await expect(progress(page)).toContainText("Разминка 1 из 2");
  await expect(page.getByRole("heading", { name: "Разминка 1 из 2" })).toBeVisible();
  await expect(page.getByText("не входит в статистику")).toBeVisible();
  await page.locator(".repsControl input").first().fill("10");
  await page.getByRole("button", { name: /^Записать разминку 10/ }).click();
  await expect(page.locator(".restState")).toHaveCount(0);
  await expect(progress(page)).toContainText("Разминка 2 из 2");
  await page.getByRole("button", { name: "Пропустить разминку" }).click();
  await expect(progress(page)).toContainText("Подход 1 из 4");
  await expect(page.getByRole("heading", { name: "Подход 1" })).toBeVisible();
  await recordFirstSet(page);
  await page.getByRole("button", { name: "Меню тренировки" }).click();
  await page.getByRole("button", { name: /^Завершить досрочно/ }).click();
  await page.getByRole("button", { name: "Подтвердить завершение" }).click();
  // в итоге один подход, а разминка в него не входит
  await expect(page.locator(".summaryMetrics")).toContainText("1");
  await page.getByRole("link", { name: "Готово" }).click();
  await page.goto("/journal");
  await page.locator("a.historyCard").first().click();
  await expect(page.getByText(/^Разминка \(не в статистике\): .*×10/)).toBeVisible();
});

test("a warm-up can be added from the workout menu until the first working set", async ({ page }) => {
  await startFromToday(page);
  await expect(progress(page)).toContainText("Подход 1 из 4");
  await page.getByRole("button", { name: "Меню тренировки" }).click();
  await page.getByRole("button", { name: /^Добавить разминку/ }).click();
  await expect(progress(page)).toContainText("Разминка 1 из 2");
  await page.getByRole("button", { name: "Пропустить разминку" }).click();
  await expect(progress(page)).toContainText("Подход 1 из 4");
  await recordFirstSet(page);
  await page.getByRole("button", { name: "Меню тренировки" }).click();
  await expect(page.getByRole("button", { name: /^Добавить разминку/ })).toHaveCount(0);
});

test("machine settings are edited in the workout and show up in the next one", async ({ page }) => {
  await startFromToday(page);
  await page.getByRole("button", { name: "Настройки тренажёра" }).first().click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Настройки тренажёра").fill("сиденье 4, спинка 2");
  await sheet.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.locator(".wkSettingsBtn", { hasText: "сиденье 4, спинка 2" })).toBeVisible();
  await page.reload();
  await expect(page.locator(".wkSettingsBtn", { hasText: "сиденье 4, спинка 2" })).toBeVisible();
  await recordFirstSet(page);
  await page.getByRole("button", { name: "Меню тренировки" }).click();
  await page.getByRole("button", { name: /^Завершить досрочно/ }).click();
  await page.getByRole("button", { name: "Подтвердить завершение" }).click();
  await page.getByRole("link", { name: "Готово" }).click();
  await startFromToday(page);
  await expect(page.locator(".wkSettingsBtn", { hasText: "сиденье 4, спинка 2" })).toBeVisible();
});

async function finishEarly(page: Page) {
  await page.getByRole("button", { name: "Меню тренировки" }).click();
  await page.getByRole("button", { name: /^Завершить досрочно/ }).click();
  await page.getByRole("button", { name: "Подтвердить завершение" }).click();
  await expect(page.locator(".summaryMetrics")).toBeVisible();
}

test("the summary can be shared as a PNG card, or downloaded when the system share sheet is missing", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    Object.defineProperty(navigator, "canShare", { value: undefined, configurable: true });
  });
  await startFromToday(page);
  await recordFirstSet(page);
  await finishEarly(page);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Поделиться картинкой" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^ritm-\d{4}-\d{2}-\d{2}\.png$/);
  const path = await download.path();
  const { readFileSync } = await import("node:fs");
  const bytes = readFileSync(path);
  expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(bytes.readUInt32BE(16)).toBe(1080);
  expect(bytes.readUInt32BE(20)).toBe(1350);
  expect(bytes.length).toBeGreaterThan(20_000);
  await expect(page.getByText("Картинка сохранена в загрузки.")).toBeVisible();
});

test("with a system share sheet the PNG card is handed over as a file", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __shared?: { name: string; type: string; size: number; title?: string } };
    Object.defineProperty(navigator, "canShare", { value: (data: { files?: File[] }) => Boolean(data.files?.length), configurable: true });
    Object.defineProperty(navigator, "share", { value: async (data: { files: File[]; title?: string }) => { w.__shared = { name: data.files[0].name, type: data.files[0].type, size: data.files[0].size, title: data.title }; }, configurable: true });
  });
  await startFromToday(page);
  await recordFirstSet(page);
  await finishEarly(page);
  await page.getByRole("button", { name: "Поделиться картинкой" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __shared?: unknown }).__shared)).toMatchObject({ type: "image/png" });
  const shared = await page.evaluate(() => (window as unknown as { __shared: { name: string; size: number; title: string } }).__shared);
  expect(shared.name).toMatch(/^ritm-\d{4}-\d{2}-\d{2}\.png$/);
  expect(shared.size).toBeGreaterThan(20_000);
  await expect(page.getByText("Картинка сохранена в загрузки.")).toHaveCount(0);
});

test("an exercise note is kept, shown in the journal and offered as a hint next time", async ({ page }) => {
  await startFromToday(page);
  await page.getByRole("button", { name: "Заметка", exact: true }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("textbox", { name: "Заметка к упражнению" }).fill("болело плечо, снизил вес");
  await sheet.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.locator(".wkSettingsBtn", { hasText: "болело плечо" })).toBeVisible();
  await page.reload();
  await expect(page.locator(".wkSettingsBtn", { hasText: "болело плечо" })).toBeVisible();
  await recordFirstSet(page);
  await finishEarly(page);
  await page.getByRole("link", { name: "Открыть в журнале" }).click();
  await expect(page.getByText("Заметка: болело плечо, снизил вес")).toBeVisible();
  await page.goto("/today");
  await startFromToday(page);
  await expect(page.getByText(/^Заметка в прошлый раз \(.*\): болело плечо, снизил вес/)).toBeVisible();
  await expect(page.locator(".wkSettingsBtn", { hasText: "болело плечо" })).toHaveCount(0);
});

test("the weekly digest switch is on by default and stays off after a reload", async ({ page }) => {
  await page.goto("/settings?section=telegram");
  const toggle = page.getByRole("checkbox", { name: "Недельная сводка в Telegram" });
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect(page.getByText("выключено").first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole("checkbox", { name: "Недельная сводка в Telegram" })).not.toBeChecked();
});
