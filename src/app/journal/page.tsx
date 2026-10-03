"use client";

import Link from "next/link";
import { ArrowRight, CalendarDays, Upload } from "lucide-react";
import { AppNav } from "@/components/app-nav";
import { useTrackerState } from "@/components/tracker-state";
import { EmptyState, HeaderAction, PageHeader } from "@/components/ui";
import { calculateWorkoutTotals, formatLocalDate, russianWord } from "@/lib/tracker";
import type { SessionTrackerState } from "@/lib/workout-session";

export default function JournalPage() {
  const { state } = useTrackerState();
  if (!state) return <main className="shell"><p>Загружаю журнал…</p></main>;
  const sessionState = state as SessionTrackerState;
  const completedSessions = (sessionState.workoutSessions ?? []).filter((item) => item.status === "completed");
  const completed = state.workouts.filter((workout) => calculateWorkoutTotals(workout).completedSets > 0 && !((sessionState.workoutSessions ?? []).some((session) => session.workoutId === workout.id && (session.status === "active" || session.status === "cancelled")))).map((workout) => ({ session: completedSessions.find((item) => item.workoutId === workout.id), workout })).sort((a, b) => b.workout.date.localeCompare(a.workout.date));
  const cancelled = state.workouts.filter((w) => sessionState.workoutSessions?.some((s) => s.workoutId===w.id && s.status === "cancelled"));
  return <main className="shell appPage"><PageHeader eyebrow="История" title="Журнал" actions={<HeaderAction href="/journal/import" icon={Upload} label="Импорт" ariaLabel="Импорт тренировок" />} /><div className="journalLinks"><Link className="historyCard" href="/calendar"><div><h2>Календарь</h2><p>Дни и серии</p></div><ArrowRight size={20} /></Link><Link className="historyCard" href="/exercises"><div><h2>Упражнения</h2><p>Рекорды и графики</p></div><ArrowRight size={20} /></Link></div><section className="historyList">{completed.map(({ workout }) => { const totals = calculateWorkoutTotals(workout); return <Link className="historyCard" href={`/journal/workouts/${workout.id}`} key={workout.id}><div><span>{formatLocalDate(workout.date)}</span><h2>{workout.title}</h2><p>{totals.completedSets} {russianWord(totals.completedSets, "подход", "подхода", "подходов")} · {totals.volumeKg.toLocaleString("ru-RU")} кг</p></div><ArrowRight size={20} /></Link>; })}</section>{!completed.length && <EmptyState icon={CalendarDays} title="История появится после первой тренировки" action={<Link className="primary" href="/workouts">Выбрать программу</Link>} />}{cancelled.length>0 && <details className="exerciseDisclosure"><summary>Отменённые тренировки</summary>{cancelled.map((w) => <Link className="historyCard" key={w.id} href={`/journal/workouts/${w.id}`}><span>{formatLocalDate(w.date)} · {w.title}</span><ArrowRight size={18} /></Link>)}</details>}<AppNav active="journal" /></main>;
}
