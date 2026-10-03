"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus, Save, Trash2, Undo2, X } from "lucide-react";
import { useTrackerState } from "@/components/tracker-state";
import { Notice, PageHeader, useConfirm } from "@/components/ui";
import { calculateWorkoutTotals, formatLocalDate, normalizeDecimalInput, russianWord, type ExerciseSet, type WeightMode } from "@/lib/tracker";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { correctHistoricalSet, removeHistoricalExercise, removeHistoricalSet, removeHistoricalWorkout, type SessionTrackerState } from "@/lib/workout-session";
import { AppSelect } from "@/components/app-select";

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
    <div className="setPart"><label>Фактический вес, кг<input type="text" inputMode="decimal" autoComplete="off" maxLength={20} value={draft.weight} onChange={(event) => change({ weight: event.target.value })} /></label><label>Фактические повторы<input type="text" inputMode="numeric" autoComplete="off" maxLength={4} value={draft.reps} onChange={(event) => change({ reps: event.target.value })} /></label><label>Учёт веса<AppSelect value={draft.mode} onChange={(value) => change({ mode: value as SetDraft["mode"] })}><option value="">Неизвестно</option><option value="total">Общий вес</option><option value="per-hand">На сторону / одна гантель</option></AppSelect></label></div>
    <label className="checkLabel"><input type="checkbox" checked={draft.completed} onChange={(event) => change({ completed: event.target.checked })} />Подход выполнен</label>
    <label>Заметка<input maxLength={4000} value={draft.note} onChange={(event) => change({ note: event.target.value })} /></label>
  </>;
}

export default function JournalWorkoutPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const router = useRouter();
  const { state, update, storageError } = useTrackerState();
  const { confirm, dialog } = useConfirm();
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
  async function beginAddition(exerciseId?: string) {
    if (addition && !(await confirm("Несохранённое добавление будет потеряно.", { title: "Отменить добавление?", danger: true, confirmLabel: "Отменить" }))) return;
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
  async function removeSet(exerciseId: string, setId: string, index: number) {
    const exercise = workout?.exercises.find((item) => item.id === exerciseId);
    if (!exercise) return;
    const lastSet = exercise.sets.length <= 1;
    const lastExercise = lastSet && workout!.exercises.length <= 1;
    const message = lastExercise ? "Это последний подход в записи. Удалить всю тренировку из журнала?" : lastSet ? `Это последний подход. Удалить упражнение «${exercise.name}» из записи?` : `Удалить подход ${index + 1} из «${exercise.name}»? Объём пересчитается.`;
    if (!(await confirm(message, { danger: true }))) return;
    const saved = update((previous) => removeHistoricalSet(previous as SessionTrackerState, workoutId, exerciseId, setId));
    if (!saved) { setMessage("Удаление не сохранилось."); return; }
    if (lastExercise) router.push("/journal");
    else setMessage(lastSet ? "Упражнение удалено из записи." : "Подход удалён из записи.");
  }
  async function removeExercise(exerciseId: string, name: string) {
    const lastExercise = workout!.exercises.length <= 1;
    if (!(await confirm(lastExercise ? "Это единственное упражнение. Удалить всю тренировку из журнала?" : `Удалить «${name}» из записи? Подходы этого упражнения исчезнут из объёма.`, { danger: true }))) return;
    const saved = update((previous) => removeHistoricalExercise(previous as SessionTrackerState, workoutId, exerciseId));
    if (!saved) { setMessage("Удаление не сохранилось."); return; }
    if (lastExercise) router.push("/journal");
    else setMessage("Упражнение удалено из записи.");
  }
  async function removeWorkout() {
    if (!(await confirm(`Удалить тренировку «${workout!.title}» из журнала? Записанные подходы исчезнут из истории и из недельной цели.`, { danger: true }))) return;
    const saved = update((previous) => removeHistoricalWorkout(previous as SessionTrackerState, workoutId));
    if (saved) router.push("/journal");
    else setMessage("Удаление не сохранилось.");
  }
  return <main className="shell appPage">
    <Link className="backLink" href="/journal"><ArrowLeft size={18} /> Журнал</Link>
    <PageHeader eyebrow={formatLocalDate(workout.date)} title={workout.title} actions={<span className="volumeBadge">{totals.volumeKg.toLocaleString("ru-RU")} кг</span>} />
    {totals.unscoredSets > 0 && <p className="muted">Объём не считает {totals.unscoredSets} {russianWord(totals.unscoredSets, "подход", "подхода", "подходов")}: нет веса, повторов или способа учёта.</p>}
    {storageError && <Notice tone="warning">{storageError}</Notice>}{message && <Notice tone={/не сохран|Проверьте|Укажите/.test(message) ? "warning" : "success"}>{message}</Notice>}
    {workout.exercises.map((exercise, exerciseIndex) => <details className="settingsEditor historyExercise" key={exercise.id} open={exerciseIndex === 0 || exercise.sets.some((set) => set.completed)}>
      <summary><h2>{exercise.name}</h2><span>{exercise.sets.filter((set) => set.completed).length}/{exercise.sets.length}</span></summary>
      {exercise.sets.map((set, index) => {
        const key = keyOf(exercise.id, set.id); const draft = drafts[key] ?? draftOf(set);
        return <form className="historySet" key={set.id} onSubmit={(event) => saveSet(event, exercise.id, set.id)} aria-label={`${exercise.name}, подход ${index + 1}`}>
          <h3>Подход {index + 1}{set.component === "compound-a" ? " · первая часть" : set.component === "compound-b" ? " · вторая часть" : ""}</h3>
          <SetFields draft={draft} change={(patch) => setDrafts((previous) => ({ ...previous, [key]: { ...(previous[key] ?? draftOf(set)), ...patch } }))} />
          <div className="settingsActions"><button className="secondary" type="submit" disabled={!drafts[key]}><Save size={17} />Сохранить исправление</button>{drafts[key] && <button className="secondary" type="button" onClick={() => clearDraft(key)}><Undo2 size={17} />Отменить правки</button>}<button className="secondary dangerButton" type="button" aria-label="Удалить подход" title="Удалить подход" onClick={() => removeSet(exercise.id, set.id, index)}><Trash2 size={17} />Удалить</button></div>
        </form>;
      })}
      <div className="settingsActions"><button className="secondary" onClick={() => beginAddition(exercise.id)}><Plus size={18} />Добавить записанный подход</button><button className="secondary dangerButton" type="button" onClick={() => removeExercise(exercise.id, exercise.name)}><Trash2 size={17} />Удалить упражнение</button></div>
    </details>)}
    <div className="settingsActions"><button className="secondary" onClick={() => beginAddition()}><Plus size={18} />Добавить упражнение в историю</button><button className="secondary dangerButton" type="button" onClick={removeWorkout}><Trash2 size={17} />Удалить тренировку</button></div>
    {addition && <form ref={additionForm} className="settingsEditor" onSubmit={saveAddition} aria-label="Добавление записи в историю">
      <div className="sectionHeading"><h2>{addition.newExercise ? "Записанное упражнение" : workout.exercises.find((e) => e.id === addition.exerciseId)?.name}</h2><button type="button" className="iconButton" aria-label="Отменить добавление" title="Отменить добавление" onClick={() => setAddition(undefined)}><X size={18} /></button></div>
      {addition.newExercise && <label style={{ display: "grid", gap: 8, marginBottom: 16 }}>Название упражнения<input maxLength={200} value={addition.name} onChange={(event) => setAddition((previous) => previous ? { ...previous, name: event.target.value } : undefined)} /></label>}
      <SetFields draft={addition.draft} change={(patch) => setAddition((previous) => previous ? { ...previous, draft: { ...previous.draft, ...patch } } : undefined)} />
      <div className="settingsActions"><button className="primary" type="submit"><Save size={18} />Добавить запись</button></div>
    </form>}
    {dialog}
  </main>;
}
