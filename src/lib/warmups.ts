import type { WarmupSet } from "./tracker.ts";

export const WARMUP_MAX = 3;

const shares: Record<number, number[]> = { 1: [0.5], 2: [0.5, 0.75], 3: [0.4, 0.6, 0.8] };
const warmupReps: Record<number, number[]> = { 1: [10], 2: [10, 5], 3: [10, 6, 3] };
const roundToPlate = (kg: number) => Math.round(kg / 2.5) * 2.5;

/**
 * Разминочные подходы для рабочего веса: ступени от меньшей доли к большей, округление до 2,5 кг.
 * Это стартовые значения, их можно поменять на экране. Нет рабочего веса — вес пустой, повторы заданы.
 */
export function planWarmups(count: number, workingWeightKg: number | null | undefined, idPrefix: string): WarmupSet[] {
  const total = Math.min(WARMUP_MAX, Math.max(0, Math.trunc(count)));
  if (!total) return [];
  return Array.from({ length: total }, (_, index) => {
    const weight = workingWeightKg != null && workingWeightKg > 0 ? roundToPlate(workingWeightKg * shares[total][index]) : 0;
    return { id: `${idPrefix}-warmup-${index + 1}`, weightKg: weight > 0 ? weight : null, reps: warmupReps[total][index], completed: false };
  });
}
