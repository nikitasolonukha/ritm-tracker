"use client";

import Link from "next/link";
import { ArrowLeft, ArrowUp, ArrowDown, LogOut, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTrackerState } from "@/components/tracker-state";
import { createClient } from "@/lib/supabase/client";
import { setServiceWorkerAccount } from "@/lib/pwa";
import type { SessionTrackerState } from "@/lib/workout-session";
import type { ExerciseSet } from "@/lib/tracker";
import { SettingsInput } from "@/components/settings-input";
import { TelegramSettings } from "@/components/telegram-settings";
import { AppNav } from "@/components/app-nav";
import { HabitEditor } from "@/components/habit-editor";
import { DataSettings } from "@/components/data-settings";

export default function SettingsPage() {
  const { state, update, importLegacy, legacyState, storageError, syncStatus } = useTrackerState();
  const sessionState = state as SessionTrackerState | null;
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>();
  const template = sessionState?.workoutTemplates?.find((t) => t.id === selectedTemplateId) ?? sessionState?.workoutTemplates?.[0];
  const [signOutError, setSignOutError] = useState("");
  const [section, setSection] = useState<"habits" | "program" | "telegram" | "data">("habits");
  useEffect(() => { const query = new URLSearchParams(window.location.search); const section = query.get("section"); if (section === "program" || section === "telegram" || section === "data") setSection(section); setSelectedTemplateId(query.get("program") ?? undefined); }, []);
  if (!state) return <main className="shell appPage"><p className="muted">Загружаю настройки...</p></main>;
  const addProgram = () => {
    const id = `program-${crypto.randomUUID()}`;
    if (update((previous) => ({ ...previous, workoutTemplates: [...(previous.workoutTemplates ?? []), { id, title: "Новая программа", date: new Date().toISOString().slice(0, 10), exercises: [] }] }))) setSelectedTemplateId(id);
  };
  const removeProgram = () => { if (template && window.confirm(`Удалить программу «${template.title}»? Записанные тренировки останутся.`)) update((previous) => ({ ...previous, workoutTemplates: previous.workoutTemplates?.filter((p) => p.id !== template.id) })); };

  const editExercise = (exerciseId: string, field: string, value: string) => update((previous) => {
    const next = previous as SessionTrackerState;
    return {
      ...next,
      workoutTemplates: (next.workoutTemplates ?? []).map((item) => item.id !== template?.id ? item : {
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
      workoutTemplates: (next.workoutTemplates ?? []).map((item) => item.id !== template?.id ? item : {
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
      workoutTemplates: (next.workoutTemplates ?? []).map((item) => item.id !== template?.id ? item : {
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
    return { ...next, workoutTemplates: (next.workoutTemplates ?? []).map((item) => item.id !== template?.id ? item : { ...item, exercises: item.exercises.filter((exercise) => exercise.id !== exerciseId) }) };
  });

  const addSet = (exerciseId: string) => update((previous) => {
    const next = previous as SessionTrackerState;
    const id = `set-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`;
    return {
      ...next,
      workoutTemplates: (next.workoutTemplates ?? []).map((item) => item.id !== template?.id ? item : {
        ...item,
        exercises: item.exercises.map((exercise) => {
          if (exercise.id !== exerciseId) return exercise;
          const components = [...new Set(exercise.sets.map((set) => set.component).filter((component) => component === "compound-a" || component === "compound-b"))];
          if (components.length > 1) {
            const pairId = `pair-${crypto.randomUUID()}`;
            return { ...exercise, sets: [...exercise.sets, ...components.map((component) => { const source = [...exercise.sets].reverse().find((set) => set.component === component); const base: ExerciseSet = source ? { ...source } : { id: `${id}-${component}`, weightKg: null, reps: 8, completed: false, component: component as ExerciseSet["component"] }; return { ...base, id: `${id}-${component}`, component: component as ExerciseSet["component"], segmentId: pairId, completed: false, weightDraft: undefined, repsDraft: undefined }; })] };
          }
          const source = exercise.sets.at(-1);
          return { ...exercise, sets: [...exercise.sets, source ? { ...source, id, completed: false, weightDraft: undefined, repsDraft: undefined } : { id, weightKg: null, reps: 8, completed: false }] };
        }),
      }),
    };
  });

  const removeSet = (exerciseId: string) => update((previous) => {
    const next = previous as SessionTrackerState;
    return {
      ...next,
      workoutTemplates: (next.workoutTemplates ?? []).map((item) => item.id !== template?.id ? item : {
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
      workoutTemplates: (next.workoutTemplates ?? []).map((item) => item.id !== template?.id ? item : {
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

  async function signOut() {
    try {
      const { error } = await createClient().auth.signOut({ scope: "local" });
      if (error) { setSignOutError("Не удалось выйти. Попробуйте снова."); return; }
      setServiceWorkerAccount();
      window.location.assign("/login");
    } catch { setSignOutError("Не удалось выйти. Проверьте соединение."); }
  }
  const addHabit = () => {
    const id = `habit-${crypto.randomUUID()}`;
    update((previous) => ({ ...previous, habits: [...previous.habits, { id, type: "habit", title: "Новая привычка", schedule: "" }] }));
  };

  return <main className="shell appPage">
    <Link className="backLink" href="/today"><ArrowLeft size={18} /> Сегодня</Link>
    <header className="pageHeader"><div><p className="eyebrow">Аккаунт</p><h1>Настройки</h1></div><button className="secondary" onClick={signOut}><LogOut size={17} /> Выйти</button></header>
    {signOutError && <p role="alert" className="storageMessage">{signOutError}</p>}
    {storageError && <p className="storageMessage" role="alert">{storageError}</p>}
    <p className="muted" role="status">{syncStatus === "idle" ? "Изменения сохранены" : syncStatus === "syncing" || syncStatus === "dirty" ? "Сохраняем изменения…" : syncStatus === "loading" ? "Загружаем данные…" : "Изменения на этом устройстве"}</p>
    {legacyState && <section className="panel migrationNotice"><p className="eyebrow">Старые данные</p><h2>Найдена локальная история</h2><p>Она хранится отдельно и не открывается автоматически другому аккаунту. Перенести её в этот аккаунт?</p><button className="primary" onClick={importLegacy}>Перенести историю</button></section>}
    <div className="settingsTabs" role="tablist" aria-label="Раздел настроек">{([["habits", "Привычки"], ["program", "Программа"], ["telegram", "Telegram"], ["data", "Данные"]] as const).map(([id, label]) => <button key={id} role="tab" aria-selected={section === id} onClick={() => setSection(id)}>{label}</button>)}</div>
    {section === "telegram" && <TelegramSettings />}
    {section === "data" && <DataSettings />}
    <div hidden={section !== "habits"}>
    <button className="secondary" onClick={addHabit}><Plus size={18} /> Добавить привычку</button>

    <section className="settingsEditor"><div className="sectionHeading"><h2>Ритм дня</h2><span className="muted">{state.habits.filter((h) => !h.archived).length} действий</span></div><div className="settingsList">{state.habits.map((habit) => <HabitEditor key={habit.id} habit={habit} />)}</div></section>
    </div>
    <div hidden={section !== "program"}>
    <div className="settingsActions"><button className="secondary" onClick={addProgram}><Plus size={18} /> Новая программа</button>{template && <button className="secondary" onClick={removeProgram}><Trash2 size={18} /> Удалить программу</button>}</div>
    {template ? <>
    <label>Программа<select value={template.id} onChange={(e) => setSelectedTemplateId(e.target.value)}>{sessionState?.workoutTemplates?.map((p) => <option value={p.id} key={p.id}>{p.title}</option>)}</select></label>
    <section className="panel settingsEditor">
      <label>Название программы<SettingsInput value={template.title} onCommit={(title) => { if (title.trim()) update((previous) => ({ ...previous, workoutTemplates: previous.workoutTemplates?.map((p) => p.id === template.id ? { ...p, title: title.trim() } : p) })); }} /></label>
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
          <div className="settingsActions">{([-1, 1] as const).map((direction) => <button key={direction} className="iconButton" aria-label={direction === -1 ? "Переместить выше" : "Переместить ниже"} disabled={template.exercises.indexOf(exercise) + direction < 0 || template.exercises.indexOf(exercise) + direction >= template.exercises.length} onClick={() => update((previous) => ({ ...previous, workoutTemplates: previous.workoutTemplates?.map((p) => { if (p.id !== template.id) return p; const list = [...p.exercises]; const index = list.findIndex((e) => e.id === exercise.id); [list[index], list[index + direction]] = [list[index + direction], list[index]]; return { ...p, exercises: list }; }) }))}>{direction === -1 ? <ArrowUp size={18} /> : <ArrowDown size={18} />}</button>)}</div>
        </div></details>;
      })}
    </section>
    </> : <p className="muted">Добавьте свою первую программу.</p>}
    </div>
    <AppNav active="settings" />
  </main>;
}
