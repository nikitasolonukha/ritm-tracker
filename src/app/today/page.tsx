"use client";

import Link from "next/link";
import { ArrowRight, Check, Clock, Dumbbell, Flame, Play, SkipForward, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AppNav } from "@/components/app-nav";
import { Button, Card, Ring } from "@/components/ds";
import { useTrackerState } from "@/components/tracker-state";
import { EmptyState, Notice, PageHeader } from "@/components/ui";
import { useStartWorkout } from "@/components/use-start-workout";
import { changeHabit, habitsForDate, sleepFromEvents, snoozeHabit } from "@/lib/habits";
import { habitStreaks } from "@/lib/streaks";
import type { TrackerState } from "@/lib/storage";
import { calculateWorkoutTotals, getLocalDate, russianWord, visibleCopy, type HabitCompletion } from "@/lib/tracker";
import type { SessionTrackerState } from "@/lib/workout-session";

type Habit = TrackerState["habits"][number];
type Update = (change: (previous: TrackerState) => TrackerState) => boolean;

const noonUtc = (date: string) => new Date(`${date}T12:00:00Z`);
const format = (date: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("ru-RU", options).format(noonUtc(date));
const clock = (value: Date) => new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" }).format(value);

function WeekStrip({ dates, today, selected, active, onSelect }: { dates: string[]; today: string; selected: string; active: Set<string>; onSelect: (date: string) => void }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const align = () => {
      const strip = ref.current;
      const target = strip?.querySelector<HTMLElement>(selected === today ? ".dayCapsule.today" : ".dayCapsule.selected");
      if (!strip || !target) return;
      strip.scrollLeft = Math.max(0, target.offsetLeft - (strip.clientWidth - target.offsetWidth) / 2);
    };
    const frame = window.requestAnimationFrame(align);
    window.addEventListener("resize", align);
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener("resize", align); };
  }, [selected, today]);
  return <section ref={ref} className="weekStrip" aria-label="Неделя">
    {dates.map((date) => <button
      type="button"
      key={date}
      className={`dayCapsule${date === today ? " today" : ""}${date === selected ? " selected" : ""}`}
      aria-pressed={date === selected}
      aria-label={format(date, { weekday: "long", day: "numeric", month: "long" })}
      onClick={() => onSelect(date)}
    >
      <span>{format(date, { weekday: "short" })}</span>
      <strong>{date.slice(-2)}</strong>
      {active.has(date) && <i aria-label="Есть активность" />}
    </button>)}
  </section>;
}

function HabitRow({ habit, state, date, today, update }: { habit: Habit; state: TrackerState; date: string; today: string; update: Update }) {
  const mark: HabitCompletion | undefined = state.completions.find((c) => c.habitId === habit.id && c.localDate === date);
  const parent = state.habits.find((h) => h.id === habit.afterHabitId);
  const parentMark = parent && state.completions.find((c) => c.habitId === parent.id && c.localDate === date && c.outcome !== "skipped");
  const snooze = state.habitSnoozes?.find((s) => s.habitId === habit.id && s.localDate === date);
  const due = snooze ? new Date(snooze.dueAt) : parentMark ? new Date(Date.parse(parentMark.completedAt) + (habit.delayMinutes ?? 0) * 60_000) : undefined;
  const when = due ? `В ${clock(due)}` : parent ? `После: ${parent.title}` : habit.time || visibleCopy(habit.schedule);
  const status = mark?.outcome === "skipped" ? "Пропущено" : mark ? "Выполнено" : when || (date === today ? "Сегодня" : "В этот день");
  const note = visibleCopy(habit.privateTitle);
  return <div className={`habitRow${mark ? " done" : ""}${mark?.outcome === "skipped" ? " skipped" : ""}`}>
    <button className="habitMain" onClick={() => update((prev) => changeHabit(prev, habit.id, date, mark ? "cancelled" : "completed"))}>
      <span className="habitCheck" aria-hidden="true">{mark && (mark.outcome === "skipped" ? <SkipForward size={16} /> : <Check size={18} />)}</span>
      <span className="habitText"><strong>{habit.title}</strong><small>{status}</small>{note && <small>{note}</small>}</span>
    </button>
    <div className="habitTools">
      {!mark && habit.reminderEnabled && <button className="habitTool" aria-label={`Отложить ${habit.title} на 10 минут`} title="Отложить на 10 минут" disabled={(snooze?.count ?? 0) >= 3} onClick={() => update((prev) => snoozeHabit(prev, habit.id, date))}><Clock size={18} /></button>}
      <button className="habitTool" aria-label={mark ? `Отменить отметку ${habit.title}` : `Пропустить ${habit.title}`} title={mark ? "Отменить отметку" : "Пропустить"} onClick={() => update((prev) => changeHabit(prev, habit.id, date, mark ? "cancelled" : "skipped"))}>{mark ? <Undo2 size={18} /> : <SkipForward size={18} />}</button>
    </div>
  </div>;
}

export default function TodayPage() {
  const { state, update, storageError } = useTrackerState();
  const { start, dialog } = useStartWorkout();
  const today = getLocalDate();
  const [selectedDate, setSelectedDate] = useState(today);
  if (!state) return <main className="shell"><p>Загружаю день…</p></main>;
  const sessionState = state as SessionTrackerState;
  const active = sessionState.workoutSessions?.find((item) => item.status === "active");
  const activeWorkout = active && state.workouts.find((workout) => workout.id === active.workoutId);
  const habits = habitsForDate(state.habits, selectedDate);
  const weekday = noonUtc(selectedDate).getUTCDay();
  const workoutHabits = state.habits.filter((habit) => !habit.archived && habit.type === "workout" && (!habit.daysOfWeek?.length || habit.daysOfWeek.includes(weekday)));
  const isDone = (habitId: string, date: string) => state.completions.some((c) => c.habitId === habitId && c.localDate === date && c.outcome !== "skipped");
  const completed = habits.filter((h) => isDone(h.id, selectedDate)).length;
  const resolved = habits.filter((h) => state.completions.some((c) => c.habitId === h.id && c.localDate === selectedDate)).length;
  const monday = noonUtc(today);
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
  const weekStart = monday.toISOString().slice(0, 10);
  const sessions = (sessionState.workoutSessions ?? []).filter((s) => (s.status === "completed" || s.status === "partial") && state.workouts.some((w) => w.id === s.workoutId && calculateWorkoutTotals(w).completedSets > 0));
  const finished = sessions.filter((s) => state.workouts.some((w) => w.id === s.workoutId && w.date >= weekStart && w.date <= today)).length;
  const dates = Array.from({ length: 7 }, (_, index) => { const date = noonUtc(today); date.setUTCDate(date.getUTCDate() - 6 + index); return date.toISOString().slice(0, 10); });
  const activeDates = new Set(state.completions.filter((c) => c.outcome !== "skipped").map((c) => c.localDate));
  const goal = state.habits.find((habit) => !habit.archived && habit.type === "workout")?.targetDays ?? 3;
  const templates = sessionState.workoutTemplates ?? [];
  const template = templates.length === 1 ? templates[0] : undefined;
  const sleep = sleepFromEvents(state.habits, state.completions, today);
  const lastObservation = state.observations.map((o) => o.date).sort().at(-1);
  const checkInDue = !lastObservation || (Date.parse(today) - Date.parse(lastObservation)) / 86_400_000 >= 3;
  const completedDays = [...new Set(state.completions.map((c) => c.localDate))].filter((date) => { const planned = habitsForDate(state.habits, date); return planned.length > 0 && planned.every((h) => isDone(h.id, date)); }).length;
  const streaks = habitStreaks(state, today);
  const nextMilestone = [14, 28, 60, 90].find((d) => d > streaks.current) ?? Math.ceil((streaks.current + 1) / 30) * 30;
  const planTitle = selectedDate !== today ? "План на этот день" : resolved === habits.length ? "План дня закрыт" : "План дня";
  const showWorkout = selectedDate === today && (active || workoutHabits.length > 0);
  const setsPlanned = template ? template.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0) : 0;
  return <main className="shell appPage todayPage">
    <PageHeader eyebrow={format(selectedDate, { day: "numeric", month: "long" })} title={selectedDate === today ? "Сегодня" : "Выбранный день"} />
    {storageError && <Notice tone="warning">{storageError}</Notice>}
    <WeekStrip dates={dates} today={today} selected={selectedDate} active={activeDates} onSelect={setSelectedDate} />
    {selectedDate !== today && <Button size="sm" onClick={() => setSelectedDate(today)}>Вернуться к сегодня</Button>}
    {showWorkout && <Card tone="accent" className="heroCard">
      <div className="heroText">
        <span className="heroEyebrow"><Dumbbell size={16} />{active ? "Тренировка идёт" : "Тренировка сегодня"}</span>
        <h2>{activeWorkout?.title ?? template?.title ?? workoutHabits[0]?.title ?? "Тренировка"}</h2>
        <p>{active ? "Продолжить с того места, где остановились." : template ? `${template.exercises.length} ${russianWord(template.exercises.length, "упражнение", "упражнения", "упражнений")} · ${setsPlanned} подходов по плану` : "Выберите программу"}</p>
      </div>
      {active
        ? <Link className="btn btn-primary btn-lg btn-block" href={`/workout/${active.id}`}><Play size={22} />Продолжить тренировку</Link>
        : template
          ? <Button variant="primary" size="lg" block icon={Play} onClick={() => void start(template.id)}>Начать тренировку</Button>
          : <Link className="btn btn-primary btn-lg btn-block" href="/workouts">Выбрать программу<ArrowRight size={22} /></Link>}
    </Card>}
    <section className="ringsRow" aria-label="Прогресс">
      <Card pad className="ringCard"><Ring size={88} stroke={8} value={completed} max={Math.max(1, habits.length)} ok={habits.length > 0 && completed === habits.length} label={`${completed}/${habits.length}`} sub="привычки" /></Card>
      <Card pad className="ringCard"><Ring size={88} stroke={8} value={finished} max={goal} ok={finished >= goal} label={`${finished}/${goal}`} sub="неделя" /></Card>
      <Link href="/calendar" className="card card-pad ringCard"><Ring size={88} stroke={8} value={streaks.current} max={nextMilestone} label={streaks.current} sub="дн. подряд" /></Link>
    </section>
    {!habits.length
      ? <EmptyState title={selectedDate === today ? "Ваш ритм дня" : "В этот день привычек нет"} action={selectedDate === today ? <Link className="btn btn-primary" href="/settings">Добавить привычки</Link> : undefined} />
      : <section className="actionSection">
        <div className="sectionHeading"><h2>{planTitle}</h2><span className="muted">{completed} из {habits.length} выполнено</span></div>
        <div className="habitList">{habits.map((habit) => <HabitRow key={habit.id} habit={habit} state={state} date={selectedDate} today={today} update={update} />)}</div>
      </section>}
    {selectedDate !== today && workoutHabits.length > 0 && <Link className="card card-pad linkRow" href="/workouts"><span><strong>Тренировки</strong><small>Открыть программы</small></span><ArrowRight size={18} /></Link>}
    {sleep != null && <p className="muted">Сон по отметкам: {sleep} ч.</p>}
    {checkInDue && <Link className="card card-pad linkRow" href="/progress"><span><strong>Как самочувствие?</strong><small>Короткая отметка за сегодня</small></span><ArrowRight size={18} /></Link>}
    {(streaks.current > 0 || completedDays > 0) && <Link className="card card-pad linkRow" href="/calendar"><Flame size={20} className="accentIcon" /><span><strong>{streaks.current > 0 ? `Серия: ${streaks.current} ${russianWord(streaks.current, "день", "дня", "дней")} подряд` : "Серия начнётся с закрытого дня"}</strong><small>Лучшая серия: {streaks.longest}. Закрытых дней: {completedDays}. Цель: {nextMilestone}.</small></span><ArrowRight size={18} /></Link>}
    <AppNav active="today" />
    {dialog}
  </main>;
}
