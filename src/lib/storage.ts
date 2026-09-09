import {
  type HabitCompletion,
  type RestTimer,
  type Workout,
  defaultHabits,
} from "./tracker";

export type TrackerState = {
  version: 1;
  habits: typeof defaultHabits;
  completions: HabitCompletion[];
  workouts: Workout[];
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
    type: "habit.completed" | "workout.saved" | "timer.started";
    createdAt: string;
    status: "pending" | "sent";
  }>;
};

export const storageKey = "ritm-tracker-state-v1";

export function createInitialState(): TrackerState {
  return {
    version: 1,
    habits: defaultHabits,
    completions: [],
    workouts: [createStarterWorkout()],
    activeTimer: null,
    observations: [],
    outbox: [],
  };
}

export function createStarterWorkout(): Workout {
  return {
    id: "today-workout",
    date: new Date().toISOString().slice(0, 10),
    title: "Тренировка",
    exercises: [
      {
        id: "bench-machine",
        name: "Жим в тренажере",
        settings: "посадка 6 · ручки 3",
        sets: [
          { id: "bench-1", weightKg: 40, reps: 8, completed: false },
          { id: "bench-2", weightKg: 45, reps: 8, completed: false },
          { id: "bench-3", weightKg: 45, reps: 8, completed: false },
        ],
      },
      {
        id: "lat-pulldown",
        name: "Верхний блок",
        sets: [
          { id: "lat-1", weightKg: 35, reps: 10, completed: false },
          { id: "lat-2", weightKg: 40, reps: 10, completed: false },
        ],
      },
    ],
  };
}

export function readState(): TrackerState {
  if (typeof window === "undefined") return createInitialState();

  const raw = window.localStorage.getItem(storageKey);
  if (!raw) return createInitialState();

  try {
    const parsed = JSON.parse(raw) as TrackerState;
    if (parsed.version !== 1) return createInitialState();
    return parsed;
  } catch {
    return createInitialState();
  }
}

export function writeState(state: TrackerState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey, JSON.stringify(state));
}
