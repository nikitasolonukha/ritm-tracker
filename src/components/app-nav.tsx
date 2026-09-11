"use client";

import Link from "next/link";
import { CalendarDays, Dumbbell, Home, LineChart } from "lucide-react";
import { useTrackerState } from "@/components/tracker-state";

export function AppNav({ active }: { active: string }) {
  const { syncConflict, resolveSyncConflict } = useTrackerState();
  const items = [
    ["today", "/today", "Сегодня", Home],
    ["workouts", "/workouts", "Тренировки", Dumbbell],
    ["progress", "/progress", "Прогресс", LineChart],
    ["journal", "/journal", "Журнал", CalendarDays],
  ] as const;
  return <>
    {syncConflict && <section className="syncConflict" role="alert"><strong>Данные изменены на другом устройстве</strong><p>Выберите, какую копию оставить. Невыбранная версия не удаляется автоматически.</p><div><button className="secondary" onClick={() => resolveSyncConflict("local")}>Оставить эту копию</button><button className="primary" onClick={() => resolveSyncConflict("remote")}>Взять серверную</button></div></section>}
    <nav className="bottomNav" aria-label="Основная навигация">{items.map(([id, href, label, Icon]) => <Link className={active === id ? "active" : ""} href={href} key={id}><span className="navIcon"><Icon size={20} /></span><span>{label}</span></Link>)}</nav>
  </>;
}
