type RecordValue = Record<string, unknown>;
const object = (v: unknown): v is RecordValue => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max = 1000) => typeof v === "string" && v.length > 0 && v.length <= max;
const numberOrNull = (v: unknown, max: number) => v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max);
function uniqueItems(value: unknown, max: number, validate: (v: RecordValue) => boolean): boolean {
  if (!Array.isArray(value) || value.length > max) return false;
  const ids = new Set<string>();
  return value.every((v) => { if (!object(v) || !text(v.id) || ids.has(v.id as string) || !validate(v)) return false; ids.add(v.id as string); return true; });
}
function workout(v: RecordValue) {
  return text(v.title, 200) && text(v.date,10) && uniqueItems(v.exercises,100,(e) => text(e.name,200) && uniqueItems(e.sets,100,(s) => numberOrNull(s.weightKg,5000) && numberOrNull(s.reps,1000) && typeof s.completed === "boolean"));
}
export function isTrackerPayload(value: unknown): boolean {
  if (!object(value) || value.version !== 1) return false;
  if (!uniqueItems(value.habits,100,(h) => {
    if (!text(h.title,200) || typeof h.schedule !== "string" || h.schedule.length>1000) return false;
    if (h.daysOfWeek !== undefined && (!Array.isArray(h.daysOfWeek) || h.daysOfWeek.some((d) => !Number.isInteger(d) || d<0 || d>6))) return false;
    if (h.delayMinutes !== undefined && (typeof h.delayMinutes !== "number" || !Number.isInteger(h.delayMinutes) || h.delayMinutes<0 || h.delayMinutes>1440)) return false;
    if (h.time !== undefined && (typeof h.time !== "string" || (h.time !== "" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(h.time)))) return false;
    return true;
  })) return false;
  if (!uniqueItems(value.completions,100000,(c) => text(c.habitId) && text(c.localDate,10) && text(c.completedAt,40) && Number.isFinite(Date.parse(c.completedAt as string)))) return false;
  if (value.habitSnoozes !== undefined && !uniqueItems(value.habitSnoozes,10000,(s) => text(s.habitId) && text(s.localDate,10) && text(s.dueAt,40) && Number.isFinite(Date.parse(s.dueAt as string)) && typeof s.count === "number" && Number.isInteger(s.count) && s.count>=1 && s.count<=3)) return false;
  if (!uniqueItems(value.workouts,10000,workout)) return false;
  if (value.workoutTemplates !== undefined && !uniqueItems(value.workoutTemplates,100,workout)) return false;
  if (!uniqueItems(value.outbox,100000,(c) => text(c.type,80) && text(c.status,20) && (c.version === undefined || (typeof c.version === "number" && Number.isInteger(c.version) && c.version>=1 && c.version<=2147483647)))) return false;
  if (!Array.isArray(value.observations) || value.observations.length>10000) return false;
  if (value.photos !== undefined && !uniqueItems(value.photos,1000,(p) => text(p.date,10) && text(p.name,500) && typeof p.dataUrl === "string" && p.dataUrl.length < 8_000_000)) return false;
  return true;
}
