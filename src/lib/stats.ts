import { calculateWorkoutTotals, type Workout } from "./tracker.ts";

export type Observation = { date: string; energy: number; sleep: number; weightKg?: number };
export type SeriesPoint = { label: string; value: number };

export type ObservationMetric = "weightKg" | "sleep" | "energy";

/** Ряд для графика: от старых к новым, последняя отметка за день побеждает, пустые значения пропускаются. */
export function observationSeries(observations: Observation[], metric: ObservationMetric, limit = 60): SeriesPoint[] {
  const byDate = new Map<string, number>();
  for (const observation of [...observations].sort((a, b) => a.date.localeCompare(b.date))) {
    const value = observation[metric];
    if (typeof value === "number" && Number.isFinite(value)) byDate.set(observation.date, value);
  }
  return [...byDate].map(([label, value]) => ({ label, value })).slice(-limit);
}

const mondayOf = (date: string) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};

/** Объём по неделям (понедельник — начало) за последние `weeks` недель, считаются только подтверждённые подходы. */
export function weeklyVolume(workouts: Workout[], today: string, weeks = 8): Array<{ weekStart: string; label: string; value: number }> {
  const currentMonday = mondayOf(today);
  const starts = Array.from({ length: weeks }, (_, index) => {
    const d = new Date(`${currentMonday}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 7 * (weeks - 1 - index));
    return d.toISOString().slice(0, 10);
  });
  const totals = new Map(starts.map((start) => [start, 0]));
  for (const workout of workouts) {
    const start = mondayOf(workout.date);
    if (!totals.has(start)) continue;
    totals.set(start, (totals.get(start) ?? 0) + calculateWorkoutTotals(workout).volumeKg);
  }
  return starts.map((weekStart) => ({ weekStart, label: `${weekStart.slice(8)}.${weekStart.slice(5, 7)}`, value: Math.round(totals.get(weekStart) ?? 0) }));
}
