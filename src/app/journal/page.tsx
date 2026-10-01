"use client";

import Link from "next/link";
import { ArrowRight, CalendarDays, Settings2, Upload } from "lucide-react";
import { AppNav } from "@/components/app-nav";
import { useTrackerState } from "@/components/tracker-state";
import { calculateWorkoutTotals } from "@/lib/tracker";
import type { SessionTrackerState } from "@/lib/workout-session";

export default function JournalPage() {
  const { state } = useTrackerState();
  if (!state) return <main className="shell"><p>Загружаю журнал…</p></main>;
  const sessionState = state as SessionTrackerState;
  const completedSessions = (sessionState.workoutSessions ?? []).filter((item) => item.status === "completed");
  const completed = state.workouts.filter((workout) => calculateWorkoutTotals(workout).completedSets > 0 && !((sessionState.workoutSessions ?? []).some((session) => session.workoutId === workout.id && (session.status === "active" || session.status === "cancelled")))).map((workout) => ({ session: completedSessions.find((item) => item.workoutId === workout.id), workout }));
  const cancelled = state.workouts.filter((w) => sessionState.workoutSessions?.some((s) => s.workoutId===w.id && s.status === "cancelled"));
  return <main className="shell appPage"><header className="pageHeader"><div><p className="eyebrow">История</p><h1>Журнал</h1></div><div className="headerActions"><Link className="iconButton" href="/settings" aria-label="Настройки"><Settings2 size={20} /></Link><Link className="secondary" href="/journal/import"><Upload size={18} />Импорт</Link></div></header><section className="historyList">{completed.map(({ workout }) => { const totals = calculateWorkoutTotals(workout); return <Link className="historyCard" href={`/journal/workouts/${workout.id}`} key={workout.id}><div><span>{workout.date}</span><h2>{workout.title}</h2><p>{totals.completedSets} подходов · {totals.volumeKg.toLocaleString("ru-RU")} кг</p></div><ArrowRight size={20} /></Link>; })}</section>{!completed.length && <section className="emptyState"><CalendarDays size={28} /><h2>История появится после первой тренировки</h2><Link className="primary" href="/workouts">Выбрать программу</Link></section>}{cancelled.length>0 && <details className="exerciseDisclosure"><summary>Отменённые тренировки</summary>{cancelled.map((w) => <Link className="historyCard" key={w.id} href={`/journal/workouts/${w.id}`}><span>{w.date} · {w.title}</span><ArrowRight size={18} /></Link>)}</details>}<AppNav active="journal" /></main>;
}
