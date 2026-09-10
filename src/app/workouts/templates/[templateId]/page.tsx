"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, Clock, Dumbbell, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { AppNav } from "@/components/app-nav";
import { useTrackerState } from "@/components/tracker-state";
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
  const start = () => { const result = startWorkoutSession(sessionState, template.id); if (!result) return; update(() => result.state); router.push(`/workout/${result.sessionId}`); };
  return <main className="shell appPage"><LinkBack /><header className="pageHeader"><div><p className="eyebrow">Программа</p><h1>{template.title}</h1><p className="muted">Проверь сохранённые рабочие веса перед стартом.</p></div><Dumbbell size={28} /></header>
    <section className="templateList">{template.exercises.map((exercise) => { const first = exercise.sets[0]; return <article className="templateExercise" key={exercise.id}><div><h2>{exercise.name}</h2><p>{exercise.settings ?? "Настройки не указаны"}</p></div><div className="templateStats"><strong>{first?.weightKg ?? "—"}</strong><span>{first?.weightMode === "per-hand" ? "кг на сторону" : first?.weightMode === "total" ? "кг общий вес" : "вес уточнить"}</span><span>{exercise.sets.length}×{first?.reps ?? "—"}</span><span><Clock size={14} /> {exercise.restSec ?? 180} сек отдых</span></div></article>; })}</section>
    <button className="primary startWorkout" onClick={start}><Play size={20} fill="currentColor" /> Начать тренировку</button><AppNav active="workouts" /></main>;
}

function LinkBack() { return <a className="backLink" href="/workouts"><ArrowLeft size={18} /> Тренировки</a>; }
