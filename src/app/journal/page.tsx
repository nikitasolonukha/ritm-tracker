"use client";

import Link from "next/link";
import { ArrowRight, CalendarDays, Upload } from "lucide-react";
import { AppNav } from "@/components/app-nav";
import { ProgressTabs } from "@/components/ds";
import { useTrackerState } from "@/components/tracker-state";
import { EmptyState, HeaderAction, PageHeader } from "@/components/ui";
import { calculateWorkoutTotals, formatLocalDate, russianWord, type Workout } from "@/lib/tracker";
import type { SessionTrackerState } from "@/lib/workout-session";

const monthTitle = (date: string) => {
  const name = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${date.slice(0, 7)}-15T12:00:00Z`));
  return name.charAt(0).toUpperCase() + name.slice(1).replace(" г.", "");
};

function WorkoutCard({ workout }: { workout: Workout }) {
  const totals = calculateWorkoutTotals(workout);
  const exercises = workout.exercises.filter((exercise) => exercise.sets.some((set) => set.completed)).map((exercise) => exercise.name);
  return <Link className="historyCard" href={`/journal/workouts/${workout.id}`}>
    <div>
      <span>{formatLocalDate(workout.date)}</span>
      <h2>{workout.title}</h2>
      <p>{totals.completedLogicalSets} {russianWord(totals.completedLogicalSets, "подход", "подхода", "подходов")} · {totals.volumeKg.toLocaleString("ru-RU")} кг</p>
      {exercises.length > 0 && <p className="historyExercises">{exercises.join(" · ")}</p>}
    </div>
    <ArrowRight size={20} />
  </Link>;
}

export default function JournalPage() {
  const { state } = useTrackerState();
  if (!state) return <main className="shell"><p>Загружаю журнал…</p></main>;
  const sessionState = state as SessionTrackerState;
  const sessions = sessionState.workoutSessions ?? [];
  const isBlocked = (workoutId: string) => sessions.some((session) => session.workoutId === workoutId && (session.status === "active" || session.status === "cancelled"));
  const completed = state.workouts
    .filter((workout) => calculateWorkoutTotals(workout).completedSets > 0 && !isBlocked(workout.id))
    .sort((a, b) => b.date.localeCompare(a.date));
  const cancelled = state.workouts.filter((workout) => sessions.some((session) => session.workoutId === workout.id && session.status === "cancelled"));
  const months = [...new Set(completed.map((workout) => workout.date.slice(0, 7)))];
  return <main className="shell appPage">
    <PageHeader eyebrow="Прогресс" title="Журнал" actions={<HeaderAction href="/journal/import" icon={Upload} label="Импорт" ariaLabel="Импорт тренировок" />} />
    <ProgressTabs active="journal" />
    {months.map((month) => <section className="monthGroup" key={month}>
      <h2 className="monthTitle">{monthTitle(`${month}-01`)}</h2>
      <div className="historyList">{completed.filter((workout) => workout.date.startsWith(month)).map((workout) => <WorkoutCard workout={workout} key={workout.id} />)}</div>
    </section>)}
    {!completed.length && <EmptyState icon={CalendarDays} title="История появится после первой тренировки" action={<Link className="btn btn-primary" href="/workouts">Выбрать программу</Link>} />}
    {cancelled.length > 0 && <details className="exerciseDisclosure">
      <summary>Отменённые тренировки</summary>
      {cancelled.map((workout) => <Link className="historyCard" key={workout.id} href={`/journal/workouts/${workout.id}`}><span>{formatLocalDate(workout.date)} · {workout.title}</span><ArrowRight size={18} /></Link>)}
    </details>}
    <AppNav active="progress" />
  </main>;
}
