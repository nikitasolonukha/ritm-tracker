import { exerciseKey } from "./exercises.ts";

export type MachinePhoto = { src: string; title: string };
type MachineEntry = { file: string; title: string; names: string[] };

/**
 * Фото тренажёров зала. Файлы лежат в `public/machines/`, а здесь каждому фото задаются подпись и названия
 * упражнений, к которым оно относится (регистр, «ё» и знаки не важны). Новое фото = файл + одна запись.
 */
export const machines: MachineEntry[] = [];

const byKey = new Map<string, MachinePhoto>();
for (const entry of machines) {
  for (const name of entry.names) byKey.set(exerciseKey(name), { src: `/machines/${entry.file}`, title: entry.title });
}

/** Фото тренажёра для упражнения по его названию (точное совпадение после нормализации). */
export function machinePhoto(name: string): MachinePhoto | undefined {
  return byKey.get(exerciseKey(name));
}
