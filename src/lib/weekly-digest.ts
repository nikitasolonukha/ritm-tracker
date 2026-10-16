import { workoutResults } from "./exercises.ts";
import { habitsForDate, sleepFromEvents } from "./habits.ts";
import { formatSleep } from "./sleep.ts";
import { habitStreaks } from "./streaks.ts";
import type { TrackerState } from "./storage.ts";
import { calculateWorkoutTotals, russianWord } from "./tracker.ts";
import type { SessionTrackerState } from "./workout-session.ts";

const dayMs = 86_400_000;
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * dayMs).toISOString().slice(0, 10);
const dayMonth = (date: string) => new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));

const MOSCOW = "Europe/Moscow";

/** Окно отправки: воскресенье с 19:00 до полуночи по Москве. Возвращает дату этого воскресенья. */
export function weeklyDigestWindow(now: Date): { endDate: string } | null {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: MOSCOW, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  if (get("weekday") !== "Sun" || Number(get("hour")) < 19) return null;
  return { endDate: `${get("year")}-${get("month")}-${get("day")}` };
}

export type WeeklyDigest = { text: string; hasData: boolean };

/**
 * Текст недельной сводки за понедельник–воскресенье `endDate`. Только записанные факты, без оценок и советов.
 * `hasData` ложно, если за неделю нет ни тренировок, ни отметок: такую сводку не отправляем.
 */
export function buildWeeklyDigest(state: SessionTrackerState, endDate: string): WeeklyDigest {
  const startDate = addDays(endDate, -6);
  const sameMonth = startDate.slice(0, 7) === endDate.slice(0, 7);
  const period = sameMonth ? `${Number(startDate.slice(8))}–${dayMonth(endDate)}` : `${dayMonth(startDate)} – ${dayMonth(endDate)}`;
  const lines: string[] = [`Ритм · итоги недели, ${period}`, ""];

  const blocked = new Set((state.workoutSessions ?? []).filter((session) => session.status === "active" || session.status === "cancelled").map((session) => session.workoutId));
  const weekWorkouts = state.workouts.filter((workout) => !blocked.has(workout.id) && workout.date >= startDate && workout.date <= endDate && calculateWorkoutTotals(workout).completedSets > 0);
  const volume = weekWorkouts.reduce((sum, workout) => sum + calculateWorkoutTotals(workout).volumeKg, 0);
  const logicalSets = weekWorkouts.reduce((sum, workout) => sum + calculateWorkoutTotals(workout).completedLogicalSets, 0);
  const records = weekWorkouts.reduce((sum, workout) => sum + workoutResults(state, workout).filter((item) => item.record).length, 0);
  const goal = state.habits.find((habit) => !habit.archived && habit.type === "workout")?.targetDays;
  if (weekWorkouts.length) {
    lines.push(`Тренировки: ${weekWorkouts.length}${goal ? ` из ${goal}` : ""}`);
    lines.push(`Подходов: ${logicalSets}, объём: ${Math.round(volume).toLocaleString("ru-RU")} кг`);
    if (records) lines.push(`Рекордов по весу: ${records}`);
  } else {
    lines.push(`Тренировок за неделю: 0${goal ? ` (цель: ${goal})` : ""}`);
  }

  let planned = 0;
  let done = 0;
  const sleepNights: number[] = [];
  for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
    const habits = habitsForDate(state.habits, date);
    planned += habits.length;
    done += habits.filter((habit) => state.completions.some((c) => c.habitId === habit.id && c.localDate === date && c.outcome !== "skipped")).length;
    const sleep = sleepFromEvents(state.habits, state.completions, date);
    if (sleep != null) sleepNights.push(sleep);
  }
  if (planned > 0) lines.push(`Привычки: ${done} из ${planned} отметок`);
  if (sleepNights.length) {
    const average = sleepNights.reduce((sum, hours) => sum + hours, 0) / sleepNights.length;
    lines.push(`Сон: в среднем ${formatSleep(average)} (${sleepNights.length} ${russianWord(sleepNights.length, "ночь", "ночи", "ночей")})`);
  }
  const streak = habitStreaks(state as TrackerState, endDate).current;
  if (streak > 0) lines.push(`Серия закрытых дней: ${streak}`);

  const marksThisWeek = state.completions.some((c) => c.localDate >= startDate && c.localDate <= endDate && c.outcome !== "skipped");
  return { text: lines.join("\n"), hasData: weekWorkouts.length > 0 || marksThisWeek };
}
