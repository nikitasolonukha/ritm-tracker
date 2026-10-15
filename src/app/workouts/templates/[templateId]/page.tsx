"use client";

import Link from "next/link";
import { ArrowLeft, Clock, Pencil, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { AppNav } from "@/components/app-nav";
import { Button } from "@/components/ds";
import { useTrackerState } from "@/components/tracker-state";
import { EmptyState, HeaderAction, PageHeader } from "@/components/ui";
import { useStartWorkout } from "@/components/use-start-workout";
import { russianWord, visibleCopy, type Exercise, type ExerciseSet } from "@/lib/tracker";
import type { SessionTrackerState } from "@/lib/workout-session";
import { logicalSets } from "@/lib/workout-flow";

const modeLabel = (mode: ExerciseSet["weightMode"]) => mode === "per-hand" ? "на сторону" : mode === "total" ? "общий вес" : "";
const weightText = (set: ExerciseSet) => set.weightKg == null ? "вес не указан" : `${set.weightKg} кг${modeLabel(set.weightMode) ? ` · ${modeLabel(set.weightMode)}` : ""}`;

/** «4 × 8 · 12,5 кг» для обычных подходов и «2 × A 8·45 + B 12·20» для пар. Подряд идущие одинаковые подходы схлопываются. */
function planRows(exercise: Exercise) {
  const rows: Array<{ key: string; count: number; reps: string; detail: string }> = [];
  for (const group of logicalSets(exercise)) {
    const parts = group.parts.map((part) => part.set);
    const key = parts.map((set) => `${set.weightKg}|${set.reps}|${set.weightMode ?? ""}`).join("+");
    const last = rows.at(-1);
    if (last?.key === key) { last.count += 1; continue; }
    rows.push(group.paired
      ? { key, count: 1, reps: group.parts.map((part) => `${part.label} ${part.set.reps ?? "—"}`).join(" + "), detail: parts.map((set, index) => `${group.parts[index].label}: ${weightText(set)}`).join(" · ") }
      : { key, count: 1, reps: String(parts[0].reps ?? "—"), detail: weightText(parts[0]) });
  }
  return rows;
}

export default function TemplatePage({ params }: { params: Promise<{ templateId: string }> }) {
  const { state } = useTrackerState();
  const { start, dialog } = useStartWorkout();
  const [routeTemplateId, setRouteTemplateId] = useState<string>();
  useEffect(() => { void params.then(({ templateId }) => setRouteTemplateId(templateId)); }, [params]);
  if (!state) return <main className="shell"><p className="muted">Загружаю программу…</p></main>;
  const sessionState = state as SessionTrackerState;
  const template = sessionState.workoutTemplates?.find((item) => item.id === routeTemplateId);
  if (!template) return <main className="shell"><LinkBack /><EmptyState title="Программа не найдена">Она могла быть удалена или ещё не сохранена.</EmptyState></main>;
  const logicalTotal = template.exercises.reduce((sum, exercise) => sum + logicalSets(exercise).length, 0);
  return <main className="shell appPage">
    <LinkBack />
    <PageHeader eyebrow="Программа" title={template.title} actions={<HeaderAction href={`/settings?section=program&program=${template.id}`} icon={Pencil} label="Изменить" ariaLabel="Редактировать программу" />} />
    <p className="muted programSummary">{template.exercises.length} {russianWord(template.exercises.length, "упражнение", "упражнения", "упражнений")} · {logicalTotal} {russianWord(logicalTotal, "подход", "подхода", "подходов")}</p>
    <section className="templateList">{template.exercises.map((exercise, index) => {
      const details = [exercise.muscleGroup, exercise.equipment, exercise.equipmentPosition].map((value) => visibleCopy(value)).filter(Boolean).join(" · ");
      const hint = visibleCopy(exercise.settings);
      return <article className="planCard" key={exercise.id}>
        <span className="planNumber">{index + 1}</span>
        <div className="planBody">
          <h2>{exercise.name}</h2>
          {(details || hint) && <p>{details || hint}</p>}
          <ul className="planRows">{planRows(exercise).map((row) => <li key={row.key}><b>{row.count} × {row.reps}</b><span>{row.detail}</span></li>)}</ul>
          <p className="planRest"><Clock size={13} /> отдых {(exercise.restSec ?? 180) / 60} мин</p>
        </div>
      </article>;
    })}</section>
    <div className="startBar"><Button variant="primary" size="lg" block icon={Play} className="startWorkout" onClick={() => void start(template.id)} disabled={!template.exercises.length || template.exercises.some((e) => !e.sets.length)}>Начать тренировку</Button></div>
    <AppNav active="workouts" />
    {dialog}
  </main>;
}

function LinkBack() { return <Link className="backLink" href="/workouts"><ArrowLeft size={18} /> Тренировки</Link>; }
