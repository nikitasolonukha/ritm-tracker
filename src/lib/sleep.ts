import { changeHabit, sleepFromEvents, sleepHabitIds } from "./habits.ts";
import type { TrackerState } from "./storage.ts";
import type { Habit, HabitCompletion } from "./tracker.ts";

export type SleepNight = { date: string; hours: number };

export type SleepSummary = {
  /** Есть обе отметки-события: «лёг» и «проснулся». Без них считать нечего. */
  configured: boolean;
  bedtimeHabitId?: string;
  wakeHabitId?: string;
  /** Сон, который закончился сегодняшним пробуждением. */
  last?: SleepNight;
  /** Время последней отметки «лёг», после которой ещё не было «проснулся». */
  asleepSince?: string;
  /** Пробуждение сегодня уже отмечено. */
  wokeAt?: string;
  /** Последние 7 дней, от старых к новым; дни без данных пропущены. */
  week: SleepNight[];
  averageHours?: number;
};

const live = (habit: Habit) => !habit.archived;
const counted = (completion: HabitCompletion) => completion.outcome !== "skipped" && !completion.backfilled;

function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** Сон за последнюю неделю и текущее состояние отметок. Время считается только по отметкам «лёг» и «проснулся». */
export function sleepSummary(state: Pick<TrackerState, "habits" | "completions">, today: string, now = new Date()): SleepSummary {
  const bedtime = state.habits.find((habit) => live(habit) && habit.eventRole === "bedtime");
  const wake = state.habits.find((habit) => live(habit) && habit.eventRole === "wake");
  if (!bedtime || !wake) return { configured: false, week: [] };
  const week: SleepNight[] = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = shiftDate(today, -offset);
    const hours = sleepFromEvents(state.habits, state.completions, date);
    if (hours != null) week.push({ date, hours });
  }
  const todaysWake = state.completions.filter((c) => c.habitId === wake.id && c.localDate === today && counted(c)).at(-1);
  const lastWake = state.completions.filter((c) => c.habitId === wake.id && counted(c)).sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt))[0];
  const lastBed = state.completions.filter((c) => c.habitId === bedtime.id && counted(c)).sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt))[0];
  // Отметка «лёг» старше 20 часов — забытая: «спит с позавчера» не показываем.
  const fresh = lastBed && now.getTime() - Date.parse(lastBed.completedAt) < 20 * 3_600_000;
  const asleep = lastBed && fresh && (!lastWake || Date.parse(lastBed.completedAt) > Date.parse(lastWake.completedAt)) ? lastBed.completedAt : undefined;
  const lastHours = week.find((night) => night.date === today);
  const average = week.length ? Math.round(week.reduce((sum, night) => sum + night.hours, 0) / week.length * 10) / 10 : undefined;
  return {
    configured: true,
    bedtimeHabitId: bedtime.id,
    wakeHabitId: wake.id,
    last: lastHours,
    asleepSince: asleep,
    wokeAt: todaysWake?.completedAt,
    week,
    averageHours: average,
  };
}

/** Включает подсчёт сна: две привычки-события. Уже настроенные роли не трогаем, ничего не дублируем. */
export function enableSleepTracking(state: TrackerState, today: string): TrackerState {
  const hasBedtime = state.habits.some((habit) => live(habit) && habit.eventRole === "bedtime");
  const hasWake = state.habits.some((habit) => live(habit) && habit.eventRole === "wake");
  if (hasBedtime && hasWake) return state;
  const added: Habit[] = [];
  if (!hasBedtime) added.push({ id: sleepHabitIds.bedtime, title: "Лёг спать", type: "sleep", schedule: "вечером", eventRole: "bedtime", createdAt: today });
  if (!hasWake) added.push({ id: sleepHabitIds.wake, title: "Проснулся", type: "sleep", schedule: "утром", eventRole: "wake", createdAt: today });
  // Если привычка с таким id уже есть (например, в архиве или без роли), даём ей роль, а не заводим вторую с тем же id.
  const habits = state.habits.map((habit) => {
    const replacement = added.find((item) => item.id === habit.id);
    return replacement ? { ...habit, archived: false, eventRole: replacement.eventRole } : habit;
  });
  const fresh = added.filter((item) => !state.habits.some((habit) => habit.id === item.id));
  return { ...state, habits: [...habits, ...fresh] };
}

/** Отметка «лёг» или «проснулся» на сегодня. Повторное нажатие отменяет отметку этого дня. */
export function markSleepEvent(state: TrackerState, role: "bedtime" | "wake", today: string, now = new Date()): TrackerState {
  const habit = state.habits.find((item) => live(item) && item.eventRole === role);
  if (!habit) return state;
  const exists = state.completions.some((c) => c.habitId === habit.id && c.localDate === today && c.outcome !== "skipped");
  return changeHabit(state, habit.id, today, exists ? "cancelled" : "completed", now);
}

/** «7 ч 30 мин» вместо «7,5». */
export function formatSleep(hours: number): string {
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return m === 0 ? `${h} ч` : h === 0 ? `${m} мин` : `${h} ч ${m} мин`;
}
