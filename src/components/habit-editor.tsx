"use client";

import { Archive, RotateCcw, Trash2 } from "lucide-react";
import { AppSelect } from "./app-select";
import { Button } from "./ds";
import { SettingsInput } from "./settings-input";
import { useTrackerState } from "./tracker-state";
import { useConfirm } from "./ui";
import { visibleCopy, type Habit } from "@/lib/tracker";
import { habitAnchors, reminderStatus } from "@/lib/habits";

const days = [[1, "Пн"], [2, "Вт"], [3, "Ср"], [4, "Чт"], [5, "Пт"], [6, "Сб"], [0, "Вс"]] as const;

export function HabitEditor({ habit }: { habit: Habit }) {
  const { state, update } = useTrackerState();
  const { confirm, dialog } = useConfirm();
  const edit = (patch: Partial<Habit>) => update((previous) => ({ ...previous, habits: previous.habits.map((item) => item.id === habit.id ? { ...item, ...patch } : item) }));
  const anchors = habitAnchors(state?.habits ?? [], habit.id);
  const remove = async () => {
    if (!(await confirm(`Удалить «${habit.title}» из плана? Уже поставленные отметки останутся в истории.`, { danger: true }))) return;
    update((previous) => ({ ...previous, habits: previous.habits.filter((item) => item.id !== habit.id).map((item) => item.afterHabitId === habit.id ? { ...item, afterHabitId: undefined } : item) }));
  };
  const summary = habit.archived ? "В архиве" : visibleCopy(habit.schedule) || habit.time || "Каждый день";
  return <details className="exerciseDisclosure editorCard">
    <summary><span>{habit.title}</span><small>{summary}</small></summary>
    <div className="settingExercise habitEditor">
      <section className="editorGroup">
        <h3>Основное</h3>
        <label>Название<SettingsInput value={habit.title} onCommit={(title) => { if (title.trim()) edit({ title: title.trim() }); }} /></label>
        <div className="twoCols">
          <label>Тип<AppSelect value={habit.type} onChange={(value) => edit({ type: value as Habit["type"] })}><option value="habit">Привычка</option><option value="meal">Еда</option><option value="medicine">Моя схема приёма</option><option value="sleep">Сон</option><option value="workout">Недельная тренировка</option></AppSelect></label>
          <label>Событие<AppSelect value={habit.eventRole ?? ""} onChange={(value) => edit({ eventRole: (value || undefined) as Habit["eventRole"] })}><option value="">Обычное действие</option><option value="wake">Пробуждение</option><option value="bedtime">Лёг спать</option></AppSelect></label>
        </div>
        <label>Личная заметка<SettingsInput value={habit.privateTitle} onCommit={(privateTitle) => edit({ privateTitle })} /></label>
      </section>
      <section className="editorGroup">
        <h3>Когда</h3>
        <fieldset className="weekdayPicker">
          <legend>Дни</legend>
          {days.map(([day, label]) => <label key={day} className="dayChip"><input type="checkbox" checked={!habit.daysOfWeek?.length || habit.daysOfWeek.includes(day)} onChange={(event) => { const selected = habit.daysOfWeek?.length ? habit.daysOfWeek : days.map(([d]) => d); const next = event.target.checked ? [...selected, day] : selected.filter((d) => d !== day); if (next.length) edit({ daysOfWeek: [...new Set(next)] }); }} /><span>{label}</span></label>)}
        </fieldset>
        <label>Когда<AppSelect value={habit.afterHabitId ? "event" : "time"} onChange={(value) => edit(value === "time" ? { afterHabitId: undefined } : { afterHabitId: anchors[0]?.id })}><option value="time">В определённое время</option><option value="event" disabled={!anchors.length}>После другого действия</option></AppSelect></label>
        {habit.afterHabitId
          ? <div className="twoCols">
            <label>После<AppSelect value={habit.afterHabitId} onChange={(value) => edit({ afterHabitId: value })}>{anchors.map((h) => <option key={h.id} value={h.id}>{h.title}</option>)}</AppSelect></label>
            <label>Через, минут<SettingsInput numeric="reps" max={1440} value={habit.delayMinutes ?? 0} onCommit={(v) => edit({ delayMinutes: Number(v) })} /></label>
          </div>
          : <label>Время (Москва)<input type="time" value={habit.time ?? ""} onChange={(event) => edit({ time: event.target.value })} /></label>}
        <label>Подпись расписания<SettingsInput value={habit.schedule === "настроить" ? "" : habit.schedule} onCommit={(schedule) => edit({ schedule })} placeholder="Необязательно" /></label>
      </section>
      <section className="editorGroup">
        <h3>Напоминание</h3>
        <label className="checkLabel switchLabel"><input type="checkbox" checked={habit.reminderEnabled ?? false} onChange={(event) => edit({ reminderEnabled: event.target.checked })} /> Напоминать в Telegram</label>
        {reminderStatus(habit) === "needs-time" && <p className="fieldError" role="status">Укажите время выше или привяжите к другому действию, иначе напоминание не придёт.</p>}
        {habit.type === "workout" && <p className="fieldHint muted">Эта привычка не стоит в списке отметок. На экране «Сегодня» она открывает тренировки. В недельную цель попадают только записанные подходы.</p>}
      </section>
      <div className="editorActions">
        <Button icon={habit.archived ? RotateCcw : Archive} onClick={() => edit({ archived: !habit.archived })}>{habit.archived ? "Вернуть из архива" : "В архив"}</Button>
        <Button variant="danger" icon={Trash2} onClick={() => void remove()}>Удалить привычку</Button>
      </div>
    </div>
    {dialog}
  </details>;
}
