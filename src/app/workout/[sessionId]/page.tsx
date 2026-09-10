"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, ChevronRight, Clock, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { useTrackerState } from "@/components/tracker-state";
import { completeWorkoutSet, restoreRestTimer } from "@/lib/tracker";
import { finishWorkoutSession, type SessionTrackerState } from "@/lib/workout-session";

export default function ActiveWorkoutPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const router = useRouter();
  const { state, update } = useTrackerState();
  const [now, setNow] = useState(() => new Date().toISOString());
  const [reps, setReps] = useState("");
  const [error, setError] = useState("");
  const [routeSessionId, setRouteSessionId] = useState<string>();
  useEffect(() => { void params.then(({ sessionId }) => setRouteSessionId(sessionId)); }, [params]);
  useEffect(() => { const id = window.setInterval(() => setNow(new Date().toISOString()), 1000); return () => window.clearInterval(id); }, []);
  if (!state) return <main className="workoutMode"><p className="muted">Восстанавливаю тренировку…</p></main>;
  const sessionState = state as SessionTrackerState;
  const session = sessionState.workoutSessions?.find((item) => item.id === routeSessionId);
  const workout = session && sessionState.workouts.find((item) => item.id === session.workoutId);
  if (!session || !workout) return <main className="workoutMode"><p>Сессия не найдена.</p><Link className="secondary" href="/workouts">Вернуться к программам</Link></main>;
  if (session.status !== "active") return <main className="workoutMode"><p>Эта сессия уже закрыта.</p><Link className="secondary" href={`/workout/${session.id}/summary`}>Открыть результат</Link></main>;
  const exercise = workout.exercises[session.activeExerciseIndex] ?? workout.exercises[0];
  const setIndex = exercise?.sets.findIndex((set) => !set.completed) ?? -1;
  const currentSet = setIndex >= 0 ? exercise.sets[setIndex] : undefined;
  const rest = sessionState.activeTimer ? restoreRestTimer(sessionState.activeTimer, now) : null;
  const elapsed = Math.max(0, Math.floor((Date.parse(now) - Date.parse(session.startedAt)) / 1000));
  const completeExercise = Boolean(exercise && exercise.sets.length > 0 && exercise.sets.every((set) => set.completed));
  const record = () => {
    if (!currentSet || !exercise) return;
    const value = Number(reps || currentSet.reps || 0);
    if (!Number.isInteger(value) || value < 1 || value > 100) { setError("Укажи целое число повторений от 1 до 100."); return; }
    setError("");
    update((previous) => {
      const next = previous as SessionTrackerState;
      const activeWorkout = next.workouts.find((item) => item.id === workout.id);
      if (!activeWorkout) return previous;
      const prepared = { ...activeWorkout, exercises: activeWorkout.exercises.map((item) => item.id !== exercise.id ? item : { ...item, sets: item.sets.map((set) => set.id === currentSet.id ? { ...set, reps: value, repsDraft: undefined } : set) }) };
      const result = completeWorkoutSet({ workout: prepared, commands: next.workoutCommands ?? [], activeTimer: next.activeTimer }, exercise.id, currentSet.id, `session-${session.id}-${currentSet.id}`, new Date().toISOString());
      const outboxId = `out-${session.id}-${currentSet.id}`;
      const alreadyQueued = next.outbox.some((item) => item.id === outboxId);
      return { ...next, workouts: next.workouts.map((item) => item.id === workout.id ? result.workout : item), workoutCommands: result.commands, activeTimer: result.activeTimer, outbox: alreadyQueued ? next.outbox : [...next.outbox, { id: outboxId, entityId: `${workout.id}:${exercise.id}:${currentSet.id}`, type: "workout.set.completed", createdAt: new Date().toISOString(), status: "pending", version: 1 }] };
    });
    setReps("");
  };
  const nextExercise = () => update((previous) => ({ ...(previous as SessionTrackerState), workoutSessions: ((previous as SessionTrackerState).workoutSessions ?? []).map((item) => item.id === session.id ? { ...item, activeExerciseIndex: Math.min(item.activeExerciseIndex + 1, workout.exercises.length - 1) } : item) }));
  const finish = () => { update((previous) => finishWorkoutSession(previous as SessionTrackerState, session.id)); router.push(`/workout/${session.id}/summary`); };
  const collapse = () => { if (reps !== "") update((previous) => ({ ...previous, workouts: previous.workouts.map((item) => item.id !== workout.id ? item : { ...item, exercises: item.exercises.map((itemExercise) => itemExercise.id !== exercise.id ? itemExercise : { ...itemExercise, sets: itemExercise.sets.map((set) => set.id === currentSet?.id ? { ...set, repsDraft: reps } : set) }) }) })); router.push("/workouts"); };
  return <main className="workoutMode"><header className="workoutTop"><button className="iconButton" aria-label="Свернуть" onClick={collapse}><ArrowLeft size={20} /></button><span className="workoutTimer"><Clock size={16} /> {formatTime(elapsed)}</span></header>
    <div className="workoutProgress"><span>Упражнение {session.activeExerciseIndex + 1} из {workout.exercises.length}</span><span>{completeExercise ? "Готово" : `Подход ${Math.max(1, setIndex + 1)} из ${exercise.sets.length}`}</span></div>
    <section className="activeExercise"><p className="eyebrow">Текущее упражнение</p><h1>{exercise.name}</h1><p className="muted">{exercise.settings ?? "Рабочий подход"}</p>
      {rest && !rest.expired && <div className="restState"><span>Отдых</span><strong>{formatTime(rest.remainingSec)}</strong><small>Следующий подход {Math.min(setIndex + 1, exercise.sets.length)} из {exercise.sets.length}</small><button className="secondary" onClick={() => update((previous) => ({ ...previous, activeTimer: null }))}><Play size={16} /> Пропустить отдых</button></div>}
      {(!rest || rest.expired) && !completeExercise && <div className="setState"><p className="eyebrow">Подход {Math.max(1, setIndex + 1)} из {exercise.sets.length}</p><div className="workWeight"><strong>{currentSet?.weightKg ?? "—"}</strong><span>{currentSet?.weightMode === "per-hand" ? "кг на сторону" : currentSet?.weightMode === "total" ? "кг общий вес" : "кг · уточнить"}</span></div><label>Фактические повторения<input autoComplete="off" inputMode="numeric" value={reps} onChange={(event) => setReps(event.target.value)} placeholder={`План: ${currentSet?.reps ?? "—"}`} /></label>{error && <p className="fieldError" role="alert">{error}</p>}<button className="primary recordButton" onClick={record}><Check size={20} /> Записать {reps || "повторения"}</button></div>}
      {completeExercise && <div className="completeState"><Check size={28} /><h2>Упражнение завершено</h2>{session.activeExerciseIndex < workout.exercises.length - 1 ? <button className="primary" onClick={nextExercise}>Следующее упражнение <ChevronRight size={20} /></button> : <button className="primary" onClick={finish}>Завершить тренировку</button>}</div>}
    </section></main>;
}

function formatTime(value: number) { return `${Math.floor(value / 60).toString().padStart(2, "0")}:${(value % 60).toString().padStart(2, "0")}`; }
