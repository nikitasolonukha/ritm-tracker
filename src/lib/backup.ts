import { getStorageKey, type TrackerState } from "./storage.ts";
import type { Workout } from "./tracker.ts";
import type { SessionTrackerState } from "./workout-session.ts";

export const MAX_BACKUP_BYTES = 20 * 1024 * 1024;
export const MAX_BACKUP_PHOTO_BYTES = 5 * 1024 * 1024;
export type BackupDocument = {
  format: "ritm-backup";
  version: 1;
  accountId: string;
  exportedAt: string;
  state: SessionTrackerState;
};
export type ParsedBackup = { state: SessionTrackerState; accountId?: string; exportedAt?: string };
export type BackupCounts = { habits: number; completions: number; workouts: number; exercises: number; sets: number; programs: number; observations: number; photos: number };
export type BackupPreview = {
  additions: BackupCounts;
  existingItems: number;
  unavailablePhotos: number;
  portablePhotos: number;
  unfinishedWorkouts: number;
  ignoredCommands: number;
};
type Value = Record<string, unknown>;
type Photo = NonNullable<TrackerState["photos"]>[number];
const isObject = (value: unknown): value is Value => !!value && typeof value === "object" && !Array.isArray(value);
const string = (value: unknown, max: number, empty = false): value is string => typeof value === "string" && (empty || value.length > 0) && value.length <= max;
const id = (value: unknown): value is string => string(value, 512);
const numeric = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
const integer = (value: unknown, min: number, max: number) => numeric(value, min, max) && Number.isInteger(value);
const optional = (value: unknown, validate: (value: unknown) => boolean) => value === undefined || validate(value);
const oneOf = (value: unknown, choices: readonly unknown[]) => choices.includes(value);
const instant = (value: unknown) => string(value, 40) && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
function date(value: unknown): value is string {
  if (!string(value, 10) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function items(value: unknown, max: number, validate: (item: Value) => boolean) {
  if (!Array.isArray(value) || value.length > max) return false;
  const ids = new Set<string>();
  return value.every((item) => {
    if (!isObject(item) || !id(item.id) || ids.has(item.id) || !validate(item)) return false;
    ids.add(item.id);
    return true;
  });
}
function validSet(set: Value) {
  return (set.weightKg === null || numeric(set.weightKg, 0, 5000))
    && (set.reps === null || integer(set.reps, 0, 1000))
    && typeof set.completed === "boolean"
    && optional(set.weightMode, (v) => oneOf(v, ["total", "per-hand"]))
    && optional(set.component, (v) => oneOf(v, ["single", "compound-a", "compound-b"]))
    && optional(set.segmentId, id) && optional(set.date, date)
    && optional(set.note, (v) => string(v, 4000, true))
    && optional(set.weightDraft, (v) => string(v, 100, true))
    && optional(set.repsDraft, (v) => string(v, 100, true));
}
function validWorkout(workout: Value) {
  return date(workout.date) && string(workout.title, 200)
    && optional(workout.sourceText, (v) => string(v, 1_000_000, true))
    && items(workout.exercises, 100, (exercise) => string(exercise.name, 200)
      && ["settings", "muscleGroup", "equipment", "equipmentPosition"].every((field) => optional(exercise[field], (v) => string(v, 1000, true)))
      && optional(exercise.category, (v) => oneOf(v, ["warmup", "working", "finisher"]))
      && optional(exercise.restSec, (v) => oneOf(v, [180, 240]))
      && optional(exercise.weightFactor, (v) => numeric(v, 0, 10))
      && items(exercise.sets, 100, validSet));
}

export function embeddedPhotoSize(dataUrl: string): number {
  if (!/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]*={0,2}$/.test(dataUrl)) throw new Error("Фото в копии должно быть в формате JPG, PNG или WebP, а не ссылкой на внешний сайт.");
  const encoded = dataUrl.slice(dataUrl.indexOf(",") + 1);
  if (!encoded.length || encoded.length % 4 !== 0) throw new Error("Встроенное фото повреждено.");
  const bytes = encoded.length / 4 * 3 - (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0);
  if (bytes > MAX_BACKUP_PHOTO_BYTES) throw new Error("Одно фото в резервной копии превышает 5 МБ.");
  return bytes;
}
function validPhoto(photo: Value) {
  if (!date(photo.date) || !string(photo.name, 500) || typeof photo.dataUrl !== "string") return false;
  if (!optional(photo.storagePath, (v) => string(v, 1000) && !v.includes("..") && !v.includes("\\") && !v.startsWith("/") && !v.includes(":"))) return false;
  if (photo.dataUrl) embeddedPhotoSize(photo.dataUrl);
  return !!photo.dataUrl || !!photo.storagePath;
}
function noUnsafeKeys(value: unknown, depth = 0): boolean {
  if (depth > 32) return false;
  if (Array.isArray(value)) return value.every((v) => noUnsafeKeys(v, depth + 1));
  if (!isObject(value)) return true;
  return Object.entries(value).every(([key, item]) => !["__proto__", "prototype", "constructor"].includes(key) && noUnsafeKeys(item, depth + 1));
}
function validateState(value: unknown): value is SessionTrackerState {
  if (!isObject(value) || value.version !== 1 || !noUnsafeKeys(value)) return false;
  if (!items(value.habits, 100, (h) => string(h.title, 200) && string(h.schedule, 1000, true)
    && oneOf(h.type, ["medicine", "habit", "workout", "sleep", "meal"])
    && optional(h.privateTitle, (v) => string(v, 1000, true))
    && optional(h.targetDays, (v) => integer(v, 1, 366))
    && optional(h.archived, (v) => typeof v === "boolean")
    && optional(h.reminderEnabled, (v) => typeof v === "boolean")
    && optional(h.time, (v) => v === "" || (string(v, 5) && /^([01]\d|2[0-3]):[0-5]\d$/.test(v)))
    && optional(h.afterHabitId, id) && optional(h.delayMinutes, (v) => integer(v, 0, 1440))
    && optional(h.eventRole, (v) => oneOf(v, ["wake", "bedtime"]))
    && optional(h.daysOfWeek, (v) => Array.isArray(v) && v.length <= 7 && new Set(v).size === v.length && v.every((d) => integer(d, 0, 6))))) return false;
  if (!items(value.completions, 100_000, (c) => id(c.habitId) && date(c.localDate) && instant(c.completedAt)
    && oneOf(c.source, ["web", "telegram"]) && optional(c.outcome, (v) => oneOf(v, ["completed", "skipped"])))) return false;
  if (!optional(value.habitSnoozes, (v) => items(v, 100_000, (s) => id(s.habitId) && date(s.localDate) && instant(s.dueAt) && integer(s.count, 1, 3)))) return false;
  if (!items(value.workouts, 10_000, validWorkout) || !optional(value.workoutTemplates, (v) => items(v, 100, validWorkout))) return false;
  if (!items(value.observations, 10_000, (o) => date(o.date) && numeric(o.energy, 0, 10) && numeric(o.sleep, 0, 24)
    && oneOf(o.skin, ["better", "same", "worse", "unknown"]) && string(o.note, 4000, true)
    && optional(o.weightKg, (v) => numeric(v, 0.01, 500)))) return false;
  if (!optional(value.photos, (v) => items(v, 1000, validPhoto))) return false;
  if (!items(value.outbox, 100_000, (c) => oneOf(c.type, ["habit.completed", "habit.cancelled", "workout.saved", "timer.started", "workout.set.completed", "timer.rescheduled", "timer.cancelled"])
    && oneOf(c.status, ["pending", "sending", "accepted", "sent", "failed", "cancelled"])
    && instant(c.createdAt) && optional(c.entityId, id) && optional(c.version, (v) => integer(v, 1, 2147483647)))) return false;
  if (value.activeTimer !== null && (!isObject(value.activeTimer) || !instant(value.activeTimer.startedAt)
    || !numeric(value.activeTimer.durationSec, 0, 86400) || !optional(value.activeTimer.endsAt, instant)
    || !optional(value.activeTimer.sourceId, id) || !optional(value.activeTimer.version, (v) => integer(v, 0, 2147483647))
    || !optional(value.activeTimer.status, (v) => oneOf(v, ["running", "expired", "cancelled"])))) return false;
  if (!optional(value.activeWorkoutId, id) || !optional(value.activeSessionId, id)) return false;
  if (!optional(value.workoutSessions, (v) => items(v, 10_000, (s) => id(s.workoutId) && id(s.templateId)
    && oneOf(s.status, ["active", "completed", "partial", "cancelled"]) && instant(s.startedAt)
    && optional(s.finishedAt, instant) && integer(s.activeExerciseIndex, 0, 100)))) return false;
  return optional(value.workoutCommands, (v) => items(v, 100_000, (c) => c.type === "workout.set.completed" && id(c.entityId)
    && instant(c.createdAt) && integer(c.version, 1, 2147483647) && oneOf(c.result, ["applied", "duplicate"])
    && isObject(c.payload) && id(c.payload.workoutId) && id(c.payload.exerciseId) && id(c.payload.setId)));
}

export function parseBackup(text: string): ParsedBackup {
  if (new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) throw new Error("Резервная копия превышает 20 МБ. Разделите фото на меньшие копии.");
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error("Файл не содержит корректный JSON. Выберите резервную копию Ритма."); }
  const wrapper = isObject(value) && value.format === "ritm-backup" ? value : undefined;
  if (wrapper && (wrapper.version !== 1 || !id(wrapper.accountId) || !instant(wrapper.exportedAt))) throw new Error("Неподдерживаемый формат резервной копии.");
  const state = wrapper ? wrapper.state : value;
  if (!validateState(state)) throw new Error("Структура резервной копии повреждена или не поддерживается. Данные не изменены.");
  const workoutIds = new Set(state.workouts.map((w) => w.id));
  if (state.workoutSessions?.some((s) => !workoutIds.has(s.workoutId))) throw new Error("В копии есть сессия без записи тренировки. Данные не изменены.");
  return { state, ...(wrapper ? { accountId: wrapper.accountId as string, exportedAt: wrapper.exportedAt as string } : {}) };
}

export function photoBelongsToAccount(path: string, accountId: string): boolean {
  return path.startsWith(`${accountId}/`) && !path.includes("..") && !path.includes("\\") && !path.includes(":");
}
function portablePhoto(photo: Photo, accountId: string): Photo | undefined {
  if (photo.dataUrl) {
    const embedded = { ...photo };
    delete embedded.storagePath;
    return embedded;
  }
  return photo.storagePath && photoBelongsToAccount(photo.storagePath, accountId) ? photo : undefined;
}
function emptyCounts(): BackupCounts {
  return { habits: 0, completions: 0, workouts: 0, exercises: 0, sets: 0, programs: 0, observations: 0, photos: 0 };
}

function prepareMerge(current: SessionTrackerState, backup: ParsedBackup, accountId: string) {
  const preview: BackupPreview = { additions: emptyCounts(), existingItems: 0, unavailablePhotos: 0, portablePhotos: 0, unfinishedWorkouts: 0, ignoredCommands: backup.state.outbox.length + (backup.state.workoutCommands?.length ?? 0) };
  function mergeItems<T extends { id: string }>(existing: T[], incoming: T[], field: keyof BackupCounts, naturalKey?: (item: T) => string): T[] {
    const ids = new Set(existing.map((item) => item.id));
    const keys = new Set(naturalKey ? existing.map(naturalKey) : []);
    const additions = incoming.filter((item) => {
      const key = naturalKey?.(item);
      if (ids.has(item.id) || (key !== undefined && keys.has(key))) { preview.existingItems++; return false; }
      ids.add(item.id); if (key !== undefined) keys.add(key);
      preview.additions[field]++;
      return true;
    });
    return additions.length ? [...existing, ...additions] : existing;
  }
  const unfinished = new Set((backup.state.workoutSessions ?? []).filter((s) => s.status === "active").map((s) => s.workoutId));
  if (backup.state.activeWorkoutId) unfinished.add(backup.state.activeWorkoutId);
  const protectedIds = new Set((current.workoutSessions ?? []).filter((s) => s.status === "active").map((s) => s.workoutId));
  if (current.activeWorkoutId) protectedIds.add(current.activeWorkoutId);
  function mergeWorkouts(existing: Workout[], incoming: Workout[], field: "workouts" | "programs") {
    const result = [...existing];
    const indices = new Map(existing.map((item, index) => [item.id, index]));
    for (const workout of incoming) {
      if (field === "workouts" && unfinished.has(workout.id)) { preview.unfinishedWorkouts++; continue; }
      const index = indices.get(workout.id);
      if (index === undefined) {
        result.push(workout); indices.set(workout.id, result.length - 1); preview.additions[field]++;
        if (field === "workouts") { preview.additions.exercises += workout.exercises.length; preview.additions.sets += workout.exercises.reduce((n, e) => n + e.sets.length, 0); }
        continue;
      }
      preview.existingItems++;
      if (field === "programs") continue;
      if (field === "workouts" && protectedIds.has(workout.id)) continue;
      const original = result[index];
      const exercises = [...original.exercises];
      const exerciseIndices = new Map(exercises.map((item, at) => [item.id, at]));
      for (const exercise of workout.exercises) {
        const at = exerciseIndices.get(exercise.id);
        if (at === undefined) {
          exercises.push(exercise); exerciseIndices.set(exercise.id, exercises.length - 1);
          if (field === "workouts") { preview.additions.exercises++; preview.additions.sets += exercise.sets.length; }
        } else {
          const old = exercises[at];
          const sets = mergeItems(old.sets, exercise.sets, "sets");
          exercises[at] = { ...old, sets };
        }
      }
      result[index] = { ...original, exercises };
    }
    return result;
  }
  const photos: Photo[] = [];
  for (const photo of backup.state.photos ?? []) {
    if (current.photos?.some((p) => p.id === photo.id)) { preview.existingItems++; continue; }
    const ready = portablePhoto(photo, accountId);
    if (!ready) { preview.unavailablePhotos++; continue; }
    if (photo.storagePath && !ready.storagePath) preview.portablePhotos++;
    photos.push(ready);
  }
  const workouts = mergeWorkouts(current.workouts, backup.state.workouts, "workouts");
  const workoutIds = new Set(workouts.map((w) => w.id));
  const originalWorkoutIds = new Set(current.workouts.map((w) => w.id));
  const sessionIds = new Set((current.workoutSessions ?? []).map((s) => s.id));
  const sessions = (backup.state.workoutSessions ?? []).filter((s) => s.status !== "active" && workoutIds.has(s.workoutId) && !originalWorkoutIds.has(s.workoutId) && !protectedIds.has(s.workoutId) && !sessionIds.has(s.id)
    && !(current.workoutSessions ?? []).some((existing) => existing.workoutId === s.workoutId));
  const state: SessionTrackerState = {
    ...current,
    habits: mergeItems(current.habits, backup.state.habits, "habits"),
    completions: mergeItems(current.completions, backup.state.completions, "completions", (c) => `${c.habitId}:${c.localDate}`),
    workouts,
    workoutTemplates: mergeWorkouts(current.workoutTemplates ?? [], backup.state.workoutTemplates ?? [], "programs"),
    observations: mergeItems(current.observations, backup.state.observations, "observations", (o) => o.date),
    photos: mergeItems(current.photos ?? [], photos, "photos"),
    workoutSessions: [...(current.workoutSessions ?? []), ...sessions],
  };
  return { state, preview };
}

export function previewBackup(current: SessionTrackerState, backup: ParsedBackup, accountId: string): BackupPreview {
  return prepareMerge(current, backup, accountId).preview;
}
export function mergeBackup(current: SessionTrackerState, backup: ParsedBackup, accountId: string, options: { skipUnavailablePhotos?: boolean; skipUnfinishedWorkouts?: boolean } = {}): SessionTrackerState {
  if (!id(accountId)) throw new Error("Войдите в аккаунт перед восстановлением копии.");
  const result = prepareMerge(current, backup, accountId);
  if (result.preview.unavailablePhotos && !options.skipUnavailablePhotos) throw new Error("Есть фото другого аккаунта без встроенного изображения. Экспортируйте полную копию с фото или явно подтвердите пропуск.");
  if (result.preview.unfinishedWorkouts && !options.skipUnfinishedWorkouts) throw new Error("В копии есть незавершённые тренировки. Явно подтвердите их пропуск; текущая активная сессия останется без изменений.");
  if (!validateState(result.state)) throw new Error("Объединённые данные превышают допустимые лимиты. Импорт не выполнен.");
  return result.state;
}

export function createBackupDocument(state: SessionTrackerState, accountId: string, exportedAt = new Date().toISOString()): BackupDocument {
  if (!id(accountId) || !instant(exportedAt) || !validateState(state)) throw new Error("Не удалось сформировать резервную копию: проверьте данные аккаунта.");
  const document: BackupDocument = { format: "ritm-backup", version: 1, accountId, exportedAt, state };
  if (new TextEncoder().encode(JSON.stringify(document)).byteLength > MAX_BACKUP_BYTES) throw new Error("Полная копия превышает 20 МБ. Сохраните фото отдельно перед восстановлением.");
  return document;
}

export function saveBeforeImport(state: SessionTrackerState, accountId: string, storage: Pick<Storage, "setItem">, backupId = crypto.randomUUID()): string {
  if (!id(accountId) || !id(backupId)) throw new Error("Не удалось определить аккаунт для резервной копии.");
  const key = `${getStorageKey(accountId)}:before-import:${backupId}`;
  try { storage.setItem(key, JSON.stringify(state)); }
  catch { throw new Error("Не удалось сохранить исходную копию на устройстве. Импорт отменён; освободите место и повторите."); }
  return key;
}
