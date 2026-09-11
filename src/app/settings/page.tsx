"use client";

import Link from "next/link";
import { ArrowLeft, Plus, Save, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTrackerState } from "@/components/tracker-state";
import type { SessionTrackerState } from "@/lib/workout-session";

export default function SettingsPage() {
  const { state, update, importLegacy, legacyState, storageError } = useTrackerState();
  const sessionState = state as SessionTrackerState | null;
  const template = sessionState?.workoutTemplates?.[0];
  const [title, setTitle] = useState("");
  if (!state || !template) return <main className="shell appPage"><p className="muted">Загружаю настройки...</p></main>;

  const editExercise = (exerciseId: string, field: string, value: string) => update((previous) => {
    const next = previous as SessionTrackerState;
    return {
      ...next,
      workoutTemplates: (next.workoutTemplates ?? []).map((item) => item.id !== template.id ? item : {
        ...item,
        exercises: item.exercises.map((exercise) => {
          if (exercise.id !== exerciseId) return exercise;
          if (field === "name") return { ...exercise, name: value };
          if (field === "restSec") return { ...exercise, restSec: Number(value) as 180 | 240 };
          const component = exercise.sets[0]?.component;
          return {
            ...exercise,
            sets: exercise.sets.map((set) => {
              if (component && set.component !== component) return set;
              if (field === "weightMode") return { ...set, weightMode: value ? value as "total" | "per-hand" : undefined };
              if (field === "weightKg") return { ...set, weightKg: value === "" ? null : Number(value) };
              return { ...set, reps: value === "" ? null : Number(value) };
            }),
          };
        }),
      }),
    };
  });

  const addExercise = () => update((previous) => {
    const next = previous as SessionTrackerState;
    const id = `exercise-${Date.now()}`;
    return {
      ...next,
      workoutTemplates: (next.workoutTemplates ?? []).map((item) => item.id !== template.id ? item : {
        ...item,
        exercises: [...item.exercises, {
          id,
          name: "Новое упражнение",
          category: "working" as const,
          restSec: 180 as const,
          sets: [1, 2, 3, 4].map((index) => ({ id: `${id}-set-${index}`, weightKg: null, reps: 8, completed: false })),
        }],
      }),
    };
  });

  const removeExercise = (exerciseId: string) => update((previous) => {
    const next = previous as SessionTrackerState;
    return { ...next, workoutTemplates: (next.workoutTemplates ?? []).map((item) => item.id !== template.id ? item : { ...item, exercises: item.exercises.filter((exercise) => exercise.id !== exerciseId) }) };
  });

  const saveTitle = () => update((previous) => {
    const next = previous as SessionTrackerState;
    return { ...next, workoutTemplates: (next.workoutTemplates ?? []).map((item) => item.id === template.id ? { ...item, title: title || item.title } : item) };
  });

  return <main className="shell appPage">
    <Link className="backLink" href="/today"><ArrowLeft size={18} /> Сегодня</Link>
    <header className="pageHeader"><div><p className="eyebrow">Аккаунт</p><h1>Настройки</h1></div></header>
    {storageError && <p className="storageMessage" role="alert">{storageError}</p>}
    {legacyState && <section className="panel migrationNotice"><p className="eyebrow">Старые данные</p><h2>Найдена локальная история</h2><p>Она хранится отдельно и не открывается автоматически другому аккаунту. Перенести её в этот аккаунт?</p><button className="primary" onClick={importLegacy}>Перенести историю</button></section>}
    <section className="panel settingsEditor">
      <label>Название программы<input value={title || template.title} onChange={(event) => setTitle(event.target.value)} /></label>
      <button className="primary" onClick={saveTitle}><Save size={18} /> Сохранить программу</button>
      <div className="sectionHeading"><h2>Упражнения</h2><button className="secondary" onClick={addExercise}><Plus size={17} /> Добавить</button></div>
      {template.exercises.map((exercise) => {
        const first = exercise.sets[0];
        return <article className="settingExercise" key={exercise.id}>
          <label>Название<input value={exercise.name} onChange={(event) => editExercise(exercise.id, "name", event.target.value)} /></label>
          <label>Вес<input type="number" min="0" step="0.5" value={first?.weightKg ?? ""} onChange={(event) => editExercise(exercise.id, "weightKg", event.target.value)} /></label>
          <label>Режим<select value={first?.weightMode ?? ""} onChange={(event) => editExercise(exercise.id, "weightMode", event.target.value)}><option value="">Уточнить</option><option value="total">Общий вес</option><option value="per-hand">На сторону / гантель</option></select></label>
          <label>Повторы<input type="number" min="1" max="100" value={first?.reps ?? ""} onChange={(event) => editExercise(exercise.id, "reps", event.target.value)} /></label>
          <label>Отдых<select value={exercise.restSec ?? 180} onChange={(event) => editExercise(exercise.id, "restSec", event.target.value)}><option value="180">180 сек</option><option value="240">240 сек</option></select></label>
          <button className="iconButton" onClick={() => removeExercise(exercise.id)} aria-label={`Удалить ${exercise.name}`}><Trash2 size={17} /></button>
        </article>;
      })}
    </section>
  </main>;
}
