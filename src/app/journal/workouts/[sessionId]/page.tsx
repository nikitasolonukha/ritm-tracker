"use client";

import Link from "next/link";
import { ArrowLeft, Check, Save } from "lucide-react";
import { useTrackerState } from "@/components/tracker-state";
import { calculateWorkoutTotals } from "@/lib/tracker";
import { useEffect, useState } from "react";
import type { SessionTrackerState } from "@/lib/workout-session";

export default function JournalWorkoutPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { state, update, storageError } = useTrackerState();
  const [routeSessionId, setRouteSessionId] = useState<string>();
  const [drafts, setDrafts] = useState<Record<string, { weight: string; reps: string }>>({});
  const [message, setMessage] = useState("");
  useEffect(() => { void params.then(({ sessionId }) => setRouteSessionId(sessionId)); }, [params]);
  if (!state) return <main className="shell"><p>Загружаю запись…</p></main>;
  const workout = state.workouts.find((item) => item.id === routeSessionId);
  if (!workout) return <main className="shell"><Link className="backLink" href="/journal"><ArrowLeft size={18} /> Журнал</Link><p>Запись не найдена.</p></main>;
  const totals = calculateWorkoutTotals(workout);
  const saveSet = (exerciseId: string, setId: string) => {
    const draft = drafts[setId];
    if (!draft) return;
    const weight = Number(draft.weight.replace(",", "."));
    const reps = Number(draft.reps);
    if (!Number.isFinite(weight) || weight < 0 || !Number.isInteger(reps) || reps < 1 || reps > 100) { setMessage("Проверь вес и повторы: вес неотрицательный, повторы от 1 до 100."); return; }
    const saved = update((previous) => ({ ...previous, workouts: previous.workouts.map((item) => item.id !== workout.id ? item : { ...item, exercises: item.exercises.map((exercise) => exercise.id !== exerciseId ? exercise : { ...exercise, sets: exercise.sets.map((set) => set.id === setId ? { ...set, weightKg: weight, reps } : set) }) }) } as SessionTrackerState));
    if (!saved) { setMessage("Не удалось сохранить исправление. Оно осталось без изменений."); return; }
    setDrafts((previous) => { const next = { ...previous }; delete next[setId]; return next; });
    setMessage("Исправление сохранено.");
  };
  const setDraft = (setId: string, field: "weight" | "reps", value: string) => setDrafts((previous) => ({ ...previous, [setId]: { weight: previous[setId]?.weight ?? "", reps: previous[setId]?.reps ?? "", [field]: value } }));
  return <main className="shell appPage"><Link className="backLink" href="/journal"><ArrowLeft size={18} /> Журнал</Link><header className="pageHeader"><div><p className="eyebrow">{workout.date}</p><h1>{workout.title}</h1></div><strong>{totals.volumeKg.toLocaleString("ru-RU")} кг</strong></header>{storageError && <p className="storageMessage" role="alert">{storageError}</p>}{message && <p className="storageMessage" role="status">{message}</p>}{workout.exercises.map((exercise) => <section className="panel" key={exercise.id}><div className="panelTitle"><h2>{exercise.name}</h2><span>{exercise.sets.filter((set) => set.completed).length}/{exercise.sets.length}</span></div>{exercise.sets.map((set) => { const draft = drafts[set.id]; return <div className="historySet" key={set.id}><Check size={16} /><label>Вес<input type="number" min="0" step="0.5" value={draft?.weight ?? (set.weightKg ?? "")} onChange={(event) => setDraft(set.id, "weight", event.target.value)} /></label><label>Повторы<input type="number" min="1" max="100" value={draft?.reps ?? (set.reps ?? "")} onChange={(event) => setDraft(set.id, "reps", event.target.value)} /></label><button className="iconButton" aria-label={`Сохранить подход ${set.id}`} onClick={() => saveSet(exercise.id, set.id)}><Save size={17} /></button></div>; })}</section>)}</main>;
}
