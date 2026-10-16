import { completeWorkoutSet, logicalSetKey, normalizeDecimalInput, type Exercise, type ExerciseSet, type Workout, type WeightMode } from "./tracker.ts";
import { planWarmups } from "./warmups.ts";
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

/**
 * Добавляет ещё один подход в конец упражнения во время тренировки: копия последнего подхода без отметки.
 * Для упражнения с правой и левой стороной добавляется целая пара.
 */
export function addExtraSet(state: SessionTrackerState, sessionId: string, exerciseId: string, seed: string = globalThis.crypto?.randomUUID?.() ?? String(Date.now())): SessionTrackerState {
  const context = activeContext(state, sessionId, exerciseId);
  if (!context || context.exercise.sets.length === 0 || context.exercise.sets.length >= 100) return state;
  const groups = logicalSets(context.exercise);
  const last = groups.at(-1);
  if (!last) return state;
  const copies: ExerciseSet[] = last.parts.map((part, index) => ({
    ...part.set,
    id: `${context.workout.id}-${exerciseId}-extra-${seed}-${index}`,
    completed: false,
    note: undefined,
    weightDraft: undefined,
    repsDraft: undefined,
    ...(last.paired ? { segmentId: `pair-extra-${seed}` } : {}),
  }));
  return {
    ...state,
    workouts: state.workouts.map((workout) => workout.id !== context.workout.id ? workout : {
      ...workout,
      exercises: workout.exercises.map((exercise) => exercise.id !== exerciseId ? exercise : { ...exercise, sets: [...exercise.sets, ...copies] }),
    }),
  };
}

export type NewExerciseInput = {
  name: string;
  sets: number;
  weightKg: number | null;
  reps: number | null;
  weightMode: WeightMode;
  paired?: boolean;
  restSec?: number;
  muscleGroup?: string;
  equipment?: string;
};

/**
 * Добавляет упражнение в конец идущей тренировки и делает его текущим. Шаблон программы не меняется:
 * упражнение есть только в этой тренировке. «Парное» создаёт для каждого подхода правую и левую часть.
 */
export function addExerciseToSession(state: SessionTrackerState, sessionId: string, input: NewExerciseInput, seed: string = globalThis.crypto?.randomUUID?.() ?? String(Date.now())): SessionTrackerState {
  const session = state.workoutSessions?.find((item) => item.id === sessionId);
  const workout = session && session.status === "active" ? state.workouts.find((item) => item.id === session.workoutId) : undefined;
  const name = input.name.trim().replace(/\s+/g, " ");
  if (!session || !workout || !name || name.length > 80 || workout.exercises.length >= 30) return state;
  const count = Math.min(10, Math.max(1, Math.trunc(input.sets)));
  const exerciseId = `${workout.id}-added-${seed}`;
  const base = { weightKg: input.weightKg, reps: input.reps, completed: false, weightMode: input.weightMode } as const;
  const sets: ExerciseSet[] = Array.from({ length: count }, (_, index) => input.paired
    ? [
      { ...base, id: `${exerciseId}-set-${index}-a`, component: "compound-a" as const, segmentId: `pair-${seed}-${index}` },
      { ...base, id: `${exerciseId}-set-${index}-b`, component: "compound-b" as const, segmentId: `pair-${seed}-${index}` },
    ]
    : [{ ...base, id: `${exerciseId}-set-${index}`, component: "single" as const }]).flat();
  const exercise: Exercise = {
    id: exerciseId,
    name,
    sets,
    ...(input.restSec ? { restSec: input.restSec } : {}),
    ...(input.muscleGroup ? { muscleGroup: input.muscleGroup } : {}),
    ...(input.equipment ? { equipment: input.equipment } : {}),
  };
  return {
    ...state,
    workouts: state.workouts.map((item) => item.id === workout.id ? { ...item, exercises: [...item.exercises, exercise] } : item),
    workoutSessions: (state.workoutSessions ?? []).map((item) => item.id === sessionId ? { ...item, activeExerciseIndex: workout.exercises.length } : item),
  };
}

function mapExercise(state: SessionTrackerState, workoutId: string, exerciseId: string, change: (exercise: Exercise) => Exercise): SessionTrackerState {
  return { ...state, workouts: state.workouts.map((workout) => workout.id !== workoutId ? workout : { ...workout, exercises: workout.exercises.map((exercise) => exercise.id === exerciseId ? change(exercise) : exercise) }) };
}

/** Следующая невыполненная разминка, пока ни один рабочий подход не записан. */
export function currentWarmup(exercise: Pick<Exercise, "sets" | "warmups">) {
  if (exercise.sets.some((set) => set.completed)) return undefined;
  return exercise.warmups?.find((warmup) => !warmup.completed);
}

export function setWarmupWeight(state: SessionTrackerState, sessionId: string, exerciseId: string, warmupId: string, kg: number): SessionTrackerState {
  const context = activeContext(state, sessionId, exerciseId);
  if (!context || !Number.isFinite(kg) || kg < 0 || kg > 5000 || !context.exercise.warmups?.some((warmup) => warmup.id === warmupId && !warmup.completed)) return state;
  return mapExercise(state, context.workout.id, exerciseId, (exercise) => ({ ...exercise, warmups: exercise.warmups?.map((warmup) => warmup.id === warmupId ? { ...warmup, weightKg: kg } : warmup) }));
}

/** Запись разминочного подхода. Без отдыха и без напоминаний: разминка короткая и в статистику не идёт. */
export function recordWarmup(state: SessionTrackerState, sessionId: string, exerciseId: string, warmupId: string, reps: number): SessionTrackerState {
  const context = activeContext(state, sessionId, exerciseId);
  if (!context || !Number.isInteger(reps) || reps < 1 || reps > 100 || !context.exercise.warmups?.some((warmup) => warmup.id === warmupId && !warmup.completed)) return state;
  return mapExercise(state, context.workout.id, exerciseId, (exercise) => ({ ...exercise, warmups: exercise.warmups?.map((warmup) => warmup.id === warmupId ? { ...warmup, reps, completed: true } : warmup) }));
}

/** Убирает невыполненную разминку (записанная остаётся). */
export function skipWarmups(state: SessionTrackerState, sessionId: string, exerciseId: string): SessionTrackerState {
  const context = activeContext(state, sessionId, exerciseId);
  if (!context || !context.exercise.warmups?.some((warmup) => !warmup.completed)) return state;
  return mapExercise(state, context.workout.id, exerciseId, (exercise) => {
    const kept = (exercise.warmups ?? []).filter((warmup) => warmup.completed);
    return { ...exercise, warmups: kept.length ? kept : undefined };
  });
}

/** Добавляет разминку в упражнение, где её не было, пока рабочие подходы не начались. */
export function addWarmups(state: SessionTrackerState, sessionId: string, exerciseId: string, count: number, seed: string = globalThis.crypto?.randomUUID?.() ?? String(Date.now())): SessionTrackerState {
  const context = activeContext(state, sessionId, exerciseId);
  if (!context || context.exercise.warmups?.length || context.exercise.sets.some((set) => set.completed)) return state;
  const planned = planWarmups(count, context.exercise.sets[0]?.weightKg, `${exerciseId}-${seed}`);
  return planned.length ? mapExercise(state, context.workout.id, exerciseId, (exercise) => ({ ...exercise, warmups: planned })) : state;
}

/**
 * Настройки тренажёра («сиденье 4, спинка 2») для упражнения: в идущей тренировке и в программе, из которой она запущена.
 * Пустая строка стирает настройки. В программе упражнение ищется по тому же id, что был при старте.
 */
export function setExerciseSettings(state: SessionTrackerState, sessionId: string, exerciseId: string, text: string): SessionTrackerState {
  const context = activeContext(state, sessionId, exerciseId);
  const value = text.trim().replace(/\s+/g, " ");
  if (!context || value.length > 200) return state;
  const apply = (exercise: Exercise): Exercise => {
    const { settings: _previous, ...rest } = exercise;
    void _previous;
    return value ? { ...rest, settings: value } : rest;
  };
  const withWorkout = mapExercise(state, context.workout.id, exerciseId, apply);
  return {
    ...withWorkout,
    workoutTemplates: withWorkout.workoutTemplates?.map((template) => template.id !== context.session.templateId ? template : { ...template, exercises: template.exercises.map((exercise) => exercise.id === exerciseId ? apply(exercise) : exercise) }),
  };
}

/** Заметка к упражнению в идущей тренировке (только в ней, в программу не попадает). Пустая строка стирает заметку. */
export function setExerciseNote(state: SessionTrackerState, sessionId: string, exerciseId: string, text: string): SessionTrackerState {
  const context = activeContext(state, sessionId, exerciseId);
  const value = text.trim();
  if (!context || value.length > 500) return state;
  return mapExercise(state, context.workout.id, exerciseId, (exercise) => {
    const { note: _previous, ...rest } = exercise;
    void _previous;
    return value ? { ...rest, note: value } : rest;
  });
}
