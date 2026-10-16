"use client";

import Link from "next/link";
import { Check, Dumbbell, Share2, Trophy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, LinkButton } from "@/components/ds";
import { useTrackerState } from "@/components/tracker-state";
import { StatTile } from "@/components/ui";
import { workoutResults } from "@/lib/exercises";
import { buildShareCardModel, renderShareCard, shareFileName, shareOrDownload } from "@/lib/share-card";
import { calculateWorkoutTotals, formatLocalDate, russianWord } from "@/lib/tracker";
import type { SessionTrackerState } from "@/lib/workout-session";

const durationText = (seconds: number) => {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes < 60 ? `${minutes} мин` : `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`;
};

export default function WorkoutSummaryPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { state } = useTrackerState();
  const [routeSessionId, setRouteSessionId] = useState<string>();
  const [shareState, setShareState] = useState<"idle" | "working" | "shared" | "downloaded" | "failed">("idle");
  const preparedCard = useRef<{ key: string; blob: Blob } | null>(null);
  useEffect(() => { void params.then(({ sessionId }) => setRouteSessionId(sessionId)); }, [params]);
  const prepareRef = useRef<(() => Promise<Blob>) | null>(null);
  const loaded = Boolean(state);
  useEffect(() => { void prepareRef.current?.().catch(() => undefined); }, [routeSessionId, loaded]);
  if (!state) return <main className="shell"><p>Загружаю результат…</p></main>;
  const sessionState = state as SessionTrackerState;
  const session = sessionState.workoutSessions?.find((item) => item.id === routeSessionId);
  const workout = session && sessionState.workouts.find((item) => item.id === session.workoutId);
  if (!workout || !session) return <main className="shell appPage"><p>Тренировка не найдена.</p><Link className="btn btn-secondary" href="/journal">Журнал</Link></main>;
  const totals = calculateWorkoutTotals(workout);
  const title = session.status === "partial" ? "Завершена частично" : session.status === "cancelled" ? "Тренировка отменена" : session.status === "active" ? "Тренировка ещё идёт" : "Тренировка завершена";
  const duration = session.finishedAt ? (Date.parse(session.finishedAt) - Date.parse(session.startedAt)) / 1000 : 0;
  const results = workoutResults(sessionState, workout);
  const cardKey = `${workout.id}:${session.finishedAt ?? ""}:${totals.completedSets}`;
  // Картинку готовим заранее: на iPhone системное окно «Поделиться» открывается только сразу после касания, без долгого ожидания.
  const prepare = () => {
    if (preparedCard.current?.key === cardKey) return Promise.resolve(preparedCard.current.blob);
    return renderShareCard(buildShareCardModel(sessionState, workout, session)).then((blob) => { preparedCard.current = { key: cardKey, blob }; return blob; });
  };
  prepareRef.current = prepare;
  const share = async () => {
    setShareState("working");
    try {
      const blob = preparedCard.current?.key === cardKey ? preparedCard.current.blob : await prepare();
      const outcome = await shareOrDownload(blob, shareFileName(workout), workout.title);
      setShareState(outcome === "cancelled" ? "idle" : outcome);
    } catch {
      setShareState("failed");
    }
  };
  const records = results.filter((item) => item.record).length;
  return <main className="shell appPage summaryPage">
    <section className="summaryHero">
      <span className="summaryBadge"><Check size={30} /></span>
      <p className="eyebrow">{title}</p>
      <h1>{workout.title}</h1>
      <p className="muted">{formatLocalDate(workout.date)}{duration > 0 ? ` · ${durationText(duration)}` : ""}</p>
    </section>
    <div className="summaryMetrics">
      <StatTile value={totals.completedLogicalSets} label={russianWord(totals.completedLogicalSets, "подход", "подхода", "подходов")} />
      <StatTile value={totals.exercises} label={russianWord(totals.exercises, "упражнение", "упражнения", "упражнений")} />
      <StatTile value={totals.volumeKg.toLocaleString("ru-RU")} label="кг объёма" />
    </div>
    {records > 0 && <p className="recordLine recordBanner"><Trophy size={18} /> {records === 1 ? "Новый рекорд по весу" : `Новых рекордов по весу: ${records}`}</p>}
    <ul className="resultList">{results.map((item) => <li key={item.id}>
      <div><strong>{item.name}</strong><small>{item.sets}</small></div>
      {item.record && <span className="recordTag"><Trophy size={14} />Рекорд</span>}
    </li>)}</ul>
    <div className="summaryActions">
      <LinkButton href="/today" variant="primary" size="lg" block>Готово</LinkButton>
      <Button icon={Share2} block disabled={shareState === "working"} onClick={() => void share()}>{shareState === "working" ? "Готовлю картинку…" : "Поделиться картинкой"}</Button>
      {shareState === "downloaded" && <p className="muted" role="status">Картинка сохранена в загрузки.</p>}
      {shareState === "failed" && <p className="wkError" role="alert">Не получилось собрать картинку. Попробуйте ещё раз.</p>}
      <LinkButton href={`/journal/workouts/${workout.id}`} icon={Dumbbell} block>Открыть в журнале</LinkButton>
    </div>
  </main>;
}
