"use client";

import Link from "next/link";
import { ArrowLeft, LogOut, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTrackerState } from "@/components/tracker-state";
import { createClient } from "@/lib/supabase/client";
import { setServiceWorkerAccount } from "@/lib/pwa";
import type { SessionTrackerState } from "@/lib/workout-session";
import type { ExerciseSet } from "@/lib/tracker";

export default function SettingsPage() {
  const { state, update, importLegacy, legacyState, storageError } = useTrackerState();
  const sessionState = state as SessionTrackerState | null;
  const template = sessionState?.workoutTemplates?.[0];
  const [title, setTitle] = useState("");
  const [telegramTest, setTelegramTest] = useState("");
  const [telegramStatus, setTelegramStatus] = useState<"loading" | "connected" | "pending" | "expired" | "disconnected" | "error">("loading");
  const [telegramLink, setTelegramLink] = useState("");
  const [telegramMessage, setTelegramMessage] = useState("");
  useEffect(() => {
    let active = true;
    void fetch("/api/telegram/link", { cache: "no-store" }).then(async (response) => {
      const body = await response.json().catch(() => ({})) as { status?: typeof telegramStatus };
      if (active) setTelegramStatus(response.ok && body.status ? body.status : "expired");
    }).catch(() => { if (active) setTelegramStatus("expired"); });
    return () => { active = false; };
  }, []);
  if (!state || !template) return <main className="shell appPage"><p className="muted">Загружаю настройки...</p></main>;

  const editExercise = (exerciseId: string, field: string, value: string, componentOverride?: ExerciseSet["component"]) => update((previous) => {
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
          const component = componentOverride ?? exercise.sets[0]?.component;
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

  const addSet = (exerciseId: string) => update((previous) => {
    const next = previous as SessionTrackerState;
    const id = `set-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`;
    return {
      ...next,
      workoutTemplates: (next.workoutTemplates ?? []).map((item) => item.id !== template.id ? item : {
        ...item,
        exercises: item.exercises.map((exercise) => {
          if (exercise.id !== exerciseId) return exercise;
          const components = [...new Set(exercise.sets.map((set) => set.component).filter(Boolean))];
          const pairNumber = new Set(exercise.sets.map((set, index) => set.segmentId ?? (set.component ? `pair-${Math.floor(index / 2)}` : `set-${index}`))).size;
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
          const lastKey = last?.segmentId ?? (last?.component ? `pair-${Math.floor((exercise.sets.length - 1) / 2)}` : last?.id);
          const nextSets = exercise.sets.filter((set, index) => (set.segmentId ?? (set.component ? `pair-${Math.floor(index / 2)}` : set.id)) !== lastKey);
          return { ...exercise, sets: nextSets.length ? nextSets : exercise.sets };
        }),
      }),
    };
  });

  const saveTitle = () => update((previous) => {
    const next = previous as SessionTrackerState;
    return { ...next, workoutTemplates: (next.workoutTemplates ?? []).map((item) => item.id === template.id ? { ...item, title: title || item.title } : item) };
  });

  async function scheduleTelegramTest() {
    setTelegramTest("Создаю job…");
    try {
      const response = await fetch("/api/telegram/test-job", { method: "POST" });
      const body = await response.json().catch(() => ({})) as { dueAt?: string; error?: string };
      if (!response.ok) { setTelegramTest(body.error === "telegram_not_linked" ? "Сначала подключи Telegram." : "Не удалось создать job."); return; }
      setTelegramTest(`Job создан. Срок: ${body.dueAt ? new Date(body.dueAt).toLocaleTimeString("ru-RU") : "через 60 секунд"}.`);
    } catch { setTelegramTest("Нет связи с сервером."); }
  }

  async function connectTelegram() {
    setTelegramMessage("Создаю ссылку подключения…");
    try {
      const response = await fetch("/api/telegram/link", { method: "POST" });
      const body = await response.json().catch(() => ({})) as { link?: string; error?: string };
      if (!response.ok || !body.link) { setTelegramMessage(body.error === "telegram_unavailable" ? "Telegram временно недоступен." : "Не удалось создать ссылку."); return; }
      setTelegramLink(body.link);
      setTelegramStatus("pending");
      setTelegramMessage("Открой ссылку в Telegram и отправь /start. После этого обнови статус.");
    } catch { setTelegramMessage("Нет связи с сервером."); }
  }

  async function disconnectTelegram() {
    setTelegramMessage("Отключаю Telegram…");
    const response = await fetch("/api/telegram/link", { method: "DELETE" }).catch(() => null);
    if (!response?.ok) { setTelegramMessage("Не удалось отключить Telegram."); return; }
    setTelegramStatus("disconnected");
    setTelegramLink("");
    setTelegramMessage("Telegram отключён.");
  }

  async function refreshTelegramStatus() {
    const response = await fetch("/api/telegram/link", { cache: "no-store" }).catch(() => null);
    const body = await response?.json().catch(() => ({})) as { status?: typeof telegramStatus } | undefined;
    if (response?.ok && body?.status) { setTelegramStatus(body.status); setTelegramMessage(body.status === "connected" ? "Telegram подключён." : "Подтверждение ещё не найдено."); }
    else setTelegramMessage("Не удалось проверить статус Telegram.");
  }

  function signOut() {
    setServiceWorkerAccount();
    void createClient().auth.signOut().finally(() => { window.location.assign("/login"); });
  }

  const editHabit = (habitId: string, field: "title" | "schedule" | "privateTitle", value: string) => update((previous) => ({
    ...previous,
    habits: previous.habits.map((habit) => habit.id !== habitId ? habit : { ...habit, [field]: value }),
  }));

  return <main className="shell appPage">
    <Link className="backLink" href="/today"><ArrowLeft size={18} /> Сегодня</Link>
    <header className="pageHeader"><div><p className="eyebrow">Аккаунт</p><h1>Настройки</h1></div><button className="secondary" onClick={signOut}><LogOut size={17} /> Выйти</button></header>
    {storageError && <p className="storageMessage" role="alert">{storageError}</p>}
    {legacyState && <section className="panel migrationNotice"><p className="eyebrow">Старые данные</p><h2>Найдена локальная история</h2><p>Она хранится отдельно и не открывается автоматически другому аккаунту. Перенести её в этот аккаунт?</p><button className="primary" onClick={importLegacy}>Перенести историю</button></section>}
    <section className="panel settingsEditor"><div className="sectionHeading"><div><p className="eyebrow">Telegram</p><h2>Подключение</h2></div><span className="muted" role="status">{telegramStatus === "loading" ? "Проверяю…" : telegramStatus === "connected" ? "Подключён" : telegramStatus === "error" ? "Ошибка доставки" : telegramStatus === "pending" ? "Ожидает подтверждения" : telegramStatus === "disconnected" ? "Не подключён" : "Ссылка истекла"}</span></div><div className="settingsActions"><button className="secondary" onClick={connectTelegram}>{telegramStatus === "connected" ? "Переподключить" : "Подключить"}</button>{telegramStatus === "connected" && <button className="secondary" onClick={disconnectTelegram}>Отключить</button>}<button className="secondary" onClick={refreshTelegramStatus}>Обновить статус</button></div>{telegramLink && <a className="telegramLink" href={telegramLink} target="_blank" rel="noreferrer">Открыть ссылку в Telegram</a>}{telegramMessage && <p className="storageMessage" role="status">{telegramMessage}</p>}{telegramStatus === "error" && <p className="fieldError" role="alert">Telegram отклонил доставку. Переподключи аккаунт.</p>}<div className="sectionHeading"><div><p className="eyebrow">Очередь</p><h3>Диагностика доставки</h3></div></div><p className="muted">Создаёт owner-only job на 60 секунд через notification_jobs и worker. Реальное сообщение отправится только после явного нажатия.</p><button className="secondary" onClick={scheduleTelegramTest} disabled={telegramStatus !== "connected"}>Тест через 60 секунд</button>{telegramTest && <p className="storageMessage" role="status">{telegramTest}</p>}</section>
    <section className="panel settingsEditor"><div className="sectionHeading"><div><p className="eyebrow">Приватно</p><h2>Ритм дня</h2></div><span className="muted">Названия и расписание</span></div><div className="settingsList">{state.habits.map((habit) => <article className="settingRow habitSettingRow" key={habit.id}><label>Действие<input value={habit.title} onChange={(event) => editHabit(habit.id, "title", event.target.value)} /></label><label>Когда<input value={habit.schedule} placeholder="Например, после завтрака" onChange={(event) => editHabit(habit.id, "schedule", event.target.value)} /></label><label>Название владельца<input value={habit.privateTitle ?? ""} placeholder="Необязательно" onChange={(event) => editHabit(habit.id, "privateTitle", event.target.value)} /></label></article>)}</div></section>
    <section className="panel settingsEditor">
      <label>Название программы<input value={title || template.title} onChange={(event) => setTitle(event.target.value)} /></label>
      <button className="primary" onClick={saveTitle}><Save size={18} /> Сохранить программу</button>
      <div className="sectionHeading"><h2>Упражнения</h2><button className="secondary" onClick={addExercise}><Plus size={17} /> Добавить</button></div>
      {template.exercises.map((exercise) => {
        const segments = [...new Set(exercise.sets.map((set) => set.component ?? "single"))];
        const logicalSetCount = new Set(exercise.sets.map((set, index) => set.segmentId ?? (set.component ? `pair-${Math.floor(index / 2)}` : `set-${index}`))).size;
        return <article className="settingExercise" key={exercise.id}>
          <label>Название<input value={exercise.name} onChange={(event) => editExercise(exercise.id, "name", event.target.value)} /></label>
          <label>Группа мышц<input value={exercise.muscleGroup ?? ""} placeholder="Например, грудь" onChange={(event) => editExercise(exercise.id, "muscleGroup", event.target.value)} /></label>
          <label>Оборудование<input value={exercise.equipment ?? ""} placeholder="Например, тренажёр" onChange={(event) => editExercise(exercise.id, "equipment", event.target.value)} /></label>
          <label>Положение оборудования<input value={exercise.equipmentPosition ?? ""} placeholder="Необязательно" onChange={(event) => editExercise(exercise.id, "equipmentPosition", event.target.value)} /></label>
          {segments.map((segment) => { const segmentSet = exercise.sets.find((set) => (set.component ?? "single") === segment); const segmentName = segment === "compound-a" ? "Часть A" : segment === "compound-b" ? "Часть B" : "Рабочие подходы"; const component = segment === "single" ? undefined : segment as ExerciseSet["component"]; return <div className="segmentEditor" key={segment}><strong>{segmentName}</strong><label>Вес<input type="number" min="0" step="0.5" value={segmentSet?.weightKg ?? ""} onChange={(event) => editExercise(exercise.id, "weightKg", event.target.value, component)} /></label><label>Режим<select value={segmentSet?.weightMode ?? ""} onChange={(event) => editExercise(exercise.id, "weightMode", event.target.value, component)}><option value="">Уточнить</option><option value="total">Общий вес</option><option value="per-hand">На сторону / гантель</option></select></label><label>Повторы<input type="number" min="1" max="100" value={segmentSet?.reps ?? ""} onChange={(event) => editExercise(exercise.id, "reps", event.target.value, component)} /></label></div>; })}
          <div className="setEditorActions"><span>{logicalSetCount} логич. подход{logicalSetCount === 1 ? "" : logicalSetCount < 5 ? "а" : "ов"}</span><button className="secondary" onClick={() => addSet(exercise.id)}>Добавить подход</button><button className="iconButton" onClick={() => removeSet(exercise.id)} disabled={logicalSetCount <= 1} aria-label={`Удалить последний подход ${exercise.name}`}><Trash2 size={17} /></button></div>
          <label>Отдых<select value={exercise.restSec ?? 180} onChange={(event) => editExercise(exercise.id, "restSec", event.target.value)}><option value="180">180 сек</option><option value="240">240 сек</option></select></label>
          <button className="iconButton" onClick={() => removeExercise(exercise.id)} aria-label={`Удалить ${exercise.name}`}><Trash2 size={17} /></button>
        </article>;
      })}
    </section>
  </main>;
}
