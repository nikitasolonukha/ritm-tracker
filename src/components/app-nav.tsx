"use client";

import Link from "next/link";
import { CalendarDays, Dumbbell, Home, LineChart } from "lucide-react";
import { useTrackerState } from "@/components/tracker-state";

export function AppNav({ active }: { active: string }) {
  const { state, syncConflict, resolveSyncConflict } = useTrackerState();
  const failed = state?.outbox.filter((item) => item.status === "failed").length ?? 0;
  const queued = state?.outbox.filter((item) => ["pending", "sending"].includes(item.status)).length ?? 0;
  const items = [
    ["today", "/today", "Сегодня", Home],
    ["workouts", "/workouts", "Тренировки", Dumbbell],
    ["progress", "/progress", "Прогресс", LineChart],
    ["journal", "/journal", "Журнал", CalendarDays],
  ] as const;
  return <>
    {syncConflict && <section className="syncConflict" role="alert"><strong>Данные изменены на другом устройстве</strong><p>Обе версии будут сохранены в резервную копию. Выберите, какую сделать основной.</p><div><button className="secondary" onClick={() => resolveSyncConflict("local")}>Оставить эту копию</button><button className="primary" onClick={() => resolveSyncConflict("remote")}>Взять серверную</button></div></section>}
    {!syncConflict && failed > 0 && <p className="outboxStatus" role="status">Не отправлено: {failed}. Данные сохранены локально, повтор будет выполнен автоматически.</p>}
    {!syncConflict && failed === 0 && queued > 0 && <p className="outboxStatus" role="status">Синхронизация: {queued}</p>}
    <nav className="bottomNav" aria-label="Основная навигация">{items.map(([id, href, label, Icon]) => <Link className={active === id ? "active" : ""} href={href} key={id}><span className="navIcon"><Icon size={20} /></span><span>{label}</span></Link>)}</nav>
  </>;
}
