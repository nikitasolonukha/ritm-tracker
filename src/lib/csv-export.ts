import { historyWorkouts } from "./exercises.ts";
import { logicalSetKey } from "./tracker.ts";
import type { SessionTrackerState } from "./workout-session.ts";

const header = ["Дата", "Тренировка", "Упражнение", "Подход", "Сторона", "Вес, кг", "Повторы", "Учёт веса", "Выполнен", "Заметка"];

/** Значение для CSV: кавычки удваиваются, значения с разделителем, кавычкой или переводом строки берутся в кавычки. */
export function csvCell(value: string | number | null | undefined): string {
  const text = value == null ? "" : String(value);
  return /[;"\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * Журнал тренировок одной таблицей: строка = подход. Разделитель «;» и десятичная запятая, как ждёт русский Excel.
 * В выгрузку попадают только завершённые и частично завершённые записи, отменённые и идущие не входят.
 */
export function workoutsToCsv(state: SessionTrackerState): string {
  const rows: string[][] = [header];
  const workouts = [...historyWorkouts(state)].sort((a, b) => a.date.localeCompare(b.date));
  for (const workout of workouts) {
    for (const exercise of workout.exercises) {
      const numbers = new Map<string, number>();
      exercise.sets.forEach((set, index) => {
        const key = logicalSetKey(set, index);
        if (!numbers.has(key)) numbers.set(key, numbers.size + 1);
        const side = set.component === "compound-a" ? "правая" : set.component === "compound-b" ? "левая" : "";
        const mode = set.weightMode === "per-hand" ? "на сторону" : set.weightMode === "total" ? "общий вес" : "";
        rows.push([
          workout.date,
          workout.title,
          exercise.name,
          String(numbers.get(key)),
          side,
          set.weightKg == null ? "" : String(set.weightKg).replace(".", ","),
          set.reps == null ? "" : String(set.reps),
          mode,
          set.completed ? "да" : "нет",
          set.note ?? "",
        ]);
      });
    }
  }
  return `﻿${rows.map((row) => row.map(csvCell).join(";")).join("\r\n")}\r\n`;
}
