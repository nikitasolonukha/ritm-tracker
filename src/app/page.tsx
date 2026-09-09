"use client";

import {
  Activity,
  Bell,
  Check,
  ChevronRight,
  Dumbbell,
  Flame,
  Moon,
  Pause,
  Pill,
  RefreshCcw,
  Save,
  Timer,
  Upload,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  applyHabitCompletion,
  calculateWorkoutTotals,
  getMilestoneState,
  parseWorkoutNotes,
  restoreRestTimer,
  suggestNextLoad,
  type ExerciseSet,
} from "@/lib/tracker";
import { createInitialState, readState, writeState, type TrackerState } from "@/lib/storage";

const today = () => new Date().toISOString().slice(0, 10);

export default function Home() {
  const [state, setState] = useState<TrackerState>(() => createInitialState());
  const [activeTab, setActiveTab] = useState<"today" | "gym" | "progress">("today");
  const [notes, setNotes] = useState("09.09.2026\nЖим в тренажере\n20x5, 30x3, 40x1, 45x8, 45x8\nБабочка посадка 6 ручки 3\n30x12, 35 в отказ");
  const [timerNow, setTimerNow] = useState(() => new Date().toISOString());

  useEffect(() => {
    setState(readState());
  }, []);

  useEffect(() => {
    writeState(state);
  }, [state]);

  useEffect(() => {
    const id = window.setInterval(() => setTimerNow(new Date().toISOString()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const currentWorkout = state.workouts[0];
  const totals = useMemo(() => calculateWorkoutTotals(currentWorkout), [currentWorkout]);
  const chiaMilestone = getMilestoneState(state.completions, "chia", 5);
  const rest = state.activeTimer ? restoreRestTimer(state.activeTimer, timerNow) : null;
  const completedToday = state.completions.filter((item) => item.localDate === today()).length;
  const nextHabit = state.habits.find((habit) => !state.completions.some((item) => item.habitId === habit.id && item.localDate === today()));

  function update(mutator: (state: TrackerState) => TrackerState) {
    setState((previous) => mutator(previous));
  }

  function completeHabit(habitId: string) {
    const now = new Date().toISOString();
    update((previous) => ({
      ...previous,
      completions: applyHabitCompletion(previous.completions, {
        id: `${habitId}-${today()}`,
        habitId,
        completedAt: now,
        localDate: today(),
        source: "web",
      }),
      outbox: [
        ...previous.outbox,
        { id: `out-${habitId}-${now}`, type: "habit.completed", createdAt: now, status: "pending" },
      ],
    }));
  }

  function toggleSet(exerciseId: string, setId: string) {
    update((previous) => ({
      ...previous,
      workouts: previous.workouts.map((workout, index) => index === 0 ? {
        ...workout,
        exercises: workout.exercises.map((exercise) => exercise.id === exerciseId ? {
          ...exercise,
          sets: exercise.sets.map((set) => set.id === setId ? { ...set, completed: !set.completed } : set),
        } : exercise),
      } : workout),
    }));
  }

  function updateSet(exerciseId: string, setId: string, patch: Partial<ExerciseSet>) {
    update((previous) => ({
      ...previous,
      workouts: previous.workouts.map((workout, index) => index === 0 ? {
        ...workout,
        exercises: workout.exercises.map((exercise) => exercise.id === exerciseId ? {
          ...exercise,
          sets: exercise.sets.map((set) => set.id === setId ? { ...set, ...patch } : set),
        } : exercise),
      } : workout),
    }));
  }

  function importNotes() {
    const imported = parseWorkoutNotes(notes);
    update((previous) => {
      if (previous.workouts.some((workout) => workout.id === imported.id)) return previous;
      return {
        ...previous,
        workouts: [imported, ...previous.workouts],
        outbox: [
          ...previous.outbox,
          { id: `out-import-${Date.now()}`, type: "workout.saved", createdAt: new Date().toISOString(), status: "pending" },
        ],
      };
    });
  }

  function startTimer(durationSec: number) {
    update((previous) => ({
      ...previous,
      activeTimer: { startedAt: new Date().toISOString(), durationSec },
      outbox: [
        ...previous.outbox,
        { id: `timer-${Date.now()}`, type: "timer.started", createdAt: new Date().toISOString(), status: "pending" },
      ],
    }));
  }

  return (
    <main className="shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">Ритм</p>
          <h1>Сегодняшний план</h1>
        </div>
        <button className="iconButton" aria-label="Проверить напоминания" title="Проверить напоминания">
          <Bell size={20} />
        </button>
      </section>

      <section className="statusBand">
        <div>
          <span>Отмечено</span>
          <strong>{completedToday} из {state.habits.length}</strong>
        </div>
        <div>
          <span>Объём тренировки</span>
          <strong>{totals.volumeKg.toLocaleString("ru-RU")} кг</strong>
        </div>
        <div>
          <span>Очередь sync</span>
          <strong>{state.outbox.filter((item) => item.status === "pending").length}</strong>
        </div>
      </section>

      <nav className="tabs" aria-label="Разделы">
        <button className={activeTab === "today" ? "active" : ""} onClick={() => setActiveTab("today")}>Сегодня</button>
        <button className={activeTab === "gym" ? "active" : ""} onClick={() => setActiveTab("gym")}>Зал</button>
        <button className={activeTab === "progress" ? "active" : ""} onClick={() => setActiveTab("progress")}>Прогресс</button>
      </nav>

      {activeTab === "today" && (
        <section className="grid">
          <article className="panel current">
            <div className="panelTitle">
              <div>
                <p className="eyebrow">Сейчас</p>
                <h2>{nextHabit?.title ?? "План закрыт"}</h2>
              </div>
              <Activity size={22} />
            </div>
            <p className="muted">{nextHabit ? `Запланировано на ${nextHabit.schedule}. Одно нажатие создаёт одну запись за день.` : "Все пункты на сегодня отмечены."}</p>
            {nextHabit && (
              <button className="primary" onClick={() => completeHabit(nextHabit.id)}>
                <Check size={18} /> Отметить
              </button>
            )}
          </article>

          <article className="panel">
            <div className="panelTitle">
              <h2>План дня</h2>
              <ChevronRight size={20} />
            </div>
            <div className="habitList">
              {state.habits.map((habit) => {
                const done = state.completions.some((item) => item.habitId === habit.id && item.localDate === today());
                const Icon = habit.type === "medicine" ? Pill : habit.type === "workout" ? Dumbbell : habit.type === "sleep" ? Moon : Flame;
                return (
                  <button key={habit.id} className={`habitRow ${done ? "done" : ""}`} onClick={() => completeHabit(habit.id)}>
                    <Icon size={18} />
                    <span>{habit.title}</span>
                    <time>{habit.schedule}</time>
                    {done && <Check size={18} />}
                  </button>
                );
              })}
            </div>
          </article>

          <article className="panel">
            <div className="panelTitle">
              <h2>Контрольная точка</h2>
              <RefreshCcw size={20} />
            </div>
            <p className="large">{chiaMilestone.count}/5 дней</p>
            <p className="muted">{chiaMilestone.reached ? "Пять выполненных дней. Есть изменения? Можно добавить фото или заметку." : "Считаются уникальные локальные дни, не количество нажатий."}</p>
            <div className="compactActions">
              <button>Лучше</button>
              <button>Без изменений</button>
              <button>Пропустить</button>
            </div>
          </article>
        </section>
      )}

      {activeTab === "gym" && (
        <section className="grid gymGrid">
          <article className="panel workoutPanel">
            <div className="panelTitle">
              <div>
                <p className="eyebrow">{currentWorkout.date}</p>
                <h2>{currentWorkout.title}</h2>
              </div>
              <Dumbbell size={22} />
            </div>

            {currentWorkout.exercises.map((exercise) => {
              const suggestion = suggestNextLoad(exercise.sets.map((set) => ({ ...set, date: currentWorkout.date })));
              return (
                <div className="exercise" key={exercise.id}>
                  <div className="exerciseHead">
                    <div>
                      <h3>{exercise.name}</h3>
                      {exercise.settings && <p>{exercise.settings}</p>}
                    </div>
                    {suggestion && <span className="hint">+2.5 кг</span>}
                  </div>
                  <div className="sets">
                    {exercise.sets.map((set) => (
                      <div className="setRow" key={set.id}>
                        <button className={set.completed ? "setDone" : ""} onClick={() => toggleSet(exercise.id, set.id)} aria-label="Отметить подход">
                          <Check size={16} />
                        </button>
                        <input
                          aria-label="Вес"
                          inputMode="decimal"
                          value={set.weightKg ?? ""}
                          onChange={(event) => updateSet(exercise.id, set.id, { weightKg: Number(event.target.value) || null })}
                        />
                        <span>кг</span>
                        <input
                          aria-label="Повторы"
                          inputMode="numeric"
                          value={set.reps ?? ""}
                          onChange={(event) => updateSet(exercise.id, set.id, { reps: Number(event.target.value) || null })}
                        />
                        <span>раз</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </article>

          <aside className="panel">
            <div className="panelTitle">
              <h2>Отдых</h2>
              <Timer size={20} />
            </div>
            <p className="timer">{rest ? formatTime(rest.remainingSec) : "00:00"}</p>
            <div className="timerActions">
              <button onClick={() => startTimer(180)}><Timer size={16} /> 180</button>
              <button onClick={() => startTimer(240)}><Timer size={16} /> 240</button>
              <button onClick={() => update((previous) => ({ ...previous, activeTimer: null }))}><Pause size={16} /> Стоп</button>
            </div>
            <div className="summary">
              <span>Подходы</span><strong>{totals.completedSets}</strong>
              <span>Не посчитано</span><strong>{totals.unscoredSets}</strong>
              <span>Упражнения</span><strong>{totals.exercises}</strong>
            </div>
          </aside>

          <article className="panel importer">
            <div className="panelTitle">
              <h2>Импорт заметок</h2>
              <Upload size={20} />
            </div>
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
            <button className="primary" onClick={importNotes}><Save size={18} /> Разобрать и сохранить</button>
          </article>
        </section>
      )}

      {activeTab === "progress" && (
        <section className="grid">
          <article className="panel wide">
            <div className="panelTitle">
              <h2>Неделя</h2>
              <Activity size={20} />
            </div>
            <div className="weekStrip">
              {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((day, index) => (
                <div className="day" key={day}>
                  <span>{day}</span>
                  <strong>{index < Math.min(completedToday, 7) ? completedToday : 0}</strong>
                </div>
              ))}
            </div>
          </article>

          <article className="panel">
            <h2>История тренировок</h2>
            <div className="history">
              {state.workouts.map((workout) => {
                const itemTotals = calculateWorkoutTotals(workout);
                return (
                  <div key={workout.id}>
                    <span>{workout.date}</span>
                    <strong>{itemTotals.volumeKg.toLocaleString("ru-RU")} кг</strong>
                  </div>
                );
              })}
            </div>
          </article>

          <article className="panel">
            <h2>Диагностика</h2>
            <p className="muted">Supabase и Telegram пока не подключены: локальные команды лежат в очереди и готовы к будущей синхронизации.</p>
            <p className="large">{state.outbox.length}</p>
          </article>
        </section>
      )}
    </main>
  );
}

function formatTime(totalSec: number) {
  const minutes = Math.floor(totalSec / 60).toString().padStart(2, "0");
  const seconds = (totalSec % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}
