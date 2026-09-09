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
import { useEffect, useState } from "react";
import {
  applyHabitCompletion,
  completeWorkoutSet,
  calculateWorkoutTotals,
  getMilestoneState,
  getLocalDate,
  normalizeDecimalInput,
  parseWorkoutNotes,
  restoreRestTimer,
  type ExerciseSet,
} from "@/lib/tracker";
import { readStateSafely, writeState, type TrackerState } from "@/lib/storage";

const today = () => getLocalDate();

export default function Home() {
  const [state, setState] = useState<TrackerState | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [storageMessage, setStorageMessage] = useState("");
  const [activeTab, setActiveTab] = useState<"today" | "gym" | "progress">("today");
  const [notes, setNotes] = useState("09.09.2026\nЖим в тренажере\n20x5, 30x3, 40x1, 45x8, 45x8\nБабочка посадка 6 ручки 3\n30x12, 35 в отказ");
  const [timerNow, setTimerNow] = useState(() => new Date().toISOString());

  useEffect(() => {
    const result = readStateSafely();
    setState(result.state);
    setHydrated(true);
    setStorageReady(result.status === "empty" || result.status === "loaded");
    if (result.status === "corrupt" || result.status === "unsupported") {
      setStorageMessage(`${result.error ?? "Локальные данные требуют восстановления"}. Исходная запись сохранена.`);
    }
  }, []);

  useEffect(() => {
    if (hydrated && storageReady && state) {
      const result = writeState(state);
      if (!result.ok) setStorageMessage("Не удалось сохранить изменения на устройстве.");
    }
  }, [hydrated, storageReady, state]);

  useEffect(() => {
    const id = window.setInterval(() => setTimerNow(new Date().toISOString()), 1000);
    return () => window.clearInterval(id);
  }, []);

  if (!state) {
    return <main className="shell"><section className="panel"><p className="muted">Читаю сохраненные данные…</p></section></main>;
  }

  const currentWorkout = state.workouts.find((workout) => workout.id === state.activeWorkoutId) ?? state.workouts[0];
  const totals = calculateWorkoutTotals(currentWorkout);
  const chiaMilestone = getMilestoneState(state.completions, "chia", 5);
  const rest = state.activeTimer ? restoreRestTimer(state.activeTimer, timerNow) : null;
  const completedToday = state.completions.filter((item) => item.localDate === today()).length;
  const nextHabit = state.habits.find((habit) => !state.completions.some((item) => item.habitId === habit.id && item.localDate === today()));

  function update(mutator: (state: TrackerState) => TrackerState) {
    setState((previous) => previous ? mutator(previous) : previous);
  }

  function completeHabit(habitId: string) {
    const now = new Date().toISOString();
    update((previous) => {
      if (previous.completions.some((item) => item.habitId === habitId && item.localDate === today())) return previous;
      return {
        ...previous,
        completions: applyHabitCompletion(previous.completions, {
          id: `${habitId}-${today()}`,
          habitId,
          completedAt: now,
          localDate: today(),
          source: "web",
        }),
        outbox: [...previous.outbox, { id: `out-${habitId}-${today()}`, entityId: `${habitId}:${today()}`, type: "habit.completed", createdAt: now, status: "pending", version: 1 }],
      };
    });
  }

  function toggleSet(exerciseId: string, setId: string) {
    const now = new Date().toISOString();
    update((previous) => {
      const session = completeWorkoutSet({ workout: currentWorkout, commands: previous.workoutCommands ?? [], activeTimer: previous.activeTimer }, exerciseId, setId, `set-${currentWorkout.id}-${exerciseId}-${setId}`, now);
      if (session.workout === currentWorkout) return previous;
      const command = session.commands.at(-1);
      return {
        ...previous,
        workouts: previous.workouts.map((workout) => workout.id === currentWorkout.id ? session.workout : workout),
        workoutCommands: session.commands,
        activeTimer: session.activeTimer,
        outbox: command ? [...previous.outbox, { id: `out-${command.id}`, entityId: command.entityId, type: "workout.set.completed", createdAt: now, status: "pending", version: 1, payload: command.payload }] : previous.outbox,
      };
    });
  }

  function updateSet(exerciseId: string, setId: string, patch: Partial<ExerciseSet>) {
    update((previous) => ({
      ...previous,
      workouts: previous.workouts.map((workout) => workout.id === currentWorkout.id ? {
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
    if (!notes.trim() || !imported.id || imported.exercises.length === 0) return;
    update((previous) => {
      if (previous.workouts.some((workout) => workout.id === imported.id)) return previous;
      return {
        ...previous,
        workouts: [...previous.workouts, imported],
        outbox: [
          ...previous.outbox,
          { id: `out-import-${Date.now()}`, type: "workout.saved", createdAt: new Date().toISOString(), status: "pending" },
        ],
      };
    });
  }

  function startTimer(durationSec: number) {
    const now = new Date();
    update((previous) => ({
      ...previous,
      activeTimer: { startedAt: now.toISOString(), endsAt: new Date(now.getTime() + durationSec * 1000).toISOString(), durationSec, status: "running", version: (previous.activeTimer?.version ?? 0) + 1 },
      outbox: [
        ...previous.outbox,
        { id: `timer-${Date.now()}`, type: "timer.started", createdAt: now.toISOString(), status: "pending", version: 1 },
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

      {storageMessage && <p className="storageMessage" role="status">{storageMessage}</p>}

      <section className="statusBand">
        <div>
          <span>Отмечено</span>
          <strong>{completedToday} из {state.habits.length}</strong>
        </div>
        <div>
          <span>Объём тренировки</span>
          <strong>{totals.volumeKg.toLocaleString("ru-RU")} кг</strong>
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
              return (
                <div className="exercise" key={exercise.id}>
                  <div className="exerciseHead">
                    <div>
                      <h3>{exercise.name}</h3>
                      {exercise.settings && <p>{exercise.settings}</p>}
                    </div>
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
                          onChange={(event) => updateSet(exercise.id, set.id, { weightKg: normalizeDecimalInput(event.target.value) })}
                        />
                        <span>кг</span>
                        <input
                          aria-label="Повторы"
                          inputMode="numeric"
                          value={set.reps ?? ""}
                          onChange={(event) => updateSet(exercise.id, set.id, { reps: event.target.value === "" ? null : (/^\d+$/.test(event.target.value) ? Number(event.target.value) : set.reps) })}
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
                    <strong>{weekCount(state, index)}</strong>
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

function weekCount(state: TrackerState, index: number) {
  const now = new Date();
  const day = (now.getDay() + 6) % 7;
  const target = new Date(now);
  target.setDate(now.getDate() - day + index);
  const date = getLocalDate(target);
  const habits = state.completions.filter((item) => item.localDate === date).length;
  const workouts = state.workouts.filter((workout) => workout.date === date && calculateWorkoutTotals(workout).completedSets > 0).length;
  return habits + workouts;
}
