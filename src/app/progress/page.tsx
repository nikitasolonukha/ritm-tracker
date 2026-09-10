"use client";

import Link from "next/link";
import { Activity, ArrowRight } from "lucide-react";
import { AppNav } from "@/components/app-nav";
import { useTrackerState } from "@/components/tracker-state";
import { calculateWorkoutTotals } from "@/lib/tracker";

export default function ProgressPage() {
  const { state } = useTrackerState();
  if (!state) return <main className="shell"><p>Считаю показатели…</p></main>;
  const workouts = state.workouts.filter((item) => calculateWorkoutTotals(item).completedSets > 0);
  const volume = workouts.reduce((sum, item) => sum + calculateWorkoutTotals(item).volumeKg, 0);
  return <main className="shell appPage"><header className="pageHeader"><div><p className="eyebrow">Показатели</p><h1>Прогресс</h1></div><Activity size={26} /></header><div className="summaryMetrics"><div><strong>{workouts.length}</strong><span>тренировок</span></div><div><strong>{volume.toLocaleString("ru-RU")}</strong><span>кг объём</span></div><div><strong>{state.completions.length}</strong><span>отметок</span></div></div><Link className="resumeBanner" href="/journal"><span><strong>Открыть журнал</strong><small>Смотреть каждую сессию отдельно</small></span><ArrowRight size={20} /></Link><AppNav active="progress" /></main>;
}
