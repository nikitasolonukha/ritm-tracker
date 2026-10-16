import assert from "node:assert/strict";
import test from "node:test";
import { enableSleepTracking, markSleepEvent } from "../src/lib/sleep.ts";
import { createInitialState } from "../src/lib/storage.ts";
import { buildWeeklyDigest, weeklyDigestWindow } from "../src/lib/weekly-digest.ts";
import { planWeeklyDigests } from "../src/lib/weekly-digest-plan.ts";
import type { SessionTrackerState } from "../src/lib/workout-session.ts";

const state = () => createInitialState("2026-10-12") as SessionTrackerState;

function workoutState(): SessionTrackerState {
  const base = state();
  const done = (id: string, date: string, weight: number) => ({ id, date, title: "Грудь", exercises: [{ id: `${id}-e`, name: "Жим в тренажёре", sets: [1, 2].map((n) => ({ id: `${id}-s${n}`, weightKg: weight, reps: 8, completed: true, weightMode: "total" as const })) }] });
  return { ...base, workouts: [done("w1", "2026-10-06", 40), done("w2", "2026-10-13", 45)], workoutSessions: [
    { id: "s1", workoutId: "w1", templateId: "t", status: "completed", startedAt: "2026-10-06T10:00:00.000Z", finishedAt: "2026-10-06T11:00:00.000Z", activeExerciseIndex: 0 },
    { id: "s2", workoutId: "w2", templateId: "t", status: "completed", startedAt: "2026-10-13T10:00:00.000Z", finishedAt: "2026-10-13T11:00:00.000Z", activeExerciseIndex: 0 },
  ] };
}

test("the weekly digest window is Sunday from 21:00 to midnight, Moscow time", () => {
  assert.deepEqual(weeklyDigestWindow(new Date("2026-10-18T18:00:00.000Z")), { endDate: "2026-10-18" }, "21:00 MSK on Sunday");
  assert.equal(weeklyDigestWindow(new Date("2026-10-18T17:59:00.000Z")), null, "20:59 MSK");
  assert.equal(weeklyDigestWindow(new Date("2026-10-17T18:00:00.000Z")), null, "Saturday");
  assert.deepEqual(weeklyDigestWindow(new Date("2026-10-18T20:59:00.000Z")), { endDate: "2026-10-18" }, "23:59 MSK");
  assert.equal(weeklyDigestWindow(new Date("2026-10-18T21:00:00.000Z")), null, "Monday 00:00 MSK");
});

test("the digest reports facts for the week: workouts, volume, records, habits", () => {
  const digest = buildWeeklyDigest(workoutState(), "2026-10-18");
  assert.equal(digest.hasData, true);
  assert.match(digest.text, /^Ритм · итоги недели, 12–18 октября/);
  assert.match(digest.text, /Тренировки: 1 из 3/);
  assert.match(digest.text, /Подходов: 2, объём: 720 кг/);
  assert.match(digest.text, /Рекордов по весу: 1/);
  assert.doesNotMatch(digest.text, /Сон:/);
  const previousWeek = buildWeeklyDigest(workoutState(), "2026-10-11");
  assert.match(previousWeek.text, /Тренировки: 1 из 3/);
  assert.doesNotMatch(previousWeek.text, /Рекордов/, "the first workout is not a record");
});

test("sleep marks show up, a quiet week is not sent, a month boundary is written in full", () => {
  let next = enableSleepTracking(state(), "2026-10-12");
  next = markSleepEvent(next, "bedtime", new Date("2026-10-13T20:00:00.000Z"));
  next = markSleepEvent(next, "wake", new Date("2026-10-14T04:30:00.000Z"));
  const digest = buildWeeklyDigest(next, "2026-10-18");
  assert.match(digest.text, /Сон: в среднем 8 ч 30 мин \(1 ночь\)/);
  assert.equal(digest.hasData, true);
  const quiet = buildWeeklyDigest(state(), "2026-10-18");
  assert.equal(quiet.hasData, false);
  assert.match(buildWeeklyDigest(state(), "2026-11-01").text, /26 октября – 1 ноября/);
});

type Row = Record<string, unknown>;
function fakeAdmin(data: { links: Row[]; jobs: Row[]; states: Row[] }, inserted: Row[], failOn?: string) {
  const answer = (table: string, rows: Row[]) => {
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "not", "is", "eq", "in"]) chain[method] = () => chain;
    chain.then = (resolve: (value: unknown) => void) => resolve(failOn === table ? { data: null, error: { message: "down" } } : { data: rows, error: null });
    return chain;
  };
  return {
    from(table: string) {
      if (table === "telegram_links") return answer(table, data.links);
      if (table === "tracker_state") return answer(table, data.states);
      return {
        select: () => answer(table, data.jobs),
        upsert: async (rows: Row[], options: Row) => { assert.deepEqual(options, { onConflict: "user_id,source_entity_id,source_version", ignoreDuplicates: true }); inserted.push(...rows); return { error: null }; },
      };
    },
  } as never;
}
const sunday = new Date("2026-10-18T18:30:00.000Z");

test("the planner queues one digest per linked user, skips opted-out and empty weeks, and is idempotent", async () => {
  const inserted: Row[] = [];
  const data = { links: [{ user_id: "a" }, { user_id: "b" }, { user_id: "c" }, { user_id: "d" }], jobs: [{ user_id: "d" }], states: [
    { user_id: "a", payload: workoutState() },
    { user_id: "b", payload: { ...workoutState(), weeklyDigest: false } },
    { user_id: "c", payload: state() },
  ] };
  assert.equal(await planWeeklyDigests(fakeAdmin(data, inserted), sunday), 1);
  assert.deepEqual(inserted.map((row) => [row.user_id, row.status, row.source_entity_id, row.source_version]), [["a", "pending", "weekly:2026-10-18", 1], ["b", "cancelled", "weekly:2026-10-18", 1], ["c", "cancelled", "weekly:2026-10-18", 1]]);
  assert.match(String(inserted[0].message), /итоги недели/);
  assert.equal(inserted[1].last_error, "digest disabled");
  assert.equal(inserted[2].last_error, "no data");
  assert.equal(new Date(String(inserted[0].expires_at)).getTime() - sunday.getTime(), 5 * 3_600_000);
  // все уже поставлены в очередь: ничего не пишем и состояние не читаем
  const again: Row[] = [];
  assert.equal(await planWeeklyDigests(fakeAdmin({ ...data, jobs: data.links }, again), sunday), 0);
  assert.equal(again.length, 0);
});

test("the planner does nothing outside the window and never throws on database errors", async () => {
  const inserted: Row[] = [];
  const data = { links: [{ user_id: "a" }], jobs: [], states: [{ user_id: "a", payload: workoutState() }] };
  assert.equal(await planWeeklyDigests(fakeAdmin(data, inserted), new Date("2026-10-19T09:00:00.000Z")), 0);
  for (const table of ["telegram_links", "tracker_state"]) assert.equal(await planWeeklyDigests(fakeAdmin(data, inserted, table), sunday), 0);
  assert.equal(inserted.length, 0);
});

test("one broken payload does not stop the others, and each run reads at most a fixed number of users", async () => {
  const inserted: Row[] = [];
  const broken = { links: [{ user_id: "a" }, { user_id: "x" }, { user_id: "y" }], jobs: [], states: [
    { user_id: "a", payload: workoutState() },
    { user_id: "x", payload: {} },
    { user_id: "y", payload: null },
  ] };
  assert.equal(await planWeeklyDigests(fakeAdmin(broken, inserted), sunday), 1);
  assert.deepEqual(inserted.map((row) => [row.user_id, row.status, row.last_error ?? null]), [["a", "pending", null], ["x", "cancelled", "digest error"], ["y", "cancelled", "digest error"]]);

  const many = Array.from({ length: 45 }, (_, index) => ({ user_id: `u${index}` }));
  let requested: unknown[] = [];
  const written: Row[] = [];
  const admin = {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "not", "is", "eq"]) chain[method] = () => chain;
      chain.in = (_column: string, ids: unknown[]) => { if (table === "tracker_state") requested = ids; return chain; };
      chain.then = (resolve: (value: unknown) => void) => resolve({ data: table === "telegram_links" ? many : table === "tracker_state" ? (requested as string[]).map((id) => ({ user_id: id, payload: workoutState() })) : [], error: null });
      return { ...chain, upsert: async (rows: Row[]) => { written.push(...rows); return { error: null }; } };
    },
  } as never;
  await planWeeklyDigests(admin, sunday);
  assert.equal(requested.length, 20);
  assert.equal(written.length, 20);
});
