"use client";

import { Bell } from "lucide-react";
import { AppSelect } from "./app-select";
import { useTrackerState } from "./tracker-state";
import { SettingsInput } from "./settings-input";
import { Notice } from "./ui";
import { habitAnchors, reminderStatus } from "@/lib/habits";
import type { Habit } from "@/lib/tracker";

const delayPresets = [0, 15, 30, 60, 90, 120, 180, 240];
const maxDelay = 1440;
const delayLabel = (minutes: number) => minutes === 0 ? "Сразу" : minutes < 60 ? `${minutes} мин` : minutes % 60 === 0 ? `${minutes / 60} ч` : `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`;

/** По умолчанию привязываем к ближайшему выше по списку приёму пищи, иначе к ближайшему действию выше, иначе к первому доступному. */
function defaultAnchor(all: Habit[], anchors: Habit[], habitId: string): Habit | undefined {
  const above = all.slice(0, Math.max(0, all.findIndex((item) => item.id === habitId))).reverse().filter((item) => anchors.some((anchor) => anchor.id === item.id));
  return above.find((item) => item.type === "meal") ?? above[0] ?? anchors[0];
}

/** Все напоминания в одном месте: включить, выбрать «в такое-то время» или «после другого действия». */
export function ReminderSettings() {
  const { state, update } = useTrackerState();
  if (!state) return null;
  const habits = state.habits.filter((habit) => !habit.archived && habit.type !== "workout");
  const edit = (id: string, patch: Partial<Habit>) => update((previous) => ({ ...previous, habits: previous.habits.map((habit) => habit.id === id ? { ...habit, ...patch } : habit) }));
  const waiting = habits.filter((habit) => reminderStatus(habit) === "needs-time").length;
  const ready = habits.filter((habit) => reminderStatus(habit) === "ready").length;
  return <section className="settingsSection reminderSettings" aria-labelledby="reminders-heading">
    <header className="sectionHeading"><h2 id="reminders-heading">Напоминания</h2><span className="muted">{ready} включено</span></header>
    <p className="muted">Сообщение приходит в Telegram. Либо в заданное время по Москве, либо после того, как вы отметили другое действие, например завтрак. Выполненное действие напоминание отменяет. В сообщении будет название привычки, поэтому называйте её действием: «Выпить аргинин».</p>
    {waiting > 0 && <Notice tone="warning">Без времени или привязки напоминание не придёт. Настройте отмеченные ниже ({waiting}).</Notice>}
    <ul className="reminderList">
      {habits.map((habit) => {
        const status = reminderStatus(habit);
        const enabled = habit.reminderEnabled ?? false;
        const after = Boolean(habit.afterHabitId);
        const anchors = habitAnchors(state.habits, habit.id);
        const delay = habit.delayMinutes ?? 0;
        const hours = Math.floor(delay / 60);
        const minutes = delay % 60;
        const setDelay = (total: number) => edit(habit.id, { delayMinutes: Math.max(0, Math.min(maxDelay, Math.round(total))) });
        const anchorTitle = state.habits.find((item) => item.id === habit.afterHabitId)?.title ?? "другого действия";
        const summary = !enabled ? "выключено" : after ? `${delay === 0 ? "сразу" : `через ${delayLabel(delay)}`} после «${anchorTitle}»` : status === "ready" ? `каждый день в ${habit.time}` : "";
        return <li key={habit.id} className={`${status}${enabled ? " open" : ""}`}>
          <div className="reminderTop">
            <label className="reminderToggle">
              <input type="checkbox" aria-label={`Напоминание: ${habit.title}`} checked={enabled} onChange={(event) => edit(habit.id, { reminderEnabled: event.target.checked })} />
              <span><strong>{habit.title}</strong>{summary ? <small>{summary}</small> : <small className="warn">нужно время</small>}</span>
            </label>
          </div>
          {enabled && <div className="reminderBody">
            <div className="settingsTabs tabs2" role="group" aria-label={`Когда напоминать: ${habit.title}`}>
              <button type="button" aria-pressed={!after} onClick={() => edit(habit.id, { afterHabitId: undefined })}>В своё время</button>
              <button type="button" aria-pressed={after} disabled={!anchors.length} onClick={() => edit(habit.id, { afterHabitId: defaultAnchor(state.habits, anchors, habit.id)?.id, delayMinutes: habit.delayMinutes ?? 0 })}>После действия</button>
            </div>
            {after ? <>
              <label className="fieldLabel">После какого действия<AppSelect value={habit.afterHabitId ?? ""} onChange={(value) => edit(habit.id, { afterHabitId: value })}>{anchors.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</AppSelect></label>
              <div className="delayChips" role="group" aria-label={`Через сколько напомнить: ${habit.title}`}>
                {delayPresets.map((preset) => <button type="button" key={preset} aria-pressed={delay === preset} onClick={() => setDelay(preset)}>{delayLabel(preset)}</button>)}
              </div>
              <div className="delayCustom" role="group" aria-label={`Своё время задержки: ${habit.title}`}>
                <span className="delayCustomTitle">Своё время</span>
                <label><SettingsInput numeric="reps" min={0} max={24} value={hours} onCommit={(value) => setDelay(Number(value) * 60 + minutes)} /><span>ч</span></label>
                <label><SettingsInput numeric="reps" min={0} max={59} value={minutes} onCommit={(value) => setDelay(hours * 60 + Number(value))} /><span>мин</span></label>
              </div>
              <p className="fieldHint muted">Напоминание придёт после того, как вы отметите «{anchorTitle}» на экране «Сегодня»{delay > 0 ? `, спустя ${delayLabel(delay)}` : ""}.</p>
            </> : <label className="fieldLabel">Время (по Москве)<input className="reminderTime" type="time" aria-label={`Время напоминания: ${habit.title}`} value={habit.time ?? ""} onChange={(event) => edit(habit.id, { time: event.target.value })} /></label>}
          </div>}
        </li>;
      })}
    </ul>
    {!habits.length && <p className="muted"><Bell size={16} /> Добавьте привычку на вкладке «Привычки», чтобы настроить напоминание.</p>}
  </section>;
}
