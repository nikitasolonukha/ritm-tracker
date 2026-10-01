"use client";

import Link from "next/link";
import { ArrowRight, Check, Clock, Dumbbell, Settings2, SkipForward, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AppNav } from "@/components/app-nav";
import { useTrackerState } from "@/components/tracker-state";
import type { SessionTrackerState } from "@/lib/workout-session";
import { calculateWorkoutTotals, getLocalDate, visibleCopy } from "@/lib/tracker";
import { changeHabit, habitsForDate, sleepFromEvents, snoozeHabit } from "@/lib/habits";

export default function TodayPage() {
  const { state, update, storageError } = useTrackerState();
  const today = getLocalDate();
  const [selectedDate, setSelectedDate] = useState(today);
  const weekRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const align = () => {
      const strip = weekRef.current;
      const target = strip?.querySelector<HTMLElement>(selectedDate === today ? ".dayCapsule.today" : ".dayCapsule.selected");
      if (!strip || !target) return;
      strip.scrollLeft = Math.max(0, target.offsetLeft - (strip.clientWidth - target.offsetWidth) / 2);
    };
    const frame = window.requestAnimationFrame(align);
    window.addEventListener("resize", align);
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener("resize", align); };
  }, [selectedDate, today, state]);
  if (!state) return <main className="shell"><p>Загружаю день…</p></main>;
  const sessionState = state as SessionTrackerState;
  const active = sessionState.workoutSessions?.find((item) => item.status === "active");
  const habits = habitsForDate(state.habits, selectedDate);
  const weekday = new Date(`${selectedDate}T12:00:00Z`).getUTCDay();
  const workoutHabits = state.habits.filter((habit) => !habit.archived && habit.type === "workout" && (!habit.daysOfWeek?.length || habit.daysOfWeek.includes(weekday)));
  const completed = habits.filter((h) => state.completions.some((c) => c.habitId === h.id && c.localDate === selectedDate && c.outcome !== "skipped")).length;
  const resolved = habits.filter((h) => state.completions.some((c) => c.habitId === h.id && c.localDate === selectedDate)).length;
  const monday = new Date(`${today}T12:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
  const weekStart = monday.toISOString().slice(0,10);
  const sessions = (sessionState.workoutSessions ?? []).filter((s) => s.status === "completed" && state.workouts.some((w) => w.id === s.workoutId && calculateWorkoutTotals(w).completedSets > 0));
  const finished = sessions.filter((s) => state.workouts.some((w) => w.id === s.workoutId && w.date >= weekStart && w.date <= today)).length;
  const dates = Array.from({ length: 7 }, (_, index) => { const date = new Date(`${today}T12:00:00Z`); date.setUTCDate(date.getUTCDate() - 6 + index); return date.toISOString().slice(0,10); });
  const sleep = sleepFromEvents(state.habits, state.completions, today);
  const lastObservation = state.observations.map((o) => o.date).sort().at(-1);
  const checkInDue = !lastObservation || (Date.parse(today) - Date.parse(lastObservation)) / 86_400_000 >= 3;
  const completedDays = [...new Set(state.completions.map((c) => c.localDate))].filter((date) => { const planned = habitsForDate(state.habits, date); return planned.length > 0 && planned.every((h) => state.completions.some((c) => c.habitId === h.id && c.localDate === date && c.outcome !== "skipped")); }).length;
  return <main className="shell appPage todayPage">
    <header className="pageHeader"><div><p className="eyebrow">{new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(new Date(`${selectedDate}T12:00:00Z`))}</p><h1>{selectedDate === today ? "Сегодня" : "Выбранный день"}</h1></div><Link className="iconButton" href="/settings" aria-label="Настройки"><Settings2 size={20} /></Link></header>
    {storageError && <p className="storageMessage" role="alert">{storageError}</p>}
    <section ref={weekRef} className="weekStrip" aria-label="Неделя">{dates.map((date) => <button type="button" className={`dayCapsule${date === today ? " today" : ""}${date === selectedDate ? " selected" : ""}`} aria-pressed={date === selectedDate} aria-label={new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long" }).format(new Date(`${date}T12:00:00Z`))} key={date} onClick={() => setSelectedDate(date)}><span>{new Intl.DateTimeFormat("ru-RU", { weekday: "short" }).format(new Date(`${date}T12:00:00Z`))}</span><strong>{date.slice(-2)}</strong>{state.completions.some((c) => c.localDate === date && c.outcome !== "skipped") && <i aria-label="Есть активность" />}</button>)}</section>
    {selectedDate !== today && <button className="secondary" type="button" onClick={() => setSelectedDate(today)}>Вернуться к сегодня</button>}
    {active && <Link className="resumeBanner" href={`/workout/${active.id}`}><Dumbbell size={21} /><span><strong>Тренировка идёт</strong><small>Продолжить текущий подход</small></span><ArrowRight size={21} /></Link>}
    {!habits.length ? <section className="emptyState"><h2>{selectedDate === today ? "Ваш ритм дня" : "В этот день привычек нет"}</h2>{selectedDate === today && <Link className="primary" href="/settings">Добавить привычки</Link>}</section> : <section className="actionSection"><div className="sectionHeading"><h2>{selectedDate === today && resolved === habits.length ? "План дня закрыт" : selectedDate === today ? "План дня" : "План на этот день"}</h2><span className="muted">{completed} из {habits.length} выполнено</span></div><div className="todayActions">{habits.map((habit) => {
      const mark = state.completions.find((c) => c.habitId === habit.id && c.localDate === selectedDate);
      const parent = state.habits.find((h) => h.id === habit.afterHabitId);
      const parentMark = parent && state.completions.find((c) => c.habitId === parent.id && c.localDate === selectedDate && c.outcome !== "skipped");
      const snooze=state.habitSnoozes?.find((s) => s.habitId===habit.id && s.localDate===selectedDate);
      const due = snooze ? new Date(snooze.dueAt) : parentMark ? new Date(Date.parse(parentMark.completedAt) + (habit.delayMinutes ?? 0) * 60_000) : undefined;
      const when = due ? `В ${new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" }).format(due)}` : parent ? `После: ${parent.title}` : habit.time || visibleCopy(habit.schedule);
      const note = visibleCopy(habit.privateTitle);
      return <div className={`dailyAction${mark ? " done" : ""}`} key={habit.id}><button className="actionCard" onClick={() => update((prev) => changeHabit(prev, habit.id, selectedDate, mark ? "cancelled" : "completed"))}><span><strong>{habit.title}</strong><small>{mark?.outcome === "skipped" ? "Пропущено" : mark ? "Выполнено" : when || (selectedDate === today ? "Сегодня" : "В этот день")}</small>{note && <small>{note}</small>}</span><span className="checkMark">{mark && (mark.outcome === "skipped" ? <SkipForward size={17} /> : <Check size={17} />)}</span></button><div className="dailyTools">{!mark && habit.reminderEnabled && <button className="secondary" aria-label={`Отложить ${habit.title} на 10 минут`} title="Отложить на 10 минут" disabled={(snooze?.count ?? 0)>=3} onClick={() => update((prev) => snoozeHabit(prev,habit.id,selectedDate))}><Clock size={17} />Отложить</button>}<button className="secondary" aria-label={mark ? `Отменить отметку ${habit.title}` : `Пропустить ${habit.title}`} onClick={() => update((prev) => changeHabit(prev, habit.id, selectedDate, mark ? "cancelled" : "skipped"))}>{mark ? <Undo2 size={17} /> : <SkipForward size={17} />}{mark ? "Отменить отметку" : "Пропустить"}</button></div></div>;
    })}</div></section>}
    {workoutHabits.length > 0 && <section className="actionSection"><div className="sectionHeading"><h2>Тренировка</h2></div>{workoutHabits.map((habit) => <Link className="actionCard" href="/workouts" key={habit.id}><span><strong>{habit.title}</strong><small>Открыть программы. В недельную цель она попадёт после записанных подходов.</small></span><ArrowRight size={18} /></Link>)}</section>}
    <section className="goalCard"><div><p className="eyebrow">Недельная цель</p><h2>{finished} из 3 тренировок</h2><p>Полный день отдыха между занятиями.</p></div><div className="goalSegments">{[0,1,2].map((i) => <span className={i < finished ? "filled" : ""} key={i} />)}</div></section>
    {sleep != null && <p className="muted">Сон по отметкам: {sleep} ч.</p>}
    {checkInDue && <Link className="resumeBanner" href="/progress"><span><strong>Как самочувствие?</strong><small>Короткая отметка за сегодня</small></span><ArrowRight size={20} /></Link>}
    {completedDays > 0 && <p className="muted">Полностью выполненных дней: {completedDays}. Следующая контрольная точка: {[14,28,60,90].find((d) => d > completedDays) ?? Math.ceil((completedDays + 1) / 30) * 30}.</p>}
    <AppNav active="today" />
  </main>;
}
