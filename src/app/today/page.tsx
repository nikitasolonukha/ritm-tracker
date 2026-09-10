"use client";

import Link from "next/link";
import { ArrowRight, Check, Dumbbell, Settings2 } from "lucide-react";
import { AppNav } from "@/components/app-nav";
import { useTrackerState } from "@/components/tracker-state";
import type { SessionTrackerState } from "@/lib/workout-session";
import { calculateWorkoutTotals, getLocalDate } from "@/lib/tracker";

const weekday = new Intl.DateTimeFormat("ru-RU", { weekday: "short", timeZone: "Europe/Moscow" });

export default function TodayPage() {
  const { state, update, storageError } = useTrackerState();
  if (!state) return <main className="shell"><p>Загружаю день…</p></main>;
  const sessionState = state as SessionTrackerState;
  const today = getLocalDate();
  const active = sessionState.workoutSessions?.find((item) => item.status === "active");
  const actionable = state.habits.filter((habit) => habit.type !== "workout");
  const pending = actionable.filter((habit) => !state.completions.some((item) => item.habitId === habit.id && item.localDate === today));
  const weekDates = new Set(Array.from({ length: 7 }, (_, index) => { const date = new Date(`${today}T12:00:00`); const mondayOffset = (date.getDay() + 6) % 7; date.setDate(date.getDate() - mondayOffset + index); return getLocalDate(date); }));
  const finishedSessions = (sessionState.workoutSessions ?? []).filter((item) => {
    if (item.status !== "completed") return false;
    const workout = state.workouts.find((candidate) => candidate.id === item.workoutId);
    return Boolean(workout && weekDates.has(workout.date) && calculateWorkoutTotals(workout).completedSets > 0);
  }).length;
  const dates = Array.from({ length: 7 }, (_, index) => { const date = new Date(`${today}T12:00:00`); date.setDate(date.getDate() - (6 - index)); return getLocalDate(date); });
  const currentAction = pending[0];
  const complete = (habitId: string) => update((previous) => ({ ...previous, completions: [...previous.completions, { id: `completion-${habitId}-${today}`, habitId, completedAt: new Date().toISOString(), localDate: today, source: "web" }] }));
  return <main className="shell appPage todayPage">
    <header className="pageHeader"><div><p className="eyebrow">{formatDate(today)}</p><h1>Сегодня</h1></div><Link className="iconButton" href="/settings" aria-label="Настройки"><Settings2 size={20} /></Link></header>
    {storageError && <p className="storageMessage" role="alert">{storageError}</p>}
    <section className="weekStrip" aria-label="Неделя">{dates.map((date) => { const isToday = date === today; const activeDate = state.completions.some((item) => item.localDate === date) || state.workouts.some((workout) => workout.date === date && calculateWorkoutTotals(workout).completedSets > 0); return <div className={`dayCapsule${isToday ? " today" : ""}`} key={date}><span>{weekday.format(new Date(`${date}T12:00:00`)).replace(".", "")}</span><strong>{date.slice(-2)}</strong>{activeDate && <i aria-label="Есть активность" />}</div>; })}</section>
    {active && <Link className="resumeBanner" href={`/workout/${active.id}`}><Dumbbell size={21} /><span><strong>Тренировка идёт</strong><small>Продолжить текущий подход</small></span><ArrowRight size={21} /></Link>}
    <section className="todayHero"><p className="eyebrow">Сейчас</p><h2>{currentAction ? currentAction.title : "День закрыт"}</h2><p>{currentAction ? currentAction.schedule === "настроить" ? "Следующее действие ждёт отметки" : currentAction.schedule : "Все запланированные действия отмечены"}</p><div>{currentAction ? <button className="primary" onClick={() => complete(currentAction.id)}><Check size={19} /> Отметить выполненным</button> : <span className="heroDone"><Check size={18} /> Сохранено за сегодня</span>}</div></section>
    <section className="actionSection"><div className="sectionHeading"><div><p className="eyebrow">Ритм дня</p><h2>Остальные действия</h2></div><span className="muted">{actionable.length - pending.length} из {actionable.length}</span></div><div className="todayActions">{actionable.filter((habit) => habit.id !== currentAction?.id).map((habit) => { const done = !pending.includes(habit); return <button className={`actionCard${done ? " done" : ""}`} key={habit.id} onClick={() => done ? update((previous) => ({ ...previous, completions: previous.completions.filter((item) => !(item.habitId === habit.id && item.localDate === today)) })) : complete(habit.id)}><span><strong>{habit.title}</strong><small>{habit.schedule === "настроить" ? "Время не задано" : habit.schedule}</small></span><span className="checkMark">{done && <Check size={17} />}</span></button>; })}</div></section>
    <section className="goalCard"><div><p className="eyebrow">Недельная цель</p><h2><strong>{Math.min(finishedSessions, 3)}</strong> из 3 тренировок</h2><p>Считаются только завершённые занятия.</p></div><div className="goalSegments">{[0, 1, 2].map((item) => <span className={item < Math.min(finishedSessions, 3) ? "filled" : ""} key={item} />)}</div></section>
    <AppNav active="today" />
  </main>;
}

function formatDate(value: string) { return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: "Europe/Moscow" }).format(new Date(`${value}T12:00:00`)); }
