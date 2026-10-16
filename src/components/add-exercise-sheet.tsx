"use client";

import { Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Chip, Sheet } from "@/components/ds";
import { buildExerciseLibrary, exerciseDefaults, exerciseKey } from "@/lib/exercises";
import { russianWord } from "@/lib/tracker";
import type { NewExerciseInput } from "@/lib/workout-flow";
import type { SessionTrackerState } from "@/lib/workout-session";

/** Добавление упражнения в идущую тренировку: из библиотеки (с прошлыми значениями) или по своему названию. */
export function AddExerciseSheet({ open, onClose, state, onAdd }: { open: boolean; onClose: () => void; state: SessionTrackerState; onAdd: (input: NewExerciseInput) => void }) {
  const [query, setQuery] = useState("");
  const [paired, setPaired] = useState(false);
  const library = useMemo(() => buildExerciseLibrary(state), [state]);
  const key = exerciseKey(query);
  const matches = (key ? library.filter((entry) => entry.key.includes(key)) : library).slice(0, 30);
  const exact = library.some((entry) => entry.key === key);

  const choose = (name: string) => {
    const defaults = exerciseDefaults(state, name);
    onAdd({
      name,
      sets: defaults.sets,
      weightKg: defaults.weightKg,
      reps: defaults.reps,
      weightMode: paired ? "per-hand" : defaults.weightMode,
      paired: paired || defaults.paired,
      restSec: defaults.restSec,
      muscleGroup: defaults.muscleGroup,
      equipment: defaults.equipment,
    });
    setQuery("");
    setPaired(false);
  };

  return <Sheet open={open} onClose={onClose} title="Добавить упражнение">
    <label className="searchField"><Search size={18} /><input type="search" placeholder="Найти или назвать новое" aria-label="Название упражнения" maxLength={80} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
    <div className="chipRow"><Chip pressed={paired} onClick={() => setPaired((value) => !value)}>Правая и левая отдельно</Chip></div>
    <ul className="menuList" aria-label="Упражнения">
      {key && !exact ? <li><button type="button" className="menuItem" onClick={() => choose(query.trim().replace(/\s+/g, " "))}><Plus size={20} /><span>Добавить «{query.trim()}»<small>Новое упражнение только в этой тренировке</small></span></button></li> : null}
      {matches.map((entry) => <li key={entry.key}><button type="button" className="menuItem" onClick={() => choose(entry.name)}><span>{entry.name}<small>{entry.lastDate ? `${entry.sessionCount} ${russianWord(entry.sessionCount, "тренировка", "тренировки", "тренировок")}, последняя ${entry.lastDate.split("-").reverse().join(".")}` : entry.inProgram ? "Есть в программе" : "Без истории"}</small></span></button></li>)}
    </ul>
    {!matches.length && !key ? <p>В библиотеке пока пусто. Напишите название, и упражнение появится в этой тренировке.</p> : null}
  </Sheet>;
}
