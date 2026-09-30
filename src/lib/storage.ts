import {
  type HabitCompletion,
  type RestTimer,
  type Workout,
  type WorkoutCommand,
  defaultHabits,
  getLocalDate,
} from "./tracker.ts";
import type { SyncWriteIntent } from "./sync.ts";

export type TrackerState = {
  version: 1;
  habits: typeof defaultHabits;
  completions: HabitCompletion[];
  habitSnoozes?: Array<{ id: string; habitId: string; localDate: string; dueAt: string; count: number }>;
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
    weightKg?: number;
  }>;
  photos?: Array<{
    id: string;
    date: string;
    name: string;
    dataUrl: string;
    storagePath?: string;
  }>;
  outbox: Array<{
    id: string;
    type: "habit.completed" | "habit.cancelled" | "workout.saved" | "timer.started" | "workout.set.completed" | "timer.rescheduled" | "timer.cancelled";
    createdAt: string;
    status: "pending" | "sending" | "accepted" | "sent" | "failed" | "cancelled";
    entityId?: string;
    payload?: unknown;
    version?: number;
  }>;
};

export const storageKey = "ritm-tracker-state-v1";
export const storageBackupPrefix = `${storageKey}-backup-`;
export const outboxAckKey = `${storageKey}-outbox-acks`;
export function readSyncCheckpoint(userId: string): { revision: number; fingerprint: string } | undefined {
  try { return JSON.parse(window.localStorage.getItem(`${getStorageKey(userId)}:checkpoint`) ?? "null") ?? undefined; }
  catch { return undefined; }
}
export function writeSyncCheckpoint(userId: string, revision: number, fingerprint: string) {
  try { window.localStorage.setItem(`${getStorageKey(userId)}:checkpoint`, JSON.stringify({ revision, fingerprint })); return true; }
  catch { return false; }
}
export function readSyncWriteIntent(userId: string): SyncWriteIntent | undefined {
  try {
    const intent: unknown = JSON.parse(window.localStorage.getItem(`${getStorageKey(userId)}:sync-intent`) ?? "null");
    if (intent && typeof intent === "object" && "expectedRevision" in intent && "fingerprint" in intent && Number.isSafeInteger(intent.expectedRevision) && (intent.expectedRevision as number) >= 0 && typeof intent.fingerprint === "string") return intent as SyncWriteIntent;
  } catch { /* A damaged intent cannot confirm a server write. */ }
  return undefined;
}
export function writeSyncWriteIntent(userId: string, intent: SyncWriteIntent): boolean {
  try { window.localStorage.setItem(`${getStorageKey(userId)}:sync-intent`, JSON.stringify(intent)); return true; }
  catch { return false; }
}
export function clearSyncWriteIntent(userId: string, expected: SyncWriteIntent): boolean {
  try {
    const stored = readSyncWriteIntent(userId);
    if (stored?.expectedRevision === expected.expectedRevision && stored.fingerprint === expected.fingerprint) window.localStorage.removeItem(`${getStorageKey(userId)}:sync-intent`);
    return true;
  }
  catch { return false; }
}
export function getStorageKey(userId?: string) {
  return userId ? `${storageKey}:${userId}` : storageKey;
}

export function getOutboxAckKey(userId?: string) {
  return userId ? `${outboxAckKey}:${userId}` : outboxAckKey;
}

export function readOutboxAcks(userId?: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const parsed = JSON.parse(window.localStorage.getItem(getOutboxAckKey(userId)) ?? "[]") as unknown;
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

export function writeOutboxAck(id: string, userId?: string): { ok: boolean; error?: string } {
  if (typeof window === "undefined") return { ok: false, error: "browser storage unavailable" };
  try {
    const acks = readOutboxAcks(userId);
    acks.add(id);
    window.localStorage.setItem(getOutboxAckKey(userId), JSON.stringify([...acks].sort()));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "outbox acknowledgement write failed" };
  }
}

export function backupSyncConflict(userId: string, revision: number, local: TrackerState, remote: TrackerState): { ok: boolean; error?: string } {
  if (typeof window === "undefined") return { ok: false, error: "browser storage unavailable" };
  try {
    const prefix = `${storageKey}-sync-conflict:${userId}:${revision}`;
    window.localStorage.setItem(`${prefix}:local`, JSON.stringify(local));
    window.localStorage.setItem(`${prefix}:remote`, JSON.stringify(remote));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "sync conflict backup failed" };
  }
}

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
    workouts: [],
    workoutTemplates: [starter],
    workoutCommands: [],
    activeTimer: null,
    observations: [],
    photos: [],
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
        sets: [1, 2, 3, 4].map((index) => ({ id: `exercise-a-${index}`, weightKg: null, reps: 8, completed: false, weightMode: "total" as const })),
      },
      {
        id: "lat-pulldown",
        name: "Упражнение B",
        category: "working",
        restSec: 240,
        sets: [1, 2, 3, 4].map((index) => ({ id: `exercise-b-${index}`, weightKg: null, reps: 8, completed: false })),
      },
      {
        id: "lateral-raise",
        name: "Упражнение C",
        category: "working",
        restSec: 180,
        sets: [1, 2, 3, 4].map((index) => ({ id: `exercise-c-${index}`, weightKg: null, reps: 8, completed: false, weightMode: "total" as const, segmentId: `pair-${Math.ceil(index / 2)}`, component: index % 2 === 1 ? "compound-a" as const : "compound-b" as const })),
      },
    ],
  };
}

export function readStateSafely(userId?: string): StateReadResult {
  if (typeof window === "undefined") return { state: createInitialState(), status: "unavailable" };

  let raw: string | null;
  try {
    raw = window.localStorage.getItem(getStorageKey(userId));
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

export function writeState(state: TrackerState, userId?: string): { ok: boolean; error?: string } {
  if (typeof window === "undefined") return { ok: false, error: "browser storage unavailable" };
  const targetKey = getStorageKey(userId);
  const temporaryKey = `${targetKey}-pending`;
  try {
    const serialized = JSON.stringify(state);
    window.localStorage.setItem(temporaryKey, serialized);
    window.localStorage.setItem(targetKey, serialized);
    window.localStorage.removeItem(temporaryKey);
    return { ok: true };
  } catch (error) {
    try { window.localStorage.removeItem(temporaryKey); } catch { /* preserve the main record */ }
    return { ok: false, error: error instanceof Error ? error.message : "storage write failed" };
  }
}

export function migrateState(state: TrackerState): TrackerState {
  const workoutTemplates = state.workoutTemplates ?? state.workouts.slice(0, 1);
  return { ...state, workoutTemplates, workoutCommands: state.workoutCommands ?? [], photos: state.photos ?? [] };
}
