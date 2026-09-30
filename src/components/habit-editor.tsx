"use client";
import { Archive, RotateCcw } from "lucide-react";
import { SettingsInput } from "./settings-input";
import { useTrackerState } from "./tracker-state";
import type { Habit } from "@/lib/tracker";
import { habitAnchors } from "@/lib/habits";

export function HabitEditor({ habit }: { habit: Habit }) {
  const { state, update } = useTrackerState();
  const edit = (patch: Partial<Habit>) => update((previous) => ({ ...previous, habits: previous.habits.map((item) => item.id === habit.id ? { ...item, ...patch } : item) }));
  const days = [[1,"Пн"],[2,"Вт"],[3,"Ср"],[4,"Чт"],[5,"Пт"],[6,"Сб"],[0,"Вс"]] as const;
  const anchors = habitAnchors(state?.habits ?? [], habit.id);
  return <details className="exerciseDisclosure"><summary><span>{habit.title}</span><small>{habit.archived ? "В архиве" : habit.schedule || habit.time || "Каждый день"}</small></summary><div className="settingExercise habitEditor">
    <label>Название<SettingsInput value={habit.title} onCommit={(title) => { if (title.trim()) edit({ title: title.trim() }); }} /></label>
    <label>Тип<select value={habit.type} onChange={(e) => edit({ type: e.target.value as Habit["type"] })}><option value="habit">Привычка</option><option value="meal">Еда</option><option value="medicine">Моя схема приёма</option><option value="sleep">Сон</option><option value="workout">Недельная тренировка</option></select></label>
    <label>Событие<select value={habit.eventRole ?? ""} onChange={(e) => edit({ eventRole: (e.target.value || undefined) as Habit["eventRole"] })}><option value="">Обычное действие</option><option value="wake">Пробуждение</option><option value="bedtime">Лёг спать</option></select></label>
    <label>Личная заметка<SettingsInput value={habit.privateTitle} onCommit={(privateTitle) => edit({ privateTitle })} /></label>
    <fieldset className="weekdayPicker"><legend>Дни</legend>{days.map(([day,label]) => <label key={day}><input type="checkbox" checked={!habit.daysOfWeek?.length || habit.daysOfWeek.includes(day)} onChange={(e) => { const selected = habit.daysOfWeek?.length ? habit.daysOfWeek : days.map(([d]) => d); const next = e.target.checked ? [...selected, day] : selected.filter((d) => d !== day); if (next.length) edit({ daysOfWeek: [...new Set(next)] }); }} /><span>{label}</span></label>)}</fieldset>
    <label>Когда<select value={habit.afterHabitId ? "event" : "time"} onChange={(e) => edit(e.target.value === "time" ? { afterHabitId: undefined } : { afterHabitId: anchors[0]?.id })}><option value="time">В определённое время</option><option value="event" disabled={!anchors.length}>После другого действия</option></select></label>
    {habit.afterHabitId ? <><label>После<select value={habit.afterHabitId} onChange={(e) => edit({ afterHabitId: e.target.value })}>{anchors.map((h) => <option key={h.id} value={h.id}>{h.title}</option>)}</select></label><label>Через, минут<SettingsInput numeric="reps" max={1440} value={habit.delayMinutes ?? 0} onCommit={(v) => edit({ delayMinutes: Number(v) })} /></label></> : <label>Время (Москва)<input type="time" value={habit.time ?? ""} onChange={(e) => edit({ time: e.target.value })} /></label>}
    <label>Подпись расписания<SettingsInput value={habit.schedule === "настроить" ? "" : habit.schedule} onCommit={(schedule) => edit({ schedule })} placeholder="Необязательно" /></label>
    <label className="checkLabel"><input type="checkbox" checked={habit.reminderEnabled ?? false} onChange={(e) => edit({ reminderEnabled: e.target.checked })} /> Напоминать в Telegram</label>
    <button className="secondary" onClick={() => edit({ archived: !habit.archived })}>{habit.archived ? <RotateCcw size={18} /> : <Archive size={18} />}{habit.archived ? "Вернуть из архива" : "В архив"}</button>
  </div></details>;
}
