import assert from "node:assert/strict";
import test from "node:test";

import {
  completeWorkoutSet,
  calculateExerciseVolume,
  getLocalDate,
  normalizeDecimalInput,
  parseWorkoutNotes,
  type Workout,
} from "../src/lib/tracker.ts";

test("Moscow local date is independent from UTC date", () => {
  assert.equal(getLocalDate(new Date("2026-09-09T21:30:00.000Z"), "Europe/Moscow"), "2026-09-10");
});

test("decimal comma is normalized without turning an empty draft into zero", () => {
  assert.equal(normalizeDecimalInput("12,5"), 12.5);
  assert.equal(normalizeDecimalInput(""), null);
  assert.equal(normalizeDecimalInput("-1"), null);
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

