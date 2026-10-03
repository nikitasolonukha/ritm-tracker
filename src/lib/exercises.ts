import { calculateExerciseVolume, calculateWorkoutTotals, type Exercise, type ExerciseSet, type Workout } from "./tracker.ts";
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
