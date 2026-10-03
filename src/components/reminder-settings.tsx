"use client";

import { Bell } from "lucide-react";
import { useTrackerState } from "./tracker-state";
import { Notice } from "./ui";
import { reminderStatus } from "@/lib/habits";
import type { Habit } from "@/lib/tracker";

/** Все напоминания в одном месте: включить, задать время, сразу увидеть, какие из них ещё не сработают. */
export function ReminderSettings() {
  const { state, update } = useTrackerState();
  if (!state) return null;
  const habits = state.habits.filter((habit) => !habit.archived && habit.type !== "workout");
  const edit = (id: string, patch: Partial<Habit>) => update((previous) => ({ ...previous, habits: previous.habits.map((habit) => habit.id === id ? { ...habit, ...patch } : habit) }));
  const anchorTitle = (habit: Habit) => state.habits.find((item) => item.id === habit.afterHabitId)?.title;
  const waiting = habits.filter((habit) => reminderStatus(habit) === "needs-time").length;
  return <section className="settingsSection reminderSettings" aria-labelledby="reminders-heading">
    <header className="sectionHeading"><h2 id="reminders-heading">Напоминания</h2><span className="muted">{habits.filter((h) => reminderStatus(h) === "ready").length} включено</span></header>
    <p className="muted">Сообщение приходит в Telegram в указанное время по Москве или после другого действия. Выполненное действие напоминание отменяет.</p>
    {waiting > 0 && <Notice tone="warning">Без времени напоминание не придёт. Укажите время у отмеченных ниже ({waiting}).</Notice>}
    <ul className="reminderList">
      {habits.map((habit) => {
        const status = reminderStatus(habit);
        return <li key={habit.id} className={status}>
          <label className="reminderToggle">
            <input type="checkbox" aria-label={`Напоминание: ${habit.title}`} checked={habit.reminderEnabled ?? false} onChange={(event) => edit(habit.id, { reminderEnabled: event.target.checked })} />
            <span><strong>{habit.title}</strong>{habit.afterHabitId ? <small>после «{anchorTitle(habit) ?? "другого действия"}», через {habit.delayMinutes ?? 0} мин</small> : status === "needs-time" ? <small className="warn">нужно время</small> : status === "ready" ? <small>каждый день в {habit.time}</small> : <small>выключено</small>}</span>
          </label>
          {!habit.afterHabitId && <input className="reminderTime" type="time" aria-label={`Время напоминания: ${habit.title}`} value={habit.time ?? ""} onChange={(event) => edit(habit.id, { time: event.target.value })} />}
        </li>;
      })}
    </ul>
    {!habits.length && <p className="muted"><Bell size={16} /> Добавьте привычку на вкладке «Привычки», чтобы настроить напоминание.</p>}
  </section>;
}
