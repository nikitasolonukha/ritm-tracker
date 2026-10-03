import assert from "node:assert/strict";
import test from "node:test";
import { buildExerciseLibrary, estimateOneRepMax, exerciseKey, formatSets, getExerciseRecords, getExerciseSeries, getExerciseSessions, lastPerformance } from "../src/lib/exercises.ts";
import type { Workout } from "../src/lib/tracker.ts";
import type { SessionTrackerState } from "../src/lib/workout-session.ts";

const set = (id: string, weightKg: number | null, reps: number | null, completed = true, weightMode: "total" | "per-hand" = "total") => ({ id, weightKg, reps, completed, weightMode });
const workout = (id: string, date: string, name: string, sets: ReturnType<typeof set>[]): Workout => ({ id, date, title: "Тренировка", exercises: [{ id: `${id}-e`, name, sets }] });
const stateOf = (workouts: Workout[], extra: Partial<SessionTrackerState> = {}) => ({ version: 1, habits: [], completions: [], workouts, activeTimer: null, observations: [], outbox: [], ...extra }) as unknown as SessionTrackerState;

test("exercise key merges spelling variants", () => {
  assert.equal(exerciseKey("Жим лёжа"), exerciseKey("  жим  лежа. "));
  assert.notEqual(exerciseKey("Жим лёжа"), exerciseKey("Жим стоя"));
});

test("sessions contain only confirmed sets and skip cancelled workouts", () => {
  const state = stateOf([
    workout("w1", "2026-09-01", "Жим лёжа", [set("a", 60, 8), set("b", 60, 8, false)]),
    workout("w2", "2026-09-08", "жим лежа", [set("c", 62.5, 6)]),
    workout("w3", "2026-09-15", "Жим лёжа", [set("d", 100, 1)]),
  ], { workoutSessions: [{ id: "s3", workoutId: "w3", templateId: "t", status: "cancelled", startedAt: "2026-09-15T10:00:00Z", activeExerciseIndex: 0 }] } as unknown as Partial<SessionTrackerState>);
  const sessions = getExerciseSessions(state, exerciseKey("Жим лёжа"));
  assert.deepEqual(sessions.map((s) => s.date), ["2026-09-08", "2026-09-01"]);
  assert.equal(sessions[1].sets.length, 1);
  assert.equal(sessions[1].volumeKg, 480);
});

test("records use only confirmed sets and Epley estimate", () => {
  const sessions = getExerciseSessions(stateOf([
    workout("w1", "2026-09-01", "Присед", [set("a", 100, 5), set("b", 120, 3, false)]),
    workout("w2", "2026-09-08", "Присед", [set("c", 105, 5), set("d", 90, 10)]),
  ]), exerciseKey("Присед"));
  const records = getExerciseRecords(sessions);
  assert.equal(records.heaviest?.weightKg, 105);
  assert.equal(records.heaviest?.date, "2026-09-08");
  assert.equal(records.bestEstimatedOneRepMax?.value, estimateOneRepMax(105, 5));
  assert.equal(records.bestSetVolume?.value, 900);
  assert.equal(estimateOneRepMax(100, 1), 100);
});

test("series are oldest first with the best set of each workout", () => {
  const sessions = getExerciseSessions(stateOf([
    workout("w1", "2026-09-01", "Тяга", [set("a", 80, 8), set("b", 85, 6)]),
    workout("w2", "2026-09-08", "Тяга", [set("c", 90, 5)]),
  ]), exerciseKey("Тяга"));
  const series = getExerciseSeries(sessions);
  assert.deepEqual(series.map((p) => p.weightKg), [85, 90]);
});

test("library merges program and history, last performance is factual", () => {
  const template = workout("t1", "2026-09-01", "Жим лёжа", [set("x", 60, 8, false)]);
  const state = stateOf([workout("w1", "2026-09-01", "жим лежа", [set("a", 60, 8), set("b", 62.5, 6)]), workout("w2", "2026-09-08", "Тяга", [set("c", 50, 10)])], { workoutTemplates: [template] });
  const library = buildExerciseLibrary(state);
  assert.equal(library.length, 2);
  const bench = library.find((e) => e.key === exerciseKey("Жим лёжа"));
  assert.equal(bench?.sessionCount, 1);
  assert.equal(bench?.inProgram, true);
  assert.equal(bench?.lastDate, "2026-09-01");
  const last = lastPerformance(state, "Жим лёжа", "w-new");
  assert.equal(formatSets(last?.sets ?? []), "60×8, 62,5×6");
  assert.equal(lastPerformance(state, "Жим лёжа", "w1"), undefined);
  assert.equal(lastPerformance(state, "Неизвестное"), undefined);
});
