"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Clock, Dumbbell, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { AppNav } from "@/components/app-nav";
import { useTrackerState } from "@/components/tracker-state";
import { visibleCopy } from "@/lib/tracker";
import { startWorkoutSession, type SessionTrackerState } from "@/lib/workout-session";

export default function TemplatePage({ params }: { params: Promise<{ templateId: string }> }) {
  const router = useRouter();
  const { state, update } = useTrackerState();
  const [routeTemplateId, setRouteTemplateId] = useState<string>();
  useEffect(() => { void params.then(({ templateId }) => setRouteTemplateId(templateId)); }, [params]);
  if (!state) return <main className="shell"><p className="muted">Загружаю программу…</p></main>;
  const sessionState = state as SessionTrackerState;
  const template = sessionState.workoutTemplates?.find((item) => item.id === routeTemplateId);
  if (!template) return <main className="shell"><LinkBack /><section className="emptyState"><h2>Программа не найдена</h2><p>Она могла быть удалена или ещё не сохранена.</p></section></main>;
  const start = () => {
    const latest = (sessionState.workoutSessions ?? []).filter((s) => s.status === "completed").at(-1);
    if (latest && (Date.now() - Date.parse(latest.finishedAt ?? latest.startedAt)) < 48 * 3600_000 && !window.confirm("Между тренировками рекомендуется полный день отдыха. Всё равно начать?")) return;
    let sessionId: string | undefined;
    const saved = update((previous) => { const result = startWorkoutSession(previous as SessionTrackerState, template.id); if (!result) return previous; sessionId = result.sessionId; return result.state; });
    if (saved && sessionId) router.push(`/workout/${sessionId}`);
  };
  return <main className="shell appPage"><LinkBack /><header className="pageHeader"><div><p className="eyebrow">Программа</p><h1>{template.title}</h1><p className="muted">Проверь сохранённые рабочие веса перед стартом.</p></div><Dumbbell size={28} /></header>
    <Link className="secondary editLink" href={`/settings?section=program&program=${template.id}`}>Редактировать программу</Link>
    <section className="templateList">{template.exercises.map((exercise) => { const details = [exercise.muscleGroup, exercise.equipment, exercise.equipmentPosition].map((value) => visibleCopy(value)).filter(Boolean).join(" · "); const hint = visibleCopy(exercise.settings); return <article className="templateExercise" key={exercise.id}><div><h2>{exercise.name}</h2>{(details || hint) && <p>{details || hint}</p>}</div><div className="templateStats">{exercise.sets.map((set,index) => <span key={set.id}>{index+1}: {set.weightKg ?? "—"} кг × {set.reps ?? "—"}{set.weightMode === "per-hand" ? " · на сторону" : set.weightMode === "total" ? " · общий" : " · режим не указан"}</span>)}<span><Clock size={14} /> {exercise.restSec ?? 180} сек отдых</span></div></article>; })}</section>
    <button className="primary startWorkout" onClick={start} disabled={!template.exercises.length || template.exercises.some((e) => !e.sets.length)}><Play size={20} fill="currentColor" /> Начать тренировку</button><AppNav active="workouts" /></main>;
}

function LinkBack() { return <a className="backLink" href="/workouts"><ArrowLeft size={18} /> Тренировки</a>; }
