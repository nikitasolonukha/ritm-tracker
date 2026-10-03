"use client";

import Link from "next/link";
import { ArrowRight, Dumbbell, Settings2 } from "lucide-react";
import { AppNav } from "@/components/app-nav";
import { EmptyState, HeaderAction, PageHeader } from "@/components/ui";
import { useTrackerState } from "@/components/tracker-state";
import { formatLocalDate, russianWord } from "@/lib/tracker";
import { latestTemplateRecordDate, type SessionTrackerState } from "@/lib/workout-session";

export default function WorkoutsPage() {
  const { state } = useTrackerState();
  if (!state) return <main className="shell"><p className="muted">Загружаю программы…</p></main>;
  const sessionState = state as SessionTrackerState;
  const active = sessionState.workoutSessions?.find((item) => item.status === "active");
  const templates = sessionState.workoutTemplates ?? [];
  return <main className="shell appPage"><PageHeader eyebrow="Мои программы" title="Тренировки" actions={<HeaderAction href="/settings?section=program" icon={Settings2} label="Программы" ariaLabel="Настроить программы" />} />
    {active && <Link className="resumeBanner" href={`/workout/${active.id}`}><span><strong>Тренировка идёт</strong><small>Продолжить текущую сессию</small></span><ArrowRight size={22} /></Link>}
    <section className="sectionHeading"><h2>Выбери план</h2><span className="muted">{templates.length} {russianWord(templates.length, "программа", "программы", "программ")}</span></section>
    <div className="programList">{templates.map((template) => { const lastDate = latestTemplateRecordDate(sessionState, template.id); return <Link className="programCard" href={`/workouts/templates/${template.id}`} key={template.id}><div className="programIcon"><Dumbbell size={22} /></div><div><h3>{template.title}</h3><p>{template.exercises.length} {russianWord(template.exercises.length, "упражнение", "упражнения", "упражнений")}</p><small>Последняя запись: {lastDate ? formatLocalDate(lastDate) : "нет данных"}</small></div><ArrowRight size={20} /></Link>; })}</div>
    {!templates.length && <EmptyState icon={Dumbbell} title="Программ пока нет" action={<Link className="primary" href="/settings">Открыть настройки</Link>}>Создай программу в настройках, затем начни первую сессию.</EmptyState>}
    <AppNav active="workouts" /></main>;
}
