"use client";

import Link from "next/link";
import { ArrowRight, Check, Dumbbell } from "lucide-react";
import { AppNav } from "@/components/app-nav";
import { useTrackerState } from "@/components/tracker-state";
import type { SessionTrackerState } from "@/lib/workout-session";
import { getLocalDate } from "@/lib/tracker";

export default function TodayPage() {
  const { state, update, storageError } = useTrackerState();
  if (!state) return <main className="shell"><p>Загружаю день…</p></main>;
  const sessionState = state as SessionTrackerState;
  const active = sessionState.workoutSessions?.find((item) => item.status === "active");
  const today = getLocalDate();
  const done = state.completions.filter((item) => item.localDate === today).length;
  return <main className="shell appPage"><header className="pageHeader"><div><p className="eyebrow">{today}</p><h1>Сегодня</h1></div></header>{storageError && <p className="storageMessage" role="alert">{storageError}</p>}{active && <Link className="resumeBanner" href={`/workout/${active.id}`}><Dumbbell size={21} /><span><strong>Тренировка идёт</strong><small>Вернуться к текущему подходу</small></span><ArrowRight size={21} /></Link>}<section className="todayHero"><p className="eyebrow">Ритм дня</p><strong>{done}</strong><span>отметок сегодня</span></section><section className="panel"><div className="panelTitle"><h2>Действия дня</h2><Check size={20} /></div><div className="todayActions">{state.habits.filter((habit) => habit.type !== "workout").map((habit) => { const completed = state.completions.some((item) => item.habitId === habit.id && item.localDate === today); return <button className={`habitRow${completed ? " done" : ""}`} key={habit.id} onClick={() => update((previous) => completed ? { ...previous, completions: previous.completions.filter((item) => !(item.habitId === habit.id && item.localDate === today)) } : { ...previous, completions: [...previous.completions, { id: `completion-${habit.id}-${today}`, habitId: habit.id, completedAt: new Date().toISOString(), localDate: today, source: "web" }] })}><span>{habit.title}</span><time>{completed ? "Готово" : habit.schedule}</time></button>; })}</div></section><AppNav active="today" /></main>;
}
