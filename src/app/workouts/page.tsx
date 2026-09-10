"use client";

import Link from "next/link";
import { ArrowRight, Dumbbell, Settings2 } from "lucide-react";
import { AppNav } from "@/components/app-nav";
import { useTrackerState } from "@/components/tracker-state";
import type { SessionTrackerState } from "@/lib/workout-session";

export default function WorkoutsPage() {
  const { state } = useTrackerState();
  if (!state) return <main className="shell"><p className="muted">Загружаю программы…</p></main>;
  const sessionState = state as SessionTrackerState;
  const active = sessionState.workoutSessions?.find((item) => item.status === "active");
  const templates = sessionState.workoutTemplates ?? [];
  return <main className="shell appPage"><header className="pageHeader"><div><p className="eyebrow">Режим</p><h1>Тренировки</h1></div><Link className="iconButton" href="/settings" aria-label="Настройки"><Settings2 size={20} /></Link></header>
    {active && <Link className="resumeBanner" href={`/workout/${active.id}`}><span><strong>Тренировка идёт</strong><small>Продолжить текущую сессию</small></span><ArrowRight size={22} /></Link>}
    <section className="sectionHeading"><div><p className="eyebrow">Мои программы</p><h2>Выбери план</h2></div><span className="muted">{templates.length} программ</span></section>
    <div className="programList">{templates.map((template) => <Link className="programCard" href={`/workouts/templates/${template.id}`} key={template.id}><div className="programIcon"><Dumbbell size={22} /></div><div><h3>{template.title}</h3><p>{template.exercises.length} упражнений · 4 рабочих подхода</p><small>Последняя запись: {sessionState.workouts.filter((item) => item.id !== template.id && item.title === template.title).at(-1)?.date ?? "нет данных"}</small></div><ArrowRight size={20} /></Link>)}</div>
    {!templates.length && <section className="emptyState"><Dumbbell size={28} /><h2>Программ пока нет</h2><p>Создай программу в настройках, затем начни первую сессию.</p><Link className="primary" href="/settings">Открыть настройки</Link></section>}
    <AppNav active="workouts" /></main>;
}
