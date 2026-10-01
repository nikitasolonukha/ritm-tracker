"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, ChevronRight, Clock, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTrackerState } from "@/components/tracker-state";
import { completeWorkoutSet, createRestTimerCommand, restoreRestTimer, visibleCopy } from "@/lib/tracker";
import { cancelWorkoutSession, finishWorkoutSession, type SessionTrackerState } from "@/lib/workout-session";

export default function ActiveWorkoutPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const router = useRouter();
  const { state, update, userId, syncStatus, storageError } = useTrackerState();
  const [now, setNow] = useState(() => new Date().toISOString());
  const [reps, setReps] = useState("");
  const [repsTouched, setRepsTouched] = useState(false);
  const [error, setError] = useState("");
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [confirmEarly, setConfirmEarly] = useState(false);
  const [finishError, setFinishError] = useState("");
  const [weightEditorOpen, setWeightEditorOpen] = useState(false);
  const [weightDraft, setWeightDraft] = useState("");
  const [rememberWeight, setRememberWeight] = useState(false);
  const [weightScope, setWeightScope] = useState<"current" | "remaining">("current");
  const [routeSessionId, setRouteSessionId] = useState<string>();
  const draftKeyRef = useRef<string | undefined>(undefined);
  const draftStorageKeyRef = useRef<string | undefined>(undefined);
  const weightDialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const weightTriggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { void params.then(({ sessionId }) => setRouteSessionId(sessionId)); }, [params]);
  useEffect(() => { const id = window.setInterval(() => setNow(new Date().toISOString()), 1000); return () => window.clearInterval(id); }, []);
  useEffect(() => {
    if (!state || !routeSessionId) return;
    const session = (state as SessionTrackerState).workoutSessions?.find((item) => item.id === routeSessionId);
    const workout = session && state.workouts.find((item) => item.id === session.workoutId);
    const exercise = workout && workout.exercises[session?.activeExerciseIndex ?? 0];
    const set = exercise?.sets.find((item) => !item.completed);
    const draftKey = `${routeSessionId}:${exercise?.id ?? "none"}:${set?.id ?? "complete"}`;
    if (draftKeyRef.current === draftKey) return;
    draftKeyRef.current = draftKey;
    const storageKey = `ritm-workout-draft:${userId}:${draftKey}`;
    draftStorageKeyRef.current = storageKey;
    let storedDraft: string | null = null;
    try { storedDraft = window.localStorage.getItem(storageKey); } catch { /* private mode can deny storage */ }
    setReps(storedDraft ?? set?.repsDraft ?? (set?.reps == null ? "" : String(set.reps)));
    setRepsTouched(false);
    setWeightDraft(set?.weightKg == null ? "" : String(set.weightKg));
    setWeightEditorOpen(false);
  }, [state, routeSessionId, userId]);
  useEffect(() => {
    if (!repsTouched || !draftStorageKeyRef.current) return;
    try { window.localStorage.setItem(draftStorageKeyRef.current, reps); } catch { /* local state remains the fallback */ }
  }, [reps, repsTouched]);
  useEffect(() => {
    if (!weightEditorOpen) return;
    previousFocusRef.current = weightTriggerRef.current ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setWeightEditorOpen(false); return; }
      if (event.key !== "Tab" || !weightDialogRef.current) return;
      const focusable = Array.from(weightDialogRef.current.querySelectorAll<HTMLElement>("button, input, [tabindex]:not([tabindex='-1'])")).filter((item) => !item.hasAttribute("disabled"));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", closeOnEscape);
    window.setTimeout(() => weightDialogRef.current?.querySelector<HTMLInputElement>("input")?.focus(), 0);
    return () => { window.removeEventListener("keydown", closeOnEscape); previousFocusRef.current?.focus(); };
  }, [weightEditorOpen]);
  if (!state) return <main className="workoutMode"><p className="muted">Восстанавливаю тренировку…</p></main>;
  const sessionState = state as SessionTrackerState;
  const session = sessionState.workoutSessions?.find((item) => item.id === routeSessionId);
  const workout = session && sessionState.workouts.find((item) => item.id === session.workoutId);
  if (!session || !workout) return <main className="workoutMode"><p>Сессия не найдена.</p><Link className="secondary" href="/workouts">Вернуться к программам</Link></main>;
  if (session.status !== "active") return <main className="workoutMode"><p>Эта сессия уже закрыта.</p><Link className="secondary" href={`/workout/${session.id}/summary`}>Открыть результат</Link></main>;
  const exercise = workout.exercises[session.activeExerciseIndex] ?? workout.exercises[0];
  const setIndex = exercise?.sets.findIndex((set) => !set.completed) ?? -1;
  const currentSet = setIndex >= 0 ? exercise.sets[setIndex] : undefined;
  const logicalSetKey = (set: NonNullable<typeof currentSet>, index: number) => set.segmentId ?? (set.component && set.component !== "single" ? `pair-${Math.floor(index / 2)}` : `set-${index}`);
  const logicalSetKeys = exercise?.sets.map(logicalSetKey) ?? [];
  const logicalSets = [...new Set(logicalSetKeys)];
  const currentLogicalIndex = currentSet && setIndex >= 0 ? logicalSets.indexOf(logicalSetKeys[setIndex] ?? "") : -1;
  const rest = sessionState.activeTimer ? restoreRestTimer(sessionState.activeTimer, now) : null;
  const restSetId = sessionState.activeTimer?.sourceId?.split(":").at(-1);
  const restSet = restSetId ? exercise.sets.find((set) => set.id === restSetId) : undefined;
  const elapsed = Math.max(0, Math.floor((Date.parse(now) - Date.parse(session.startedAt)) / 1000));
  const completeExercise = Boolean(exercise && exercise.sets.length > 0 && exercise.sets.every((set) => set.completed));
  const record = () => {
    if (!currentSet || !exercise) return;
    const raw = reps.trim();
    if (!raw) { setError("Введи фактическое число повторений."); return; }
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1 || value > 100) { setError("Укажи целое число повторений от 1 до 100."); return; }
    setError("");
    const saved = update((previous) => {
      const next = previous as SessionTrackerState;
      const activeWorkout = next.workouts.find((item) => item.id === workout.id);
      if (!activeWorkout) return previous;
      if (activeWorkout.exercises.find((e) => e.id===exercise.id)?.sets.find((s) => s.id===currentSet.id)?.completed) return previous;
      const prepared = { ...activeWorkout, exercises: activeWorkout.exercises.map((item) => item.id !== exercise.id ? item : { ...item, sets: item.sets.map((set) => set.id === currentSet.id ? { ...set, reps: value, repsDraft: undefined } : set) }) };
      const result = completeWorkoutSet({ workout: prepared, commands: next.workoutCommands ?? [], activeTimer: next.activeTimer }, exercise.id, currentSet.id, `session-${session.id}-${currentSet.id}`, new Date().toISOString());
      const entityId = `${workout.id}:${exercise.id}:${currentSet.id}`;
      const dueAt = result.activeTimer?.sourceId === entityId ? result.activeTimer.endsAt : undefined;
      const outboxId = `out-${session.id}-${currentSet.id}`;
      const alreadyQueued = next.outbox.some((item) => item.id === outboxId);
      return { ...next, workouts: next.workouts.map((item) => item.id === workout.id ? result.workout : item), workoutCommands: result.commands, activeTimer: result.activeTimer, outbox: alreadyQueued ? next.outbox : [...next.outbox, { id: outboxId, entityId, type: "workout.set.completed", createdAt: new Date().toISOString(), status: "pending", version: dueAt ? result.activeTimer?.version ?? 1 : 1, payload: { sessionId: session.id, dueAt, expiresAt: dueAt ? new Date(new Date(dueAt).getTime() + 120000).toISOString() : undefined, message: `Ритм: отдых завершен после ${exercise.name}. Открой тренировку для следующего шага.` } }] };
    });
    if (saved) {
      if (draftStorageKeyRef.current) { try { window.localStorage.removeItem(draftStorageKeyRef.current); } catch { /* ignore storage cleanup errors */ } }
      setReps(""); setRepsTouched(false);
    } else setError("Не удалось сохранить подход. Черновик оставлен, повтори действие.");
  };
  const changeRestTimer = (action: "reschedule" | "cancel") => update((previous) => {
    const next = previous as SessionTrackerState;
    const timer = next.activeTimer;
    const nowIso = new Date().toISOString();
    if (!timer) return previous;
    const mutation = createRestTimerCommand(timer, action, nowIso, `Ритм: отдых завершен после ${exercise.name}. Открой тренировку для следующего шага.`);
    if (!mutation) return previous;
    const nextOutbox = next.outbox.map((item) => item.entityId === timer.sourceId && ["timer.rescheduled", "timer.cancelled"].includes(item.type) && item.status === "pending" ? { ...item, status: "cancelled" as const } : item);
    return {
      ...next,
      activeTimer: mutation.timer,
      outbox: [...nextOutbox, mutation.command],
    };
  });
  const nextExercise = () => update((previous) => ({ ...(previous as SessionTrackerState), workoutSessions: ((previous as SessionTrackerState).workoutSessions ?? []).map((item) => item.id === session.id ? { ...item, activeExerciseIndex: Math.min(item.activeExerciseIndex + 1, workout.exercises.length - 1) } : item) }));
  const commitFinish = () => { const saved = update((previous) => finishWorkoutSession(previous as SessionTrackerState, session.id)); if (saved) router.push(`/workout/${session.id}/summary`); };
  const finish = () => { if (!workout.exercises.some((e) => e.sets.some((set) => set.completed))) { setFinishError("Пока нет записанных подходов. Запишите подход или отмените тренировку."); return; } if (!confirmFinish) { setFinishError(""); setConfirmFinish(true); return; } commitFinish(); };
  const finishEarly = () => { if (!workout.exercises.some((e) => e.sets.some((set) => set.completed))) { setFinishError("Пока нет записанных подходов. Запишите подход или отмените тренировку."); return; } if (!confirmEarly) { setFinishError(""); setConfirmEarly(true); return; } commitFinish(); };
  const cancel = () => { if (!window.confirm("Отменить тренировку? Записанные подходы сохранятся, но занятие не попадёт в недельную цель.")) return; const saved = update((previous) => cancelWorkoutSession(previous as SessionTrackerState, session.id)); if (saved) router.push("/workouts"); };
  const collapse = () => { const saved = repsTouched ? update((previous) => ({ ...previous, workouts: previous.workouts.map((item) => item.id !== workout.id ? item : { ...item, exercises: item.exercises.map((itemExercise) => itemExercise.id !== exercise.id ? itemExercise : { ...itemExercise, sets: itemExercise.sets.map((set) => set.id === currentSet?.id ? { ...set, repsDraft: reps } : set) }) }) })) : true; if (saved) router.push("/workouts"); };
  const saveWeight = () => {
    const rawWeight = weightDraft.trim();
    const value = Number(rawWeight.replace(",", "."));
    if (!currentSet || !rawWeight || !Number.isFinite(value) || value < 0) { setError("Укажи корректный вес."); return; }
    const saved = update((previous) => {
      const next = previous as SessionTrackerState;
      const currentIndex = exercise.sets.findIndex((set) => set.id === currentSet.id);
      const component = currentSet.component;
      const appliesToSet = (set: NonNullable<typeof currentSet>, index: number) => set.id === currentSet.id || (weightScope === "remaining" && index >= currentIndex && (!component || set.component === component));
      return { ...next, workouts: next.workouts.map((item) => item.id !== workout.id ? item : { ...item, exercises: item.exercises.map((itemExercise) => itemExercise.id !== exercise.id ? itemExercise : { ...itemExercise, sets: itemExercise.sets.map((set, index) => appliesToSet(set, index) ? { ...set, weightKg: value } : set) }) }), workoutTemplates: rememberWeight ? (next.workoutTemplates ?? []).map((item) => item.id !== session.templateId ? item : { ...item, exercises: item.exercises.map((itemExercise) => itemExercise.id !== exercise.id ? itemExercise : { ...itemExercise, sets: itemExercise.sets.map((set) => !component || set.component === component ? { ...set, weightKg: value } : set) }) }) : next.workoutTemplates };
    });
    if (saved) { setError(""); setWeightEditorOpen(false); }
  };
  return <main className="workoutMode"><header className="workoutTop"><button className="iconButton" aria-label="Свернуть" onClick={collapse}><ArrowLeft size={20} /></button><span className="workoutTimer"><Clock size={16} /> {formatTime(elapsed)}</span><button className="secondary" onClick={cancel}>Отменить</button></header>
    <p className="workoutSync" role="status">{syncStatus === "idle" ? "Сохранено" : syncStatus === "syncing" || syncStatus === "dirty" ? "На устройстве · отправляем на сервер" : "На устройстве · нет подтверждения сервера"}</p>
    {storageError && <p className="storageMessage" role="alert">{storageError}</p>}
    <div className="workoutProgress"><span>Упражнение {session.activeExerciseIndex + 1} из {workout.exercises.length}</span><span>{completeExercise ? "Готово" : `Подход ${Math.max(1, currentLogicalIndex + 1)} из ${logicalSets.length}`}</span></div>
    <section className="activeExercise"><p className="eyebrow">Текущее упражнение</p><h1>{exercise.name}</h1><p className="muted">{visibleCopy(exercise.settings) || "Рабочий подход"}</p>
      {rest && !rest.expired && <div className="restState"><span>Отдых</span><strong>{formatTime(rest.remainingSec)}</strong><small>Записано: {restSet?.weightKg ?? "—"} × {restSet?.reps ?? "—"}</small><small>{completeExercise ? (session.activeExerciseIndex < workout.exercises.length - 1 ? "Следующее упражнение готово" : "Программа почти завершена") : `Далее — подход ${Math.min(currentLogicalIndex + 1, logicalSets.length)} из ${logicalSets.length}`}</small><div className="restBar"><span style={{ width: `${Math.max(0, Math.min(100, (rest.remainingSec / (sessionState.activeTimer?.durationSec || 1)) * 100))}%` }} /></div><div className="restActions"><button className="secondary" onClick={() => changeRestTimer("reschedule")}>+30 секунд</button><button className="secondary" onClick={() => changeRestTimer("cancel")}><Play size={16} /> Пропустить отдых</button></div></div>}
      {(!rest || rest.expired) && !completeExercise && <div className="setState"><p className="eyebrow">Подход {Math.max(1, currentLogicalIndex + 1)} из {logicalSets.length}</p><div className="setSegments" aria-label="Подходы">{logicalSets.map((key, index) => { const group = exercise.sets.filter((item, itemIndex) => logicalSetKeys[itemIndex] === key); const done = group.every((item) => item.completed); return <span className={done ? "done" : index === currentLogicalIndex ? "current" : ""} key={key}>{index + 1}</span>; })}</div><div className="workWeight"><strong>{currentSet?.weightKg ?? "—"}</strong><span>{currentSet?.weightMode === "per-hand" ? "кг на сторону" : currentSet?.weightMode === "total" ? "кг общий вес" : "кг · уточнить"}</span><button ref={weightTriggerRef} className="secondary weightEditButton" onClick={() => setWeightEditorOpen((value) => !value)}>Изменить</button></div>{weightEditorOpen && <div ref={weightDialogRef} className="weightEditor" role="dialog" aria-modal="true" aria-label="Изменить рабочий вес"><h2>Рабочий вес</h2><label>Вес<input inputMode="decimal" value={weightDraft} onChange={(event) => setWeightDraft(event.target.value)} /></label><fieldset className="weightScope"><legend>Применить</legend><label><input type="radio" checked={weightScope === "current"} onChange={() => setWeightScope("current")} /> Только этот подход</label><label><input type="radio" checked={weightScope === "remaining"} onChange={() => setWeightScope("remaining")} /> Этот и оставшиеся</label></fieldset><label className="checkLabel"><input type="checkbox" checked={rememberWeight} onChange={(event) => setRememberWeight(event.target.checked)} /> Запомнить для следующих тренировок</label><div className="weightEditorActions"><button className="secondary" onClick={() => setWeightEditorOpen(false)}>Отмена</button><button className="primary" onClick={saveWeight}>Сохранить</button></div></div>}<label className="repsField">Фактические повторения<div className="repsControl"><button type="button" aria-label="Уменьшить" onClick={() => { setRepsTouched(true); setReps(String(Math.max(0, Number(reps || 0) - 1))); }}>−</button><input autoComplete="off" inputMode="numeric" value={reps} onChange={(event) => { setRepsTouched(true); setReps(event.target.value); }} placeholder={`${currentSet?.reps ?? "—"}`} /><button type="button" aria-label="Увеличить" onClick={() => { setRepsTouched(true); setReps(String(Math.min(100, Number(reps || 0) + 1))); }}>+</button></div><small>План: {currentSet?.reps ?? "не задан"}. Это только подсказка.</small></label>{error && <p className="fieldError" role="alert">{error}</p>}<button className="primary recordButton" onClick={record}><Check size={20} /> Записать {reps || "повторения"}</button></div>}
      {completeExercise && <div className="completeState"><Check size={28} /><h2>Упражнение завершено</h2>{session.activeExerciseIndex < workout.exercises.length - 1 ? <button className="primary" onClick={nextExercise}>Следующее упражнение <ChevronRight size={20} /></button> : <button className="primary" onClick={finish}>{confirmFinish ? "Подтвердить завершение" : "Завершить тренировку"}</button>}</div>}
    </section>
    {!completeExercise && <div className="earlyFinish">{finishError && <p className="fieldError" role="alert">{finishError}</p>}{confirmEarly ? <><p>Незаписанные подходы не попадут в результат. В недельной цели останутся только уже записанные подходы.</p><div className="finishActions"><button className="secondary" type="button" onClick={() => { setConfirmEarly(false); setFinishError(""); }}>Продолжить занятие</button><button className="secondary dangerButton" type="button" onClick={finishEarly}>Подтвердить завершение</button></div></> : <button className="secondary" type="button" onClick={finishEarly}>Завершить досрочно</button>}</div>}
    </main>;
}

function formatTime(value: number) { return `${Math.floor(value / 60).toString().padStart(2, "0")}:${(value % 60).toString().padStart(2, "0")}`; }
