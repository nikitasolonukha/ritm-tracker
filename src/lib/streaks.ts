import { habitsForDate } from "./habits.ts";
import type { TrackerState } from "./storage.ts";
import { calculateWorkoutTotals, type Workout } from "./tracker.ts";

const dayMs = 86_400_000;
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * dayMs).toISOString().slice(0, 10);
const mondayOf = (date: string) => addDays(date, -((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7));

export type DayInfo = { date: string; planned: number; done: number; closed: boolean; trained: boolean };

export function dayInfo(state: TrackerState, date: string, trainedDates: Set<string>): DayInfo {
  const planned = habitsForDate(state.habits, date);
  const done = planned.filter((habit) => state.completions.some((c) => c.habitId === habit.id && c.localDate === date && c.outcome !== "skipped")).length;
  return { date, planned: planned.length, done, closed: planned.length > 0 && done === planned.length, trained: trainedDates.has(date) };
}

/** Даты тренировок: только с подтверждёнными подходами, без активных и отменённых. */
export function trainedDateSet(workouts: Workout[], excludedWorkoutIds: Set<string> = new Set()): Set<string> {
  return new Set(workouts.filter((w) => !excludedWorkoutIds.has(w.id) && calculateWorkoutTotals(w).completedSets > 0).map((w) => w.date));
}

/**
 * Серия закрытых дней подряд. Сегодняшний день не обрывает серию, пока он не закончился.
 * Дни без плана не считаются и не обрывают серию.
 */
export function habitStreaks(state: TrackerState, today: string): { current: number; longest: number } {
  const first = state.completions.map((c) => c.localDate).sort()[0];
  if (!first) return { current: 0, longest: 0 };
  const none = new Set<string>();
  let longest = 0;
  let run = 0;
  for (let date = first; date <= today; date = addDays(date, 1)) {
    const info = dayInfo(state, date, none);
    if (info.planned === 0) continue;
    if (info.closed) { run += 1; longest = Math.max(longest, run); }
    else if (date !== today) run = 0;
  }
  // `run` уже учитывает сегодня, если день закрыт, и не сброшен им, если не закрыт.
  return { current: run, longest };
}

/** Сколько недель подряд выполнена недельная цель. Текущая неделя засчитывается только после достижения цели. */
export function weeklyGoalStreak(trainedDates: Set<string>, goal: number, today: string): number {
  if (goal <= 0) return 0;
  const perWeek = new Map<string, number>();
  for (const date of trainedDates) perWeek.set(mondayOf(date), (perWeek.get(mondayOf(date)) ?? 0) + 1);
  let week = mondayOf(today);
  let streak = 0;
  if ((perWeek.get(week) ?? 0) >= goal) streak += 1;
  week = addDays(week, -7);
  while ((perWeek.get(week) ?? 0) >= goal) { streak += 1; week = addDays(week, -7); }
  return streak;
}

export type CalendarCell = DayInfo & { inMonth: boolean; isToday: boolean; isFuture: boolean };

/** Сетка месяца, неделя начинается с понедельника. `month` — 1…12. */
export function monthGrid(state: TrackerState, year: number, month: number, today: string, trainedDates: Set<string>): CalendarCell[] {
  const firstOfMonth = `${year}-${String(month).padStart(2, "0")}-01`;
  const start = mondayOf(firstOfMonth);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lead = (Date.parse(`${firstOfMonth}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / dayMs;
  const rows = Math.ceil((lead + daysInMonth) / 7);
  return Array.from({ length: rows * 7 }, (_, index) => {
    const date = addDays(start, index);
    return { ...dayInfo(state, date, trainedDates), inMonth: date.slice(0, 7) === firstOfMonth.slice(0, 7), isToday: date === today, isFuture: date > today };
  });
}
