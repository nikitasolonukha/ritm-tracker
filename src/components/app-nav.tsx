"use client";

import Link from "next/link";
import { CalendarDays, Dumbbell, Home, LineChart, Settings } from "lucide-react";

export function AppNav({ active }: { active: string }) {
  const items = [
    ["today", "/today", "Сегодня", Home],
    ["workouts", "/workouts", "Тренировки", Dumbbell],
    ["progress", "/progress", "Прогресс", LineChart],
    ["journal", "/journal", "Журнал", CalendarDays],
  ] as const;
  return <nav className="bottomNav" aria-label="Основная навигация">{items.map(([id, href, label, Icon]) => <Link className={active === id ? "active" : ""} href={href} key={id}><Icon size={19} /><span>{label}</span></Link>)}<Link className={active === "settings" ? "active" : ""} href="/settings"><Settings size={19} /><span>Настройки</span></Link></nav>;
}
