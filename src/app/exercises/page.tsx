"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight, Dumbbell, Search } from "lucide-react";
import { useState } from "react";
import { AppNav } from "@/components/app-nav";
import { useTrackerState } from "@/components/tracker-state";
import { EmptyState, PageHeader } from "@/components/ui";
import { buildExerciseLibrary, exerciseKey } from "@/lib/exercises";
import { formatLocalDate, russianWord } from "@/lib/tracker";
import type { SessionTrackerState } from "@/lib/workout-session";

export default function ExercisesPage() {
  const { state } = useTrackerState();
  const [query, setQuery] = useState("");
  if (!state) return <main className="shell"><p className="muted">Загружаю упражнения…</p></main>;
  const library = buildExerciseLibrary(state as SessionTrackerState);
  const needle = exerciseKey(query);
  const shown = needle ? library.filter((entry) => entry.key.includes(needle) || exerciseKey(entry.muscleGroup).includes(needle)) : library;
  return <main className="shell appPage">
    <Link className="backLink" href="/journal"><ArrowLeft size={18} />Журнал</Link>
    <PageHeader eyebrow="История и рекорды" title="Упражнения" />
    {library.length > 0 && <label className="searchField"><Search size={18} /><input type="search" placeholder="Найти упражнение" aria-label="Найти упражнение" value={query} onChange={(event) => setQuery(event.target.value)} /></label>}
    <section className="historyList">
      {shown.map((entry) => <Link className="historyCard" href={`/exercises/${encodeURIComponent(entry.key)}`} key={entry.key}>
        <div>
          <h2>{entry.name}</h2>
          <p>{[entry.muscleGroup, entry.equipment].filter(Boolean).join(" · ") || (entry.inProgram ? "Из программы" : "Из журнала")}</p>
          <span>{entry.sessionCount ? `${entry.sessionCount} ${russianWord(entry.sessionCount, "тренировка", "тренировки", "тренировок")} · последняя ${formatLocalDate(entry.lastDate!)}` : "Ещё не выполнялось"}</span>
        </div>
        <ArrowRight size={20} />
      </Link>)}
    </section>
    {library.length > 0 && !shown.length && <p className="muted">Ничего не найдено.</p>}
    {!library.length && <EmptyState icon={Dumbbell} title="Упражнений пока нет" action={<Link className="primary" href="/workouts">Выбрать программу</Link>}>Они появятся из программ и записанных тренировок.</EmptyState>}
    <AppNav active="journal" />
  </main>;
}
