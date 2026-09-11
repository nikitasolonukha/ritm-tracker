import assert from "node:assert/strict";
import test from "node:test";

import {
  completeWorkoutSet,
  createRestTimerCommand,
  calculateExerciseVolume,
  commitDraftValue,
  getLocalDate,
  normalizeDecimalInput,
  parseWorkoutNotes,
  stableStringify,
  defaultHabits,
  type Workout,
} from "../src/lib/tracker.ts";
import { decideLostPutResponse } from "../src/lib/sync.ts";

test("Moscow local date is independent from UTC date", () => {
  assert.equal(getLocalDate(new Date("2026-09-09T21:30:00.000Z"), "Europe/Moscow"), "2026-09-10");
});

test("decimal comma is normalized without turning an empty draft into zero", () => {
  assert.equal(normalizeDecimalInput("12,5"), 12.5);
  assert.equal(normalizeDecimalInput(""), null);
  assert.equal(normalizeDecimalInput("-1"), null);
});

test("draft commit distinguishes untouched, empty, valid, and invalid input", () => {
  assert.deepEqual(commitDraftValue(undefined, "weight"), { status: "untouched" });
  assert.deepEqual(commitDraftValue("", "weight"), { status: "empty", value: null });
  assert.deepEqual(commitDraftValue("12,5", "weight"), { status: "valid", value: 12.5 });
  assert.deepEqual(commitDraftValue("12x", "reps"), { status: "invalid" });
});

test("stable JSON ignores object key order but preserves array order", () => {
  assert.equal(stableStringify({ b: 2, a: { d: 4, c: 3 } }), stableStringify({ a: { c: 3, d: 4 }, b: 2 }));
  assert.notEqual(stableStringify({ values: [1, 2] }), stableStringify({ values: [2, 1] }));
});

test("stable JSON is valid when optional transport fields are undefined", () => {
  const encoded = stableStringify({ z: undefined, a: [undefined, Number.NaN, { b: undefined, a: 1 }] });
  assert.equal(encoded, '{"a":[null,null,{"a":1}]}');
  assert.doesNotThrow(() => JSON.parse(encoded));
});

test("lost sync response is accepted only when the server has the sent payload", () => {
  const payload = { version: 1, value: "local" };
  assert.deepEqual(decideLostPutResponse(payload, 10, { payload: { value: "local", version: 1 }, version: 11 }), { action: "accepted", revision: 11 });
  assert.deepEqual(decideLostPutResponse(payload, 10, { payload: null, version: 10 }), { action: "retry", revision: 10 });
  assert.deepEqual(decideLostPutResponse(payload, 10, { payload: { version: 1, value: "other" }, version: 11 }), { action: "conflict", revision: 11 });
});

test("45 kg per side for 8 reps is 720 kg", () => {
  assert.equal(calculateExerciseVolume([{ id: "s", weightKg: 45, reps: 8, completed: true, weightMode: "per-hand" }]), 720);
});

test("completeSet is idempotent, starts one rest timer, and queues a command", () => {
  const workout: Workout = {
    id: "session-1",
    date: "2026-09-10",
    title: "Зал",
    exercises: [{ id: "chest", name: "Жим", category: "working", restSec: 240, sets: [
      { id: "set-1", weightKg: 45, reps: 8, completed: false, weightMode: "per-hand" },
    ] }],
  };
  const first = completeWorkoutSet({ workout, commands: [], activeTimer: null }, "chest", "set-1", "cmd-1", "2026-09-10T10:00:00.000Z");
  const second = completeWorkoutSet(first, "chest", "set-1", "cmd-1", "2026-09-10T10:00:01.000Z");
  assert.equal(first.workout.exercises[0].sets[0].completed, true);
  assert.equal(first.activeTimer?.durationSec, 240);
  assert.equal(first.commands.length, 1);
  assert.deepEqual(second, first);
});

test("inline imports keep the exercise name and decimal comma", () => {
  const workout = parseWorkoutNotes("28 августа 2026\nЖим в тренажере (45x8, 45x8, 45x8, 45x8)\nБицепс (12,5x8)");
  assert.equal(workout.exercises[0].name, "Жим в тренажере");
  assert.equal(workout.exercises[1].sets[0].weightKg, 12.5);
});

test("default schedule records the user's scheme without inventing clock times", () => {
  assert.equal(defaultHabits.find((habit) => habit.id === "wake")?.schedule, "настроить");
  assert.equal(defaultHabits.find((habit) => habit.id === "chia")?.schedule, "настроить");
  assert.equal(defaultHabits.find((habit) => habit.id === "zinc")?.privateTitle, "настроить");
});

test("compound shoulder pairs start one rest per pair", () => {
  const workout: Workout = {
    id: "shoulders",
    date: "2026-09-10",
    title: "Плечи",
    exercises: [{ id: "shoulders", name: "Плечи", restSec: 180, sets: [
      { id: "a1", weightKg: 5, reps: 8, completed: false, component: "compound-a", segmentId: "pair-1", weightMode: "total" },
      { id: "b1", weightKg: 5, reps: 8, completed: false, component: "compound-b", segmentId: "pair-1", weightMode: "total" },
      { id: "a2", weightKg: 5, reps: 8, completed: false, component: "compound-a", segmentId: "pair-2", weightMode: "total" },
      { id: "b2", weightKg: 5, reps: 8, completed: false, component: "compound-b", segmentId: "pair-2", weightMode: "total" },
    ] }],
  };
  const first = completeWorkoutSet({ workout, commands: [], activeTimer: null }, "shoulders", "a1", "a1-command", "2026-09-10T10:00:00.000Z");
  const second = completeWorkoutSet(first, "shoulders", "b1", "b1-command", "2026-09-10T10:00:01.000Z");
  assert.equal(first.activeTimer, null);
  assert.equal(second.activeTimer?.durationSec, 180);
  assert.equal(second.activeTimer?.sourceId, "shoulders:shoulders:b1");
});

test("impossible Russian dates are rejected", () => {
  assert.equal(parseWorkoutNotes("31 февраля 2026\nЖим\n45x8").id, "");
});

test("rest reschedule creates one newer command and cancel stops the timer", () => {
  const timer = { sourceId: "session-1:bench:set-1", startedAt: "2026-09-10T08:00:00.000Z", endsAt: "2026-09-10T08:04:00.000Z", durationSec: 240, version: 1, status: "running" as const };
  const extended = createRestTimerCommand(timer, "reschedule", "2026-09-10T08:01:00.000Z", "rest");
  assert.equal(extended?.timer?.version, 2);
  assert.equal(extended?.timer?.endsAt, "2026-09-10T08:04:30.000Z");
  assert.equal(extended?.command.type, "timer.rescheduled");
  assert.equal(extended?.command.payload.expiresAt, "2026-09-10T08:14:30.000Z");
  const cancelled = createRestTimerCommand(extended!.timer!, "cancel", "2026-09-10T08:02:00.000Z", "rest");
  assert.equal(cancelled?.timer, null);
  assert.equal(cancelled?.command.type, "timer.cancelled");
  assert.equal(cancelled?.command.version, 3);
});
