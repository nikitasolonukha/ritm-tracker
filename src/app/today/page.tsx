"use client";

import Link from "next/link";
import { ArrowRight, Check, Dumbbell } from "lucide-react";
import { AppNav } from "@/components/app-nav";
import { useTrackerState } from "@/components/tracker-state";
import type { SessionTrackerState } from "@/lib/workout-session";
import { getLocalDate } from "@/lib/tracker";

export default function TodayPage() {
  const { state } = useTrackerState();
  if (!state) return <main className="shell"><p>Загружаю день…</p></main>;
  const sessionState = state as SessionTrackerState;
  const active = sessionState.workoutSessions?.find((item) => item.status === "active");
  const today = getLocalDate();
  const done = state.completions.filter((item) => item.localDate === today).length;
  return <main className="shell appPage"><header className="pageHeader"><div><p className="eyebrow">{today}</p><h1>Сегодня</h1></div></header>{active && <Link className="resumeBanner" href={`/workout/${active.id}`}><Dumbbell size={21} /><span><strong>Тренировка идёт</strong><small>Вернуться к текущему подходу</small></span><ArrowRight size={21} /></Link>}<section className="todayHero"><p className="eyebrow">Ритм дня</p><strong>{done}</strong><span>отметок сегодня</span></section><section className="panel"><div className="panelTitle"><h2>Действия дня</h2><Check size={20} /></div>{state.habits.filter((habit) => habit.type !== "workout").map((habit) => <div className="habitRow" key={habit.id}><span>{habit.title}</span><time>{habit.schedule}</time></div>)}</section><AppNav active="today" /></main>;
}
