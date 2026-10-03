import assert from "node:assert/strict";
import test from "node:test";
import { observationSeries, weeklyVolume } from "../src/lib/stats.ts";
import type { Workout } from "../src/lib/tracker.ts";

test("observation series is sorted, deduplicated per day and skips empty values", () => {
  const series = observationSeries([
    { date: "2026-09-10", energy: 6, sleep: 7, weightKg: 81 },
    { date: "2026-09-08", energy: 5, sleep: 6 },
    { date: "2026-09-10", energy: 7, sleep: 7.5, weightKg: 80.5 },
  ], "weightKg");
  assert.deepEqual(series, [{ label: "2026-09-10", value: 80.5 }]);
  assert.deepEqual(observationSeries([{ date: "2026-09-08", energy: 5, sleep: 6 }, { date: "2026-09-10", energy: 7, sleep: 7.5 }], "sleep").map((p) => p.value), [6, 7.5]);
});

test("weekly volume counts only confirmed sets inside the window, Monday-based", () => {
  const set = (id: string, completed: boolean) => ({ id, weightKg: 50, reps: 10, completed, weightMode: "total" as const });
  const workout = (id: string, date: string, completed: boolean): Workout => ({ id, date, title: "T", exercises: [{ id: `${id}e`, name: "X", sets: [set(`${id}s`, completed)] }] });
  const bars = weeklyVolume([
    workout("a", "2026-09-28", true),
    workout("b", "2026-10-03", true),
    workout("c", "2026-10-02", false),
    workout("old", "2026-01-01", true),
  ], "2026-10-03", 3);
  assert.deepEqual(bars.map((b) => b.weekStart), ["2026-09-14", "2026-09-21", "2026-09-28"]);
  assert.equal(bars[2].value, 1000);
  assert.equal(bars[0].value, 0);
});
