import { calculateExerciseVolume, calculateWorkoutTotals, logicalSetKey, type Exercise, type ExerciseSet, type Workout } from "./tracker.ts";
import type { SessionTrackerState } from "./workout-session.ts";

/** Ключ упражнения: одинаковые названия («Жим лёжа», «жим  лежа») склеиваются в одно. */
export function exerciseKey(name: string): string {
  return name.toLowerCase().replaceAll("ё", "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

export type ExerciseSession = {
  date: string;
  workoutId: string;
  workoutTitle: string;
  /** Только подтверждённые подходы. */
  sets: ExerciseSet[];
  volumeKg: number;
};

export type ExerciseRecord = { value: number; weightKg: number; reps: number; date: string };

export type ExerciseRecords = {
  heaviest?: ExerciseRecord;
  bestEstimatedOneRepMax?: ExerciseRecord;
  bestSetVolume?: ExerciseRecord;
};

export type ExerciseEntry = {
  key: string;
  name: string;
  muscleGroup: string;
  equipment: string;
  sessionCount: number;
  lastDate: string | null;
  inProgram: boolean;
};

/** Тренировки, чьи подходы считаются историей: не активные и не отменённые, с хотя бы одним подтверждённым подходом. */
export function historyWorkouts(state: SessionTrackerState): Workout[] {
  const blocked = new Set((state.workoutSessions ?? []).filter((s) => s.status === "active" || s.status === "cancelled").map((s) => s.workoutId));
  return state.workouts.filter((w) => !blocked.has(w.id) && calculateWorkoutTotals(w).completedSets > 0);
}

export function getExerciseSessions(state: SessionTrackerState, key: string): ExerciseSession[] {
  const sessions: ExerciseSession[] = [];
  for (const workout of historyWorkouts(state)) {
    const done = workout.exercises.filter((e) => exerciseKey(e.name) === key).flatMap((e) => e.sets.filter((s) => s.completed));
    if (!done.length) continue;
    sessions.push({ date: workout.date, workoutId: workout.id, workoutTitle: workout.title, sets: done, volumeKg: calculateExerciseVolume(done) });
  }
  return sessions.sort((a, b) => b.date.localeCompare(a.date));
}

/** Оценка 1ПМ по формуле Эпли. Для одного повторения — сам вес. */
export function estimateOneRepMax(weightKg: number, reps: number): number {
  return reps <= 1 ? weightKg : Math.round(weightKg * (1 + reps / 30) * 10) / 10;
}

const setVolume = (set: ExerciseSet) => calculateExerciseVolume([set]);

export function getExerciseRecords(sessions: ExerciseSession[]): ExerciseRecords {
  const records: ExerciseRecords = {};
  for (const session of sessions) {
    for (const set of session.sets) {
      if (set.weightKg == null || set.reps == null || set.weightKg <= 0 || set.reps <= 0) continue;
      const { weightKg, reps } = set;
      const date = session.date;
      const heaviest = records.heaviest;
      if (!heaviest || weightKg > heaviest.weightKg || (weightKg === heaviest.weightKg && (reps > heaviest.reps || (reps === heaviest.reps && date > heaviest.date)))) records.heaviest = { value: weightKg, weightKg, reps, date };
      const e1rm = estimateOneRepMax(weightKg, reps);
      if (!records.bestEstimatedOneRepMax || e1rm > records.bestEstimatedOneRepMax.value) records.bestEstimatedOneRepMax = { value: e1rm, weightKg, reps, date };
      const volume = setVolume(set);
      if (volume > 0 && (!records.bestSetVolume || volume > records.bestSetVolume.value)) records.bestSetVolume = { value: volume, weightKg, reps, date };
    }
  }
  return records;
}

/** Точки графика: лучший подход каждой тренировки по весу и по оценке 1ПМ, от старых к новым. */
export function getExerciseSeries(sessions: ExerciseSession[]) {
  return [...sessions].reverse().map((session) => {
    let topWeight = 0;
    let topOneRepMax = 0;
    for (const set of session.sets) {
      if (set.weightKg == null || set.reps == null || set.reps <= 0) continue;
      topWeight = Math.max(topWeight, set.weightKg);
      topOneRepMax = Math.max(topOneRepMax, estimateOneRepMax(set.weightKg, set.reps));
    }
    return { date: session.date, weightKg: topWeight, oneRepMax: topOneRepMax, volumeKg: session.volumeKg };
  }).filter((point) => point.weightKg > 0);
}

export function formatSets(sets: ExerciseSet[]): string {
  return sets.map((set) => `${set.weightKg == null ? "—" : String(set.weightKg).replace(".", ",")}×${set.reps ?? "—"}`).join(", ");
}

/** «В прошлый раз»: только факты из предыдущей записанной тренировки, без советов. */
export function lastPerformance(state: SessionTrackerState, name: string, excludeWorkoutId?: string): ExerciseSession | undefined {
  const key = exerciseKey(name);
  return getExerciseSessions(state, key).find((session) => session.workoutId !== excludeWorkoutId);
}

export function buildExerciseLibrary(state: SessionTrackerState): ExerciseEntry[] {
  const map = new Map<string, ExerciseEntry>();
  const touch = (exercise: Exercise, inProgram: boolean) => {
    const key = exerciseKey(exercise.name);
    if (!key) return;
    const current = map.get(key);
    map.set(key, {
      key,
      name: current?.name ?? exercise.name.trim(),
      muscleGroup: current?.muscleGroup || exercise.muscleGroup?.trim() || "",
      equipment: current?.equipment || exercise.equipment?.trim() || "",
      sessionCount: current?.sessionCount ?? 0,
      lastDate: current?.lastDate ?? null,
      inProgram: (current?.inProgram ?? false) || inProgram,
    });
  };
  for (const template of state.workoutTemplates ?? []) for (const exercise of template.exercises) touch(exercise, true);
  for (const workout of [...historyWorkouts(state)].sort((a, b) => b.date.localeCompare(a.date))) {
    for (const exercise of workout.exercises) {
      if (!exercise.sets.some((s) => s.completed)) continue;
      touch(exercise, false);
    }
  }
  for (const entry of map.values()) {
    const sessions = getExerciseSessions(state, entry.key);
    entry.sessionCount = sessions.length;
    entry.lastDate = sessions[0]?.date ?? null;
  }
  return [...map.values()].sort((a, b) => (b.lastDate ?? "").localeCompare(a.lastDate ?? "") || a.name.localeCompare(b.name, "ru"));
}

export type RecordEntry = { key: string; name: string; weightKg: number; reps: number; date: string };

/** Личные рекорды по весу для каждого упражнения с историей. Сначала самые свежие, `limit` штук. */
export function recentRecords(state: SessionTrackerState, limit = 5): RecordEntry[] {
  const entries: RecordEntry[] = [];
  for (const entry of buildExerciseLibrary(state)) {
    if (!entry.sessionCount) continue;
    const heaviest = getExerciseRecords(getExerciseSessions(state, entry.key)).heaviest;
    if (heaviest) entries.push({ key: entry.key, name: entry.name, weightKg: heaviest.weightKg, reps: heaviest.reps, date: heaviest.date });
  }
  return entries.sort((a, b) => b.date.localeCompare(a.date) || b.weightKg - a.weightKg).slice(0, limit);
}

export type LiveRecord = { kind: "weight" | "oneRepMax"; value: number; previous: number };

/**
 * Рекорд в момент записи подхода: сравнение с прошлыми тренировками и с уже записанными подходами этого же упражнения.
 * Без истории рекорда нет: первый раз всегда «точка отсчёта». Режимы веса («на руку» и «общий») не смешиваются.
 */
export function detectLiveRecord(state: SessionTrackerState, exercise: Pick<Exercise, "id" | "name" | "sets">, set: ExerciseSet): LiveRecord | null {
  if (set.weightKg == null || set.reps == null || set.weightKg <= 0 || set.reps <= 0 || !set.weightMode) return null;
  const usable = (other: ExerciseSet) => other.weightMode === set.weightMode && other.weightKg != null && other.reps != null && other.weightKg > 0 && other.reps > 0;
  const history = getExerciseSessions(state, exerciseKey(exercise.name)).flatMap((session) => session.sets).filter(usable);
  // Первый раз всегда «точка отсчёта»: подход тяжелее предыдущего подхода той же тренировки рекордом не считается.
  if (!history.length) return null;
  const comparable = [...history, ...exercise.sets.filter((other) => other.id !== set.id && other.completed).filter(usable)];
  const heaviest = Math.max(...comparable.map((other) => other.weightKg as number));
  if (set.weightKg > heaviest) return { kind: "weight", value: set.weightKg, previous: heaviest };
  const bestOneRepMax = Math.max(...comparable.map((other) => estimateOneRepMax(other.weightKg as number, other.reps as number)));
  const oneRepMax = estimateOneRepMax(set.weightKg, set.reps);
  return oneRepMax > bestOneRepMax ? { kind: "oneRepMax", value: oneRepMax, previous: bestOneRepMax } : null;
}

export type ExerciseDefaults = { sets: number; weightKg: number | null; reps: number | null; weightMode: "total" | "per-hand"; restSec?: number; muscleGroup?: string; equipment?: string; paired: boolean };

/** Значения для упражнения, добавленного в ходе тренировки: как в прошлый раз, если оно уже было, иначе 3×10 без веса. */
export function exerciseDefaults(state: SessionTrackerState, name: string): ExerciseDefaults {
  const key = exerciseKey(name);
  const last = lastPerformance(state, name);
  const known = [...(state.workoutTemplates ?? []).flatMap((template) => template.exercises), ...state.workouts.flatMap((workout) => workout.exercises)].find((item) => exerciseKey(item.name) === key);
  const base = { restSec: known?.restSec, muscleGroup: known?.muscleGroup, equipment: known?.equipment };
  if (!last?.sets.length) return { sets: 3, weightKg: null, reps: 10, weightMode: "total", paired: false, ...base };
  const paired = last.sets.some((set) => set.component === "compound-a" || set.component === "compound-b");
  const logicalCount = new Set(last.sets.map((set, index) => logicalSetKey(set, index))).size;
  const lastSet = last.sets.at(-1)!;
  return { sets: Math.min(10, Math.max(1, paired ? logicalCount : last.sets.length)), weightKg: lastSet.weightKg, reps: lastSet.reps, weightMode: lastSet.weightMode ?? "total", paired, ...base };
}

export type WorkoutResult = { id: string; name: string; sets: string; record: boolean };

/** Итог тренировки по упражнениям: записанные подходы и признак рекорда веса относительно прошлых тренировок. */
export function workoutResults(state: SessionTrackerState, workout: Workout): WorkoutResult[] {
  return workout.exercises
    .map((exercise) => {
      const done = exercise.sets.filter((set) => set.completed);
      if (!done.length) return null;
      const key = exerciseKey(exercise.name);
      const before = getExerciseRecords(getExerciseSessions(state, key).filter((entry) => entry.workoutId !== workout.id && entry.date <= workout.date));
      const now = getExerciseRecords([{ date: workout.date, workoutId: workout.id, workoutTitle: workout.title, sets: done, volumeKg: 0 }]);
      const record = Boolean(now.heaviest && before.heaviest && now.heaviest.weightKg > before.heaviest.weightKg);
      return { id: exercise.id, name: exercise.name, sets: formatSets(done), record };
    })
    .filter((item): item is WorkoutResult => item !== null);
}

/** Последняя заметка к упражнению из прошлых тренировок (не из идущей). */
export function lastExerciseNote(state: SessionTrackerState, name: string, excludeWorkoutId?: string): { text: string; date: string } | undefined {
  const key = exerciseKey(name);
  for (const workout of [...historyWorkouts(state)].sort((a, b) => b.date.localeCompare(a.date))) {
    if (workout.id === excludeWorkoutId) continue;
    const note = workout.exercises.find((exercise) => exerciseKey(exercise.name) === key && exercise.note?.trim())?.note?.trim();
    if (note) return { text: note, date: workout.date };
  }
  return undefined;
}
