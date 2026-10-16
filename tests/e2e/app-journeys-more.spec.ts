import { expect, test, type Locator, type Page } from "@playwright/test";

/** Ещё сквозные сценарии в демо-режиме: пары, отмена, импорт, отметки, редакторы, выгрузка. */

const progress = (page: Page) => page.locator(".workoutProgress");

/** Выбор в списке: на телефоне это обычный select, на компьютере собственное меню. */
async function pick(page: Page, scope: Locator, label: string, optionText: string) {
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

async function recordSet(page: Page, reps = "8") {
  const inputs = page.locator(".repsControl input");
  for (let index = 0; index < await inputs.count(); index += 1) await inputs.nth(index).fill(reps);
  await page.getByRole("button", { name: /^Записать/ }).click();
  const skip = page.getByRole("button", { name: /Пропустить отдых/ });
  if (await skip.isVisible().catch(() => false)) await skip.click();
}

test("a right/left pair shares one weight and is recorded with both sides at once", async ({ page }) => {
  await startFromToday(page);
  await page.getByRole("button", { name: "Упражнение 3: Упражнение C" }).click();
  await expect(progress(page)).toContainText("Подход 1 из 2");
  await expect(page.locator(".repsControl input")).toHaveCount(2);
  const plus = page.getByRole("button", { name: "Увеличить вес", exact: true });
  await plus.click();
  await plus.click();
  await expect(page.locator(".workWeight strong")).toHaveText("5");
  await page.getByRole("button", { name: /^Записать \d+ \+ \d+/ }).click();
  await page.getByRole("button", { name: /Пропустить отдых/ }).click();
  await expect(progress(page)).toContainText("Подход 2 из 2");
  // вес не «прилип» ко второму подходу: меняли только текущий
  await expect(page.locator(".workWeight strong")).not.toHaveText("5");
});

test("an unfinished workout can be cancelled from the menu and leaves the statistics", async ({ page }) => {
  await startFromToday(page);
  await recordSet(page);
  await page.getByRole("button", { name: "Меню тренировки" }).click();
  await page.getByRole("button", { name: /^Отменить тренировку/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Отменить тренировку", exact: true }).click();
  await expect(page).toHaveURL(/\/workouts$/);
  await page.goto("/journal");
  await expect(page.locator("a.historyCard")).toHaveCount(1); // только в блоке «Отменённые»
  await expect(page.getByText("Отменённые тренировки")).toBeVisible();
  await page.goto("/progress");
  await expect(page.locator(".statTile").first()).toContainText("0");
});

test("weight as last time is offered after the first workout", async ({ page }) => {
  await startFromToday(page);
  const plus = page.getByRole("button", { name: /^Увеличить вес/ }).first();
  await plus.click();
  await plus.click();
  await page.locator(".repsControl input").first().fill("8");
  await recordSet(page);
  await page.getByRole("button", { name: "Меню тренировки" }).click();
  await page.getByRole("button", { name: /^Завершить досрочно/ }).click();
  await page.getByRole("button", { name: "Подтвердить завершение" }).click();
  await page.getByRole("link", { name: "Готово" }).click();
  await startFromToday(page);
  await expect(page.locator(".wkLast")).toContainText("В прошлый раз");
  await expect(page.getByRole("button", { name: /Вес как в прошлый раз/ })).toBeVisible();
});

test("an active workout can be resumed from any other main screen", async ({ page }) => {
  await startFromToday(page);
  await page.goto("/progress");
  const bar = page.getByRole("link", { name: /Тренировка · / });
  await expect(bar).toBeVisible();
  await bar.click();
  await expect(progress(page)).toBeVisible();
});

test("progress: a daily mark is saved, shown in history and can be deleted", async ({ page }) => {
  await page.goto("/progress");
  await page.getByRole("textbox", { name: "Энергия, 0–10" }).fill("7");
  await page.getByRole("textbox", { name: "Сон, часов" }).fill("7,5");
  await page.getByRole("textbox", { name: "Масса, кг" }).fill("72,5");
  await page.getByRole("button", { name: "Сохранить отметку" }).click();
  await expect(page.getByText("Отметка сохранена на устройстве.")).toBeVisible();
  const card = page.locator(".obsCard").first();
  await expect(card).toContainText("Энергия 7/10");
  await expect(card).toContainText("72.5 кг");
  await page.reload();
  await expect(page.locator(".obsCard").first()).toContainText("Энергия 7/10");
  await page.getByRole("button", { name: /^Удалить отметку за/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Удалить" }).click();
  await expect(page.locator(".obsCard")).toHaveCount(0);
});

test("import: pasted notes become a preview and then journal entries", async ({ page }) => {
  await page.goto("/journal/import");
  await page.getByRole("textbox", { name: "Исходный текст" }).fill("12.09.2026\nЖим лёжа\n60x8, 62,5x6\n");
  await page.getByRole("button", { name: "Предпросмотр" }).click();
  await expect(page.locator(".importCard")).toHaveCount(1);
  await page.getByRole("button", { name: "Подтвердить импорт" }).click();
  await expect(page.getByText("История сохранена.", { exact: false })).toBeVisible();
  await page.goto("/journal");
  await expect(page.locator("a.historyCard")).toHaveCount(1);
  await expect(page.locator("a.historyCard").first()).toContainText("Жим лёжа");
  await page.goto("/exercises");
  await expect(page.getByText("Жим лёжа").first()).toBeVisible();
});

test("program editor: new exercise, rest time, right/left sides show on the program page", async ({ page }) => {
  await page.goto("/settings?section=program");
  await page.getByRole("button", { name: "Добавить", exact: true }).click();
  const editor = page.locator(".exerciseDisclosure:visible").last();
  await editor.locator("summary").click();
  await editor.getByLabel("Название", { exact: true }).fill("Тяга одной рукой");
  await editor.getByLabel("Название", { exact: true }).press("Tab");
  await pick(page, editor, "Отдых", "1 мин 30 с");
  await editor.getByRole("button", { name: "Правая и левая" }).click();
  await expect(editor.getByRole("button", { name: "Убрать правую и левую" })).toBeVisible();
  await page.goto("/workouts");
  await page.locator("a.programCard").first().click();
  const plan = page.locator(".planCard").filter({ hasText: "Тяга одной рукой" });
  await expect(plan).toContainText("правая и левая");
  await expect(plan).toContainText("1 мин 30 с");
});

test("habit editor: add, rename, archive and delete a habit", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("button", { name: "Добавить привычку" }).click();
  const editor = page.locator(".exerciseDisclosure:visible").filter({ hasText: "Новая привычка" });
  await editor.locator("summary").click();
  await editor.getByLabel("Название", { exact: true }).fill("Растяжка вечером");
  await editor.getByLabel("Название", { exact: true }).press("Tab");
  await page.getByRole("button", { name: "В архив" }).last().click();
  await expect(page.getByText("В архиве", { exact: true }).first()).toBeVisible();
  await page.goto("/today");
  await expect(page.getByText("Растяжка вечером")).toHaveCount(0);
  await page.goto("/settings");
  const archived = page.locator(".exerciseDisclosure:visible").filter({ hasText: "Растяжка вечером" });
  await archived.locator("summary").click();
  await archived.getByRole("button", { name: "Удалить привычку" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Удалить" }).click();
  await expect(page.getByText("Растяжка вечером")).toHaveCount(0);
});

test("data tab: the journal downloads as CSV and the backup as JSON", async ({ page }) => {
  await startFromToday(page);
  await recordSet(page);
  await page.getByRole("button", { name: "Меню тренировки" }).click();
  await page.getByRole("button", { name: /^Завершить досрочно/ }).click();
  await page.getByRole("button", { name: "Подтвердить завершение" }).click();
  await page.goto("/settings?section=data");
  const csvDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: /Скачать журнал в CSV/ }).click();
  const csv = await csvDownload;
  expect(csv.suggestedFilename()).toMatch(/^ritm-journal-\d{4}-\d{2}-\d{2}\.csv$/);
  const path = await csv.path();
  const { readFileSync } = await import("node:fs");
  const text = readFileSync(path!, "utf8");
  expect(text.startsWith("﻿Дата;Тренировка;Упражнение;Подход")).toBe(true);
  expect(text.split("\r\n").length).toBeGreaterThan(2);
});

test("the rest panel stays compact and does not cover the set controls or the record button", async ({ page }) => {
  await startFromToday(page);
  await page.locator(".repsControl input").first().fill("8");
  await page.getByRole("button", { name: /^Записать/ }).click();
  const panel = page.locator(".restState");
  await expect(panel).toBeVisible();
  const box = await panel.boundingBox();
  const viewport = page.viewportSize();
  expect(box && viewport).toBeTruthy();
  // снимок владельца: панель занимала ~40% экрана, кнопки вытягивались на 300px
  expect(box!.height).toBeLessThan(150);
  expect(box!.height).toBeLessThan(viewport!.height * 0.22);
  for (const name of [/^\+30 секунд/, /^Пропустить отдых/]) {
    const button = await page.getByRole("button", { name }).boundingBox();
    expect(button!.height).toBeLessThanOrEqual(60);
    expect(button!.height).toBeGreaterThanOrEqual(40);
  }
  // кнопка записи видна и ниже панели, панель не перекрывает вес и повторы
  const record = await page.getByRole("button", { name: /^Записать/ }).boundingBox();
  expect(record!.y).toBeGreaterThanOrEqual(box!.y + box!.height - 1);
  // таймер не налезает на кнопки
  const time = await panel.locator("strong").boundingBox();
  const plus30 = await page.getByRole("button", { name: /^\+30 секунд/ }).boundingBox();
  expect(plus30!.x).toBeGreaterThanOrEqual(time!.x + time!.width + 4);
  // после прокрутки вниз вес и повторы целиком выше панели (на низких экранах без прокрутки они частично под ней)
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const panelAfter = await panel.boundingBox();
  const weight = await page.locator(".workWeight").first().boundingBox();
  expect(weight!.y + weight!.height).toBeLessThanOrEqual(panelAfter!.y + 1);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});

test("the rest ends with a vibration and two beeps once, and the signal can be switched off", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __vibrations: number; __beeps: number; AudioContext: unknown };
    w.__vibrations = 0;
    w.__beeps = 0;
    Object.defineProperty(navigator, "vibrate", { value: () => { w.__vibrations += 1; return true; }, configurable: true });
    w.AudioContext = class {
      currentTime = 0;
      destination = {};
      resume() { return Promise.resolve(); }
      createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (target: unknown) => target }; }
      createOscillator() { w.__beeps += 1; return { type: "", frequency: { value: 0 }, connect: (target: unknown) => target, start() {}, stop() {} }; }
    };
  });
  await page.clock.install();
  await startFromToday(page);
  await page.locator(".repsControl input").first().fill("8");
  await page.getByRole("button", { name: /^Записать/ }).click();
  await expect(page.locator(".restState")).toBeVisible();
  await page.clock.runFor(5 * 60 * 1000);
  await expect(page.locator(".restState")).toHaveCount(0);
  const counts = await page.evaluate(() => { const w = window as unknown as { __vibrations: number; __beeps: number }; return { v: w.__vibrations, b: w.__beeps }; });
  expect(counts).toEqual({ v: 1, b: 2 });

  await page.getByRole("button", { name: "Меню тренировки" }).click();
  await page.getByRole("button", { name: /^Сигнал после отдыха: включён/ }).click();
  await expect(page.getByRole("button", { name: /^Сигнал после отдыха: выключен/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.reload();
  await page.getByRole("button", { name: "Меню тренировки" }).click();
  await expect(page.getByRole("button", { name: /^Сигнал после отдыха: выключен/ })).toBeVisible();
});

test("the screen is kept awake during a workout and released afterwards", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __locks: number; __released: number };
    w.__locks = 0;
    w.__released = 0;
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: { request: async () => { w.__locks += 1; return { release: async () => { w.__released += 1; }, addEventListener() {} }; } },
    });
  });
  await startFromToday(page);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __locks: number }).__locks)).toBe(1);
  await page.getByRole("button", { name: "Меню тренировки" }).click();
  await page.getByRole("button", { name: /^Отменить тренировку/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Отменить тренировку", exact: true }).click();
  await expect(page).toHaveURL(/\/workouts$/);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __released: number }).__released)).toBeGreaterThanOrEqual(1);
});
