import { createRestTimerCommand, getLocalDate, type Workout } from "./tracker.ts";
import type { TrackerState } from "./storage.ts";
import type { ExerciseSet } from "./tracker.ts";

export type WorkoutSession = {
  id: string;
  workoutId: string;
  templateId: string;
  status: "active" | "completed" | "partial" | "cancelled";
  startedAt: string;
  finishedAt?: string;
  activeExerciseIndex: number;
};

export type SessionTrackerState = TrackerState & { workoutSessions?: WorkoutSession[]; activeSessionId?: string };

export function correctHistoricalSet(state: SessionTrackerState, workoutId: string, exerciseId: string, setId: string, patch: Pick<ExerciseSet, "weightKg" | "reps" | "weightMode" | "completed" | "note">): SessionTrackerState {
  if (state.activeWorkoutId === workoutId || state.workoutSessions?.some((session) => session.workoutId === workoutId && session.status === "active")) return state;
  const workout = state.workouts.find((workout) => workout.id === workoutId);
  if (!workout?.exercises.find((exercise) => exercise.id === exerciseId)?.sets.some((set) => set.id === setId)) return state;
  const entityId = `${workoutId}:${exerciseId}:${setId}`;
  const corrected = { ...workout, exercises: workout.exercises.map((exercise) => exercise.id !== exerciseId ? exercise : { ...exercise, sets: exercise.sets.map((set) => set.id !== setId ? set : { ...set, ...patch, weightDraft: undefined, repsDraft: undefined }) }) };
  return { ...state,
    workouts: state.workouts.map((item) => item.id === workoutId ? corrected : item),
    outbox: patch.completed ? state.outbox : state.outbox.map((command) => command.entityId === entityId && ["pending", "sending", "failed"].includes(command.status) ? { ...command, status: "cancelled" } : command),
    workoutSessions: state.workoutSessions?.map((session) => session.workoutId === workoutId && ["completed", "partial"].includes(session.status) ? { ...session, status: corrected.exercises.every((exercise) => exercise.sets.every((set) => set.completed)) ? "completed" : "partial" } : session),
  };
}

export function startWorkoutSession(state: SessionTrackerState, templateId: string, now = new Date()): { state: SessionTrackerState; sessionId: string } | null {
  const template = state.workoutTemplates?.find((item) => item.id === templateId) ?? state.workouts.find((item) => item.id === templateId);
  if (!template || !template.exercises.length || template.exercises.some((e) => !e.sets.length)) return null;
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
  const sets = state.workouts.find((workout) => workout.id === session.workoutId)?.exercises.flatMap((exercise) => exercise.sets) ?? [];
  if (!sets.some((set) => set.completed)) return state;
  const status = sets.every((set) => set.completed) ? "completed" as const : "partial" as const;
  const cancellation = state.activeWorkoutId === session.workoutId && state.activeTimer ? createRestTimerCommand(state.activeTimer, "cancel", now.toISOString(), "Тренировка завершена") : null;
  return {
    ...state,
    outbox: cancellation ? [...state.outbox, cancellation.command] : state.outbox,
    workoutSessions: (state.workoutSessions ?? []).map((session) => session.id === sessionId ? { ...session, status, finishedAt: now.toISOString() } : session),
    activeSessionId: state.activeSessionId === sessionId ? undefined : state.activeSessionId,
    activeWorkoutId: state.activeWorkoutId === session.workoutId ? undefined : state.activeWorkoutId,
    activeTimer: state.activeWorkoutId === session.workoutId ? null : state.activeTimer,
  };
}

export function cancelWorkoutSession(state: SessionTrackerState, sessionId: string, now = new Date()): SessionTrackerState {
  const session = state.workoutSessions?.find((item) => item.id === sessionId);
  if (!session || session.status !== "active") return state;
  const cancellation = state.activeWorkoutId === session.workoutId && state.activeTimer ? createRestTimerCommand(state.activeTimer, "cancel", now.toISOString(), "Тренировка отменена") : null;
  return {
    ...state,
    outbox: cancellation ? [...state.outbox, cancellation.command] : state.outbox,
    workoutSessions: (state.workoutSessions ?? []).map((session) => session.id === sessionId ? { ...session, status: "cancelled", finishedAt: now.toISOString() } : session),
    activeSessionId: state.activeSessionId === sessionId ? undefined : state.activeSessionId,
    activeWorkoutId: state.activeWorkoutId === session.workoutId ? undefined : state.activeWorkoutId,
    activeTimer: state.activeWorkoutId === session.workoutId ? null : state.activeTimer,
  };
}
