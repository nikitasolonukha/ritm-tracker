import { applyHabitCompletion, getHabitCommandIdentity, type Habit, type HabitCompletion } from "./tracker.ts";
import type { TrackerState } from "./storage.ts";

export function habitsForDate(habits: Habit[], localDate: string): Habit[] {
  const weekday = new Date(`${localDate}T12:00:00Z`).getUTCDay();
  return habits.filter((habit) => !habit.archived && habit.type !== "workout" && (!habit.daysOfWeek?.length || habit.daysOfWeek.includes(weekday)));
}

export function habitAnchors(habits: Habit[], habitId: string): Habit[] {
  const byId = new Map(habits.map((habit) => [habit.id, habit]));
  return habits.filter((habit) => {
    if (habit.id === habitId || habit.archived || habit.type === "workout") return false;
    const visited = new Set([habitId]);
    let cursor: Habit | undefined = habit;
    while (cursor) {
      if (visited.has(cursor.id)) return false;
      visited.add(cursor.id);
      cursor = cursor.afterHabitId ? byId.get(cursor.afterHabitId) : undefined;
    }
    return true;
  });
}
export function changeHabit(state: TrackerState, habitId: string, date: string, action: "completed" | "cancelled" | "skipped", now = new Date()): TrackerState {
  if (!state.habits.some((item) => item.id === habitId && !item.archived)) return state;
  const existing = state.completions.find((item) => item.habitId === habitId && item.localDate === date);
  if (action === "cancelled" ? !existing : existing && (existing.outcome ?? "completed") === action) return state;
  const entityId = `habit:${habitId}:${date}`;
  const version = state.outbox.filter((item) => item.entityId === entityId).length + 1;
  const command = getHabitCommandIdentity(habitId, date, action === "cancelled" ? "cancelled" : "completed", version);
  const completions = action === "cancelled" ? state.completions.filter((item) => !(item.habitId === habitId && item.localDate === date))
    : applyHabitCompletion(state.completions.filter((item) => !(item.habitId === habitId && item.localDate === date)), { id: `completion-${habitId}-${date}`, habitId, localDate: date, completedAt: now.toISOString(), source: "web", outcome: action });
  return { ...state, completions, outbox: [...state.outbox, { id: command.id, entityId, type: action === "cancelled" ? "habit.cancelled" : "habit.completed", createdAt: now.toISOString(), version, status: "pending", payload: { habitId, localDate: date, action } }] };
}
export function snoozeHabit(state: TrackerState, habitId: string, date: string, now = new Date()): TrackerState {
  const prior = state.habitSnoozes?.find((s) => s.habitId===habitId && s.localDate===date);
  if ((prior?.count ?? 0)>=3 || state.completions.some((c) => c.habitId===habitId && c.localDate===date)) return state;
  const snooze={ id:`snooze-${habitId}-${date}`,habitId,localDate:date,dueAt:new Date(now.getTime()+10*60_000).toISOString(),count:(prior?.count ?? 0)+1 };
  return { ...state,habitSnoozes:[...(state.habitSnoozes ?? []).filter((s) => s.id!==snooze.id),snooze] };
}
export function sleepFromEvents(habits: Habit[], completions: HabitCompletion[], date: string): number | undefined {
  const wakeIds = new Set(habits.filter((h) => h.eventRole === "wake").map((h) => h.id));
  const sleepIds = new Set(habits.filter((h) => h.eventRole === "bedtime").map((h) => h.id));
  const wake = completions.filter((c) => c.localDate === date && wakeIds.has(c.habitId) && c.outcome !== "skipped").at(-1);
  if (!wake) return;
  const wakeAt = Date.parse(wake.completedAt);
  const bedtime = completions.filter((c) => sleepIds.has(c.habitId) && c.outcome !== "skipped" && Date.parse(c.completedAt) < wakeAt).sort((a,b) => Date.parse(b.completedAt) - Date.parse(a.completedAt))[0];
  if (!bedtime) return;
  const hours = (wakeAt - Date.parse(bedtime.completedAt)) / 3_600_000;
  return hours > 0 && hours <= 24 ? Math.round(hours * 10) / 10 : undefined;
}

/** Готово ли напоминание: серверный планировщик создаёт его только при заданном времени или привязке к другому действию. */
export function reminderStatus(habit: Habit): "off" | "ready" | "needs-time" {
  if (!habit.reminderEnabled || habit.archived || habit.type === "workout") return "off";
  if (habit.afterHabitId) return "ready";
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(habit.time ?? "") ? "ready" : "needs-time";
}
