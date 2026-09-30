import { parseWorkoutNotesBatch, stableStringify, type Workout } from "./tracker.ts";

const months = "января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря";
const missingRussianYear = new RegExp(`^\\d{1,2}\\s+(?:${months})$`,"i");
const header = new RegExp(`^\\d{1,2}(?:[./-]\\d{1,2}(?:[./-]\\d{2,4})?|\\s+(?:${months})(?:\\s+\\d{4})?)$`,"i");

export function prepareWorkoutImport(input: string, year?: number): { workouts: Workout[]; error?: string; needsYear?: boolean } {
  const lines = input.split(/\r?\n/);
  const dates = lines.filter((line) => header.test(line.trim()));
  if (!dates.length) return { workouts:[],error:"Добавьте дату перед каждой тренировкой." };
  const missing = dates.some((line) => /^\d{1,2}[./-]\d{1,2}$/.test(line.trim()) || missingRussianYear.test(line.trim()));
  if (missing && (!year || !Number.isInteger(year) || year<1900 || year>2100)) return { workouts:[],needsYear:true,error:"Укажите год для дат без года." };
  const normalized = lines.map((line) => { const trimmed=line.trim(); if (/^\d{1,2}[./-]\d{1,2}$/.test(trimmed)) return `${trimmed}.${year}`; if (missingRussianYear.test(trimmed)) return `${trimmed} ${year}`; return line; }).join("\n");
  const workouts = parseWorkoutNotesBatch(normalized).map((workout) => ({ ...workout,sourceText:input,exercises:workout.exercises.filter((e) => e.sets.length) }));
  if (workouts.length !== dates.length || workouts.some((w) => !w.exercises.length)) return { workouts:[],error:"Не удалось разобрать все даты или подходы. Проверьте исходный текст." };
  return { workouts };
}

export function withoutRepeatedImportFacts(imported: Workout[], history: Workout[]): Workout[] {
  const result: Workout[] = [];
  for (const workout of imported) {
    if ([...history,...result].some((w) => w.id === workout.id)) continue;
    const sameDay = [...history,...result].filter((w) => w.date === workout.date);
    const exercises = workout.exercises.filter((e) => !sameDay.some((w) => w.exercises.some((old) => {
      if (old.name.trim().toLowerCase() !== e.name.trim().toLowerCase() || old.sets.length < e.sets.length) return false;
      return e.sets.every((s,index) => stableStringify({ weight:s.weightKg,reps:s.reps,note:s.note }) === stableStringify({ weight:old.sets[index].weightKg,reps:old.sets[index].reps,note:old.sets[index].note }));
    })));
    if (exercises.length) result.push({ ...workout,exercises });
  }
  return result;
}
