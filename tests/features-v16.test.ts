import assert from "node:assert/strict";
import test from "node:test";
import { createBackupDocument, parseBackup } from "../src/lib/backup.ts";
import { detectLiveRecord, exerciseDefaults, lastExerciseNote, workoutResults } from "../src/lib/exercises.ts";
import { buildShareCardModel, SHARE_CARD_MAX_ROWS, shareFileName } from "../src/lib/share-card.ts";
import { changeHabit, habitsForDate } from "../src/lib/habits.ts";
import { weekOverview } from "../src/lib/week-overview.ts";
import { enableSleepTracking, formatSleep, markSleepEvent, sleepDayOf, sleepSummary } from "../src/lib/sleep.ts";
import { createInitialState } from "../src/lib/storage.ts";
import { calculateWorkoutTotals } from "../src/lib/tracker.ts";
import { addExerciseToSession, addWarmups, currentWarmup, logicalSets, recordLogicalSet, recordWarmup, setExerciseNote, setExerciseSettings, setWarmupWeight, skipWarmups } from "../src/lib/workout-flow.ts";
import { planWarmups } from "../src/lib/warmups.ts";
import { cancelWorkoutSession, finishWorkoutSession, startWorkoutSession, suggestNextTemplate, type SessionTrackerState } from "../src/lib/workout-session.ts";

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
  state = markSleepEvent(state, "bedtime", bed);
  let summary = sleepSummary(state, "2026-10-02", hourAfter(bed));
  assert.equal(summary.configured, true);
  assert.equal(summary.asleepSince, bed.toISOString());
  assert.equal(summary.last, undefined);
  state = markSleepEvent(state, "wake", wakeUp);
  summary = sleepSummary(state, "2026-10-03", hourAfter(wakeUp));
  assert.equal(summary.last?.hours, 7.8);
  assert.equal(summary.asleepSince, undefined);
  assert.equal(summary.wokeAt, wakeUp.toISOString());
  assert.equal(summary.averageHours, 7.8);
  assert.deepEqual(summary.week.map((n) => n.date), ["2026-10-03"]);
});

test("a second tap undoes the mark", () => {
  let state = enableSleepTracking(createInitialState("2026-10-02"), "2026-10-02");
  state = markSleepEvent(state, "bedtime", bed);
  state = markSleepEvent(state, "wake", wakeUp);
  assert.equal(sleepSummary(state, "2026-10-03", hourAfter(wakeUp)).last?.hours, 7.8);
  state = markSleepEvent(state, "wake", new Date("2026-10-03T05:00:00.000Z"));
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
  state = markSleepEvent(state, "bedtime", bed);
  // забыл нажать «лёг» следующим вечером, проснулся через 30 часов после первой отметки
  const lateWake = new Date(bed.getTime() + 30 * 3_600_000);
  state = markSleepEvent(state, "wake", lateWake);
  const summary = sleepSummary(state, "2026-10-03", hourAfter(lateWake));
  assert.equal(summary.last, undefined);
  assert.deepEqual(summary.week, []);
  // «лёг» без «проснулся» больше 20 часов назад не считается текущим сном
  const stale = markSleepEvent(enableSleepTracking(createInitialState("2026-10-02"), "2026-10-02"), "bedtime", bed);
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

test("an exercise note stays in its workout, is shown next time and can be cleared", () => {
  const first = runSession(withTemplate(), "2026-10-02", [{ weight: 40, reps: 8 }]);
  const exerciseId = workoutOfSession(first.state, first.sessionId).exercises[0].id;
  const noted = setExerciseNote(first.state, first.sessionId, exerciseId, "  болело плечо, снизил вес ");
  assert.equal(workoutOfSession(noted, first.sessionId).exercises[0].note, "болело плечо, снизил вес");
  assert.equal("note" in noted.workoutTemplates![0].exercises[0], false, "the program does not get the note");
  assert.equal(setExerciseNote(noted, first.sessionId, exerciseId, "x".repeat(501)), noted);
  assert.equal(setExerciseNote(noted, "missing", exerciseId, "а"), noted);
  assert.equal("note" in workoutOfSession(setExerciseNote(noted, first.sessionId, exerciseId, "  "), first.sessionId).exercises[0], false);
  const finished = finishWorkoutSession(noted, first.sessionId, new Date("2026-10-02T11:00:00.000Z"));
  assert.deepEqual(lastExerciseNote(finished, "жим в тренажёре"), { text: "болело плечо, снизил вес", date: "2026-10-02" });
  const next = startWorkoutSession(finished, "tpl", new Date("2026-10-09T10:00:00.000Z"))!;
  assert.equal(workoutOfSession(next.state, next.sessionId).exercises[0].note, undefined, "a new workout starts without a note");
  assert.equal(lastExerciseNote(next.state, "Жим в тренажёре", workoutOfSession(next.state, next.sessionId).id)?.date, "2026-10-02");
  assert.equal(lastExerciseNote(finished, "Другое упражнение"), undefined);
  const parsed = parseBackup(JSON.stringify(createBackupDocument(noted, "account-a")));
  assert.equal(workoutOfSession(parsed.state, first.sessionId).exercises[0].note, "болело плечо, снизил вес");
});

test("the share card shows only recorded work and cuts the list with a count of the rest", () => {
  const base = withTemplate();
  const many = { ...base, workoutTemplates: [{ ...base.workoutTemplates![0], exercises: Array.from({ length: 9 }, (_, index) => ({ ...press(40), id: `e${index}`, name: `Упражнение ${index + 1}` })) }] } as SessionTrackerState;
  const started = startWorkoutSession(many, "tpl", new Date("2026-10-02T10:00:00.000Z"))!;
  let state = started.state;
  const workout = workoutOfSession(state, started.sessionId);
  for (const exercise of workout.exercises) state = recordLogicalSet(state, started.sessionId, exercise.id, [{ setId: exercise.sets[0].id, reps: 8 }]);
  state = finishWorkoutSession(state, started.sessionId, new Date("2026-10-02T11:05:00.000Z"));
  const session = state.workoutSessions![0];
  const model = buildShareCardModel(state, workoutOfSession(state, started.sessionId), session);
  assert.equal(model.rows.length, SHARE_CARD_MAX_ROWS);
  assert.equal(model.more, 2);
  assert.equal(model.durationText, "1 ч 5 мин");
  assert.deepEqual(model.stats.map((stat) => stat.label), ["подходов", "упражнений", "кг объёма"]);
  assert.equal(model.stats[0].value, "9");
  assert.equal(model.recordCount, 0);
  assert.equal(shareFileName({ date: "2026-10-02" }), "ritm-2026-10-02.png");
  const planned = buildShareCardModel(state, { ...workoutOfSession(state, started.sessionId), exercises: [{ ...workout.exercises[0], sets: workout.exercises[0].sets.map((set) => ({ ...set, completed: false })) }] }, session);
  assert.equal(planned.rows.length, 0, "planned sets are not shown");
});

test("the week overview counts only this week's recorded work and leaves the unfinished today out of the denominator", () => {
  const base = withTemplate();
  const empty = weekOverview(base, "2026-10-14");
  assert.equal(empty.hasData, false);
  const first = runSession(base, "2026-10-12", [{ weight: 40, reps: 8 }, { weight: 40, reps: 8 }]);
  const done = finishWorkoutSession(first.state, first.sessionId, new Date("2026-10-12T11:00:00.000Z"));
  const overview = weekOverview(done, "2026-10-14");
  assert.equal(overview.startDate, "2026-10-12");
  assert.equal(overview.workouts, 1);
  assert.equal(overview.volumeKg, 640);
  assert.equal(overview.goal, 3);
  assert.equal(overview.hasData, true);
  // тренировка прошлой недели в этой неделе не считается
  assert.equal(weekOverview(done, "2026-10-19").workouts, 0);
  assert.equal(weekOverview(done, "2026-10-18").workouts, 1, "Sunday is still the same week");
  // отмена тренировки в статистику не идёт
  const second = runSession(done, "2026-10-13", [{ weight: 100, reps: 10 }]);
  const cancelled = cancelWorkoutSession(second.state, second.sessionId);
  assert.equal(weekOverview(cancelled, "2026-10-14").volumeKg, 640);
});

test("the week overview closes days only when every planned habit is done, and averages sleep", () => {
  let state = enableSleepTracking(createInitialState("2026-10-12"), "2026-10-12");
  state = markSleepEvent(state, "bedtime", new Date("2026-10-12T20:00:00.000Z"));
  state = markSleepEvent(state, "wake", new Date("2026-10-13T04:00:00.000Z"));
  state = markSleepEvent(state, "bedtime", new Date("2026-10-13T20:00:00.000Z"));
  state = markSleepEvent(state, "wake", new Date("2026-10-14T04:00:00.000Z"));
  const overview = weekOverview(state, "2026-10-14");
  assert.equal(overview.sleepNights, 2);
  assert.equal(overview.sleepAverageHours, 8);
  assert.equal(overview.hasData, false, "only sleep marks: no 'days closed 0 of 0' tile");
  const planned = state.habits.filter((habit) => !habit.archived && habit.type !== "workout" && !habit.eventRole);
  for (const habit of planned) state = changeHabit(state, habit.id, "2026-10-13", "completed", new Date("2026-10-13T12:00:00.000Z"));
  const after = weekOverview(state, "2026-10-14");
  assert.equal(after.hasData, true);
  assert.equal(after.daysClosed, 1);
  assert.equal(after.daysPlanned, 2, "12th and 13th count, today (14th) is still open");
});

test("pressing 'bedtime' again after midnight cancels the real bedtime mark instead of adding a second one", () => {
  let state = enableSleepTracking(createInitialState("2026-10-11"), "2026-10-11");
  state = markSleepEvent(state, "bedtime", new Date("2026-10-11T20:30:00.000Z")); // 23:30 MSK on the 11th
  const at = new Date("2026-10-11T21:10:00.000Z"); // 00:10 MSK on the 12th
  assert.equal(sleepSummary(state, "2026-10-12", at).asleepSince, "2026-10-11T20:30:00.000Z");
  state = markSleepEvent(state, "bedtime", at);
  assert.deepEqual(state.completions.filter((c) => c.habitId === "sleep-bedtime"), [], "the card said 'cancel', so the mark is gone");
  assert.equal(sleepSummary(state, "2026-10-12", at).asleepSince, undefined);
});

test("going to bed after midnight counts for the evening before and does not erase tonight's bedtime later", () => {
  let state = enableSleepTracking(createInitialState("2026-10-11"), "2026-10-11");
  state = markSleepEvent(state, "bedtime", new Date("2026-10-11T21:30:00.000Z")); // 00:30 MSK on the 12th
  const bedMark = state.completions.find((c) => c.habitId === "sleep-bedtime")!;
  assert.equal(bedMark.localDate, "2026-10-11", "before 04:00 still belongs to the previous evening");
  assert.equal(bedMark.backfilled, undefined, "a real mark, not a backfill");
  assert.equal(bedMark.completedAt, "2026-10-11T21:30:00.000Z");
  state = markSleepEvent(state, "wake", new Date("2026-10-12T05:00:00.000Z")); // 08:00 MSK on the 12th
  assert.equal(sleepSummary(state, "2026-10-12", new Date("2026-10-12T06:00:00.000Z")).last?.hours, 7.5);
  // вечером 12-го «лёг» ставит новую отметку и не стирает ту, что дала сегодняшние 7,5 часа
  const evening = new Date("2026-10-12T20:30:00.000Z");
  state = markSleepEvent(state, "bedtime", evening);
  assert.equal(state.completions.filter((c) => c.habitId === "sleep-bedtime").length, 2);
  const summary = sleepSummary(state, "2026-10-12", new Date("2026-10-12T20:40:00.000Z"));
  assert.equal(summary.last?.hours, 7.5);
  assert.equal(summary.asleepSince, evening.toISOString());
  assert.equal(sleepDayOf(new Date("2026-10-12T00:59:00.000Z")), "2026-10-11", "03:59 MSK on the 12th is still the evening of the 11th");
  assert.equal(sleepDayOf(new Date("2026-10-12T01:00:00.000Z")), "2026-10-12", "04:00 MSK starts the new day");
});

test("a heavier set than an earlier set of the same workout is not a record when there is no history", () => {
  const started = startWorkoutSession(withTemplate(), "tpl", new Date("2026-10-02T10:00:00.000Z"))!;
  const exercise = workoutOfSession(started.state, started.sessionId).exercises[0];
  const withEarlier = { ...exercise, sets: [{ ...exercise.sets[0], weightKg: 40, reps: 8, completed: true }, exercise.sets[1]] };
  assert.equal(detectLiveRecord(started.state, withEarlier, { ...exercise.sets[1], weightKg: 50, reps: 8, completed: true }), null);
});

test("records are judged only against earlier workouts, not against later ones", () => {
  const base = withTemplate();
  const doIt = (state: SessionTrackerState, day: string, weight: number) => {
    const started = startWorkoutSession(state, "tpl", new Date(`${day}T10:00:00.000Z`))!;
    const workout = workoutOfSession(started.state, started.sessionId);
    const set = workout.exercises[0].sets[0];
    const weighed = { ...started.state, workouts: started.state.workouts.map((w) => w.id !== workout.id ? w : { ...w, exercises: w.exercises.map((e) => ({ ...e, sets: e.sets.map((s) => s.id === set.id ? { ...s, weightKg: weight } : s) })) }) };
    return finishWorkoutSession(recordLogicalSet(weighed, started.sessionId, workout.exercises[0].id, [{ setId: set.id, reps: 8 }]), started.sessionId, new Date(`${day}T11:00:00.000Z`));
  };
  let state = doIt(base, "2026-10-05", 50);
  state = doIt(state, "2026-10-12", 60);
  state = doIt(state, "2026-10-19", 70);
  const byDate = (date: string) => state.workouts.find((w) => w.date === date)!;
  assert.equal(workoutResults(state, byDate("2026-10-05"))[0].record, false, "first time: nothing to beat");
  assert.equal(workoutResults(state, byDate("2026-10-12"))[0].record, true, "60 beats 50, even though 70 came later");
  assert.equal(workoutResults(state, byDate("2026-10-19"))[0].record, true);
});
