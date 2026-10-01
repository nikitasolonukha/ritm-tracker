import assert from "node:assert/strict";
import test from "node:test";
import { clearSyncWriteIntent, createInitialState, getStorageKey, migrateState, readSyncWriteIntent, shouldShowLegacyOffer, writeSyncWriteIntent } from "../src/lib/storage.ts";
import { acknowledgeSavedHabits, confirmedSyncWrite, decideSyncDirection, syncFingerprint } from "../src/lib/sync.ts";
import { changeHabit, habitAnchors, habitsForDate, sleepFromEvents, snoozeHabit } from "../src/lib/habits.ts";
import { prepareWorkoutImport, withoutRepeatedImportFacts } from "../src/lib/import.ts";
import { validateRegistration } from "../src/lib/auth.ts";
import { isTrackerPayload } from "../src/lib/payload-validation.ts";
import { correctHistoricalSet, finishWorkoutSession, latestTemplateRecordDate, removeHistoricalExercise, removeHistoricalSet, removeHistoricalWorkout, startWorkoutSession, type SessionTrackerState } from "../src/lib/workout-session.ts";
import { parseTelegramHabitCallback } from "../src/lib/telegram.ts";
import { formatLocalDate, parseWorkoutNotes, russianWord } from "../src/lib/tracker.ts";

test("set separators never absorb reps into the following decimal weight", () => {
  for (const separator of [",", ", ", ";", "\n"]) {
    const notes = `09.09.2026\nFixture\n${["45x8", "45х8", "45×8", "45x8"].join(separator)}\nDecimal\n12,5x8;12.5×8`;
    const exercises = parseWorkoutNotes(notes).exercises;
    assert.equal(exercises[0].sets.length, 4);
    assert.deepEqual(exercises[0].sets.map((set) => [set.weightKg, set.reps]), [[45, 8], [45, 8], [45, 8], [45, 8]]);
    assert.deepEqual(exercises[1].sets.map((set) => [set.weightKg, set.reps]), [[12.5, 8], [12.5, 8]]);
  }
});

test("clean local state downloads a changed server snapshot; two dirty copies conflict", () => {
  const initial = createInitialState();
  const base = syncFingerprint(initial);
  const remote = { ...initial, observations: [{ id:"one",date:"2026-09-30",energy:5,sleep:8,skin:"same" as const,note:"fixture" }] };
  const local = { ...initial, habits:[] };
  assert.equal(decideSyncDirection(initial,remote,base),"download");
  assert.equal(decideSyncDirection(local,initial,base),"upload");
  assert.equal(decideSyncDirection(local,remote,base),"conflict");
  assert.equal(decideSyncDirection(local,remote,undefined,false),"conflict");
  assert.equal(decideSyncDirection(initial,remote,undefined,true),"download");
});
test("transport acknowledgements cannot create data conflicts", () => {
  const state=createInitialState();
  const local={ ...state,outbox:[{ id:"fixture",type:"habit.completed" as const,status:"pending" as const,createdAt:"2026-09-30T09:00:00Z" }] };
  const remote={ ...local,outbox:local.outbox.map((i) => ({ ...i,status:"accepted" as const })) };
  assert.equal(decideSyncDirection(local,remote),"same");
});

test("reload recovers a committed PUT before uploading later local edits", () => {
  const initial = createInitialState();
  const sent = { ...initial, activeTimer: null, observations: [{ id: "sent", date: "2026-09-30", energy: 5, sleep: 8, skin: "same" as const, note: "fixture" }] };
  const local = { ...sent, observations: [...sent.observations, { ...sent.observations[0], id: "later" }] };
  const intent = { expectedRevision: 191, fingerprint: syncFingerprint(sent) };
  const remote = { payload: sent, version: 192 };
  assert.equal(decideSyncDirection(local, remote.payload, syncFingerprint(initial)), "conflict");
  const recoveredBase = confirmedSyncWrite(intent, remote);
  assert.equal(recoveredBase, syncFingerprint(sent));
  assert.equal(decideSyncDirection(local, remote.payload, recoveredBase), "upload");
});

test("pending write recovery never adopts divergent or uncommitted server data", () => {
  const sent = createInitialState();
  const intent = { expectedRevision: 10, fingerprint: syncFingerprint(sent) };
  assert.equal(confirmedSyncWrite(intent, { payload: { ...sent, habits: [] }, version: 11 }), undefined);
  assert.equal(confirmedSyncWrite(intent, { payload: sent, version: 10 }), undefined);
  assert.equal(confirmedSyncWrite(intent, { version: 11 }), undefined);
  assert.equal(confirmedSyncWrite(undefined, { payload: sent, version: 11 }), undefined);
});

test("write intents survive reload, stay account-scoped and fail safely", () => {
  const records = new Map<string, string>();
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  let unavailable = false;
  const storage = {
    getItem: (key: string) => records.get(key) ?? null,
    setItem: (key: string, value: string) => { if (unavailable) throw new Error("quota"); records.set(key, value); },
    removeItem: (key: string) => { if (unavailable) throw new Error("quota"); records.delete(key); },
  };
  Object.defineProperty(globalThis, "window", { value: { localStorage: storage }, configurable: true });
  try {
    const intent = { expectedRevision: 191, fingerprint: syncFingerprint(createInitialState()) };
    assert.equal(writeSyncWriteIntent("fixture-a", intent), true);
    assert.deepEqual(readSyncWriteIntent("fixture-a"), intent);
    assert.equal(readSyncWriteIntent("fixture-b"), undefined);
    const otherTabIntent = { ...intent, expectedRevision: 192, fingerprint: "other-tab" };
    assert.equal(writeSyncWriteIntent("fixture-a", otherTabIntent), true);
    assert.equal(clearSyncWriteIntent("fixture-a", intent), true);
    assert.deepEqual(readSyncWriteIntent("fixture-a"), otherTabIntent, "A late response cannot remove another page's recovery intent");
    assert.equal(writeSyncWriteIntent("fixture-a", intent), true);
    unavailable = true;
    assert.equal(writeSyncWriteIntent("fixture-a", { ...intent, expectedRevision: 192 }), false);
    assert.deepEqual(readSyncWriteIntent("fixture-a"), intent);
    assert.equal(clearSyncWriteIntent("fixture-a", intent), false);
    unavailable = false;
    assert.equal(clearSyncWriteIntent("fixture-a", intent), true);
    assert.equal(readSyncWriteIntent("fixture-a"), undefined);
    for (const malformed of ["{", "null", '{"expectedRevision":-1,"fingerprint":"x"}', '{"expectedRevision":2,"fingerprint":3}']) {
      records.set(`${getStorageKey("fixture-a")}:sync-intent`, malformed);
      assert.equal(readSyncWriteIntent("fixture-a"), undefined);
    }
  } finally {
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("a habit created during PUT remains pending until its own snapshot is saved", () => {
  const saved = { outbox: [{ id: "sent", type: "habit.completed", status: "accepted" }] };
  const current = { outbox: [{ id: "sent", type: "habit.completed", status: "pending" }, { id: "later", type: "habit.completed", status: "pending" }] };
  assert.deepEqual(acknowledgeSavedHabits(current, saved).outbox.map((item) => item.status), ["accepted", "pending"]);
});
test("explicitly empty programs stay empty after migration", () => {
  const state=createInitialState();
  assert.deepEqual(migrateState({ ...state,workoutTemplates:[],workouts:state.workoutTemplates! }).workoutTemplates,[]);
});
test("habits obey weekdays and archive, without changing existing facts", () => {
  const habits=[{ id:"a",title:"Fixture",type:"habit" as const,schedule:"",daysOfWeek:[1,3,5] },{ id:"b",title:"Archive",type:"habit" as const,schedule:"",archived:true }];
  assert.equal(habitsForDate(habits,"2026-09-30").length,1);
  assert.equal(habitsForDate(habits,"2026-10-01").length,0);
});

test("event chains allow prepare-then-drink while preventing circular dependencies", () => {
  const base = { title: "Fixture", type: "habit" as const, schedule: "" };
  const habits = [{ ...base, id: "meal" }, { ...base, id: "prepare", afterHabitId: "meal" }, { ...base, id: "drink", afterHabitId: "prepare", delayMinutes: 240 }];
  assert.deepEqual(habitAnchors(habits, "drink").map((habit) => habit.id), ["meal", "prepare"]);
  assert.deepEqual(habitAnchors(habits, "meal"), []);
});
test("skip, mark and undo are stable commands and never duplicate one day's fact", () => {
  const state={ ...createInitialState(),habits:[{ id:"fixture",title:"Fixture",type:"habit" as const,schedule:"" }] };
  const skipped=changeHabit(state,"fixture","2026-09-30","skipped");
  assert.equal(skipped.completions[0].outcome,"skipped");
  const completed=changeHabit(skipped,"fixture","2026-09-30","completed");
  assert.equal(completed.completions.length,1);
  assert.equal(completed.completions[0].outcome,"completed");
  assert.equal(changeHabit(completed,"fixture","2026-09-30","cancelled").completions.length,0);
  assert.equal(new Set(completed.outbox.map((i) => i.id)).size,2);
});
test("sleep uses completed bedtime and wake events across midnight", () => {
  const habits=[{ id:"sleep",title:"Fixture",type:"sleep" as const,schedule:"",eventRole:"bedtime" as const },{ id:"wake",title:"Fixture",type:"sleep" as const,schedule:"",eventRole:"wake" as const }];
  const marks=[{ id:"1",habitId:"sleep",localDate:"2026-09-29",completedAt:"2026-09-29T20:00:00Z",source:"web" as const },{ id:"2",habitId:"wake",localDate:"2026-09-30",completedAt:"2026-09-30T06:00:00Z",source:"web" as const }];
  assert.equal(sleepFromEvents(habits,marks,"2026-09-30"),10);
  assert.equal(sleepFromEvents(habits,[{ ...marks[0],outcome:"skipped" },marks[1]],"2026-09-30"),undefined);
});
test("finishing a session queues a durable rest cancellation", () => {
  const initial=createInitialState();
  const started=startWorkoutSession(initial,initial.workoutTemplates![0].id)!;
  assert.equal(finishWorkoutSession(started.state,started.sessionId),started.state);
  const recorded={ ...started.state,workouts:started.state.workouts.map((workout) => ({ ...workout,exercises:workout.exercises.map((exercise,index) => ({ ...exercise,sets:exercise.sets.map((set,at) => ({ ...set,completed:index===0 && at===0 })) })) })) };
  const active={ ...recorded,activeTimer:{ sourceId:"fixture:rest",startedAt:new Date().toISOString(),durationSec:180,version:1 } };
  const finished=finishWorkoutSession(active,started.sessionId);
  assert.equal(finished.activeTimer,null);
  assert.equal(finished.workoutSessions?.[0].status,"partial");
  assert.equal(finished.outbox.at(-1)?.type,"timer.cancelled");
  assert.equal(finished.outbox.at(-1)?.version,2);
  assert.equal(finishWorkoutSession(finished,started.sessionId).outbox.length,finished.outbox.length);
});
test("registration validates email/password without altering the password", () => {
  assert.equal(validateRegistration("fixture@example.test","correct-password"),null);
  assert.ok(validateRegistration("not-an-email","correct-password"));
  assert.ok(validateRegistration("fixture@example.test","short"));
  assert.ok(validateRegistration("fixture@example.test","a".repeat(129)));
});

test("offline historical undo cancels obsolete pending commands without creating a timer", () => {
  const initial = createInitialState();
  const workout = { id: "w", title: "Fixture", date: "2026-09-30", exercises: [{ id: "e", name: "Fixture", sets: [{ id: "s", weightKg: 45, reps: 8, weightMode: "total" as const, completed: true }] }] };
  const pending = { id: "completion", type: "workout.set.completed" as const, entityId: "w:e:s", version: 1, status: "pending" as const, createdAt: "2026-09-30T09:00:00Z" };
  const state = { ...initial, workouts: [workout], outbox: [pending, { ...pending, id: "cancel", type: "timer.cancelled" as const }] };
  const corrected = correctHistoricalSet(state, "w", "e", "s", { ...workout.exercises[0].sets[0], completed: false });
  assert.equal(corrected.workouts[0].exercises[0].sets[0].completed, false);
  assert.deepEqual(corrected.outbox.map((command) => command.status), ["cancelled", "cancelled"]);
  assert.equal(corrected.activeTimer, state.activeTimer);
  assert.equal(corrected.outbox.length, state.outbox.length);
});
test("program record date follows the template and skips unconfirmed sets", () => {
  const workout = (id: string, date: string, completed: boolean) => ({ id, date, title: "Same", exercises: [{ id: `${id}-e`, name: "Fixture", sets: [{ id: `${id}-s`, weightKg: completed ? 10 : null, reps: completed ? 8 : null, completed }] }] });
  const state = {
    workouts: [workout("old", "2026-09-01", true), workout("renamed", "2026-10-02", true), workout("empty", "2026-10-03", false)],
    workoutSessions: [
      { id: "a", workoutId: "old", templateId: "program", status: "completed", startedAt: "2026-09-01T10:00:00Z", activeExerciseIndex: 0 },
      { id: "b", workoutId: "renamed", templateId: "program", status: "completed", startedAt: "2026-10-02T10:00:00Z", activeExerciseIndex: 0 },
      { id: "c", workoutId: "empty", templateId: "program", status: "completed", startedAt: "2026-10-03T10:00:00Z", activeExerciseIndex: 0 },
    ],
  } as SessionTrackerState;
  assert.equal(latestTemplateRecordDate(state, "program"), "2026-10-02");
  assert.equal(latestTemplateRecordDate(state, "missing"), null);
  assert.equal(formatLocalDate("2026-10-02"), "2 октября");
  assert.equal(russianWord(1, "программа", "программы", "программ"), "программа");
  assert.equal(russianWord(3, "упражнение", "упражнения", "упражнений"), "упражнения");
  assert.equal(russianWord(11, "действие", "действия", "действий"), "действий");
  assert.equal(russianWord(21, "действие", "действия", "действий"), "действие");
});

test("historical deletion removes one set, then an exercise, then the workout, and leaves an active session untouched", () => {
  const initial = createInitialState();
  const workout = { id: "w", title: "Fixture", date: "2026-09-30", exercises: [
    { id: "e", name: "Fixture", sets: [{ id: "s", weightKg: 45, reps: 8, weightMode: "total" as const, completed: true }, { id: "s2", weightKg: 45, reps: 8, weightMode: "total" as const, completed: true }] },
    { id: "e2", name: "Second", sets: [{ id: "s3", weightKg: 20, reps: 10, weightMode: "total" as const, completed: false }] },
  ] };
  const pending = { id: "completion", type: "workout.set.completed" as const, entityId: "w:e:s", version: 1, status: "pending" as const, createdAt: "2026-09-30T09:00:00Z" };
  const state = { ...initial, workouts: [workout], outbox: [pending], workoutSessions: [{ id: "session", workoutId: "w", templateId: "t", status: "partial" as const, startedAt: "2026-09-30T09:00:00Z", activeExerciseIndex: 0 }] };
  const oneSet = removeHistoricalSet(state, "w", "e", "s");
  assert.deepEqual(oneSet.workouts[0].exercises[0].sets.map((set) => set.id), ["s2"]);
  assert.equal(oneSet.outbox[0].status, "cancelled");
  assert.equal(removeHistoricalSet(oneSet, "w", "e", "missing"), oneSet);
  const exerciseGone = removeHistoricalExercise(oneSet, "w", "e");
  assert.deepEqual(exerciseGone.workouts[0].exercises.map((exercise) => exercise.id), ["e2"]);
  const removed = removeHistoricalWorkout(exerciseGone, "w");
  assert.equal(removed.workouts.length, 0);
  assert.equal(removed.workoutSessions?.length, 0);
  const active = { ...state, activeWorkoutId: "w", workoutSessions: [{ ...state.workoutSessions![0], status: "active" as const }] };
  assert.equal(removeHistoricalWorkout(active, "w"), active);
});
test("server rejects malformed nested state before queue triggers", () => {
  const initial=createInitialState();
  assert.equal(isTrackerPayload(initial),true);
  assert.equal(isTrackerPayload({ ...initial,habits:[{ id:"h",title:"H",schedule:"",delayMinutes:-10 }] }),false);
  assert.equal(isTrackerPayload({ ...initial,workouts:[{ id:"bad",date:"2026-09-30",title:"Bad",exercises:[{ id:"e",name:"E",sets:[{ id:"s",weightKg:-1,reps:8,completed:true }] }] }] }),false);
});
test("habit callback is bounded and versioned", () => {
  assert.deepEqual(parseTelegramHabitCallback("habit_done:a1000000-0000-4000-8000-000000000001:123"),{ action:"done",jobId:"a1000000-0000-4000-8000-000000000001",sourceVersion:123 });
  assert.equal(parseTelegramHabitCallback("habit_skip:a1000000-0000-4000-8000-000000000001:0"),null);
  assert.equal(parseTelegramHabitCallback("habit_done:not-a-job:123"),null);
});
test("repeated mark cannot move the event time or create another command", () => {
  const state={ ...createInitialState(),habits:[{ id:"a",title:"Fixture",type:"habit" as const,schedule:"" }] };
  const completed=changeHabit(state,"a","2026-09-30","completed",new Date("2026-09-30T09:00:00Z"));
  assert.equal(changeHabit(completed,"a","2026-09-30","completed",new Date("2026-09-30T10:00:00Z")),completed);
});
test("snoozing is explicit, bounded and does not complete a habit", () => {
  let state=createInitialState();
  for(let i=0;i<3;i++) state=snoozeHabit(state,"wake","2026-09-30");
  assert.equal(state.habitSnoozes?.[0].count,3);
  assert.equal(snoozeHabit(state,"wake","2026-09-30"),state);
  assert.equal(state.completions.length,0);
});
test("import requires missing year, rejects invalid dates and detects partial repeats", () => {
  const raw="9 сентября\nFixture press\n45x8,45x8\n10 сентября\nFixture row\n12,5x8";
  assert.equal(prepareWorkoutImport(raw).needsYear,true);
  const ready=prepareWorkoutImport(raw,2026);
  assert.equal(ready.workouts.length,2);
  assert.equal(ready.workouts[1].exercises[0].sets[0].weightKg,12.5);
  assert.equal(ready.workouts[0].sourceText,raw);
  assert.ok(prepareWorkoutImport("31 февраля 2026\nFixture\n45x8").error);
  const partial=prepareWorkoutImport("9 сентября 2026\nFixture press\n45x8",2026).workouts;
  assert.equal(withoutRepeatedImportFacts(partial,ready.workouts).length,0);
});
test("handled phone history stays hidden until that copy changes", () => {
  assert.equal(shouldShowLegacyOffer(true, "same", "same"), false);
  assert.equal(shouldShowLegacyOffer(true, "newer", "same"), true);
  assert.equal(shouldShowLegacyOffer(false, "same", undefined), false);
});
