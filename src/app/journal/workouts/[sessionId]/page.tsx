"use client";

import Link from "next/link";
import { ArrowLeft, Check } from "lucide-react";
import { useTrackerState } from "@/components/tracker-state";
import { calculateWorkoutTotals } from "@/lib/tracker";
import { useEffect, useState } from "react";

export default function JournalWorkoutPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { state } = useTrackerState();
  const [routeSessionId, setRouteSessionId] = useState<string>();
  useEffect(() => { void params.then(({ sessionId }) => setRouteSessionId(sessionId)); }, [params]);
  if (!state) return <main className="shell"><p>Загружаю запись…</p></main>;
  const workout = state.workouts.find((item) => item.id === routeSessionId);
  if (!workout) return <main className="shell"><Link className="backLink" href="/journal"><ArrowLeft size={18} /> Журнал</Link><p>Запись не найдена.</p></main>;
  const totals = calculateWorkoutTotals(workout);
  return <main className="shell appPage"><Link className="backLink" href="/journal"><ArrowLeft size={18} /> Журнал</Link><header className="pageHeader"><div><p className="eyebrow">{workout.date}</p><h1>{workout.title}</h1></div><strong>{totals.volumeKg.toLocaleString("ru-RU")} кг</strong></header>{workout.exercises.map((exercise) => <section className="panel" key={exercise.id}><div className="panelTitle"><h2>{exercise.name}</h2><span>{exercise.sets.filter((set) => set.completed).length}/{exercise.sets.length}</span></div>{exercise.sets.map((set) => <div className="historySet" key={set.id}><Check size={16} /><span>{set.weightKg ?? "—"} кг · {set.reps ?? "—"} повторений</span></div>)}</section>)}</main>;
}
