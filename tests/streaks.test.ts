import assert from "node:assert/strict";
import test from "node:test";
import { habitStreaks, monthGrid, trainedDateSet, weeklyGoalStreak } from "../src/lib/streaks.ts";
import type { TrackerState } from "../src/lib/storage.ts";
import type { Workout } from "../src/lib/tracker.ts";

const habits = [{ id: "a", title: "A", type: "habit", schedule: "" }, { id: "b", title: "B", type: "habit", schedule: "" }] as TrackerState["habits"];
const mark = (habitId: string, localDate: string, outcome: "completed" | "skipped" = "completed") => ({ id: `${habitId}-${localDate}`, habitId, localDate, completedAt: `${localDate}T08:00:00.000Z`, outcome, source: "web" as const });
const stateOf = (completions: ReturnType<typeof mark>[]) => ({ version: 1, habits, completions, workouts: [], activeTimer: null, observations: [], outbox: [] }) as unknown as TrackerState;

test("streak counts closed days and today does not break it until it ends", () => {
  const state = stateOf([
    mark("a", "2026-10-01"), mark("b", "2026-10-01"),
    mark("a", "2026-10-02"), mark("b", "2026-10-02"),
    mark("a", "2026-10-03"),
  ]);
  assert.deepEqual(habitStreaks(state, "2026-10-03"), { current: 2, longest: 2 });
  const closedToday = stateOf([mark("a", "2026-10-02"), mark("b", "2026-10-02"), mark("a", "2026-10-03"), mark("b", "2026-10-03")]);
  assert.equal(habitStreaks(closedToday, "2026-10-03").current, 2);
});

test("a skipped habit and a missed day break the streak, longest is remembered", () => {
  const state = stateOf([
    mark("a", "2026-09-28"), mark("b", "2026-09-28"),
    mark("a", "2026-09-29"), mark("b", "2026-09-29"),
    mark("a", "2026-09-30"), mark("b", "2026-09-30", "skipped"),
    mark("a", "2026-10-01"), mark("b", "2026-10-01"),
  ]);
  assert.deepEqual(habitStreaks(state, "2026-10-02"), { current: 1, longest: 2 });
  assert.deepEqual(habitStreaks(state, "2026-10-03"), { current: 0, longest: 2 });
  assert.deepEqual(habitStreaks(stateOf([]), "2026-10-02"), { current: 0, longest: 0 });
});

test("weekly goal streak ignores an unfinished current week", () => {
  const dates = new Set(["2026-09-14", "2026-09-16", "2026-09-18", "2026-09-21", "2026-09-23", "2026-09-25", "2026-09-29"]);
  assert.equal(weeklyGoalStreak(dates, 3, "2026-10-03"), 2);
  dates.add("2026-10-01"); dates.add("2026-10-02");
  assert.equal(weeklyGoalStreak(dates, 3, "2026-10-03"), 3);
  assert.equal(weeklyGoalStreak(dates, 0, "2026-10-03"), 0);
});

test("month grid starts on Monday, marks training and future days", () => {
  const workout: Workout = { id: "w", date: "2026-10-02", title: "T", exercises: [{ id: "e", name: "X", sets: [{ id: "s", weightKg: 50, reps: 5, completed: true, weightMode: "total" }] }] };
  const trained = trainedDateSet([workout]);
  const grid = monthGrid(stateOf([mark("a", "2026-10-01"), mark("b", "2026-10-01")]), 2026, 10, "2026-10-03", trained);
  assert.equal(grid.length % 7, 0);
  assert.equal(grid[0].date, "2026-09-28");
  assert.equal(grid[0].inMonth, false);
  const oct1 = grid.find((c) => c.date === "2026-10-01")!;
  assert.equal(oct1.closed, true);
  assert.equal(grid.find((c) => c.date === "2026-10-02")!.trained, true);
  assert.equal(grid.find((c) => c.date === "2026-10-03")!.isToday, true);
  assert.equal(grid.find((c) => c.date === "2026-10-04")!.isFuture, true);
});
