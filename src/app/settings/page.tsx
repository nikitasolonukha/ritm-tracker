"use client";

import Link from "next/link";
import { ArrowLeft, LogOut, Plus, Save, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTrackerState } from "@/components/tracker-state";
import { createClient } from "@/lib/supabase/client";
import { setServiceWorkerAccount } from "@/lib/pwa";
import type { SessionTrackerState } from "@/lib/workout-session";
import type { ExerciseSet } from "@/lib/tracker";
import { SettingsInput } from "@/components/settings-input";
import { TelegramSettings } from "@/components/telegram-settings";
import { AppNav } from "@/components/app-nav";

export default function SettingsPage() {
  const { state, update, importLegacy, legacyState, storageError, syncStatus } = useTrackerState();
  const sessionState = state as SessionTrackerState | null;
  const template = sessionState?.workoutTemplates?.[0];
  const [title, setTitle] = useState("");
  const [section, setSection] = useState<"habits" | "program" | "telegram">("habits");
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
          if (field === "muscleGroup") return { ...exercise, muscleGroup: value };
          if (field === "equipment") return { ...exercise, equipment: value };
          if (field === "equipmentPosition") return { ...exercise, equipmentPosition: value };
          if (field === "restSec") return { ...exercise, restSec: Number(value) as 180 | 240 };
          return { ...exercise, [field]: value };
        }),
      }),
    };
  });

  const editSet = (exerciseId: string, setId: string, field: "weightKg" | "weightMode" | "reps", value: string) => update((previous) => {
    const next = previous as SessionTrackerState;
    return {
      ...next,
      workoutTemplates: (next.workoutTemplates ?? []).map((item) => item.id !== template.id ? item : {
        ...item,
        exercises: item.exercises.map((exercise) => exercise.id !== exerciseId ? exercise : {
          ...exercise,
          sets: exercise.sets.map((set) => {
            if (set.id !== setId) return set;
            if (field === "weightMode") return { ...set, weightMode: value ? value as ExerciseSet["weightMode"] : undefined };
            if (field === "weightKg") return { ...set, weightKg: value === "" ? null : Number(value) };
            return { ...set, reps: value === "" ? null : Number(value) };
          }),
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

  const addSet = (exerciseId: string) => update((previous) => {
    const next = previous as SessionTrackerState;
    const id = `set-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`;
    return {
      ...next,
      workoutTemplates: (next.workoutTemplates ?? []).map((item) => item.id !== template.id ? item : {
        ...item,
        exercises: item.exercises.map((exercise) => {
          if (exercise.id !== exerciseId) return exercise;
          const components = [...new Set(exercise.sets.map((set) => set.component).filter((component) => component === "compound-a" || component === "compound-b"))];
          const pairNumber = new Set(exercise.sets.map((set, index) => set.segmentId ?? (set.component && set.component !== "single" ? `pair-${Math.floor(index / 2)}` : `set-${index}`))).size;
          if (components.length > 1) {
            const pairId = `pair-${pairNumber}`;
            return { ...exercise, sets: [...exercise.sets, ...components.map((component) => { const source = [...exercise.sets].reverse().find((set) => set.component === component); const base: ExerciseSet = source ? { ...source } : { id: `${id}-${component}`, weightKg: null, reps: 8, completed: false, component: component as ExerciseSet["component"] }; return { ...base, id: `${id}-${component}`, component: component as ExerciseSet["component"], segmentId: pairId, completed: false, weightDraft: undefined, repsDraft: undefined }; })] };
          }
          const source = exercise.sets.at(-1);
          return source ? { ...exercise, sets: [...exercise.sets, { ...source, id, completed: false, weightDraft: undefined, repsDraft: undefined }] } : exercise;
        }),
      }),
    };
  });

  const removeSet = (exerciseId: string) => update((previous) => {
    const next = previous as SessionTrackerState;
    return {
      ...next,
      workoutTemplates: (next.workoutTemplates ?? []).map((item) => item.id !== template.id ? item : {
        ...item,
        exercises: item.exercises.map((exercise) => {
          if (exercise.id !== exerciseId || exercise.sets.length <= 1) return exercise;
          const last = exercise.sets.at(-1);
          const lastKey = last?.segmentId ?? (last?.component && last.component !== "single" ? `pair-${Math.floor((exercise.sets.length - 1) / 2)}` : last?.id);
          const nextSets = exercise.sets.filter((set, index) => (set.segmentId ?? (set.component && set.component !== "single" ? `pair-${Math.floor(index / 2)}` : set.id)) !== lastKey);
          return { ...exercise, sets: nextSets.length ? nextSets : exercise.sets };
        }),
      }),
    };
  });

  const makeCompound = (exerciseId: string) => update((previous) => {
    const next = previous as SessionTrackerState;
    return {
      ...next,
      workoutTemplates: (next.workoutTemplates ?? []).map((item) => item.id !== template.id ? item : {
        ...item,
        exercises: item.exercises.map((exercise) => exercise.id !== exerciseId ? exercise : {
          ...exercise,
          sets: exercise.sets.map((set, index) => ({
            ...set,
            component: index % 2 === 0 ? "compound-a" as const : "compound-b" as const,
            segmentId: `pair-${Math.floor(index / 2) + 1}`,
            completed: false,
          })),
        }),
      }),
    };
  });

  const saveTitle = () => update((previous) => {
    const next = previous as SessionTrackerState;
    return { ...next, workoutTemplates: (next.workoutTemplates ?? []).map((item) => item.id === template.id ? { ...item, title: title || item.title } : item) };
  });

  function signOut() {
    setServiceWorkerAccount();
    void createClient().auth.signOut().finally(() => { window.location.assign("/login"); });
  }

  const editHabit = (habitId: string, field: "title" | "schedule" | "privateTitle", value: string) => update((previous) => ({
    ...previous,
    habits: previous.habits.map((habit) => habit.id !== habitId ? habit : { ...habit, [field]: value }),
  }));
  const addHabit = () => {
    const id = `habit-${crypto.randomUUID()}`;
    update((previous) => ({ ...previous, habits: [...previous.habits, { id, type: "habit", title: "Новая привычка", schedule: "" }] }));
  };

  return <main className="shell appPage">
    <Link className="backLink" href="/today"><ArrowLeft size={18} /> Сегодня</Link>
    <header className="pageHeader"><div><p className="eyebrow">Аккаунт</p><h1>Настройки</h1></div><button className="secondary" onClick={signOut}><LogOut size={17} /> Выйти</button></header>
    {storageError && <p className="storageMessage" role="alert">{storageError}</p>}
    <p className="muted" role="status">{syncStatus === "idle" ? "Изменения сохранены" : syncStatus === "syncing" || syncStatus === "dirty" ? "Сохраняем изменения…" : syncStatus === "loading" ? "Загружаем данные…" : "Изменения на этом устройстве"}</p>
    {legacyState && <section className="panel migrationNotice"><p className="eyebrow">Старые данные</p><h2>Найдена локальная история</h2><p>Она хранится отдельно и не открывается автоматически другому аккаунту. Перенести её в этот аккаунт?</p><button className="primary" onClick={importLegacy}>Перенести историю</button></section>}
    <div className="settingsTabs" role="tablist" aria-label="Раздел настроек">{([["habits", "Привычки"], ["program", "Программа"], ["telegram", "Telegram"]] as const).map(([id, label]) => <button key={id} role="tab" aria-selected={section === id} onClick={() => setSection(id)}>{label}</button>)}</div>
    {section === "telegram" && <TelegramSettings />}
    <div hidden={section !== "habits"}>
    <button className="secondary" onClick={addHabit}><Plus size={18} /> Добавить привычку</button>

    <section className="panel settingsEditor"><div className="sectionHeading"><div><p className="eyebrow">Приватно</p><h2>Ритм дня</h2></div><span className="muted">Названия и расписание</span></div><div className="settingsList">{state.habits.map((habit) => <article className="settingRow habitSettingRow" key={habit.id}><label>Действие<SettingsInput value={habit.title} onCommit={(value) => editHabit(habit.id, "title", value)} /></label><label>Когда<SettingsInput value={habit.schedule} placeholder="Например, после завтрака" onCommit={(value) => editHabit(habit.id, "schedule", value)} /></label><label>Личная заметка<SettingsInput value={habit.privateTitle} placeholder="Необязательно" onCommit={(value) => editHabit(habit.id, "privateTitle", value)} /></label></article>)}</div></section>
    </div>
    <div hidden={section !== "program"}>
    <section className="panel settingsEditor">
      <label>Название программы<input value={title || template.title} onChange={(event) => setTitle(event.target.value)} /></label>
      <button className="primary" onClick={saveTitle}><Save size={18} /> Сохранить название</button>
      <div className="sectionHeading"><h2>Упражнения</h2><button className="secondary" onClick={addExercise}><Plus size={17} /> Добавить</button></div>
      {template.exercises.map((exercise) => {
        const logicalSetCount = new Set(exercise.sets.map((set, index) => set.segmentId ?? (set.component && set.component !== "single" ? `pair-${Math.floor(index / 2)}` : `set-${index}`))).size;
        const logicalSets: Array<{ key: string; label: string; sets: ExerciseSet[] }> = [];
        for (const [index, set] of exercise.sets.entries()) {
          const key = set.segmentId ?? (set.component && set.component !== "single" ? `pair-${Math.floor(index / 2)}` : set.id);
          const existing = logicalSets.find((item) => item.key === key);
          if (existing) existing.sets.push(set);
          else logicalSets.push({ key, label: set.component ? `Подход ${logicalSets.length + 1}` : `Подход ${logicalSets.length + 1}`, sets: [set] });
        }
        return <details className="exerciseDisclosure" key={exercise.id}><summary><span>{exercise.name}</span><small>{logicalSetCount} подхода · {(exercise.restSec ?? 180) / 60} мин отдыха</small></summary><div className="settingExercise">
          <label>Название<SettingsInput value={exercise.name} onCommit={(value) => editExercise(exercise.id, "name", value)} /></label>
          <label>Группа мышц<SettingsInput value={exercise.muscleGroup} placeholder="Например, грудь" onCommit={(value) => editExercise(exercise.id, "muscleGroup", value)} /></label>
          <label>Оборудование<SettingsInput value={exercise.equipment} placeholder="Например, тренажёр" onCommit={(value) => editExercise(exercise.id, "equipment", value)} /></label>
          <label>Положение оборудования<SettingsInput value={exercise.equipmentPosition} placeholder="Необязательно" onCommit={(value) => editExercise(exercise.id, "equipmentPosition", value)} /></label>
          <div className="setEditors">{logicalSets.map((logicalSet) => <div className="segmentEditor" key={logicalSet.key}><strong>{logicalSet.label}</strong>{logicalSet.sets.map((set) => <div className="setPart" key={set.id}><span className="muted">{set.component === "compound-a" ? "A" : set.component === "compound-b" ? "B" : ""}</span><label>Вес<SettingsInput numeric="weight" value={set.weightKg} onCommit={(value) => editSet(exercise.id, set.id, "weightKg", value)} /></label><label>Режим<select value={set.weightMode ?? ""} onChange={(event) => editSet(exercise.id, set.id, "weightMode", event.target.value)}><option value="">Уточнить</option><option value="total">Общий вес</option><option value="per-hand">На сторону / гантель</option></select></label><label>Повторы<SettingsInput numeric="reps" value={set.reps} onCommit={(value) => editSet(exercise.id, set.id, "reps", value)} /></label></div>)}</div>)}</div>
          <div className="setEditorActions"><span>{logicalSetCount} логич. подход{logicalSetCount === 1 ? "" : logicalSetCount < 5 ? "а" : "ов"}</span><button className="secondary" onClick={() => addSet(exercise.id)}>Добавить подход</button>{!exercise.sets.some((set) => set.component && set.component !== "single") && exercise.sets.length >= 2 && exercise.sets.length % 2 === 0 && <button className="secondary" onClick={() => makeCompound(exercise.id)}>Сделать парами A/B</button>}<button className="iconButton" onClick={() => removeSet(exercise.id)} disabled={logicalSetCount <= 1} aria-label={`Удалить последний подход ${exercise.name}`}><Trash2 size={17} /></button></div>
          <label>Отдых<select value={exercise.restSec ?? 180} onChange={(event) => editExercise(exercise.id, "restSec", event.target.value)}><option value="180">180 сек</option><option value="240">240 сек</option></select></label>
          <button className="iconButton" onClick={() => removeExercise(exercise.id)} aria-label={`Удалить ${exercise.name}`}><Trash2 size={17} /></button>
        </div></details>;
      })}
    </section>
    </div>
    <AppNav active="settings" />
  </main>;
}
