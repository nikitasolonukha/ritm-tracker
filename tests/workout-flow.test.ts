import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../src/lib/storage.ts";
import { calculateWorkoutTotals, completeWorkoutSet } from "../src/lib/tracker.ts";
import { cancelWorkoutSession, correctHistoricalSet, finishWorkoutSession, startWorkoutSession, type SessionTrackerState } from "../src/lib/workout-session.ts";
import { currentLogicalSet, goToExercise, logicalSets, parseRepsInput, parseWeightInput, recordLogicalSet, recordSet, setSetWeight } from "../src/lib/workout-flow.ts";

type Set = { id: string; weightKg: number | null; reps: number | null; completed: boolean; weightMode?: "total" | "per-hand"; component?: "compound-a" | "compound-b"; segmentId?: string };

function sessionWith(exercises: Array<{ id: string; name: string; sets: Set[] }>) {
  const base = createInitialState("2026-10-03") as SessionTrackerState;
  const template = { id: "tpl", title: "Тест", date: "2026-10-03", exercises: exercises.map((exercise) => ({ ...exercise, restSec: 180 as const })) };
  const started = startWorkoutSession({ ...base, workoutTemplates: [template] }, "tpl", new Date("2026-10-03T10:00:00.000Z"))!;
  return { state: started.state, sessionId: started.sessionId };
}

const pairedExercise = () => ({
  id: "press",
  name: "Жим в паре",
  sets: [
    { id: "a1", weightKg: 20, reps: 8, completed: false, weightMode: "per-hand" as const, component: "compound-a" as const, segmentId: "pair-1" },
    { id: "b1", weightKg: 10, reps: 12, completed: false, weightMode: "per-hand" as const, component: "compound-b" as const, segmentId: "pair-1" },
    { id: "a2", weightKg: 20, reps: 8, completed: false, weightMode: "per-hand" as const, component: "compound-a" as const, segmentId: "pair-2" },
    { id: "b2", weightKg: 10, reps: 12, completed: false, weightMode: "per-hand" as const, component: "compound-b" as const, segmentId: "pair-2" },
  ],
});
const plainExercise = () => ({
  id: "row",
  name: "Тяга",
  sets: [1, 2, 3].map((n) => ({ id: `s${n}`, weightKg: 40, reps: 10, completed: false, weightMode: "total" as const })),
});

const workoutOf = (state: SessionTrackerState, sessionId: string) => state.workouts.find((w) => w.id === state.workoutSessions!.find((s) => s.id === sessionId)!.workoutId)!;
const setOf = (state: SessionTrackerState, sessionId: string, exerciseId: string, localSetId: string) => workoutOf(state, sessionId).exercises.find((e) => e.id === exerciseId)!.sets.find((s) => s.id.endsWith(`-${localSetId}`))!;
const idOf = (state: SessionTrackerState, sessionId: string, exerciseId: string, localSetId: string) => setOf(state, sessionId, exerciseId, localSetId).id;

test("a pair is one logical set with two labelled parts", () => {
  const { state, sessionId } = sessionWith([pairedExercise()]);
  const groups = logicalSets(workoutOf(state, sessionId).exercises[0]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].parts.map((p) => p.label), ["A", "B"]);
  assert.equal(groups[0].paired, true);
  assert.equal(currentLogicalSet(workoutOf(state, sessionId).exercises[0])?.key, "pair-1");
});

test("changing the weight of one part keeps the set identity and adds no sets", () => {
  const { state, sessionId } = sessionWith([pairedExercise()]);
  const before = JSON.stringify(workoutOf(state, sessionId).exercises[0].sets.map((s) => s.id));
  const changed = setSetWeight(state, sessionId, "press", idOf(state, sessionId, "press", "a1"), 25, { scope: "this" });
  const sets = workoutOf(changed, sessionId).exercises[0].sets;
  assert.equal(JSON.stringify(sets.map((s) => s.id)), before);
  assert.equal(sets.length, 4);
  assert.equal(setOf(changed, sessionId, "press", "a1").weightKg, 25);
  assert.equal(setOf(changed, sessionId, "press", "a2").weightKg, 20);
  assert.equal(setOf(changed, sessionId, "press", "b1").weightKg, 10);
});

test("'rest' scope changes the same part of the remaining sets, never completed ones or the other part", () => {
  const { state, sessionId } = sessionWith([pairedExercise()]);
  const first = recordLogicalSet(state, sessionId, "press", [
    { setId: idOf(state, sessionId, "press", "a1"), reps: 8 },
    { setId: idOf(state, sessionId, "press", "b1"), reps: 12 },
  ]);
  const changed = setSetWeight(first, sessionId, "press", idOf(first, sessionId, "press", "a2"), 27.5, { scope: "rest" });
  assert.equal(setOf(changed, sessionId, "press", "a1").weightKg, 20);
  assert.equal(setOf(changed, sessionId, "press", "a2").weightKg, 27.5);
  assert.equal(setOf(changed, sessionId, "press", "b2").weightKg, 10);
});

test("changing the weight of a plain exercise: this vs rest", () => {
  const { state, sessionId } = sessionWith([plainExercise()]);
  const one = setSetWeight(state, sessionId, "row", idOf(state, sessionId, "row", "s1"), 45, { scope: "this" });
  assert.deepEqual(workoutOf(one, sessionId).exercises[0].sets.map((s) => s.weightKg), [45, 40, 40]);
  const rest = setSetWeight(state, sessionId, "row", idOf(state, sessionId, "row", "s2"), 50, { scope: "rest" });
  assert.deepEqual(workoutOf(rest, sessionId).exercises[0].sets.map((s) => s.weightKg), [40, 50, 50]);
});

test("a weight change fills a missing weight mode so the volume counts", () => {
  const exercise = { id: "row", name: "Тяга", sets: [
    { id: "s1", weightKg: null, reps: 10, completed: false, weightMode: "total" as const },
    { id: "s2", weightKg: null, reps: 10, completed: false },
  ] };
  const { state, sessionId } = sessionWith([exercise]);
  const changed = setSetWeight(state, sessionId, "row", idOf(state, sessionId, "row", "s2"), 30, { scope: "this" });
  assert.equal(setOf(changed, sessionId, "row", "s2").weightMode, "total");
  const done = recordSet(changed, sessionId, "row", idOf(changed, sessionId, "row", "s2"), 10);
  assert.equal(calculateWorkoutTotals(workoutOf(done, sessionId)).volumeKg, 300);
});

test("remembering a weight updates only the affected template sets", () => {
  const { state, sessionId } = sessionWith([plainExercise()]);
  const changed = setSetWeight(state, sessionId, "row", idOf(state, sessionId, "row", "s2"), 55, { scope: "this", remember: true });
  const template = changed.workoutTemplates!.find((t) => t.id === "tpl")!.exercises[0].sets;
  assert.deepEqual(template.map((s) => s.weightKg), [40, 55, 40]);
  const notRemembered = setSetWeight(state, sessionId, "row", idOf(state, sessionId, "row", "s2"), 55, { scope: "rest" });
  assert.deepEqual(notRemembered.workoutTemplates!.find((t) => t.id === "tpl")!.exercises[0].sets.map((s) => s.weightKg), [40, 40, 40]);
});

test("weight cannot be changed on a recorded set or with a bad value", () => {
  const { state, sessionId } = sessionWith([plainExercise()]);
  const id = idOf(state, sessionId, "row", "s1");
  const recorded = recordSet(state, sessionId, "row", id, 10);
  assert.equal(setSetWeight(recorded, sessionId, "row", id, 99, { scope: "this" }), recorded);
  assert.equal(setSetWeight(state, sessionId, "row", id, -1, { scope: "this" }), state);
  assert.equal(setSetWeight(state, sessionId, "row", id, Number.NaN, { scope: "this" }), state);
});

test("recording a pair records both parts once and starts one rest timer", () => {
  const { state, sessionId } = sessionWith([pairedExercise()]);
  const entries = [
    { setId: idOf(state, sessionId, "press", "a1"), reps: 8 },
    { setId: idOf(state, sessionId, "press", "b1"), reps: 12 },
  ];
  const done = recordLogicalSet(state, sessionId, "press", entries);
  const exercise = workoutOf(done, sessionId).exercises[0];
  assert.equal(exercise.sets.filter((s) => s.completed).length, 2);
  assert.equal(done.activeTimer?.sourceId, `${exercise.sets[1].id ? workoutOf(done, sessionId).id : ""}:press:${exercise.sets[1].id}`);
  assert.equal(currentLogicalSet(exercise)?.key, "pair-2");
  const again = recordLogicalSet(done, sessionId, "press", entries);
  assert.equal(again.workouts, done.workouts);
  assert.equal(again.outbox.length, done.outbox.length);
  const totals = calculateWorkoutTotals(workoutOf(done, sessionId));
  assert.equal(totals.completedSets, 2);
  assert.equal(totals.completedLogicalSets, 1);
});

test("a stale command does not keep a reopened set uncompleted forever", () => {
  const { state, sessionId } = sessionWith([plainExercise()]);
  const id = idOf(state, sessionId, "row", "s1");
  const workout = workoutOf(state, sessionId);
  const first = completeWorkoutSet({ workout, commands: [], activeTimer: null }, "row", id, "cmd-1", "2026-10-03T10:00:00.000Z");
  const reopened = { ...first, workout: { ...first.workout, exercises: first.workout.exercises.map((e) => ({ ...e, sets: e.sets.map((s) => ({ ...s, completed: false })) })) } };
  const second = completeWorkoutSet(reopened, "row", id, "cmd-1", "2026-10-03T10:05:00.000Z");
  assert.equal(second.workout.exercises[0].sets[0].completed, true);
  assert.equal(second.commands.filter((c) => c.entityId.endsWith(id)).length, 1);
});

test("invalid reps are rejected and parsers are strict", () => {
  const { state, sessionId } = sessionWith([plainExercise()]);
  const id = idOf(state, sessionId, "row", "s1");
  for (const reps of [0, -1, 101, 2.5, Number.NaN]) assert.equal(recordSet(state, sessionId, "row", id, reps), state);
  assert.equal(parseRepsInput("8"), 8);
  assert.equal(parseRepsInput("1e3"), null);
  assert.equal(parseRepsInput("0x10"), null);
  assert.equal(parseRepsInput("0"), null);
  assert.equal(parseWeightInput("12,5"), 12.5);
  assert.equal(parseWeightInput("abc"), null);
  assert.equal(parseWeightInput("9999"), null);
});

test("full flow survives a save and reload and ends with exactly the recorded sets", () => {
  const { state, sessionId } = sessionWith([pairedExercise(), plainExercise()]);
  let next = setSetWeight(state, sessionId, "press", idOf(state, sessionId, "press", "a1"), 22.5, { scope: "rest" });
  next = JSON.parse(JSON.stringify(next)) as SessionTrackerState;
  next = recordLogicalSet(next, sessionId, "press", [
    { setId: idOf(next, sessionId, "press", "a1"), reps: 8 },
    { setId: idOf(next, sessionId, "press", "b1"), reps: 12 },
  ]);
  next = JSON.parse(JSON.stringify(next)) as SessionTrackerState;
  next = goToExercise(next, sessionId, 1);
  assert.equal(next.workoutSessions![0].activeExerciseIndex, 1);
  next = recordSet(next, sessionId, "row", idOf(next, sessionId, "row", "s1"), 10);
  const finished = finishWorkoutSession(next, sessionId);
  const totals = calculateWorkoutTotals(workoutOf(finished, sessionId));
  assert.equal(totals.completedSets, 3);
  assert.equal(totals.completedLogicalSets, 2);
  assert.equal(finished.workoutSessions![0].status, "partial");
  assert.equal(goToExercise(finished, sessionId, 0), finished);
});

test("starting another template while a session is active resumes that session and says so", () => {
  const { state, sessionId } = sessionWith([plainExercise()]);
  const second = { id: "tpl2", title: "Другая", date: "2026-10-03", exercises: [{ ...plainExercise(), id: "other", restSec: 180 as const }] };
  const result = startWorkoutSession({ ...state, workoutTemplates: [...state.workoutTemplates!, second] }, "tpl2");
  assert.equal(result?.sessionId, sessionId);
  assert.equal(result?.resumed, true);
});

test("reopening a recorded set in the journal and re-recording is not blocked", () => {
  const { state, sessionId } = sessionWith([plainExercise()]);
  const id = idOf(state, sessionId, "row", "s1");
  const recorded = recordSet(state, sessionId, "row", id, 10);
  const workoutId = workoutOf(recorded, sessionId).id;
  const cancelled = cancelWorkoutSession(recorded, sessionId);
  const reopened = correctHistoricalSet({ ...cancelled, workoutSessions: cancelled.workoutSessions!.map((s) => ({ ...s, status: "completed" as const })) }, workoutId, "row", id, { weightKg: 40, reps: 10, weightMode: "total", completed: false });
  assert.equal(setOf(reopened, sessionId, "row", "s1").completed, false);
});
