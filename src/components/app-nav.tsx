"use client";

import Link from "next/link";
import { CalendarDays, Dumbbell, Home, LineChart } from "lucide-react";

export function AppNav({ active }: { active: string }) {
  const items = [
    ["today", "/today", "Сегодня", Home],
    ["workouts", "/workouts", "Тренировки", Dumbbell],
    ["progress", "/progress", "Прогресс", LineChart],
    ["journal", "/journal", "Журнал", CalendarDays],
  ] as const;
  return <nav className="bottomNav" aria-label="Основная навигация">{items.map(([id, href, label, Icon]) => <Link className={active === id ? "active" : ""} href={href} key={id}><span className="navIcon"><Icon size={20} /></span><span>{label}</span></Link>)}</nav>;
}
