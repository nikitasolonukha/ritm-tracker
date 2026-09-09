export type WeightMode = "total" | "per-hand";

export type ExerciseSet = {
  id: string;
  weightKg: number | null;
  reps: number | null;
  completed: boolean;
  note?: string;
  weightMode?: WeightMode;
  date?: string;
};

export type Exercise = {
  id: string;
  name: string;
  settings?: string;
  sets: ExerciseSet[];
};

export type Workout = {
  id: string;
  date: string;
  title: string;
  exercises: Exercise[];
};

export type HabitCompletion = {
  id: string;
  habitId: string;
  completedAt: string;
  localDate: string;
  source: "web" | "telegram";
};

export type Habit = {
  id: string;
  title: string;
  type: "medicine" | "habit" | "workout" | "sleep" | "meal";
  schedule: string;
  privateTitle?: string;
  targetDays?: number;
};

export type RestTimer = {
  startedAt: string;
  durationSec: number;
};

export function calculateExerciseVolume(sets: ExerciseSet[]): number {
  return sets.reduce((sum, set) => {
    if (!set.completed || set.weightKg == null || set.reps == null) {
      return sum;
    }

    const multiplier = set.weightMode === "per-hand" ? 2 : 1;
    return sum + set.weightKg * multiplier * set.reps;
  }, 0);
}

export function calculateWorkoutTotals(workout: Workout) {
  let completedSets = 0;
  let unscoredSets = 0;
  let volumeKg = 0;

  for (const exercise of workout.exercises) {
    for (const set of exercise.sets) {
      if (!set.completed) continue;
      completedSets += 1;

      if (set.weightKg == null || set.reps == null) {
        unscoredSets += 1;
        continue;
      }

      volumeKg += calculateExerciseVolume([set]);
    }
  }

  return {
    completedSets,
    exercises: workout.exercises.length,
    unscoredSets,
    volumeKg,
  };
}

export function applyHabitCompletion(
  completions: HabitCompletion[],
  next: HabitCompletion,
): HabitCompletion[] {
  if (completions.some((item) => item.id === next.id)) {
    return completions;
  }

  if (completions.some((item) => (
    item.habitId === next.habitId && item.localDate === next.localDate
  ))) {
    return completions;
  }

  return [...completions, next].sort((a, b) => a.completedAt.localeCompare(b.completedAt));
}

export function getMilestoneState(
  completions: HabitCompletion[],
  habitId: string,
  thresholdDays: number,
) {
  const dates = Array.from(new Set(
    completions
      .filter((item) => item.habitId === habitId)
      .map((item) => item.localDate),
  )).sort();

  return {
    count: dates.length,
    dates,
    reached: dates.length >= thresholdDays,
    thresholdDays,
  };
}

export function restoreRestTimer(timer: RestTimer, nowIso = new Date().toISOString()) {
  const startedMs = new Date(timer.startedAt).getTime();
  const nowMs = new Date(nowIso).getTime();
  const elapsedSec = Math.max(0, Math.floor((nowMs - startedMs) / 1000));
  const remainingSec = Math.max(0, timer.durationSec - elapsedSec);

  return {
    remainingSec,
    expired: remainingSec === 0,
  };
}

export function parseWorkoutNotes(input: string): Workout {
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const rawDate = lines[0] ?? "";
  const date = parseDate(rawDate) ?? new Date().toISOString().slice(0, 10);
  const exercises: Exercise[] = [];

  for (let i = parseDate(rawDate) ? 1 : 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (looksLikeSetLine(line)) continue;

    const nextLine = lines[i + 1] ?? "";
    const { name, settings } = splitExerciseNameAndSettings(line);
    const sets = looksLikeSetLine(nextLine) ? parseSetLine(nextLine) : [];

    exercises.push({
      id: slug(`${name}-${i}`),
      name,
      settings,
      sets,
    });

    if (sets.length > 0) i += 1;
  }

  return {
    id: `import-${date}-${hash(input)}`,
    date,
    title: `Импорт ${date}`,
    exercises,
  };
}

export function suggestNextLoad(history: Array<Pick<ExerciseSet, "weightKg" | "reps" | "completed" | "date">>) {
  const scored = history
    .filter((set) => set.completed && set.weightKg != null && set.reps != null)
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));

  if (scored.length < 3) return null;

  const lastThree = scored.slice(-3);
  const sameWeight = lastThree.every((set) => set.weightKg === lastThree[0].weightKg);
  const stableReps = lastThree.every((set) => (set.reps ?? 0) >= 8);

  if (!sameWeight || !stableReps || lastThree[0].weightKg == null) {
    return null;
  }

  return {
    reason: "Последние три результата стабильные. Можно попробовать небольшой шаг вверх.",
    nextWeightKg: lastThree[0].weightKg + 2.5,
  };
}

export const defaultHabits: Habit[] = [
  { id: "wake", title: "Подъём", type: "sleep", schedule: "09:30" },
  { id: "breakfast", title: "Завтрак", type: "meal", schedule: "10:00" },
  { id: "medicine-am", title: "Утренний приём", privateTitle: "Препарат из назначения", type: "medicine", schedule: "10:15" },
  { id: "chia", title: "Чиа", type: "habit", schedule: "12:00", targetDays: 5 },
  { id: "gym", title: "Зал", type: "workout", schedule: "19:00", targetDays: 3 },
];

function looksLikeSetLine(line: string) {
  return /\d+\s*[xх×]\s*\d+|\d+.*отказ/i.test(line);
}

function parseSetLine(line: string): ExerciseSet[] {
  return line.split(/[,;]/).map((chunk, index) => {
    const trimmed = chunk.trim();
    const match = trimmed.match(/(\d+(?:[.,]\d+)?)\s*[xх×]\s*(\d+)/i);
    if (match) {
      return {
        id: `set-${index}-${slug(trimmed)}`,
        weightKg: Number(match[1].replace(",", ".")),
        reps: Number(match[2]),
        completed: true,
      };
    }

    const unknown = trimmed.match(/(\d+(?:[.,]\d+)?)/);
    return {
      id: `set-${index}-${slug(trimmed)}`,
      weightKg: unknown ? Number(unknown[1].replace(",", ".")) : null,
      reps: null,
      completed: true,
      note: trimmed.replace(unknown?.[0] ?? "", "").trim() || "неполная запись",
    };
  });
}

function splitExerciseNameAndSettings(line: string) {
  const settingsMatch = line.match(/(посадка|ручки|сиденье|наклон).*$/i);
  if (settingsMatch?.index == null || settingsMatch.index === 0) {
    return { name: line };
  }

  return {
    name: line.slice(0, settingsMatch.index).trim(),
    settings: line.slice(settingsMatch.index).trim(),
  };
}

function parseDate(value: string) {
  const match = value.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (!match) return null;

  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  return `${year}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-zа-я0-9]+/gi, "-")
    .replace(/^-|-$/g, "") || "item";
}

function hash(value: string) {
  let output = 0;
  for (let i = 0; i < value.length; i += 1) {
    output = Math.imul(31, output) + value.charCodeAt(i) | 0;
  }
  return Math.abs(output).toString(36);
}
