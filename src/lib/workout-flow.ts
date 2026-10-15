import { completeWorkoutSet, logicalSetKey, normalizeDecimalInput, type Exercise, type ExerciseSet, type Workout } from "./tracker.ts";
import type { SessionTrackerState } from "./workout-session.ts";

export { logicalSetKey };

export type LogicalPart = { set: ExerciseSet; index: number; label: "A" | "B" | null };
export type LogicalSet = { key: string; number: number; parts: LogicalPart[]; paired: boolean; completed: boolean };

/** Подходы упражнения так, как их видит человек: пара A/B — один подход из двух частей. */
export function logicalSets(exercise: Pick<Exercise, "sets">): LogicalSet[] {
  const groups: LogicalSet[] = [];
  for (const [index, set] of exercise.sets.entries()) {
    const key = logicalSetKey(set, index);
    const label = set.component === "compound-a" ? "A" as const : set.component === "compound-b" ? "B" as const : null;
    const existing = groups.find((group) => group.key === key);
    if (existing) existing.parts.push({ set, index, label });
    else groups.push({ key, number: groups.length + 1, parts: [{ set, index, label }], paired: false, completed: false });
  }
  for (const group of groups) {
    group.paired = group.parts.some((part) => part.label !== null);
    group.completed = group.parts.every((part) => part.set.completed);
  }
  return groups;
}

export function currentLogicalSet(exercise: Pick<Exercise, "sets">): LogicalSet | undefined {
  return logicalSets(exercise).find((group) => !group.completed);
}

export type WeightScope = "this" | "rest";

function activeContext(state: SessionTrackerState, sessionId: string, exerciseId: string) {
  const session = state.workoutSessions?.find((item) => item.id === sessionId);
  if (!session || session.status !== "active") return null;
  const workout = state.workouts.find((item) => item.id === session.workoutId);
  const exercise = workout?.exercises.find((item) => item.id === exerciseId);
  return workout && exercise ? { session, workout, exercise } : null;
}

/**
 * Смена рабочего веса в активной тренировке. Подход остаётся тем же: меняется только `weightKg`
 * (и `weightMode`, если его не было).
 *  - "this": только этот подход (в паре A/B это одна часть);
 *  - "rest": этот и все следующие незаписанные подходы той же части.
 * `remember` дополнительно переносит вес в шаблон, но только для затронутых подходов.
 */
export function setSetWeight(
  state: SessionTrackerState,
  sessionId: string,
  exerciseId: string,
  setId: string,
  weightKg: number,
  options: { scope: WeightScope; remember?: boolean },
): SessionTrackerState {
  if (!Number.isFinite(weightKg) || weightKg < 0 || weightKg > 5000) return state;
  const context = activeContext(state, sessionId, exerciseId);
  const targetIndex = context?.exercise.sets.findIndex((set) => set.id === setId) ?? -1;
  if (!context || targetIndex < 0) return state;
  const target = context.exercise.sets[targetIndex];
  if (target.completed) return state;
  const knownMode = context.exercise.sets.find((set) => set.weightMode)?.weightMode;
  const affected = new Set(context.exercise.sets.flatMap((set, index) => {
    if (set.id === setId) return [set.id];
    if (options.scope !== "rest" || set.completed || index < targetIndex) return [];
    return !target.component || set.component === target.component ? [set.id] : [];
  }));
  const apply = (set: ExerciseSet): ExerciseSet => ({ ...set, weightKg, weightMode: set.weightMode ?? knownMode });
  const prefix = `${context.workout.id}-${exerciseId}-`;
  const templateSetIds = new Set([...affected].filter((id) => id.startsWith(prefix)).map((id) => id.slice(prefix.length)));
  return {
    ...state,
    workouts: state.workouts.map((workout) => workout.id !== context.workout.id ? workout : {
      ...workout,
      exercises: workout.exercises.map((exercise) => exercise.id !== exerciseId ? exercise : { ...exercise, sets: exercise.sets.map((set) => affected.has(set.id) ? apply(set) : set) }),
    }),
    workoutTemplates: options.remember
      ? (state.workoutTemplates ?? []).map((template) => template.id !== context.session.templateId ? template : {
        ...template,
        exercises: template.exercises.map((exercise) => exercise.id !== exerciseId ? exercise : { ...exercise, sets: exercise.sets.map((set) => templateSetIds.has(set.id) ? apply(set) : set) }),
      })
      : state.workoutTemplates,
  };
}

export function parseRepsInput(raw: string): number | null {
  const text = raw.trim();
  if (!/^\d{1,3}$/.test(text)) return null;
  const value = Number(text);
  return value >= 1 && value <= 100 ? value : null;
}

export function parseWeightInput(raw: string): number | null {
  const value = normalizeDecimalInput(raw);
  return value != null && value >= 0 && value <= 5000 ? value : null;
}

/** Запись одной части подхода: помечает её выполненной, ставит команду в очередь и (после последней части) запускает отдых. */
export function recordSet(state: SessionTrackerState, sessionId: string, exerciseId: string, setId: string, reps: number, now = new Date()): SessionTrackerState {
  if (!Number.isInteger(reps) || reps < 1 || reps > 100) return state;
  const context = activeContext(state, sessionId, exerciseId);
  const current = context?.exercise.sets.find((set) => set.id === setId);
  if (!context || !current || current.completed) return state;
  const prepared: Workout = {
    ...context.workout,
    exercises: context.workout.exercises.map((item) => item.id !== exerciseId ? item : { ...item, sets: item.sets.map((set) => set.id === setId ? { ...set, reps, repsDraft: undefined } : set) }),
  };
  const nowIso = now.toISOString();
  const result = completeWorkoutSet({ workout: prepared, commands: state.workoutCommands ?? [], activeTimer: state.activeTimer }, exerciseId, setId, `session-${sessionId}-${setId}`, nowIso);
  const entityId = `${context.workout.id}:${exerciseId}:${setId}`;
  const dueAt = result.activeTimer?.sourceId === entityId ? result.activeTimer.endsAt : undefined;
  const outboxId = `out-${sessionId}-${setId}`;
  const queued = state.outbox.some((item) => item.id === outboxId);
  return {
    ...state,
    workouts: state.workouts.map((workout) => workout.id === context.workout.id ? result.workout : workout),
    workoutCommands: result.commands,
    activeTimer: result.activeTimer,
    outbox: queued ? state.outbox : [...state.outbox, {
      id: outboxId,
      entityId,
      type: "workout.set.completed",
      createdAt: nowIso,
      status: "pending",
      version: dueAt ? result.activeTimer?.version ?? 1 : 1,
      payload: {
        sessionId,
        dueAt,
        expiresAt: dueAt ? new Date(new Date(dueAt).getTime() + 120000).toISOString() : undefined,
        message: `Ритм: отдых завершен после ${context.exercise.name}. Открой тренировку для следующего шага.`,
      },
    }],
  };
}

/** Запись всего логического подхода одним действием: обе части пары подряд, отдых стартует один раз после последней. */
export function recordLogicalSet(state: SessionTrackerState, sessionId: string, exerciseId: string, entries: Array<{ setId: string; reps: number }>, now = new Date()): SessionTrackerState {
  let next = state;
  for (const entry of entries) next = recordSet(next, sessionId, exerciseId, entry.setId, entry.reps, now);
  return next;
}

/** Перейти к упражнению по номеру (в том числе назад). */
export function goToExercise(state: SessionTrackerState, sessionId: string, index: number): SessionTrackerState {
  const session = state.workoutSessions?.find((item) => item.id === sessionId);
  const workout = session && state.workouts.find((item) => item.id === session.workoutId);
  if (!session || session.status !== "active" || !workout || index < 0 || index >= workout.exercises.length || index === session.activeExerciseIndex) return state;
  return { ...state, workoutSessions: (state.workoutSessions ?? []).map((item) => item.id === sessionId ? { ...item, activeExerciseIndex: index } : item) };
}
