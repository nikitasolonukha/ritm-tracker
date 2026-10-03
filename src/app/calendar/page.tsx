"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, Dumbbell, Flame } from "lucide-react";
import { useState } from "react";
import { AppNav } from "@/components/app-nav";
import { useTrackerState } from "@/components/tracker-state";
import { PageHeader, StatTile } from "@/components/ui";
import { habitsForDate } from "@/lib/habits";
import { habitStreaks, monthGrid, trainedDateSet, weeklyGoalStreak } from "@/lib/streaks";
import { calculateWorkoutTotals, formatLocalDate, getLocalDate, russianWord } from "@/lib/tracker";
import type { SessionTrackerState } from "@/lib/workout-session";

const monthName = (year: number, month: number) => { const name = new Intl.DateTimeFormat("ru-RU", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 15))); return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${year}`; };
const weekdays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

export default function CalendarPage() {
  const { state } = useTrackerState();
  const today = getLocalDate();
  const [cursor, setCursor] = useState(() => ({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) }));
  const [selected, setSelected] = useState(today);
  if (!state) return <main className="shell"><p className="muted">Загружаю календарь…</p></main>;
  const sessionState = state as SessionTrackerState;
  const blocked = new Set((sessionState.workoutSessions ?? []).filter((s) => s.status === "active" || s.status === "cancelled").map((s) => s.workoutId));
  const trained = trainedDateSet(state.workouts, blocked);
  const grid = monthGrid(state, cursor.year, cursor.month, today, trained);
  const streaks = habitStreaks(state, today);
  const goal = state.habits.find((habit) => !habit.archived && habit.type === "workout")?.targetDays ?? 3;
  const weeks = weeklyGoalStreak(trained, goal, today);
  const shift = (delta: number) => setCursor(({ year, month }) => { const index = year * 12 + (month - 1) + delta; return { year: Math.floor(index / 12), month: (index % 12) + 1 }; });
  const dayWorkouts = state.workouts.filter((w) => w.date === selected && !blocked.has(w.id) && calculateWorkoutTotals(w).completedSets > 0);
  const dayHabits = habitsForDate(state.habits, selected).map((habit) => ({ habit, mark: state.completions.find((c) => c.habitId === habit.id && c.localDate === selected) }));
  const monthDays = grid.filter((c) => c.inMonth && !c.isFuture);
  const monthTrainings = monthDays.filter((c) => c.trained).length;
  const monthClosed = monthDays.filter((c) => c.closed).length;
  return <main className="shell appPage">
    <Link className="backLink" href="/journal"><ArrowLeft size={18} />Журнал</Link>
    <PageHeader eyebrow="История по дням" title="Календарь" />
    <div className="summaryMetrics">
      <StatTile value={streaks.current} label={russianWord(streaks.current, "день подряд", "дня подряд", "дней подряд")} />
      <StatTile value={streaks.longest} label="лучшая серия" />
      <StatTile value={weeks} label={russianWord(weeks, "неделя с целью", "недели с целью", "недель с целью")} />
    </div>
    <section className="calendar" aria-label="Календарь">
      <div className="calendarHead">
        <button type="button" className="iconButton" aria-label="Предыдущий месяц" onClick={() => shift(-1)}><ChevronLeft size={20} /></button>
        <h2>{monthName(cursor.year, cursor.month)}</h2>
        <button type="button" className="iconButton" aria-label="Следующий месяц" onClick={() => shift(1)}><ChevronRight size={20} /></button>
      </div>
      <div className="calendarGrid">
        {weekdays.map((day) => <span className="calendarWeekday" key={day}>{day}</span>)}
        {grid.map((cell) => <button
          type="button"
          key={cell.date}
          className={`calendarDay${cell.inMonth ? "" : " outside"}${cell.isToday ? " today" : ""}${cell.date === selected ? " selected" : ""}${cell.closed ? " closed" : ""}${cell.isFuture ? " future" : ""}`}
          aria-pressed={cell.date === selected}
          aria-label={`${formatLocalDate(cell.date)}${cell.trained ? ", тренировка" : ""}${cell.closed ? ", все привычки выполнены" : ""}`}
          onClick={() => setSelected(cell.date)}
        >
          <span>{Number(cell.date.slice(8))}</span>
          <i className={cell.trained ? "trainedDot" : undefined} aria-hidden="true" />
        </button>)}
      </div>
      <p className="calendarLegend"><span className="trainedDot" /> тренировка <span className="closedSwatch" /> все привычки выполнены</p>
      <p className="muted calendarSummary">В этом месяце: {monthTrainings} {russianWord(monthTrainings, "тренировка", "тренировки", "тренировок")}, закрыто дней: {monthClosed}.</p>
    </section>
    <section className="actionSection">
      <div className="sectionHeading"><h2>{formatLocalDate(selected)}</h2>{selected === today && <span className="muted">сегодня</span>}</div>
      {dayWorkouts.map((workout) => { const totals = calculateWorkoutTotals(workout); return <Link className="historyCard" href={`/journal/workouts/${workout.id}`} key={workout.id}>
        <div><span><Dumbbell size={14} /> Тренировка</span><h2>{workout.title}</h2><p>{totals.completedSets} {russianWord(totals.completedSets, "подход", "подхода", "подходов")} · {totals.volumeKg.toLocaleString("ru-RU")} кг</p></div><ArrowRight size={20} />
      </Link>; })}
      {dayHabits.length > 0 ? <ul className="dayHabits">{dayHabits.map(({ habit, mark }) => <li key={habit.id} className={mark ? (mark.outcome === "skipped" ? "skipped" : "done") : ""}><span>{habit.title}</span><small>{mark ? (mark.outcome === "skipped" ? "пропущено" : "выполнено") : selected > today ? "впереди" : "не отмечено"}</small></li>)}</ul>
        : !dayWorkouts.length && <p className="muted">В этот день ничего не запланировано.</p>}
      {streaks.current >= 2 && selected === today && <p className="recordLine"><Flame size={16} /> Серия закрытых дней: {streaks.current}. Не прерывайте её.</p>}
    </section>
    <AppNav active="journal" />
  </main>;
}
