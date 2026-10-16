import assert from "node:assert/strict";
import test from "node:test";
import { createBackupDocument, parseBackup } from "../src/lib/backup.ts";
import { detectLiveRecord, exerciseDefaults } from "../src/lib/exercises.ts";
import { habitsForDate } from "../src/lib/habits.ts";
import { enableSleepTracking, formatSleep, markSleepEvent, sleepSummary } from "../src/lib/sleep.ts";
import { createInitialState } from "../src/lib/storage.ts";
import { calculateWorkoutTotals } from "../src/lib/tracker.ts";
import { addExerciseToSession, addWarmups, currentWarmup, logicalSets, recordLogicalSet, recordWarmup, setExerciseSettings, setWarmupWeight, skipWarmups } from "../src/lib/workout-flow.ts";
import { planWarmups } from "../src/lib/warmups.ts";
import { finishWorkoutSession, startWorkoutSession, suggestNextTemplate, type SessionTrackerState } from "../src/lib/workout-session.ts";

const press = (weight: number) => ({ id: "press", name: "Жим в тренажёре", restSec: 180 as const, sets: [1, 2].map((n) => ({ id: `s${n}`, weightKg: weight, reps: 8, completed: false, weightMode: "total" as const })) });

function withTemplate(weight = 40) {
  const base = createInitialState("2026-10-01") as SessionTrackerState;
  return { ...base, workoutTemplates: [{ id: "tpl", title: "Тест", date: "2026-10-01", exercises: [press(weight)] }] } as SessionTrackerState;
}

const workoutOfSession = (state: SessionTrackerState, sessionId: string) => state.workouts.find((w) => w.id === state.workoutSessions!.find((s) => s.id === sessionId)!.workoutId)!;

function runSession(state: SessionTrackerState, day: string, reps: Array<{ weight: number; reps: number }>) {
  const started = startWorkoutSession(state, "tpl", new Date(`${day}T10:00:00.000Z`))!;
  let next = started.state;
  const workout = workoutOfSession(next, started.sessionId);
  reps.forEach((entry, index) => {
    const set = workout.exercises[0].sets[index];
    next = { ...next, workouts: next.workouts.map((w) => w.id !== workout.id ? w : { ...w, exercises: w.exercises.map((e) => ({ ...e, sets: e.sets.map((s) => s.id === set.id ? { ...s, weightKg: entry.weight } : s) })) }) };
    next = recordLogicalSet(next, started.sessionId, "press", [{ setId: set.id, reps: entry.reps }], new Date(`${day}T10:0${index}:00.000Z`));
  });
  return { state: next, sessionId: started.sessionId };
}

function secondSession(weight: number, reps: number) {
  const first = runSession(withTemplate(), "2026-10-02", [{ weight, reps }, { weight, reps }]);
  const finished = finishWorkoutSession(first.state, first.sessionId, new Date("2026-10-02T11:00:00.000Z"));
  const next = startWorkoutSession(finished, "tpl", new Date("2026-10-09T10:00:00.000Z"))!;
  return { state: next.state, exercise: workoutOfSession(next.state, next.sessionId).exercises[0] };
}

test("a record is announced only against history and earlier sets of the same workout", () => {
  const { state, exercise } = secondSession(40, 8);
  assert.equal(detectLiveRecord(state, exercise, { ...exercise.sets[0], weightKg: 40, reps: 8, completed: true }), null, "same as last time is not a record");
  assert.deepEqual(detectLiveRecord(state, exercise, { ...exercise.sets[0], weightKg: 42.5, reps: 8, completed: true }), { kind: "weight", value: 42.5, previous: 40 });
  assert.equal(detectLiveRecord(state, exercise, { ...exercise.sets[0], weightKg: 40, reps: 10, completed: true })?.kind, "oneRepMax");
  // подход, записанный раньше в этой же тренировке, поднимает планку
  const withEarlier = { ...exercise, sets: [{ ...exercise.sets[0], weightKg: 45, reps: 8, completed: true }, exercise.sets[1]] };
  assert.equal(detectLiveRecord(state, withEarlier, { ...exercise.sets[1], weightKg: 45, reps: 8, completed: true }), null);
});

test("no record without history, without a weight mode, or across weight modes", () => {
  const fresh = startWorkoutSession(withTemplate(), "tpl", new Date("2026-10-02T10:00:00.000Z"))!;
  const firstExercise = workoutOfSession(fresh.state, fresh.sessionId).exercises[0];
  assert.equal(detectLiveRecord(fresh.state, firstExercise, { ...firstExercise.sets[0], weightKg: 100, reps: 8, completed: true }), null);
  const { state, exercise } = secondSession(40, 8);
  assert.equal(detectLiveRecord(state, exercise, { ...exercise.sets[0], weightKg: 60, reps: 8, completed: true, weightMode: undefined }), null);
  assert.equal(detectLiveRecord(state, exercise, { ...exercise.sets[0], weightKg: 60, reps: 8, completed: true, weightMode: "per-hand" }), null, "per-hand is not compared with a total weight");
});

test("an exercise added mid-workout lives only in this workout and is recorded like the others", () => {
  const { state, sessionId } = runSession(withTemplate(), "2026-10-02", [{ weight: 40, reps: 8 }]);
  const added = addExerciseToSession(state, sessionId, { name: "  Разгибания   ног ", sets: 3, weightKg: 30, reps: 12, weightMode: "total", restSec: 90 }, "x1");
  const workout = workoutOfSession(added, sessionId);
  assert.equal(workout.exercises.length, 2);
  assert.equal(workout.exercises[1].name, "Разгибания ног");
  assert.equal(workout.exercises[1].sets.length, 3);
  assert.equal(added.workoutSessions![0].activeExerciseIndex, 1);
  assert.equal(added.workoutTemplates![0].exercises.length, 1, "the program is not changed");
  const done = recordLogicalSet(added, sessionId, workout.exercises[1].id, [{ setId: workout.exercises[1].sets[0].id, reps: 12 }], new Date("2026-10-02T10:30:00.000Z"));
  const after = workoutOfSession(done, sessionId);
  assert.equal(after.exercises[1].sets[0].completed, true);
  assert.equal(calculateWorkoutTotals(after).completedSets, 2);
  assert.equal(calculateWorkoutTotals(after).volumeKg, 40 * 8 + 30 * 12);
  assert.equal(done.activeTimer?.durationSec, 90);
  const another = addExerciseToSession(added, sessionId, { name: "Разгибания ног", sets: 3, weightKg: 30, reps: 12, weightMode: "total" }, "x2");
  assert.equal(workoutOfSession(another, sessionId).exercises.length, 3);
});

test("a right/left exercise is added as logical pairs", () => {
  const { state, sessionId } = runSession(withTemplate(), "2026-10-02", [{ weight: 40, reps: 8 }]);
  const added = addExerciseToSession(state, sessionId, { name: "Тяга одной рукой", sets: 2, weightKg: 20, reps: 10, weightMode: "per-hand", paired: true }, "p1");
  const exercise = workoutOfSession(added, sessionId).exercises[1];
  assert.equal(exercise.sets.length, 4);
  const groups = logicalSets(exercise);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].parts.map((p) => p.label), ["A", "B"]);
});

test("invalid additions change nothing", () => {
  const { state, sessionId } = runSession(withTemplate(), "2026-10-02", [{ weight: 40, reps: 8 }]);
  const input = { sets: 3, weightKg: null, reps: 10, weightMode: "total" as const };
  assert.equal(addExerciseToSession(state, sessionId, { ...input, name: "   " }), state);
  assert.equal(addExerciseToSession(state, sessionId, { ...input, name: "x".repeat(81) }), state);
  assert.equal(addExerciseToSession(state, "missing", { ...input, name: "Жим" }), state);
  const finished = finishWorkoutSession(state, sessionId);
  assert.equal(addExerciseToSession(finished, sessionId, { ...input, name: "Жим" }), finished);
  const clamped = addExerciseToSession(state, sessionId, { ...input, name: "Жим", sets: 99 }, "c");
  assert.equal(workoutOfSession(clamped, sessionId).exercises[1].sets.length, 10);
});

test("defaults come from the last performance, otherwise 3×10 without a weight", () => {
  const empty = exerciseDefaults(withTemplate(), "Совсем новое");
  assert.deepEqual({ sets: empty.sets, weight: empty.weightKg, reps: empty.reps, paired: empty.paired }, { sets: 3, weight: null, reps: 10, paired: false });
  const first = runSession(withTemplate(), "2026-10-02", [{ weight: 40, reps: 8 }, { weight: 45, reps: 6 }]);
  const finished = finishWorkoutSession(first.state, first.sessionId, new Date("2026-10-02T11:00:00.000Z"));
  const known = exerciseDefaults(finished, "жим  в тренажёре");
  assert.equal(known.sets, 2);
  assert.equal(known.weightKg, 45);
  assert.equal(known.reps, 6);
  assert.equal(known.restSec, 180);
});

test("added exercises survive a backup round trip", () => {
  const { state, sessionId } = runSession(withTemplate(), "2026-10-02", [{ weight: 40, reps: 8 }]);
  const added = addExerciseToSession(state, sessionId, { name: "Тяга одной рукой", sets: 2, weightKg: 20, reps: 10, weightMode: "per-hand", paired: true, restSec: 120 }, "p1");
  const parsed = parseBackup(JSON.stringify(createBackupDocument(added, "account-a")));
  assert.equal(workoutOfSession(parsed.state, sessionId).exercises[1].sets.length, 4);
});

const bed = new Date("2026-10-02T20:30:00.000Z");
const wakeUp = new Date("2026-10-03T04:15:00.000Z");
const hourAfter = (date: Date) => new Date(date.getTime() + 3_600_000);

test("sleep is counted from the bedtime and wake marks, not from the plan", () => {
  let state = createInitialState("2026-10-02");
  assert.equal(sleepSummary(state, "2026-10-03").configured, false);
  state = enableSleepTracking(state, "2026-10-02");
  assert.equal(enableSleepTracking(state, "2026-10-02"), state, "enabling twice changes nothing");
  assert.equal(state.habits.filter((h) => h.eventRole).length, 2);
  state = markSleepEvent(state, "bedtime", "2026-10-02", bed);
  let summary = sleepSummary(state, "2026-10-02", hourAfter(bed));
  assert.equal(summary.configured, true);
  assert.equal(summary.asleepSince, bed.toISOString());
  assert.equal(summary.last, undefined);
  state = markSleepEvent(state, "wake", "2026-10-03", wakeUp);
  summary = sleepSummary(state, "2026-10-03", hourAfter(wakeUp));
  assert.equal(summary.last?.hours, 7.8);
  assert.equal(summary.asleepSince, undefined);
  assert.equal(summary.wokeAt, wakeUp.toISOString());
  assert.equal(summary.averageHours, 7.8);
  assert.deepEqual(summary.week.map((n) => n.date), ["2026-10-03"]);
});

test("a second tap undoes the mark", () => {
  let state = enableSleepTracking(createInitialState("2026-10-02"), "2026-10-02");
  state = markSleepEvent(state, "bedtime", "2026-10-02", bed);
  state = markSleepEvent(state, "wake", "2026-10-03", wakeUp);
  assert.equal(sleepSummary(state, "2026-10-03", hourAfter(wakeUp)).last?.hours, 7.8);
  state = markSleepEvent(state, "wake", "2026-10-03", new Date("2026-10-03T05:00:00.000Z"));
  assert.equal(sleepSummary(state, "2026-10-03", hourAfter(wakeUp)).last, undefined);
  assert.equal(sleepSummary(state, "2026-10-03", hourAfter(wakeUp)).asleepSince, bed.toISOString());
});

test("sleep habits stay out of the daily plan", () => {
  const state = enableSleepTracking(createInitialState("2026-10-02"), "2026-10-02");
  const planned = habitsForDate(state.habits, "2026-10-03").map((h) => h.id);
  assert.equal(planned.includes("sleep-bedtime") || planned.includes("sleep-wake"), false);
});

test("existing sleep habits are reused and an archived one is revived instead of duplicated", () => {
  const base = createInitialState("2026-10-02");
  const custom = { ...base, habits: [...base.habits, { id: "my-wake", title: "Подъём", type: "sleep" as const, schedule: "утром", eventRole: "wake" as const }] };
  const enabled = enableSleepTracking(custom, "2026-10-02");
  assert.equal(enabled.habits.filter((h) => h.eventRole === "wake").length, 1);
  assert.equal(enabled.habits.filter((h) => h.eventRole === "bedtime").length, 1);
  const archived = { ...base, habits: [...base.habits, { id: "sleep-bedtime", title: "Лёг спать", type: "sleep" as const, schedule: "вечером", archived: true }] };
  const revived = enableSleepTracking(archived, "2026-10-02");
  assert.equal(revived.habits.filter((h) => h.id === "sleep-bedtime").length, 1);
  assert.equal(revived.habits.find((h) => h.id === "sleep-bedtime")?.archived, false);
});

test("sleep length is shown as hours and minutes", () => {
  assert.equal(formatSleep(7.5), "7 ч 30 мин");
  assert.equal(formatSleep(8), "8 ч");
  assert.equal(formatSleep(0.5), "30 мин");
  assert.equal(formatSleep(6.83), "6 ч 50 мин");
});

test("a forgotten bedtime mark gives no absurd sleep and no endless 'asleep' state", () => {
  let state = enableSleepTracking(createInitialState("2026-10-02"), "2026-10-02");
  state = markSleepEvent(state, "bedtime", "2026-10-02", bed);
  // забыл нажать «лёг» следующим вечером, проснулся через 30 часов после первой отметки
  const lateWake = new Date(bed.getTime() + 30 * 3_600_000);
  state = markSleepEvent(state, "wake", "2026-10-03", lateWake);
  const summary = sleepSummary(state, "2026-10-03", hourAfter(lateWake));
  assert.equal(summary.last, undefined);
  assert.deepEqual(summary.week, []);
  // «лёг» без «проснулся» больше 20 часов назад не считается текущим сном
  const stale = markSleepEvent(enableSleepTracking(createInitialState("2026-10-02"), "2026-10-02"), "bedtime", "2026-10-02", bed);
  assert.equal(sleepSummary(stale, "2026-10-04", new Date(bed.getTime() + 21 * 3_600_000)).asleepSince, undefined);
  assert.equal(sleepSummary(stale, "2026-10-03", new Date(bed.getTime() + 19 * 3_600_000)).asleepSince, bed.toISOString());
});

const withWarmups = (count: number, weight = 60) => {
  const base = withTemplate(weight);
  return { ...base, workoutTemplates: [{ ...base.workoutTemplates![0], exercises: [{ ...press(weight), warmupSets: count }] }] } as SessionTrackerState;
};

test("warm-up sets ramp up from the working weight and round to 2.5 kg", () => {
  assert.deepEqual(planWarmups(1, 60, "x").map((w) => [w.weightKg, w.reps]), [[30, 10]]);
  assert.deepEqual(planWarmups(2, 60, "x").map((w) => [w.weightKg, w.reps]), [[30, 10], [45, 5]]);
  assert.deepEqual(planWarmups(3, 62.5, "x").map((w) => [w.weightKg, w.reps]), [[25, 10], [37.5, 6], [50, 3]]);
  assert.deepEqual(planWarmups(2, null, "x").map((w) => w.weightKg), [null, null]);
  assert.deepEqual(planWarmups(0, 60, "x"), []);
  assert.equal(planWarmups(9, 60, "x").length, 3);
  assert.equal(new Set(planWarmups(3, 60, "x").map((w) => w.id)).size, 3);
});

test("a workout starts with the warm-ups of the program and they never count as sets, volume or history", () => {
  const started = startWorkoutSession(withWarmups(2), "tpl", new Date("2026-10-02T10:00:00.000Z"))!;
  const exercise = workoutOfSession(started.state, started.sessionId).exercises[0];
  assert.equal(exercise.warmups?.length, 2);
  assert.equal(currentWarmup(exercise)?.weightKg, 30);
  let state = started.state;
  const first = exercise.warmups![0];
  state = setWarmupWeight(state, started.sessionId, exercise.id, first.id, 25);
  state = recordWarmup(state, started.sessionId, exercise.id, first.id, 12);
  assert.equal(recordWarmup(state, started.sessionId, exercise.id, first.id, 5), state, "recording twice changes nothing");
  assert.equal(state.activeTimer ?? null, null, "no rest timer after a warm-up");
  assert.equal(state.outbox.length, 0, "no reminder commands for a warm-up");
  const after = workoutOfSession(state, started.sessionId);
  assert.equal(calculateWorkoutTotals(after).completedSets, 0);
  assert.equal(calculateWorkoutTotals(after).volumeKg, 0);
  assert.equal(currentWarmup(after.exercises[0])?.id, exercise.warmups![1].id);
  // после первого рабочего подхода разминка уже не предлагается
  const worked = recordLogicalSet(state, started.sessionId, exercise.id, [{ setId: after.exercises[0].sets[0].id, reps: 8 }]);
  assert.equal(currentWarmup(workoutOfSession(worked, started.sessionId).exercises[0]), undefined);
});

test("skipping removes only unfinished warm-ups; adding works before the first working set only", () => {
  const started = startWorkoutSession(withWarmups(3), "tpl", new Date("2026-10-02T10:00:00.000Z"))!;
  const id = workoutOfSession(started.state, started.sessionId).exercises[0].id;
  const warmups = workoutOfSession(started.state, started.sessionId).exercises[0].warmups!;
  let state = recordWarmup(started.state, started.sessionId, id, warmups[0].id, 10);
  state = skipWarmups(state, started.sessionId, id);
  assert.deepEqual(workoutOfSession(state, started.sessionId).exercises[0].warmups?.map((w) => w.completed), [true]);
  assert.equal(skipWarmups(state, started.sessionId, id), state);
  const plain = startWorkoutSession(withTemplate(), "tpl", new Date("2026-10-02T10:00:00.000Z"))!;
  const plainId = workoutOfSession(plain.state, plain.sessionId).exercises[0].id;
  const added = addWarmups(plain.state, plain.sessionId, plainId, 2, "w1");
  assert.equal(workoutOfSession(added, plain.sessionId).exercises[0].warmups?.length, 2);
  assert.equal(addWarmups(added, plain.sessionId, plainId, 2, "w2"), added, "already has warm-ups");
  const worked = recordLogicalSet(plain.state, plain.sessionId, plainId, [{ setId: workoutOfSession(plain.state, plain.sessionId).exercises[0].sets[0].id, reps: 8 }]);
  assert.equal(addWarmups(worked, plain.sessionId, plainId, 2, "w3"), worked, "too late once a working set is recorded");
});

test("a workout with warm-ups finishes as completed when all working sets are done", () => {
  const started = startWorkoutSession(withWarmups(2), "tpl", new Date("2026-10-02T10:00:00.000Z"))!;
  let state = started.state;
  const exercise = workoutOfSession(state, started.sessionId).exercises[0];
  state = recordLogicalSet(state, started.sessionId, exercise.id, exercise.sets.map((set) => ({ setId: set.id, reps: 8 })));
  const finished = finishWorkoutSession(state, started.sessionId, new Date("2026-10-02T11:00:00.000Z"));
  assert.equal(finished.workoutSessions![0].status, "completed");
  const parsed = parseBackup(JSON.stringify(createBackupDocument(withWarmups(2), "account-a")));
  assert.equal(parsed.state.workoutTemplates![0].exercises[0].warmupSets, 2);
  const duringWorkout = parseBackup(JSON.stringify(createBackupDocument(started.state, "account-a")));
  assert.equal(workoutOfSession(duringWorkout.state, started.sessionId).exercises[0].warmups?.length, 2);
});

test("the next program is the one not done for the longest time", () => {
  const base = createInitialState("2026-10-01") as SessionTrackerState;
  const templateOf = (id: string, title: string) => ({ id, title, date: "2026-10-01", exercises: [{ ...press(40), id: `${id}-press` }] });
  let state: SessionTrackerState = { ...base, workoutTemplates: [templateOf("a", "Грудь"), templateOf("b", "Спина")] };
  assert.equal(suggestNextTemplate(state)?.template.id, "a", "nothing done yet: the first in the list");
  const doIt = (id: string, day: string) => {
    const started = startWorkoutSession(state, id, new Date(`${day}T10:00:00.000Z`))!;
    const workout = workoutOfSession(started.state, started.sessionId);
    const done = recordLogicalSet(started.state, started.sessionId, workout.exercises[0].id, [{ setId: workout.exercises[0].sets[0].id, reps: 8 }], new Date(`${day}T10:05:00.000Z`));
    state = finishWorkoutSession(done, started.sessionId, new Date(`${day}T11:00:00.000Z`));
  };
  doIt("a", "2026-10-02");
  assert.deepEqual([suggestNextTemplate(state)?.template.id, suggestNextTemplate(state)?.lastDate], ["b", null]);
  doIt("b", "2026-10-04");
  assert.deepEqual([suggestNextTemplate(state)?.template.id, suggestNextTemplate(state)?.lastDate], ["a", "2026-10-02"]);
  doIt("a", "2026-10-06");
  assert.equal(suggestNextTemplate(state)?.template.id, "b");
  assert.equal(suggestNextTemplate({ ...base, workoutTemplates: [] }), undefined);
});

test("machine settings are saved in the workout and in the program, and can be cleared", () => {
  const started = startWorkoutSession(withTemplate(), "tpl", new Date("2026-10-02T10:00:00.000Z"))!;
  const exerciseId = workoutOfSession(started.state, started.sessionId).exercises[0].id;
  const saved = setExerciseSettings(started.state, started.sessionId, exerciseId, "  сиденье 4,   спинка 2 ");
  assert.equal(workoutOfSession(saved, started.sessionId).exercises[0].settings, "сиденье 4, спинка 2");
  assert.equal(saved.workoutTemplates![0].exercises[0].settings, "сиденье 4, спинка 2");
  assert.equal(setExerciseSettings(saved, started.sessionId, exerciseId, "x".repeat(201)), saved);
  assert.equal(setExerciseSettings(saved, "missing", exerciseId, "а"), saved);
  const cleared = setExerciseSettings(saved, started.sessionId, exerciseId, "   ");
  assert.equal("settings" in workoutOfSession(cleared, started.sessionId).exercises[0], false);
  assert.equal("settings" in cleared.workoutTemplates![0].exercises[0], false);
  // следующая тренировка получает настройки из программы
  const next = startWorkoutSession(finishWorkoutSession(recordLogicalSet(saved, started.sessionId, exerciseId, [{ setId: workoutOfSession(saved, started.sessionId).exercises[0].sets[0].id, reps: 8 }]), started.sessionId), "tpl", new Date("2026-10-09T10:00:00.000Z"))!;
  assert.equal(workoutOfSession(next.state, next.sessionId).exercises[0].settings, "сиденье 4, спинка 2");
});
