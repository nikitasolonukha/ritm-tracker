"use client";

import Link from "next/link";
import { ArrowLeft, Check, Dumbbell } from "lucide-react";
import { useTrackerState } from "@/components/tracker-state";
import { calculateWorkoutTotals } from "@/lib/tracker";
import type { SessionTrackerState } from "@/lib/workout-session";
import { useEffect, useState } from "react";

export default function WorkoutSummaryPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { state } = useTrackerState();
  const [routeSessionId, setRouteSessionId] = useState<string>();
  useEffect(() => { void params.then(({ sessionId }) => setRouteSessionId(sessionId)); }, [params]);
  if (!state) return <main className="shell"><p>Загружаю результат…</p></main>;
  const sessionState = state as SessionTrackerState;
  const session = sessionState.workoutSessions?.find((item) => item.id === routeSessionId);
  const workout = session && sessionState.workouts.find((item) => item.id === session.workoutId);
  const totals = calculateWorkoutTotals(workout);
  return <main className="shell appPage summaryPage"><Link className="backLink" href="/journal"><ArrowLeft size={18} /> Журнал</Link><section className="summaryHero"><Check size={34} /><p className="eyebrow">Тренировка завершена</p><h1>{workout?.title ?? "Тренировка"}</h1><p className="muted">{workout?.date}</p></section><div className="summaryMetrics"><div><strong>{totals.completedSets}</strong><span>подходов</span></div><div><strong>{totals.exercises}</strong><span>упражнений</span></div><div><strong>{totals.volumeKg.toLocaleString("ru-RU")}</strong><span>кг объём</span></div></div><Link className="primary" href={`/journal/workouts/${workout?.id ?? ""}`}><Dumbbell size={18} /> Открыть в журнале</Link></main>;
}
