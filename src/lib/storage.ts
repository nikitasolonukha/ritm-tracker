import {
  type HabitCompletion,
  type RestTimer,
  type Workout,
  type WorkoutCommand,
  defaultHabits,
  getLocalDate,
} from "./tracker.ts";

export type TrackerState = {
  version: 1;
  habits: typeof defaultHabits;
  completions: HabitCompletion[];
  workouts: Workout[];
  workoutTemplates?: Workout[];
  activeWorkoutId?: string;
  workoutCommands?: WorkoutCommand[];
  activeTimer: RestTimer | null;
  observations: Array<{
    id: string;
    date: string;
    energy: number;
    sleep: number;
    skin: "better" | "same" | "worse" | "unknown";
    note: string;
  }>;
  outbox: Array<{
    id: string;
    type: "habit.completed" | "workout.saved" | "timer.started" | "workout.set.completed";
    createdAt: string;
    status: "pending" | "sent";
    entityId?: string;
    payload?: unknown;
    version?: number;
  }>;
};

export const storageKey = "ritm-tracker-state-v1";
export const storageBackupPrefix = `${storageKey}-backup-`;

export type StateReadResult = {
  state: TrackerState;
  status: "empty" | "loaded" | "corrupt" | "unsupported" | "unavailable";
  backupKey?: string;
  error?: string;
};

export function createInitialState(localDate = getLocalDate()): TrackerState {
  const starter = createStarterWorkout(localDate);
  return {
    version: 1,
    habits: defaultHabits,
    completions: [],
    workouts: [starter],
    workoutTemplates: [starter],
    activeWorkoutId: starter.id,
    workoutCommands: [],
    activeTimer: null,
    observations: [],
    outbox: [],
  };
}

export function createStarterWorkout(localDate = getLocalDate()): Workout {
  return {
    id: "today-workout",
    date: localDate,
    title: "Тренировка",
    exercises: [
      {
        id: "bench-machine",
        name: "Упражнение A",
        settings: "настроить",
        category: "working",
        restSec: 240,
        weightFactor: 2,
        sets: [1, 2, 3, 4].map((index) => ({ id: `exercise-a-${index}`, weightKg: null, reps: null, completed: false, weightMode: "total" as const })),
      },
      {
        id: "lat-pulldown",
        name: "Упражнение B",
        category: "working",
        restSec: 240,
        sets: [1, 2, 3, 4].map((index) => ({ id: `exercise-b-${index}`, weightKg: null, reps: null, completed: false })),
      },
      {
        id: "lateral-raise",
        name: "Упражнение C",
        category: "working",
        restSec: 180,
        sets: [1, 2].map((index) => ({ id: `exercise-c-${index}`, weightKg: null, reps: null, completed: false, component: index === 1 ? "compound-a" as const : "compound-b" as const })),
      },
    ],
  };
}

export function readStateSafely(): StateReadResult {
  if (typeof window === "undefined") return { state: createInitialState(), status: "unavailable" };

  let raw: string | null;
  try {
    raw = window.localStorage.getItem(storageKey);
  } catch (error) {
    return { state: createInitialState(), status: "unavailable", error: error instanceof Error ? error.message : "storage read failed" };
  }
  if (!raw) return { state: createInitialState(), status: "empty" };

  try {
    const parsed = JSON.parse(raw) as Partial<TrackerState>;
    if (parsed.version !== 1 || !Array.isArray(parsed.habits) || !Array.isArray(parsed.completions) || !Array.isArray(parsed.workouts)) {
      return { state: createInitialState(), status: "unsupported", error: "Неподдерживаемая версия локальных данных" };
    }
    return { state: migrateState(parsed as TrackerState), status: "loaded" };
  } catch (error) {
    const backupKey = `${storageBackupPrefix}${Date.now()}`;
    try { window.localStorage.setItem(backupKey, raw); } catch { /* leave the original for manual recovery */ }
    return { state: createInitialState(), status: "corrupt", backupKey, error: error instanceof Error ? error.message : "Некорректный JSON" };
  }
}

export function readState(): TrackerState {
  return readStateSafely().state;
}

export function writeState(state: TrackerState): { ok: boolean; error?: string } {
  if (typeof window === "undefined") return { ok: false, error: "browser storage unavailable" };
  const temporaryKey = `${storageKey}-pending`;
  try {
    const serialized = JSON.stringify(state);
    window.localStorage.setItem(temporaryKey, serialized);
    window.localStorage.setItem(storageKey, serialized);
    window.localStorage.removeItem(temporaryKey);
    return { ok: true };
  } catch (error) {
    try { window.localStorage.removeItem(temporaryKey); } catch { /* preserve the main record */ }
    return { ok: false, error: error instanceof Error ? error.message : "storage write failed" };
  }
}

function migrateState(state: TrackerState): TrackerState {
  const workoutTemplates = state.workoutTemplates?.length ? state.workoutTemplates : state.workouts.slice(0, 1);
  return { ...state, workoutTemplates, activeWorkoutId: state.activeWorkoutId ?? state.workouts[0]?.id, workoutCommands: state.workoutCommands ?? [] };
}
