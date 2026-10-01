"use client";

import Link from "next/link";
import { CalendarDays, Clock, Dumbbell, Home, LineChart, SkipForward } from "lucide-react";
import { useEffect, useState } from "react";
import { createRestTimerCommand, restoreRestTimer, russianWord } from "@/lib/tracker";
import type { SessionTrackerState } from "@/lib/workout-session";
import { useTrackerState } from "@/components/tracker-state";

export function AppNav({ active }: { active: string }) {
  const { state, update, syncConflict, resolveSyncConflict, retrySync, syncStatus } = useTrackerState();
  const [now,setNow]=useState(() => new Date().toISOString());
  useEffect(() => { if (!state?.activeTimer) return; const tick=setInterval(() => setNow(new Date().toISOString()),1000); return () => clearInterval(tick); },[state?.activeTimer]);
  const rest=state?.activeTimer ? restoreRestTimer(state.activeTimer,now) : null;
  const activeSession=(state as SessionTrackerState | null)?.workoutSessions?.find((s) => s.status === "active");
  const timerAction=(action:"cancel"|"reschedule") => update((previous) => {
    if (!previous.activeTimer) return previous;
    const command=createRestTimerCommand(previous.activeTimer,action,new Date().toISOString(),"Ритм: отдых завершён.");
    return command ? { ...previous,activeTimer:command.timer,outbox:[...previous.outbox,command.command] } : previous;
  });
  const failed = state?.outbox.filter((item) => item.status === "failed").length ?? 0;
  const queued = state?.outbox.filter((item) => ["pending", "sending"].includes(item.status)).length ?? 0;
  const items = [
    ["today", "/today", "Сегодня", Home],
    ["workouts", "/workouts", "Тренировки", Dumbbell],
    ["progress", "/progress", "Прогресс", LineChart],
    ["journal", "/journal", "Журнал", CalendarDays],
  ] as const;
  return <>
    {rest && !rest.expired && activeSession && <div className="globalRest"><Link href={`/workout/${activeSession.id}`}><Clock size={18} />Отдых · {Math.floor(rest.remainingSec/60)}:{String(rest.remainingSec%60).padStart(2,"0")}</Link><button className="secondary" onClick={() => timerAction("reschedule")}>+30 с</button><button className="iconButton" onClick={() => timerAction("cancel")} aria-label="Пропустить текущий отдых" title="Пропустить отдых"><SkipForward size={18} /></button></div>}
    {syncConflict && <section className="syncConflict" role="alert"><strong>Данные изменены на другом устройстве</strong><p>Обе версии будут сохранены в резервную копию. Выберите, какую сделать основной.</p><div><button className="secondary" onClick={() => resolveSyncConflict("local")}>Оставить эту копию</button><button className="primary" onClick={() => resolveSyncConflict("remote")}>Взять серверную</button></div></section>}
    {!syncConflict && failed > 0 && <p className="outboxStatus" role="status">Не отправлено: {failed}. Данные сохранены локально, повтор будет выполнен автоматически.</p>}
    {!syncConflict && failed === 0 && queued > 0 && <p className="outboxStatus" role="status">{queued} {russianWord(queued, "действие", "действия", "действий")} {russianWord(queued, "ждёт", "ждут", "ждут")} отправки. Запись останется на этом устройстве, пока сервер её не подтвердит.</p>}
    {!syncConflict && syncStatus === "offline" && <p className="outboxStatus" role="alert">Нет связи. Изменения сохранены на устройстве. <button className="textButton" onClick={retrySync}>Повторить синхронизацию</button></p>}
    {!syncConflict && syncStatus === "error" && <p className="outboxStatus" role="alert">Синхронизация недоступна. <button className="textButton" onClick={retrySync}>Повторить</button></p>}
    <nav className="bottomNav" aria-label="Основная навигация">{items.map(([id, href, label, Icon]) => <Link className={active === id ? "active" : ""} href={href} key={id}><span className="navIcon"><Icon size={20} /></span><span>{label}</span></Link>)}</nav>
  </>;
}
