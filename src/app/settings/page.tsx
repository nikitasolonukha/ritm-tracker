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
import { AppSelect } from "@/components/app-select";
import { HeaderAction, Notice, PageHeader, useConfirm } from "@/components/ui";
import { buildExerciseLibrary } from "@/lib/exercises";

function setsWord(count: number) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "подход";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "подхода";
  return "подходов";
}

export default function SettingsPage() {
  const { state, update, importLegacy, dismissLegacy, legacyState, storageError, syncStatus } = useTrackerState();
  const { confirm, dialog } = useConfirm();
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
  const removeProgram = async () => { if (template && await confirm(`Удалить программу «${template.title}»? Записанные тренировки останутся.`, { danger: true })) update((previous) => ({ ...previous, workoutTemplates: previous.workoutTemplates?.filter((p) => p.id !== template.id) })); };

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

  const setExerciseMode = (exerciseId: string, value: string) => {
    if (value === "mixed") return;
    update((previous) => ({ ...previous, workoutTemplates: (previous.workoutTemplates ?? []).map((item) => item.id !== template?.id ? item : { ...item, exercises: item.exercises.map((exercise) => exercise.id !== exerciseId ? exercise : { ...exercise, sets: exercise.sets.map((set) => ({ ...set, weightMode: (value || undefined) as ExerciseSet["weightMode"] })) }) }) }));
  };

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

  const removeExercise = async (exerciseId: string, name: string) => {
    if (!(await confirm(`Удалить упражнение «${name}» из программы? Уже записанные тренировки останутся.`, { danger: true }))) return;
    update((previous) => {
      const next = previous as SessionTrackerState;
      return { ...next, workoutTemplates: (next.workoutTemplates ?? []).map((item) => item.id !== template?.id ? item : { ...item, exercises: item.exercises.filter((exercise) => exercise.id !== exerciseId) }) };
    });
  };

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

  const logicalKey = (set: ExerciseSet, index: number) => set.segmentId ?? (set.component && set.component !== "single" ? `pair-${Math.floor(index / 2)}` : set.id);
  const removeLogicalSet = async (exerciseId: string, key: string, name: string, onlyOne: boolean) => {
    if (!(await confirm(onlyOne ? `Это последний подход. Удалить упражнение «${name}» из программы?` : `Удалить этот подход из «${name}»?`, { danger: true }))) return;
    update((previous) => {
      const next = previous as SessionTrackerState;
      return {
        ...next,
        workoutTemplates: (next.workoutTemplates ?? []).map((item) => item.id !== template?.id ? item : {
          ...item,
          exercises: onlyOne ? item.exercises.filter((exercise) => exercise.id !== exerciseId) : item.exercises.map((exercise) => {
            if (exercise.id !== exerciseId) return exercise;
            const sets = exercise.sets.filter((set, index) => logicalKey(set, index) !== key);
            return { ...exercise, sets: sets.length ? sets : exercise.sets };
          }),
        }),
      };
    });
  };
  const splitCompound = (exerciseId: string) => update((previous) => {
    const next = previous as SessionTrackerState;
    return {
      ...next,
      workoutTemplates: (next.workoutTemplates ?? []).map((item) => item.id !== template?.id ? item : {
        ...item,
        exercises: item.exercises.map((exercise) => exercise.id !== exerciseId ? exercise : {
          ...exercise,
          sets: exercise.sets.map((set) => ({ ...set, component: undefined, segmentId: undefined })),
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
    <PageHeader eyebrow="Аккаунт" title="Настройки" actions={<HeaderAction onClick={signOut} icon={LogOut} label="Выйти" />} />
    {signOutError && <Notice tone="error">{signOutError}</Notice>}
    {storageError && <Notice tone="warning">{storageError}</Notice>}
    <p className="muted" role="status">{syncStatus === "idle" ? "Изменения сохранены" : syncStatus === "syncing" || syncStatus === "dirty" ? "Сохраняем изменения…" : syncStatus === "loading" ? "Загружаем данные…" : "Изменения на этом устройстве"}</p>
    {legacyState && <section className="panel migrationNotice"><p className="eyebrow">На этом телефоне</p><h2>Есть записи до входа в аккаунт</h2><p>Это привычки, тренировки и отметки, которые остались в памяти телефона. Их можно скопировать сюда: то, что уже есть в аккаунте, не сотрётся. Незавершённая тренировка из старой копии текущую не заменит.</p><div className="settingsActions"><button className="primary" onClick={importLegacy}>Перенести в этот аккаунт</button><button className="secondary" type="button" onClick={dismissLegacy}>Не переносить</button></div></section>}
    <div className="settingsTabs" role="tablist" aria-label="Раздел настроек">{([["habits", "Привычки"], ["program", "Программа"], ["telegram", "Telegram"], ["data", "Данные"]] as const).map(([id, label]) => <button key={id} role="tab" aria-selected={section === id} onClick={() => setSection(id)}>{label}</button>)}</div>
    {section === "telegram" && <TelegramSettings />}
    {section === "data" && <DataSettings />}
    <div hidden={section !== "habits"}>
    <button className="secondary" onClick={addHabit}><Plus size={18} /> Добавить привычку</button>

    <section className="settingsEditor"><div className="sectionHeading"><h2>Ритм дня</h2><span className="muted">{state.habits.filter((h) => !h.archived).length} действий</span></div><div className="settingsList">{[...state.habits].sort((a, b) => Number(Boolean(a.archived)) - Number(Boolean(b.archived))).map((habit, index, list) => <div key={habit.id}>{habit.archived && !list[index - 1]?.archived && <h3 className="archiveHeading">В архиве</h3>}<HabitEditor habit={habit} /></div>)}</div></section>
    </div>
    <div hidden={section !== "program"}>
    <datalist id="exercise-names">{buildExerciseLibrary(state as SessionTrackerState).map((entry) => <option key={entry.key} value={entry.name} />)}</datalist>
    <div className="btnRow"><button className="secondary" aria-label="Новая программа" onClick={addProgram}><Plus size={18} /> Новая</button>{template && <button className="secondary dangerButton" aria-label="Удалить программу" onClick={removeProgram}><Trash2 size={18} /> Удалить</button>}</div>
    {template ? <>
    <label className="fieldLabel">Программа<AppSelect value={template.id} onChange={setSelectedTemplateId}>{sessionState?.workoutTemplates?.map((p) => <option value={p.id} key={p.id}>{p.title}</option>)}</AppSelect></label>
    <section className="panel settingsEditor">
      <label>Название программы<SettingsInput value={template.title} onCommit={(title) => { if (title.trim()) update((previous) => ({ ...previous, workoutTemplates: previous.workoutTemplates?.map((p) => p.id === template.id ? { ...p, title: title.trim() } : p) })); }} /></label>
      <div className="sectionHeading"><h2>Упражнения</h2><button className="secondary" onClick={addExercise}><Plus size={17} /> Добавить</button></div>
      {template.exercises.map((exercise, exerciseIndex) => {
        const logicalSets: Array<{ key: string; sets: ExerciseSet[] }> = [];
        for (const [index, set] of exercise.sets.entries()) {
          const key = set.segmentId ?? (set.component && set.component !== "single" ? `pair-${Math.floor(index / 2)}` : set.id);
          const existing = logicalSets.find((item) => item.key === key);
          if (existing) existing.sets.push(set);
          else logicalSets.push({ key, sets: [set] });
        }
        const logicalSetCount = logicalSets.length;
        const paired = exercise.sets.some((set) => set.component && set.component !== "single");
        const modes = new Set(exercise.sets.map((set) => set.weightMode ?? ""));
        const mixed = modes.size > 1;
        const lastExercise = exerciseIndex === template.exercises.length - 1;
        const moveExercise = (direction: -1 | 1) => update((previous) => ({ ...previous, workoutTemplates: previous.workoutTemplates?.map((p) => { if (p.id !== template.id) return p; const list = [...p.exercises]; const index = list.findIndex((e) => e.id === exercise.id); [list[index], list[index + direction]] = [list[index + direction], list[index]]; return { ...p, exercises: list }; }) }));
        return <details className="exerciseDisclosure" key={exercise.id}><summary><span>{exercise.name}</span><small>{logicalSetCount} {setsWord(logicalSetCount)} · {(exercise.restSec ?? 180) / 60} мин отдыха</small></summary><div className="settingExercise">
          <label>Название<SettingsInput list="exercise-names" value={exercise.name} onCommit={(value) => editExercise(exercise.id, "name", value)} /></label>
          <div className="twoCols"><label>Группа мышц<SettingsInput value={exercise.muscleGroup} placeholder="Например, грудь" onCommit={(value) => editExercise(exercise.id, "muscleGroup", value)} /></label>
          <label>Оборудование<SettingsInput value={exercise.equipment} placeholder="Например, тренажёр" onCommit={(value) => editExercise(exercise.id, "equipment", value)} /></label></div>
          <label>Положение оборудования<SettingsInput value={exercise.equipmentPosition} placeholder="Необязательно" onCommit={(value) => editExercise(exercise.id, "equipmentPosition", value)} /></label>
          <div className="twoCols"><label>Режим<AppSelect value={mixed ? "mixed" : [...modes][0] ?? ""} onChange={(value) => setExerciseMode(exercise.id, value)}><option value="">Уточнить</option><option value="total">Общий вес</option><option value="per-hand">На сторону</option>{mixed && <option value="mixed" disabled>Разный</option>}</AppSelect></label>
          <label>Отдых<AppSelect value={exercise.restSec ?? 180} onChange={(value) => editExercise(exercise.id, "restSec", value)}><option value="180">180 сек</option><option value="240">240 сек</option></AppSelect></label></div>
          <p className="fieldHint muted">«Общий вес» — штанга или тренажёр целиком. «На сторону» — вес одной гантели, в объём входит дважды.</p>
          <div className="setEditors">{logicalSets.map((logicalSet, setNumber) => <div className="segmentEditor" key={logicalSet.key}>{logicalSet.sets.map((set, partIndex) => {
            const caption = (text: string) => <span className={setNumber === 0 && partIndex === 0 ? undefined : "srOnly"}>{text}</span>;
            const part = set.component === "compound-a" ? "A" : set.component === "compound-b" ? "B" : "";
            return <div className={`setPart${mixed ? " withMode" : ""}`} key={set.id}>
              <span className="setNo" aria-hidden="true">{partIndex === 0 || part ? `${setNumber + 1}${part}` : ""}</span>
              <label>{caption("Вес")}<SettingsInput numeric="weight" placeholder="кг" value={set.weightKg} onCommit={(value) => editSet(exercise.id, set.id, "weightKg", value)} /></label>
              <label>{caption("Повторы")}<SettingsInput numeric="reps" placeholder="раз" value={set.reps} onCommit={(value) => editSet(exercise.id, set.id, "reps", value)} /></label>
              {partIndex === 0 ? <button type="button" className="iconButton dangerButton" aria-label={`Удалить подход ${setNumber + 1}`} title="Удалить подход" onClick={() => removeLogicalSet(exercise.id, logicalSet.key, exercise.name, logicalSets.length <= 1)}><Trash2 size={18} /></button> : <span />}
              {mixed && <label className="setMode">{caption("Режим")}<AppSelect value={set.weightMode ?? ""} onChange={(value) => editSet(exercise.id, set.id, "weightMode", value)}><option value="">Уточнить</option><option value="total">Общий вес</option><option value="per-hand">На сторону</option></AppSelect></label>}
            </div>;
          })}</div>)}</div>
          <div className="setEditorActions"><button className="secondary" onClick={() => addSet(exercise.id)}><Plus size={17} /> Подход</button>{paired ? <button className="secondary" onClick={() => splitCompound(exercise.id)}>Разделить пары</button> : exercise.sets.length >= 2 && exercise.sets.length % 2 === 0 && <button className="secondary" title="Соседние подходы станут парой: часть A, затем часть B, отдых после обеих" onClick={() => makeCompound(exercise.id)}>Сделать парами A/B</button>}</div>
          {paired && <p className="fieldHint muted">Подходы идут парами: сначала часть A, затем часть B. Отдых — после обеих.</p>}
          <div className="exerciseToolbar"><button type="button" className="iconButton" aria-label="Переместить выше" title="Выше" disabled={exerciseIndex === 0} onClick={() => moveExercise(-1)}><ArrowUp size={18} /></button><button type="button" className="iconButton" aria-label="Переместить ниже" title="Ниже" disabled={lastExercise} onClick={() => moveExercise(1)}><ArrowDown size={18} /></button><button type="button" className="secondary dangerButton" onClick={() => removeExercise(exercise.id, exercise.name)}><Trash2 size={17} /> Удалить упражнение</button></div>
        </div></details>;
      })}
    </section>
    </> : <p className="muted">Добавьте свою первую программу.</p>}
    </div>
    <AppNav active="settings" />
    {dialog}
  </main>;
}
