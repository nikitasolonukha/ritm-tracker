"use client";

import Link from "next/link";
import { ArrowLeft, Plus, Save, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTrackerState } from "@/components/tracker-state";
import type { SessionTrackerState } from "@/lib/workout-session";

export default function SettingsPage() {
  const { state, update, storageError } = useTrackerState();
  const sessionState = state as SessionTrackerState | null;
  const template = sessionState?.workoutTemplates?.[0];
  const [title, setTitle] = useState("");
  if (!state || !template) return <main className="shell appPage"><p className="muted">Загружаю настройки...</p></main>;
  const currentTitle = title || template.title;
  const save = () => update((previous) => { const next = previous as SessionTrackerState; return { ...next, workoutTemplates: (next.workoutTemplates ?? []).map((item) => item.id === template.id ? { ...item, title: currentTitle } : item) }; });
  const editExercise = (exerciseId: string, field: "name" | "weightKg" | "reps" | "restSec", value: string) => update((previous) => { const next = previous as SessionTrackerState; return { ...next, workoutTemplates: (next.workoutTemplates ?? []).map((item) => item.id !== template.id ? item : { ...item, exercises: item.exercises.map((exercise) => exercise.id !== exerciseId ? exercise : field === "name" ? { ...exercise, name: value } : { ...exercise, ...(field === "restSec" ? { restSec: Number(value) as 180 | 240 } : { sets: exercise.sets.map((set) => ({ ...set, [field]: value === "" ? null : Number(value) })) }) }) }) }; });
  const addExercise = () => update((previous) => { const next = previous as SessionTrackerState; const id = `exercise-${Date.now()}`; return { ...next, workoutTemplates: (next.workoutTemplates ?? []).map((item) => item.id !== template.id ? item : { ...item, exercises: [...item.exercises, { id, name: "Новое упражнение", category: "working" as const, restSec: 180 as const, sets: [1, 2, 3, 4].map((index) => ({ id: `${id}-set-${index}`, weightKg: null, reps: 8, completed: false })) }] }) }; });
  const removeExercise = (exerciseId: string) => update((previous) => { const next = previous as SessionTrackerState; return { ...next, workoutTemplates: (next.workoutTemplates ?? []).map((item) => item.id !== template.id ? item : { ...item, exercises: item.exercises.filter((exercise) => exercise.id !== exerciseId) }) }; });
  return <main className="shell appPage"><Link className="backLink" href="/today"><ArrowLeft size={18} /> Сегодня</Link><header className="pageHeader"><div><p className="eyebrow">Аккаунт</p><h1>Настройки</h1></div></header>{storageError && <p className="storageMessage" role="alert">{storageError}</p>}<section className="panel settingsEditor"><label>Название программы<input value={currentTitle} onChange={(event) => setTitle(event.target.value)} /></label><button className="primary" onClick={save}><Save size={18} /> Сохранить программу</button><div className="sectionHeading"><h2>Упражнения</h2><button className="secondary" onClick={addExercise}><Plus size={17} /> Добавить</button></div>{template.exercises.map((exercise) => { const first = exercise.sets[0]; return <article className="settingExercise" key={exercise.id}><label>Название<input value={exercise.name} onChange={(event) => editExercise(exercise.id, "name", event.target.value)} /></label><label>Вес<input type="number" min="0" step="0.5" value={first?.weightKg ?? ""} onChange={(event) => editExercise(exercise.id, "weightKg", event.target.value)} /></label><label>Повторы<input type="number" min="1" max="100" value={first?.reps ?? ""} onChange={(event) => editExercise(exercise.id, "reps", event.target.value)} /></label><label>Отдых<select value={exercise.restSec ?? 180} onChange={(event) => editExercise(exercise.id, "restSec", event.target.value)}><option value="180">180 сек</option><option value="240">240 сек</option></select></label><button className="iconButton" onClick={() => removeExercise(exercise.id)} aria-label={`Удалить ${exercise.name}`}><Trash2 size={17} /></button></article>; })}</section></main>;
}
