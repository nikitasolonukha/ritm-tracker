import assert from "node:assert/strict";
import test from "node:test";
import {
  createBackupDocument, embeddedPhotoSize, MAX_BACKUP_BYTES, MAX_BACKUP_PHOTO_BYTES,
  mergeBackup, parseBackup, photoBelongsToAccount, previewBackup, saveBeforeImport,
} from "../src/lib/backup.ts";
import type { SessionTrackerState } from "../src/lib/workout-session.ts";
import type { Workout } from "../src/lib/tracker.ts";

const instant = "2026-09-30T09:00:00.000Z";
const image = "data:image/png;base64,iVBORw0KGgo=";
function workout(id = "history"): Workout {
  return { id, title: "Fixture routine", date: "2026-09-29", exercises: [{ id: "fixture-exercise", name: "Fixture lift", sets: [{ id: "fixture-set", weightKg: 12.5, reps: 8, completed: true, weightMode: "total" }] }] };
}
function fixture(): SessionTrackerState {
  return {
    version: 1,
    habits: [{ id: "habit", title: "Fixture action", type: "habit", schedule: "", time: "09:00" }],
    completions: [{ id: "completion", habitId: "habit", localDate: "2026-09-29", completedAt: instant, source: "web" }],
    workouts: [workout()], workoutTemplates: [workout("program")],
    observations: [{ id: "observation", date: "2026-09-29", energy: 6, sleep: 8, skin: "unknown", note: "Fixture" }],
    photos: [], activeTimer: null, outbox: [], workoutSessions: [], workoutCommands: [],
  };
}
const parsed = (state: SessionTrackerState) => parseBackup(JSON.stringify(state));

test("backup round trips a versioned document and legacy JSON without production defaults", () => {
  const state = fixture();
  const document = createBackupDocument(state, "account-a", instant);
  assert.deepEqual(parseBackup(JSON.stringify(document)), { state, accountId: "account-a", exportedAt: instant });
  assert.deepEqual(parsed(state), { state });
});
test("invalid JSON, versions, nesting and duplicate IDs are rejected before import", () => {
  assert.throws(() => parseBackup("{bad"), /JSON/);
  assert.throws(() => parsed({ ...fixture(), version: 2 } as unknown as SessionTrackerState), /Структура/);
  assert.throws(() => parseBackup(JSON.stringify({ ...createBackupDocument(fixture(), "account-a", instant), version: 9 })), /формат/);
  const state = fixture();
  assert.throws(() => parsed({ ...state, habits: [...state.habits, state.habits[0]] }), /Структура/);
  assert.throws(() => parsed({ ...state, workouts: [{ ...workout(), exercises: [{ ...workout().exercises[0], sets: [{ ...workout().exercises[0].sets[0], weightKg: -1 }] }] }] }), /Структура/);
  assert.throws(() => parsed({ ...state, observations: [{ ...state.observations[0], sleep: 30 }] }), /Структура/);
  assert.throws(() => parsed({ ...state, outbox: [{ id: "cmd", type: "timer.cancelled", status: "pending", createdAt: "invalid" }] }), /Структура/);
});
test("impossible calendar dates, fractional reps and unsupported weight modes cannot enter history", () => {
  const state = fixture();
  assert.throws(() => parsed({ ...state, workouts: [{ ...workout(), date: "2026-02-30" }] }), /Структура/);
  const set = workout().exercises[0].sets[0];
  for (const badSet of [{ ...set, reps: 8.5 }, { ...set, weightMode: "guess" }]) {
    const value = { ...state, workouts: [{ ...workout(), exercises: [{ ...workout().exercises[0], sets: [badSet] }] }] };
    assert.throws(() => parseBackup(JSON.stringify(value)), /Структура/);
  }
});
test("incomplete facts stay incomplete and unknown weight modes are not guessed", () => {
  const state = fixture();
  state.workouts[0].exercises[0].sets = [{ id: "failure", weightKg: null, reps: null, completed: true, note: "Отказ" }];
  const read = parsed(state);
  assert.deepEqual(read.state.workouts[0].exercises[0].sets, state.workouts[0].exercises[0].sets);
});
test("untrusted prototype keys and sessions without their workout are rejected", () => {
  assert.throws(() => parseBackup(JSON.stringify(fixture()).replace('"version":1', '"version":1,"__proto__":{"polluted":true}')), /Структура/);
  assert.throws(() => parsed({ ...fixture(), workoutSessions: [{ id: "s", workoutId: "missing", templateId: "program", status: "completed", startedAt: instant, activeExerciseIndex: 0 }] }), /сессия/);
});
test("merge adds only new IDs and facts while keeping existing values, IDs and plans", () => {
  const current = fixture(); const incoming = fixture();
  incoming.habits[0].title = "Do not overwrite";
  incoming.workouts[0].title = "Do not overwrite";
  incoming.workouts[0].exercises[0].sets[0].weightKg = 99;
  incoming.workouts[0].exercises[0].sets.push({ id: "new-set", weightKg: 20, reps: 10, completed: true, weightMode: "per-hand" });
  incoming.workouts[0].exercises.push({ id: "new-exercise", name: "Another fixture", sets: [] });
  incoming.workouts.push(workout("new-workout"));
  incoming.workoutTemplates![0].title = "Do not overwrite";
  const before = JSON.stringify(current); const source = JSON.stringify(incoming);
  const backup = parsed(incoming);
  const preview = previewBackup(current, backup, "account-a");
  assert.equal(preview.additions.workouts, 1);
  assert.equal(preview.additions.exercises, 2);
  assert.equal(preview.additions.sets, 2);
  const merged = mergeBackup(current, backup, "account-a");
  assert.equal(merged.habits[0].title, "Fixture action");
  assert.equal(merged.workouts[0].title, "Fixture routine");
  assert.equal(merged.workouts[0].exercises[0].sets[0].weightKg, 12.5);
  assert.equal(merged.workouts[0].exercises[0].sets.length, 2);
  assert.equal(merged.workoutTemplates![0].title, "Fixture routine");
  assert.equal(JSON.stringify(current), before);
  assert.equal(JSON.stringify(incoming), source);
  assert.deepEqual(mergeBackup(merged, backup, "account-a"), merged);
});
test("day-level duplicates do not double count habit marks or observations", () => {
  const current = fixture(); const incoming = fixture();
  incoming.completions[0] = { ...incoming.completions[0], id: "other-id", outcome: "skipped" };
  incoming.observations[0] = { ...incoming.observations[0], id: "other-observation", energy: 1 };
  const merged = mergeBackup(current, parsed(incoming), "account-a");
  assert.deepEqual(merged.completions, current.completions);
  assert.deepEqual(merged.observations, current.observations);
});
test("current active session, workout, timer and commands stay exactly untouched", () => {
  const current = fixture();
  current.activeWorkoutId = "history"; current.activeSessionId = "current-session";
  current.activeTimer = { sourceId: "rest-current", startedAt: instant, durationSec: 240, version: 3 };
  current.workoutSessions = [{ id: "current-session", workoutId: "history", templateId: "program", status: "active", startedAt: instant, activeExerciseIndex: 0 }];
  current.outbox = [{ id: "current-command", type: "timer.rescheduled", status: "pending", createdAt: instant, version: 3, payload: { dueAt: "2026-09-30T09:04:00Z" } }];
  current.workoutCommands = [{ id: "current-fact", type: "workout.set.completed", entityId: "rest-current", createdAt: instant, version: 1, result: "applied", payload: { exerciseId: "fixture-exercise", setId: "fixture-set", workoutId: "history" } }];
  current.habitSnoozes = [{ id: "snooze", habitId: "habit", localDate: "2026-09-30", dueAt: instant, count: 1 }];
  const incoming = fixture();
  incoming.workouts[0].exercises[0].sets.push({ id: "forbidden", weightKg: 99, reps: 20, completed: true });
  incoming.outbox = [{ id: "do-not-replay", type: "timer.started", createdAt: instant, status: "pending" }];
  incoming.activeTimer = { startedAt: instant, durationSec: 180 };
  incoming.habitSnoozes = [{ id: "old-snooze", habitId: "habit", localDate: "2026-09-29", dueAt: instant, count: 3 }];
  const merged = mergeBackup(current, parsed(incoming), "account-a");
  assert.deepEqual(merged.workouts[0], current.workouts[0]);
  assert.strictEqual(merged.activeTimer, current.activeTimer);
  assert.strictEqual(merged.outbox, current.outbox);
  assert.strictEqual(merged.workoutCommands, current.workoutCommands);
  assert.strictEqual(merged.habitSnoozes, current.habitSnoozes);
  assert.equal(merged.activeSessionId, current.activeSessionId);
  assert.deepEqual(merged.workoutSessions, current.workoutSessions);
});
test("incoming unfinished sessions require explicit skipping and never revive a timer", () => {
  const current = fixture(); const incoming = fixture();
  incoming.workouts = [workout("unfinished")]; incoming.activeWorkoutId = "unfinished";
  incoming.workoutSessions = [{ id: "unfinished-session", workoutId: "unfinished", templateId: "program", status: "active", startedAt: instant, activeExerciseIndex: 0 }];
  const backup = parsed(incoming);
  assert.equal(previewBackup(current, backup, "account-a").unfinishedWorkouts, 1);
  assert.throws(() => mergeBackup(current, backup, "account-a"), /незавершённые/);
  const merged = mergeBackup(current, backup, "account-a", { skipUnfinishedWorkouts: true });
  assert.deepEqual(merged.workouts, current.workouts);
  assert.deepEqual(merged.workoutSessions, []);
  assert.equal(merged.activeTimer, null);
});
test("completed sessions merge into history without generating commands", () => {
  const incoming = fixture(); incoming.workouts = [workout("new-history")];
  incoming.workoutSessions = [{ id: "finished-session", workoutId: "new-history", templateId: "program", status: "completed", startedAt: instant, finishedAt: instant, activeExerciseIndex: 0 }];
  const merged = mergeBackup(fixture(), parsed(incoming), "account-a");
  assert.equal(merged.workoutSessions?.[0].id, "finished-session");
  assert.deepEqual(merged.outbox, []);
});
test("incoming session metadata cannot reclassify an existing historical workout as cancelled", () => {
  const current = fixture(); const incoming = fixture();
  incoming.workoutSessions = [{ id: "cancelled-in-file", workoutId: "history", templateId: "program", status: "cancelled", startedAt: instant, finishedAt: instant, activeExerciseIndex: 0 }];
  const merged = mergeBackup(current, parsed(incoming), "account-a");
  assert.deepEqual(merged.workoutSessions, current.workoutSessions);
  assert.deepEqual(merged.workouts, current.workouts);
});
test("foreign photo references are blocked by default, explicitly skipped, or converted from embedded photos", () => {
  const current = fixture(); const incoming = fixture();
  incoming.photos = [
    { id: "foreign-embedded", date: "2026-09-29", name: "Fixture.png", dataUrl: image, storagePath: "account-b/embedded.png" },
    { id: "foreign-link", date: "2026-09-29", name: "Missing.png", dataUrl: "", storagePath: "account-b/missing.png" },
    { id: "own-link", date: "2026-09-29", name: "Own.png", dataUrl: "", storagePath: "account-a/own.png" },
  ];
  const backup = parsed(incoming); const preview = previewBackup(current, backup, "account-a");
  assert.equal(preview.unavailablePhotos, 1); assert.equal(preview.portablePhotos, 1); assert.equal(preview.additions.photos, 2);
  assert.throws(() => mergeBackup(current, backup, "account-a"), /фото другого аккаунта/);
  const merged = mergeBackup(current, backup, "account-a", { skipUnavailablePhotos: true });
  assert.equal(merged.photos?.find((p) => p.id === "foreign-embedded")?.storagePath, undefined);
  assert.equal(merged.photos?.find((p) => p.id === "foreign-embedded")?.dataUrl, image);
  assert.equal(merged.photos?.some((p) => p.id === "foreign-link"), false);
  assert.equal(merged.photos?.find((p) => p.id === "own-link")?.storagePath, "account-a/own.png");
});
test("photo links must be private account-scoped paths, not external image URLs or SVG data", () => {
  assert.equal(photoBelongsToAccount("account-a/photo.jpg", "account-a"), true);
  assert.equal(photoBelongsToAccount("account-ab/photo.jpg", "account-a"), false);
  assert.equal(photoBelongsToAccount("account-a/../account-b/photo.jpg", "account-a"), false);
  for (const dataUrl of ["https://example.test/photo.jpg", "data:image/svg+xml;base64,PHN2Zz4=", "data:image/png;base64,a"]) {
    assert.throws(() => parsed({ ...fixture(), photos: [{ id: "bad", name: "Bad", date: "2026-09-29", dataUrl }] }));
  }
});
test("embedded photos work even if an old same-account storage reference is no longer available", () => {
  const incoming = fixture();
  incoming.photos = [{ id: "embedded", date: "2026-09-29", name: "Fixture.png", dataUrl: image, storagePath: "account-a/old-photo.png" }];
  const merged = mergeBackup(fixture(), parsed(incoming), "account-a");
  assert.equal(merged.photos?.[0].dataUrl, image);
  assert.equal(merged.photos?.[0].storagePath, undefined);
});
test("file and embedded photo byte limits are enforced, including padded base64", () => {
  assert.equal(embeddedPhotoSize("data:image/png;base64,YQ=="), 1);
  assert.equal(embeddedPhotoSize("data:image/png;base64,YWI="), 2);
  const tooBig = `data:image/png;base64,${"A".repeat(Math.ceil((MAX_BACKUP_PHOTO_BYTES + 1) / 3) * 4)}`;
  assert.throws(() => embeddedPhotoSize(tooBig), /5 МБ/);
  assert.throws(() => parseBackup(" ".repeat(MAX_BACKUP_BYTES + 1)), /20 МБ/);
});
test("pre-import backups use only current account namespace and never overwrite an existing backup", () => {
  const storage = new Map<string, string>();
  const writer = { setItem: (key: string, value: string) => { storage.set(key, value); } };
  const before = fixture();
  const key = saveBeforeImport(before, "account-a", writer, "fixture-copy-1");
  assert.equal(key, "ritm-tracker-state-v1:account-a:before-import:fixture-copy-1");
  saveBeforeImport(before, "account-a", writer, "fixture-copy-2");
  assert.equal(storage.size, 2);
  assert.deepEqual(JSON.parse(storage.get(key)!), before);
  assert.throws(() => saveBeforeImport(before, "account-a", { setItem: () => { throw new Error("quota"); } }), /Импорт отменён/);
});
test("merged limits are checked, not only each independently valid file", () => {
  const current = fixture(); const incoming = fixture();
  current.habits = Array.from({ length: 100 }, (_, n) => ({ id: `old-${n}`, title: "Fixture", type: "habit" as const, schedule: "" }));
  assert.throws(() => mergeBackup(current, parsed(incoming), "account-a"), /лимиты/);
});
