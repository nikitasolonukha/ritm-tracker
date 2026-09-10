import { getLocalDate, type Workout } from "./tracker";
import type { TrackerState } from "./storage";

export type WorkoutSession = {
  id: string;
  workoutId: string;
  templateId: string;
  status: "active" | "completed" | "cancelled";
  startedAt: string;
  finishedAt?: string;
  activeExerciseIndex: number;
};

export type SessionTrackerState = TrackerState & { workoutSessions?: WorkoutSession[]; activeSessionId?: string };

export function startWorkoutSession(state: SessionTrackerState, templateId: string, now = new Date()): { state: SessionTrackerState; sessionId: string } | null {
  const template = state.workoutTemplates?.find((item) => item.id === templateId) ?? state.workouts.find((item) => item.id === templateId);
  if (!template) return null;
  const existing = state.workoutSessions?.find((item) => item.status === "active");
  if (existing) return { state: { ...state, activeSessionId: existing.id }, sessionId: existing.id };
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${now.getTime()}-${state.workouts.length}`;
  const sessionId = `session-${suffix}`;
  const workoutId = `workout-${sessionId}`;
  const workout: Workout = {
    ...template,
    id: workoutId,
    date: getLocalDate(now),
    exercises: template.exercises.map((exercise) => ({
      ...exercise,
      sets: exercise.sets.map((set) => ({ ...set, id: `${workoutId}-${exercise.id}-${set.id}`, completed: false, weightDraft: undefined, repsDraft: undefined })),
    })),
  };
  const session: WorkoutSession = { id: sessionId, workoutId, templateId, status: "active", startedAt: now.toISOString(), activeExerciseIndex: 0 };
  return { state: { ...state, workouts: [...state.workouts, workout], workoutSessions: [...(state.workoutSessions ?? []), session], activeSessionId: sessionId, activeWorkoutId: workoutId }, sessionId };
}

export function finishWorkoutSession(state: SessionTrackerState, sessionId: string, now = new Date()): SessionTrackerState {
  const session = state.workoutSessions?.find((item) => item.id === sessionId);
  if (!session || session.status !== "active") return state;
  return {
    ...state,
    workoutSessions: (state.workoutSessions ?? []).map((session) => session.id === sessionId ? { ...session, status: "completed", finishedAt: now.toISOString() } : session),
    activeSessionId: state.activeSessionId === sessionId ? undefined : state.activeSessionId,
    activeWorkoutId: state.activeWorkoutId === session.workoutId ? undefined : state.activeWorkoutId,
    activeTimer: state.activeWorkoutId === session.workoutId ? null : state.activeTimer,
  };
}

export function cancelWorkoutSession(state: SessionTrackerState, sessionId: string, now = new Date()): SessionTrackerState {
  const session = state.workoutSessions?.find((item) => item.id === sessionId);
  if (!session || session.status !== "active") return state;
  return {
    ...state,
    workoutSessions: (state.workoutSessions ?? []).map((session) => session.id === sessionId ? { ...session, status: "cancelled", finishedAt: now.toISOString() } : session),
    activeSessionId: state.activeSessionId === sessionId ? undefined : state.activeSessionId,
    activeWorkoutId: state.activeWorkoutId === session.workoutId ? undefined : state.activeWorkoutId,
    activeTimer: state.activeWorkoutId === session.workoutId ? null : state.activeTimer,
  };
}
