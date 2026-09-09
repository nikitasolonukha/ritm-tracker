export type WeightMode = "total" | "per-hand";

export type ExerciseSet = {
  id: string;
  weightKg: number | null;
  reps: number | null;
  completed: boolean;
  note?: string;
  weightMode?: WeightMode;
  date?: string;
  component?: "single" | "compound-a" | "compound-b";
  weightDraft?: string;
  repsDraft?: string;
};

export type ExerciseCategory = "warmup" | "working" | "finisher";

export type Exercise = {
  id: string;
  name: string;
  settings?: string;
  category?: ExerciseCategory;
  restSec?: 180 | 240;
  weightFactor?: number;
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
  sourceId?: string;
  startedAt: string;
  endsAt?: string;
  durationSec: number;
  status?: "running" | "expired" | "cancelled";
  version?: number;
};

export type WorkoutCommand = {
  id: string;
  type: "workout.set.completed";
  entityId: string;
  payload: { exerciseId: string; setId: string; workoutId: string };
  createdAt: string;
  version: number;
  result: "applied" | "duplicate";
};

export type WorkoutSessionState = {
  workout: Workout;
  commands: WorkoutCommand[];
  activeTimer: RestTimer | null;
};

export function getLocalDate(date = new Date(), timeZone = "Europe/Moscow"): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function normalizeDecimalInput(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (!normalized || !/^\d+(?:\.\d+)?$/.test(normalized)) return null;
  const number = Number(normalized);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

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
  const endsMs = timer.endsAt ? new Date(timer.endsAt).getTime() : startedMs + timer.durationSec * 1000;
  const remainingSec = Math.max(0, Math.ceil((endsMs - nowMs) / 1000));

  return {
    remainingSec,
    expired: remainingSec === 0,
  };
}

export function completeWorkoutSet(
  state: WorkoutSessionState,
  exerciseId: string,
  setId: string,
  commandId: string,
  nowIso: string,
): WorkoutSessionState {
  if (state.commands.some((command) => command.id === commandId || command.entityId === `${state.workout.id}:${exerciseId}:${setId}`)) {
    return state;
  }

  const exercise = state.workout.exercises.find((item) => item.id === exerciseId);
  const target = exercise?.sets.find((set) => set.id === setId);
  if (!exercise || !target || target.completed) return state;

  const restSec = exercise.restSec ?? (exercise.category === "working" && /груд|жим|спин|тя|блок/i.test(exercise.name) ? 240 : 180);
  const command: WorkoutCommand = {
    id: commandId,
    type: "workout.set.completed",
    entityId: `${state.workout.id}:${exerciseId}:${setId}`,
    payload: { exerciseId, setId, workoutId: state.workout.id },
    createdAt: nowIso,
    version: 1,
    result: "applied",
  };

  const nextWorkout: Workout = {
    ...state.workout,
    exercises: state.workout.exercises.map((item) => item.id !== exerciseId ? item : {
      ...item,
      sets: item.sets.map((set) => set.id === setId ? { ...set, completed: true, weightDraft: undefined, repsDraft: undefined } : set),
    }),
  };
  const pairedIncomplete = target.component === "compound-a"
    ? exercise.sets.some((set) => set.component === "compound-b" && !set.completed)
    : target.component === "compound-b"
      ? exercise.sets.some((set) => set.component === "compound-a" && !set.completed)
      : false;

  return {
    workout: nextWorkout,
    commands: [...state.commands, command],
    activeTimer: pairedIncomplete ? state.activeTimer : {
      sourceId: command.entityId,
      startedAt: nowIso,
      endsAt: new Date(new Date(nowIso).getTime() + restSec * 1000).toISOString(),
      durationSec: restSec,
      status: "running",
      version: (state.activeTimer?.version ?? 0) + 1,
    },
  };
}

export function parseWorkoutNotes(input: string): Workout {
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return { id: "", date: getLocalDate(), title: "", exercises: [] };
  }

  const rawDate = lines[0] ?? "";
  const explicitDate = parseDate(rawDate) ?? parseRussianDate(rawDate);
  if (/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/.test(rawDate) && !parseDate(rawDate)) {
    return { id: "", date: getLocalDate(), title: "", exercises: [] };
  }
  const date = explicitDate ?? getLocalDate();
  const exercises: Exercise[] = [];

  for (let i = parseDate(rawDate) || parseRussianDate(rawDate) ? 1 : 0; i < lines.length; i += 1) {
    const line = lines[i];

    const inline = line.match(/^(.*?)\s*\((.*)\)\s*$/);
    if (inline) {
      const { name, settings } = splitExerciseNameAndSettings(inline[1].trim());
      const sets = parseSetLine(inline[2]);
      if (sets.length === 0) continue;
      exercises.push({ id: slug(`${name}-${i}`), name, settings, category: "working", restSec: 180, sets });
      continue;
    }

    if (looksLikeSetLine(line)) continue;

    const nextLine = lines[i + 1] ?? "";
    const { name, settings } = splitExerciseNameAndSettings(line);
    const sets = looksLikeSetLine(nextLine) ? parseSetLine(nextLine) : [];

    exercises.push({
      id: slug(`${name}-${i}`),
      name,
      settings,
      category: "working",
      restSec: 180,
      sets,
    });

    if (sets.length > 0) i += 1;
  }

  const normalizedInput = lines.map((line) => line.replace(/\s+/g, " ").trim().toLowerCase()).join("\n");
  return {
    id: `import-${date}-${hash(normalizedInput)}`,
    date,
    title: `Импорт ${date}`,
    exercises,
  };
}

export function parseWorkoutNotesBatch(input: string): Workout[] {
  const lines = input.split(/\r?\n/);
  const starts = lines.reduce<number[]>((result, line, index) => {
    if (parseDate(line.trim()) || parseRussianDate(line.trim()) || /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/.test(line.trim())) result.push(index);
    return result;
  }, []);
  if (starts.length <= 1) {
    const workout = parseWorkoutNotes(input);
    return workout.id ? [workout] : [];
  }
  return starts.map((start, index) => parseWorkoutNotes(lines.slice(start, starts[index + 1] ?? lines.length).join("\n"))).filter((workout) => workout.id && workout.exercises.length > 0);
}

export function suggestNextLoad(history: Array<Pick<ExerciseSet, "weightKg" | "reps" | "completed" | "date">>) {
  void history;
  return null;
}

export const defaultHabits: Habit[] = [
  { id: "wake", title: "Подъём", type: "sleep", schedule: "настроить" },
  { id: "breakfast", title: "Утренний приём пищи", type: "meal", schedule: "настроить" },
  { id: "medicine-am", title: "Утренняя привычка", privateTitle: "настроить", type: "medicine", schedule: "настроить" },
  { id: "chia", title: "Дневная привычка", type: "habit", schedule: "настроить", targetDays: 5 },
  { id: "zinc", title: "Вечерняя привычка", privateTitle: "настроить", type: "medicine", schedule: "настроить" },
  { id: "gym", title: "Тренировка", type: "workout", schedule: "настроить", targetDays: 3 },
];

function looksLikeSetLine(line: string) {
  return /\d+\s*[xх×]\s*\d+|\d+.*отказ/i.test(line);
}

function parseSetLine(line: string): ExerciseSet[] {
  const decimalSafe = line.replace(/(\d+),(\d+)(?=\s*[xх×])/gi, "$1.$2");
  return decimalSafe.split(/[,;]/).map((chunk, index) => {
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
  const iso = `${year}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  const candidate = new Date(`${iso}T00:00:00Z`);
  return candidate.getUTCFullYear() === Number(year) && candidate.getUTCMonth() + 1 === Number(match[2]) && candidate.getUTCDate() === Number(match[1]) ? iso : null;
}

function parseRussianDate(value: string) {
  const match = value.toLowerCase().match(/(\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)(?:\s+(\d{4}))?/);
  if (!match) return null;
  const month = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"].indexOf(match[2]) + 1;
  const year = Number(match[3] ?? getLocalDate().slice(0, 4));
  return `${year}-${String(month).padStart(2, "0")}-${match[1].padStart(2, "0")}`;
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
