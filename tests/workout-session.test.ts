import assert from "node:assert/strict";
import test from "node:test";
import { backupSyncConflict, createInitialState, readOutboxAcks, writeOutboxAck } from "../src/lib/storage.ts";
import { cancelWorkoutSession, finishWorkoutSession, startWorkoutSession, type SessionTrackerState } from "../src/lib/workout-session.ts";

test("starting a template creates an independent session snapshot", () => {
  const initial = createInitialState("2026-09-10") as SessionTrackerState;
  const started = startWorkoutSession(initial, initial.workoutTemplates![0].id, new Date("2026-09-10T08:00:00.000Z"));
  assert.ok(started);
  assert.notEqual(started.sessionId, initial.workoutTemplates![0].id);
  assert.equal(started.state.workouts.at(-1)?.id, `workout-${started.sessionId}`);
  assert.equal(started.state.workouts.at(-1)?.exercises[0].sets.every((set) => !set.completed), true);
});

test("finish and cancel are idempotent and clear only the active workout timer", () => {
  const initial = createInitialState("2026-09-10") as SessionTrackerState;
  const started = startWorkoutSession(initial, initial.workoutTemplates![0].id, new Date("2026-09-10T08:00:00.000Z"))!;
  const withTimer = { ...started.state, activeTimer: { sourceId: "test", startedAt: "2026-09-10T08:00:00.000Z", durationSec: 240 } };
  const finished = finishWorkoutSession(withTimer, started.sessionId, new Date("2026-09-10T09:00:00.000Z"));
  assert.equal(finished.activeTimer, null);
  assert.equal(finished.activeSessionId, undefined);
  assert.equal(finishWorkoutSession(finished, started.sessionId).workoutSessions?.[0].finishedAt, finished.workoutSessions?.[0].finishedAt);
  const cancelled = cancelWorkoutSession(started.state, started.sessionId);
  assert.equal(cancelled.workoutSessions?.[0].status, "cancelled");
});

test("outbox acknowledgements survive reload and stay isolated per user", () => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value); },
      },
    },
  });

  assert.equal(writeOutboxAck("command-1", "user-a").ok, true);
  assert.deepEqual([...readOutboxAcks("user-a")], ["command-1"]);
  assert.deepEqual([...readOutboxAcks("user-b")], []);
  delete (globalThis as { window?: unknown }).window;
});

test("sync conflict backup keeps both user-scoped copies", () => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) } },
  });
  const local = createInitialState("2026-09-10");
  const remote = createInitialState("2026-09-11");
  assert.equal(backupSyncConflict("user-a", 7, local, remote).ok, true);
  assert.equal(values.has("ritm-tracker-state-v1-sync-conflict:user-a:7:local"), true);
  assert.equal(values.has("ritm-tracker-state-v1-sync-conflict:user-a:7:remote"), true);
  assert.equal(values.has("ritm-tracker-state-v1-sync-conflict:user-b:7:local"), false);
  delete (globalThis as { window?: unknown }).window;
});
