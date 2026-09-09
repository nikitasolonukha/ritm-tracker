import assert from "node:assert/strict";
import test from "node:test";

import {
  applyHabitCompletion,
  calculateExerciseVolume,
  calculateWorkoutTotals,
  getMilestoneState,
  parseWorkoutNotes,
  restoreRestTimer,
  suggestNextLoad,
} from "../src/lib/tracker.ts";

test("calculates normal barbell/machine volume", () => {
  assert.equal(calculateExerciseVolume([
    { id: "s1", weightKg: 45, reps: 8, completed: true },
    { id: "s2", weightKg: 45, reps: 8, completed: true },
    { id: "s3", weightKg: 45, reps: 8, completed: true },
    { id: "s4", weightKg: 45, reps: 8, completed: true },
  ]), 1440);
});

test("calculates dumbbell volume with per-hand weight", () => {
  assert.equal(calculateExerciseVolume([
    { id: "s1", weightKg: 12, reps: 10, completed: true, weightMode: "per-hand" },
  ]), 240);
});

test("excludes planned and unknown sets from actual totals", () => {
  const totals = calculateWorkoutTotals({
    id: "w1",
    date: "2026-09-09",
    title: "Зал",
    exercises: [
      {
        id: "e1",
        name: "Бабочка",
        sets: [
          { id: "s1", weightKg: 30, reps: 12, completed: true },
          { id: "s2", weightKg: 35, reps: null, completed: true, note: "в отказ" },
          { id: "s3", weightKg: 40, reps: 10, completed: false },
        ],
      },
    ],
  });

  assert.equal(totals.volumeKg, 360);
  assert.equal(totals.completedSets, 2);
  assert.equal(totals.unscoredSets, 1);
});

test("does not duplicate habit completion on repeated commands", () => {
  const first = applyHabitCompletion([], {
    id: "cmd-1",
    habitId: "chia",
    completedAt: "2026-09-09T08:00:00+03:00",
    localDate: "2026-09-09",
    source: "telegram",
  });
  const second = applyHabitCompletion(first, {
    id: "cmd-1",
    habitId: "chia",
    completedAt: "2026-09-09T08:01:00+03:00",
    localDate: "2026-09-09",
    source: "web",
  });

  assert.equal(second.length, 1);
  assert.equal(second[0].source, "telegram");
});

test("counts milestone days by unique local completion dates", () => {
  const state = getMilestoneState([
    { id: "a", habitId: "chia", localDate: "2026-09-01", completedAt: "2026-09-01T08:00:00+03:00", source: "web" },
    { id: "b", habitId: "chia", localDate: "2026-09-01", completedAt: "2026-09-01T12:00:00+03:00", source: "web" },
    { id: "c", habitId: "chia", localDate: "2026-09-02", completedAt: "2026-09-02T08:00:00+03:00", source: "telegram" },
    { id: "d", habitId: "chia", localDate: "2026-09-03", completedAt: "2026-09-03T08:00:00+03:00", source: "web" },
    { id: "e", habitId: "chia", localDate: "2026-09-04", completedAt: "2026-09-04T08:00:00+03:00", source: "web" },
    { id: "f", habitId: "chia", localDate: "2026-09-05", completedAt: "2026-09-05T08:00:00+03:00", source: "web" },
  ], "chia", 5);

  assert.equal(state.reached, true);
  assert.deepEqual(state.dates, ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"]);
});

test("restores rest timer after refresh", () => {
  assert.deepEqual(restoreRestTimer({
    startedAt: "2026-09-09T10:00:00.000Z",
    durationSec: 240,
  }, "2026-09-09T10:03:00.000Z"), {
    remainingSec: 60,
    expired: false,
  });

  assert.deepEqual(restoreRestTimer({
    startedAt: "2026-09-09T10:00:00.000Z",
    durationSec: 180,
  }, "2026-09-09T10:04:00.000Z"), {
    remainingSec: 0,
    expired: true,
  });
});

test("parses pasted workout notes without inventing unknown reps", () => {
  const workout = parseWorkoutNotes(`09.09.2026
Жим в тренажере
20x5, 30x3, 40x1, 45x8, 45x8
Бабочка посадка 6 ручки 3
30x12, 35 в отказ`);

  assert.equal(workout.date, "2026-09-09");
  assert.equal(workout.exercises.length, 2);
  assert.equal(workout.exercises[0].sets.length, 5);
  assert.equal(workout.exercises[1].settings, "посадка 6 ручки 3");
  assert.equal(workout.exercises[1].sets[1].reps, null);
  assert.equal(workout.exercises[1].sets[1].note, "в отказ");
});

test("does not show an unverified load suggestion", () => {
  assert.equal(suggestNextLoad([
    { date: "2026-09-01", weightKg: 45, reps: 8, completed: true },
    { date: "2026-09-05", weightKg: 45, reps: 8, completed: true },
    { date: "2026-09-09", weightKg: 45, reps: 9, completed: true },
  ]), null);

  assert.equal(suggestNextLoad([
    { date: "2026-09-01", weightKg: 45, reps: 8, completed: true },
    { date: "2026-09-09", weightKg: 45, reps: 6, completed: true },
  ]), null);
});
