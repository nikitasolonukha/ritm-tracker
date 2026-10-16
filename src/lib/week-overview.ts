import { historyWorkouts } from "./exercises.ts";
import { habitsForDate, sleepFromEvents } from "./habits.ts";
import { dayInfo } from "./streaks.ts";
import type { SessionTrackerState } from "./workout-session.ts";
import { calculateWorkoutTotals } from "./tracker.ts";

const dayMs = 86_400_000;
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * dayMs).toISOString().slice(0, 10);
const mondayOf = (date: string) => addDays(date, -((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7));

export type WeekOverview = {
  startDate: string;
  workouts: number;
  /** Цель по тренировкам в неделю из привычки «Тренировка» (по умолчанию 3). */
  goal: number;
  volumeKg: number;
  /** Дни с планом привычек, закрытые полностью, и всего дней с планом (по сегодня включительно). */
  daysClosed: number;
  daysPlanned: number;
  sleepAverageHours?: number;
  sleepNights: number;
  /** Есть ли за неделю хоть что-то записанное: пустой неделе блок не нужен. */
  hasData: boolean;
};

/** Итоги текущей недели (с понедельника по сегодня) только по записанным данным. */
export function weekOverview(state: SessionTrackerState, today: string): WeekOverview {
  const startDate = mondayOf(today);
  const workouts = historyWorkouts(state).filter((workout) => workout.date >= startDate && workout.date <= today);
  const volumeKg = workouts.reduce((sum, workout) => sum + calculateWorkoutTotals(workout).volumeKg, 0);
  const none = new Set<string>();
  let daysClosed = 0;
  let daysPlanned = 0;
  const sleep: number[] = [];
  for (let date = startDate; date <= today; date = addDays(date, 1)) {
    const info = dayInfo(state, date, none);
    if (info.planned > 0) {
      // Сегодняшний незакрытый день ещё не закончился: в знаменатель его не берём.
      if (info.closed || date !== today) daysPlanned += 1;
      if (info.closed) daysClosed += 1;
    }
    const hours = sleepFromEvents(state.habits, state.completions, date);
    if (hours != null) sleep.push(hours);
  }
  const goal = state.habits.find((habit) => !habit.archived && habit.type === "workout")?.targetDays ?? 3;
  const marks = daysPlanned > 0 && state.completions.some((c) => c.localDate >= startDate && c.localDate <= today && c.outcome !== "skipped" && state.habits.some((habit) => habit.id === c.habitId && habitsForDate([habit], c.localDate).length > 0));
  return {
    startDate,
    workouts: workouts.length,
    goal,
    volumeKg: Math.round(volumeKg),
    daysClosed,
    daysPlanned,
    ...(sleep.length ? { sleepAverageHours: sleep.reduce((sum, hours) => sum + hours, 0) / sleep.length } : {}),
    sleepNights: sleep.length,
    hasData: workouts.length > 0 || marks,
  };
}
