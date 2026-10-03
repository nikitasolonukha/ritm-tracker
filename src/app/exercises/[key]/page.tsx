"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Dumbbell, Trophy } from "lucide-react";
import { AppNav } from "@/components/app-nav";
import { LineChart } from "@/components/charts";
import { useTrackerState } from "@/components/tracker-state";
import { EmptyState, PageHeader, StatTile } from "@/components/ui";
import { buildExerciseLibrary, formatSets, getExerciseRecords, getExerciseSeries, getExerciseSessions } from "@/lib/exercises";
import { formatLocalDate, russianWord } from "@/lib/tracker";
import type { SessionTrackerState } from "@/lib/workout-session";

function decode(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value ?? "";
  try { return decodeURIComponent(raw); } catch { return raw; }
}

export default function ExercisePage() {
  const key = decode(useParams<{ key: string }>().key);
  const { state } = useTrackerState();
  if (!state) return <main className="shell"><p className="muted">Загружаю упражнение…</p></main>;
  const sessionState = state as SessionTrackerState;
  const entry = buildExerciseLibrary(sessionState).find((item) => item.key === key);
  const sessions = getExerciseSessions(sessionState, key);
  const records = getExerciseRecords(sessions);
  const series = getExerciseSeries(sessions);
  const back = <Link className="backLink" href="/exercises"><ArrowLeft size={18} />Упражнения</Link>;
  if (!entry) return <main className="shell appPage">{back}<EmptyState title="Упражнение не найдено">Оно могло быть переименовано или удалено из программ.</EmptyState><AppNav active="journal" /></main>;
  const kg = (value: number) => value.toLocaleString("ru-RU", { maximumFractionDigits: 1 });
  return <main className="shell appPage">
    {back}
    <PageHeader eyebrow={[entry.muscleGroup, entry.equipment].filter(Boolean).join(" · ") || "Упражнение"} title={entry.name} />
    {!sessions.length ? <EmptyState icon={Dumbbell} title="Пока нет записанных подходов">Рекорды и график появятся после первой тренировки с этим упражнением.</EmptyState> : <>
      <div className="summaryMetrics">
        <StatTile value={records.heaviest ? `${kg(records.heaviest.weightKg)} кг` : "—"} label="макс. вес" />
        <StatTile value={records.bestEstimatedOneRepMax ? `${kg(records.bestEstimatedOneRepMax.value)} кг` : "—"} label="оценка 1ПМ" />
        <StatTile value={sessions.length} label={russianWord(sessions.length, "тренировка", "тренировки", "тренировок")} />
      </div>
      {records.heaviest && <p className="recordLine"><Trophy size={16} /> Рекорд по весу: {kg(records.heaviest.weightKg)} кг × {records.heaviest.reps}, {formatLocalDate(records.heaviest.date)}</p>}
      <section className="actionSection">
        <div className="sectionHeading"><h2>Рабочий вес</h2><span className="muted">лучший подход тренировки</span></div>
        <LineChart title="Рабочий вес" unit="кг" points={series.map((p) => ({ label: p.date, value: p.weightKg }))} />
      </section>
      <section className="actionSection">
        <div className="sectionHeading"><h2>История</h2><span className="muted">{sessions.length} {russianWord(sessions.length, "запись", "записи", "записей")}</span></div>
        <div className="historyList">
          {sessions.map((session) => <Link className="historyCard" href={`/journal/workouts/${session.workoutId}`} key={session.workoutId}>
            <div><span>{formatLocalDate(session.date)}</span><h2>{formatSets(session.sets)}</h2><p>{session.volumeKg > 0 ? `${session.volumeKg.toLocaleString("ru-RU")} кг объёма` : session.workoutTitle}</p></div>
            <ArrowRight size={20} />
          </Link>)}
        </div>
      </section>
    </>}
    <AppNav active="journal" />
  </main>;
}
