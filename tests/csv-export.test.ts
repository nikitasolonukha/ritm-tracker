import assert from "node:assert/strict";
import test from "node:test";
import { csvCell, workoutsToCsv } from "../src/lib/csv-export.ts";
import type { SessionTrackerState } from "../src/lib/workout-session.ts";

const state = {
  version: 1, habits: [], completions: [], activeTimer: null, observations: [], outbox: [],
  workouts: [{
    id: "w1", date: "2026-10-01", title: "Основная; Full \"Body\"",
    exercises: [
      { id: "e1", name: "Жим", sets: [{ id: "s1", weightKg: 62.5, reps: 8, completed: true, weightMode: "total" }, { id: "s2", weightKg: 62.5, reps: 7, completed: false, weightMode: "total", note: "тяжело\nочень" }] },
      { id: "e2", name: "Тяга одной рукой", sets: [
        { id: "a1", weightKg: 20, reps: 10, completed: true, weightMode: "total", component: "compound-a", segmentId: "pair-1" },
        { id: "b1", weightKg: 20, reps: 9, completed: true, weightMode: "total", component: "compound-b", segmentId: "pair-1" },
      ] },
    ],
  }, { id: "w2", date: "2026-09-01", title: "Пустая", exercises: [{ id: "e3", name: "Х", sets: [{ id: "x", weightKg: 1, reps: 1, completed: false }] }] }],
} as unknown as SessionTrackerState;

test("cells with separators, quotes and line breaks are quoted", () => {
  assert.equal(csvCell("просто"), "просто");
  assert.equal(csvCell("a;b"), "\"a;b\"");
  assert.equal(csvCell("say \"hi\""), "\"say \"\"hi\"\"\"");
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(5), "5");
});

test("the workout log becomes one row per set with decimal commas and pair sides", () => {
  const csv = workoutsToCsv(state);
  assert.ok(csv.startsWith("﻿Дата;Тренировка;"));
  const lines = csv.trim().split("\r\n");
  assert.equal(lines.length, 5, "header + 4 sets; the workout without recorded sets is not exported");
  assert.equal(lines[1], "2026-10-01;\"Основная; Full \"\"Body\"\"\";Жим;1;;62,5;8;общий вес;да;");
  assert.ok(lines[2].includes("\"тяжело\nочень\""));
  assert.ok(lines[2].includes(";нет;"));
  assert.ok(lines[3].includes(";Тяга одной рукой;1;правая;20;10;"));
  assert.ok(lines[4].includes(";Тяга одной рукой;1;левая;20;9;"));
});
