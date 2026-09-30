"use client";

import Link from "next/link";
import { ArrowLeft, Plus, Save, Undo2, X } from "lucide-react";
import { useTrackerState } from "@/components/tracker-state";
import { calculateWorkoutTotals, normalizeDecimalInput, type ExerciseSet, type WeightMode } from "@/lib/tracker";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { correctHistoricalSet, type SessionTrackerState } from "@/lib/workout-session";

type SetDraft = { weight: string; reps: string; mode: "" | WeightMode; completed: boolean; note: string };
type Addition = { id: string; exerciseId: string; newExercise: boolean; name: string; draft: SetDraft };
const emptyDraft = (): SetDraft => ({ weight: "", reps: "", mode: "", completed: true, note: "" });
const draftOf = (set: ExerciseSet): SetDraft => ({ weight: String(set.weightKg ?? ""), reps: String(set.reps ?? ""), mode: set.weightMode ?? "", completed: set.completed, note: set.note ?? "" });
function parseDraft(draft: SetDraft): Pick<ExerciseSet, "weightKg" | "reps" | "weightMode" | "completed" | "note"> | undefined {
  const weightKg = draft.weight.trim() ? normalizeDecimalInput(draft.weight) : null;
  const reps = draft.reps.trim() && /^\d+$/.test(draft.reps.trim()) ? Number(draft.reps) : null;
  if ((draft.weight.trim() && (weightKg == null || weightKg > 5000)) || (draft.reps.trim() && (reps == null || reps > 1000))) return;
  return { weightKg, reps, weightMode: draft.mode || undefined, completed: draft.completed, note: draft.note.trim() || undefined };
}
function SetFields({ draft, change }: { draft: SetDraft; change: (patch: Partial<SetDraft>) => void }) {
  return <>
    <div className="setPart"><span aria-hidden="true" /><label>Фактический вес, кг<input type="text" inputMode="decimal" autoComplete="off" maxLength={20} value={draft.weight} onChange={(event) => change({ weight: event.target.value })} /></label><label>Учёт веса<select value={draft.mode} onChange={(event) => change({ mode: event.target.value as SetDraft["mode"] })}><option value="">Неизвестно</option><option value="total">Общий вес</option><option value="per-hand">На сторону / одна гантель</option></select></label><label>Фактические повторы<input type="text" inputMode="numeric" autoComplete="off" maxLength={4} value={draft.reps} onChange={(event) => change({ reps: event.target.value })} /></label></div>
    <label className="checkLabel" style={{ display: "flex", alignItems: "center", gap: 10, margin: "12px 0" }}><input type="checkbox" checked={draft.completed} onChange={(event) => change({ completed: event.target.checked })} />Подход выполнен</label>
    <label style={{ display: "grid", gap: 8 }}>Заметка<input maxLength={4000} value={draft.note} onChange={(event) => change({ note: event.target.value })} /></label>
  </>;
}

export default function JournalWorkoutPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { state, update, storageError } = useTrackerState();
  const [routeSessionId, setRouteSessionId] = useState<string>();
  const [drafts, setDrafts] = useState<Record<string, SetDraft>>({});
  const [addition, setAddition] = useState<Addition>();
  const additionForm = useRef<HTMLFormElement>(null);
  const [message, setMessage] = useState("");
  useEffect(() => { void params.then(({ sessionId }) => setRouteSessionId(sessionId)); }, [params]);
  useEffect(() => { additionForm.current?.querySelector("input")?.focus(); }, [addition?.id]);
  if (!state) return <main className="shell"><p>Загружаю запись…</p></main>;
  const sessions = (state as SessionTrackerState).workoutSessions ?? [];
  const session = sessions.find((item) => item.id === routeSessionId || item.workoutId === routeSessionId);
  const workout = state.workouts.find((item) => item.id === (session?.workoutId ?? routeSessionId));
  if (!workout) return <main className="shell"><Link className="backLink" href="/journal"><ArrowLeft size={18} /> Журнал</Link><p>Запись не найдена.</p></main>;
  if (session?.status === "active" || state.activeWorkoutId === workout.id) return <main className="shell appPage"><Link className="backLink" href="/journal"><ArrowLeft size={18} /> Журнал</Link><h1>{workout.title}</h1><p>Эта тренировка ещё идёт.</p><Link className="primary" href={session ? `/workout/${session.id}` : "/workouts"}>Продолжить тренировку</Link></main>;
  const workoutId = workout.id;
  const totals = calculateWorkoutTotals(workout);
  const keyOf = (exerciseId: string, setId: string) => `${exerciseId}:${setId}`;
  const clearDraft = (key: string) => setDrafts((previous) => { const next = { ...previous }; delete next[key]; return next; });
  const saveSet = (event: FormEvent, exerciseId: string, setId: string) => {
    event.preventDefault();
    const key = keyOf(exerciseId, setId);
    const draft = drafts[key];
    if (!draft) return;
    const parsed = parseDraft(draft);
    if (!parsed) { setMessage("Проверьте вес (0–5000 кг, например 12,5) и целое число повторений (0–1000). Неизвестные значения можно оставить пустыми."); return; }
    let found = false;
    const saved = update((previous) => {
      if (previous.activeWorkoutId === workoutId || (previous as SessionTrackerState).workoutSessions?.some((s) => s.workoutId === workoutId && s.status === "active")) return previous;
      found = Boolean(previous.workouts.find((w) => w.id === workoutId)?.exercises.find((e) => e.id === exerciseId)?.sets.some((s) => s.id === setId));
      return correctHistoricalSet(previous, workoutId, exerciseId, setId, parsed);
    });
    if (!saved || !found) { setMessage("Исправление не сохранилось. Ваш черновик остался в полях."); return; }
    clearDraft(key); setMessage("Исправление сохранено на устройстве.");
  };
  function beginAddition(exerciseId?: string) {
    if (addition && !window.confirm("Отменить несохранённое добавление?")) return;
    setAddition({ id: `history-set-${crypto.randomUUID()}`, exerciseId: exerciseId ?? `history-exercise-${crypto.randomUUID()}`, newExercise: !exerciseId, name: "", draft: emptyDraft() });
    setMessage("");
  }
  function saveAddition(event: FormEvent) {
    event.preventDefault();
    if (!addition) return;
    const parsed = parseDraft(addition.draft);
    if (!parsed || (addition.newExercise && !addition.name.trim())) { setMessage("Укажите название упражнения и проверьте вес и повторы. Неизвестные числовые значения можно оставить пустыми."); return; }
    let found = false;
    const saved = update((previous) => {
      if (previous.activeWorkoutId === workoutId || (previous as SessionTrackerState).workoutSessions?.some((s) => s.workoutId === workoutId && s.status === "active")) return previous;
      return { ...previous, workouts: previous.workouts.map((item) => {
      if (item.id !== workoutId) return item;
      const set: ExerciseSet = { id: addition.id, ...parsed, date: item.date };
      if (addition.newExercise) {
        if (item.exercises.some((exercise) => exercise.id === addition.exerciseId)) { found = true; return item; }
        if (item.exercises.length >= 100) return item;
        found = true;
        return { ...item, exercises: [...item.exercises, { id: addition.exerciseId, name: addition.name.trim(), sets: [set] }] };
      }
      return { ...item, exercises: item.exercises.map((exercise) => {
        if (exercise.id !== addition.exerciseId) return exercise;
        if (exercise.sets.some((s) => s.id === addition.id)) { found = true; return exercise; }
        if (exercise.sets.length >= 100) return exercise;
        found = true;
        return { ...exercise, sets: [...exercise.sets, set] };
      }) };
    }) };
    });
    if (!saved || !found) { setMessage("Добавление не сохранилось. Черновик остался в полях. В записи может быть не больше 100 упражнений и 100 подходов в упражнении."); return; }
    setAddition(undefined); setMessage("Запись добавлена на устройство.");
  }
  return <main className="shell appPage">
    <Link className="backLink" href="/journal"><ArrowLeft size={18} /> Журнал</Link>
    <header className="pageHeader"><div><p className="eyebrow">{workout.date}</p><h1 style={{ overflowWrap: "anywhere" }}>{workout.title}</h1></div><strong>{totals.volumeKg.toLocaleString("ru-RU")} кг</strong></header>
    {totals.unscoredSets > 0 && <p className="muted">В объём не включены {totals.unscoredSets} подходов с неизвестным весом, повторами или способом учёта.</p>}
    {storageError && <p className="storageMessage" role="alert">{storageError}</p>}{message && <p className="storageMessage" role="status">{message}</p>}
    {workout.exercises.map((exercise) => <section className="settingsEditor" key={exercise.id}>
      <div className="sectionHeading"><h2 style={{ overflowWrap: "anywhere" }}>{exercise.name}</h2><span>{exercise.sets.filter((set) => set.completed).length}/{exercise.sets.length}</span></div>
      {exercise.sets.map((set, index) => {
        const key = keyOf(exercise.id, set.id); const draft = drafts[key] ?? draftOf(set);
        return <form className="historySet segmentEditor" style={{ gridTemplateColumns: "minmax(0, 1fr)" }} key={set.id} onSubmit={(event) => saveSet(event, exercise.id, set.id)} aria-label={`${exercise.name}, подход ${index + 1}`}>
          <h3>Подход {index + 1}{set.component === "compound-a" ? " · первая часть" : set.component === "compound-b" ? " · вторая часть" : ""}</h3>
          <SetFields draft={draft} change={(patch) => setDrafts((previous) => ({ ...previous, [key]: { ...(previous[key] ?? draftOf(set)), ...patch } }))} />
          <div className="settingsActions"><button className="secondary" type="submit" disabled={!drafts[key]}><Save size={17} />Сохранить исправление</button>{drafts[key] && <button className="secondary" type="button" onClick={() => clearDraft(key)}><Undo2 size={17} />Отменить правки</button>}</div>
        </form>;
      })}
      <button className="secondary" onClick={() => beginAddition(exercise.id)}><Plus size={18} />Добавить записанный подход</button>
    </section>)}
    <div className="settingsActions"><button className="secondary" onClick={() => beginAddition()}><Plus size={18} />Добавить упражнение в историю</button></div>
    {addition && <form ref={additionForm} className="settingsEditor" onSubmit={saveAddition} aria-label="Добавление записи в историю">
      <div className="sectionHeading"><h2>{addition.newExercise ? "Записанное упражнение" : workout.exercises.find((e) => e.id === addition.exerciseId)?.name}</h2><button type="button" className="iconButton" aria-label="Отменить добавление" title="Отменить добавление" onClick={() => setAddition(undefined)}><X size={18} /></button></div>
      {addition.newExercise && <label style={{ display: "grid", gap: 8, marginBottom: 16 }}>Название упражнения<input maxLength={200} value={addition.name} onChange={(event) => setAddition((previous) => previous ? { ...previous, name: event.target.value } : undefined)} /></label>}
      <SetFields draft={addition.draft} change={(patch) => setAddition((previous) => previous ? { ...previous, draft: { ...previous.draft, ...patch } } : undefined)} />
      <div className="settingsActions"><button className="primary" type="submit"><Save size={18} />Добавить запись</button></div>
    </form>}
  </main>;
}
