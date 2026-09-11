import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import * as tracker from "../src/lib/tracker.ts";
import { createInitialState, createStarterWorkout, readStateSafely, storageKey } from "../src/lib/storage.ts";

const now = "2026-09-09T10:00:00.000Z";

function workoutFixture() {
  return {
    id: "fixture-workout",
    date: "2026-09-09",
    title: "Fixture",
    exercises: [{
      id: "fixture-exercise",
      name: "Fixture exercise",
      category: "working",
      restSec: 240,
      sets: [1, 2, 3, 4].map((index) => ({
        id: `fixture-set-${index}`,
        weightKg: 45,
        reps: 8,
        completed: false,
        weightMode: "per-hand",
      })),
    }],
  };
}

test("A01 chest completion starts 240 second rest", () => {
  const workout = workoutFixture();
  const result = tracker.completeWorkoutSet({ workout, commands: [], activeTimer: null }, "fixture-exercise", "fixture-set-1", "cmd-1", now);
  assert.equal(result.activeTimer.durationSec, 240);
});

test("A02 completion creates durable command data", () => {
  const workout = workoutFixture();
  const result = tracker.completeWorkoutSet({ workout, commands: [], activeTimer: null }, "fixture-exercise", "fixture-set-1", "cmd-1", now);
  assert.equal(result.commands[0].payload.setId, "fixture-set-1");
});

test("A03 repeated habit operation is idempotent", () => {
  const item = { id: "habit-day", habitId: "chia", completedAt: now, localDate: "2026-09-09", source: "web" };
  const first = tracker.applyHabitCompletion([], item);
  assert.equal(tracker.applyHabitCompletion(first, { ...item, source: "telegram" }).length, 1);
});

test("A04 repeated set command cannot undo completion", () => {
  const workout = workoutFixture();
  const state = { workout, commands: [], activeTimer: null };
  const first = tracker.completeWorkoutSet(state, "fixture-exercise", "fixture-set-1", "cmd-1", now);
  const second = tracker.completeWorkoutSet(first, "fixture-exercise", "fixture-set-1", "cmd-1", now);
  assert.equal(second.workout.exercises[0].sets[0].completed, true);
  assert.equal(second.commands.length, 1);
});

test("A05 starter chest program has four working sets", () => {
  assert.equal(createStarterWorkout("2026-09-09").exercises[0].sets.length, 4);
});

test("initial state keeps the starter program out of workout history", () => {
  const state = createInitialState("2026-09-09");
  assert.equal(state.workouts.length, 0);
  assert.equal(state.workoutTemplates?.length, 1);
  assert.equal(state.activeWorkoutId, undefined);
});

test("A06 45 kg per side x 8 is 720 kg", () => {
  const set = workoutFixture().exercises[0].sets[0];
  assert.equal(tracker.calculateExerciseVolume([{ ...set, completed: true }]), 720);
});

test("A07 three sets do not produce an unverified load hint", () => {
  assert.equal(tracker.suggestNextLoad([1, 2, 3].map(() => ({ date: "2026-09-09", weightKg: 45, reps: 8, completed: true }))), null);
});

test("A08 inline exercise name survives import", () => {
  assert.ok(tracker.parseWorkoutNotes("28 августа 2026\nЖим в тренажере (45x8, 45x8, 45x8, 45x8)").exercises.some((item) => item.name === "Жим в тренажере"));
});

test("A09 decimal comma stays in one set", () => {
  const result = tracker.parseWorkoutNotes("09.09.2026\nБицепс\n12,5x8");
  assert.equal(result.exercises[0].sets.length, 1);
  assert.equal(result.exercises[0].sets[0].weightKg, 12.5);
});

test("A10 empty import produces no exercise or id", () => {
  const result = tracker.parseWorkoutNotes("   ");
  assert.equal(result.id, "");
  assert.equal(result.exercises.length, 0);
});

test("A11 historical import does not replace active workout", () => {
  const state = createInitialState("2026-09-09");
  const imported = tracker.parseWorkoutNotes("28.08.2026\nЖим\n45x8");
  const next = { ...state, workouts: [...state.workouts, imported] };
  assert.equal(next.activeWorkoutId, undefined);
});

test("A12 unique real dates are used for milestone counts", () => {
  const state = tracker.getMilestoneState([
    { id: "a", habitId: "chia", localDate: "2026-09-10", completedAt: now, source: "web" },
    { id: "b", habitId: "chia", localDate: "2026-09-10", completedAt: now, source: "web" },
  ], "chia", 2);
  assert.equal(state.count, 1);
});

test("A13 Moscow date after UTC midnight belongs to local next day", () => {
  assert.equal(tracker.getLocalDate(new Date("2026-09-09T21:30:00.000Z")), "2026-09-10");
});

test("A14 decimal input accepts comma and rejects negative", () => {
  assert.equal(tracker.normalizeDecimalInput("12,5"), 12.5);
  assert.equal(tracker.normalizeDecimalInput("-1"), null);
});

test("A15 offline assets never receive an HTML login fallback", async () => {
  const handlers = {};
  const context = { Response, self: { addEventListener: (name, handler) => { handlers[name] = handler; }, skipWaiting() {}, clients: { claim() {} } }, fetch: async () => { throw new Error("offline"); }, caches: { match: async (request) => request === "/" ? { headers: new Map([["Content-Type", "text/html"]]) } : undefined, open: async () => ({ put() {}, addAll() {} }), keys: async () => [] } };
  vm.runInNewContext(fs.readFileSync(new URL("../public/sw.js", import.meta.url), "utf8"), context);
  let responsePromise;
  handlers.fetch({ request: { method: "GET", mode: "same-origin", url: "https://app.test/_next/static/chunks/app.js", destination: "script" }, respondWith: (promise) => { responsePromise = promise; } });
  const response = await responsePromise;
  assert.equal(response.status, 503);
});

test("A15b offline navigation never falls back to the public login shell", async () => {
  const handlers = {};
  const context = {
    Response,
    URL,
    self: { addEventListener: (name, handler) => { handlers[name] = handler; }, skipWaiting() {}, clients: { claim() {} } },
    fetch: async () => { throw new Error("offline"); },
    caches: {
      match: async () => undefined,
      open: async () => ({ match: async () => undefined, put() {}, addAll() {} }),
      keys: async () => ["ritm-public-v2"],
      delete: async () => true,
    },
  };
  vm.runInNewContext(fs.readFileSync(new URL("../public/sw.js", import.meta.url), "utf8"), context);
  let responsePromise;
  handlers.fetch({ request: { method: "GET", mode: "navigate", url: "https://app.test/today", destination: "document" }, waitUntil() {}, respondWith: (promise) => { responsePromise = promise; } });
  const response = await responsePromise;
  assert.equal(response.status, 503);
  assert.match(await response.text(), /Нет связи/);
});

test("A16 whitespace-normalized import has a stable identity", () => {
  const first = tracker.parseWorkoutNotes("09.09.2026\nЖим\n45x8");
  const second = tracker.parseWorkoutNotes("09.09.2026\nЖим\n45x8\n");
  assert.equal(first.id, second.id);
});

test("A17 corrupt local state is backed up instead of overwritten", () => {
  const records = new Map([[storageKey, "{bad json"]]);
  globalThis.window = { localStorage: { getItem: (key) => records.get(key) ?? null, setItem: (key, value) => records.set(key, value), removeItem: (key) => records.delete(key) } };
  const result = readStateSafely();
  assert.equal(result.status, "corrupt");
  assert.equal(records.get(storageKey), "{bad json");
  assert.ok(result.backupKey && records.get(result.backupKey) === "{bad json");
  delete globalThis.window;
});

test("user-scoped reads never fall back to another account's legacy journal", () => {
  const records = new Map([[storageKey, JSON.stringify(createInitialState("2026-09-09"))]]);
  globalThis.window = { localStorage: { getItem: (key) => records.get(key) ?? null, setItem: (key, value) => records.set(key, value), removeItem: (key) => records.delete(key) } };
  const result = readStateSafely("different-user");
  assert.equal(result.status, "empty");
  assert.equal(result.state.workouts.length, 0);
  assert.equal(records.get(storageKey), JSON.stringify(createInitialState("2026-09-09")));
  delete globalThis.window;
});
