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
import { createClient } from "@/lib/supabase/client";
import {
  applyHabitCompletion,
  completeWorkoutSet,
  calculateWorkoutTotals,
  getMilestoneState,
  getLocalDate,
  normalizeDecimalInput,
  parseWorkoutNotesBatch,
  restoreRestTimer,
  type ExerciseSet,
} from "@/lib/tracker";
import { readStateSafely, writeState, type TrackerState } from "@/lib/storage";

const today = () => getLocalDate();

export default function Home() {
  const [state, setState] = useState<TrackerState | null>(null);
  const [userId, setUserId] = useState<string>();
  const [hydrated, setHydrated] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [syncReady, setSyncReady] = useState(false);
  const [storageMessage, setStorageMessage] = useState("");
  const [activeTab, setActiveTab] = useState<"today" | "gym" | "progress" | "settings">("today");
  const [notes, setNotes] = useState("01.01.2026\nУпражнение A\n10x5, 15x3, 20x8\nУпражнение B\n12x10");
  const [timerNow, setTimerNow] = useState(() => new Date().toISOString());

  useEffect(() => {
    let cancelled = false;
    void createClient().auth.getUser().then(async ({ data }) => {
      if (cancelled) return;
      const id = data.user?.id;
      setUserId(id);
      const result = readStateSafely(id);
      let nextState = result.state;
      try {
        const remoteResponse = await fetch("/api/sync", { cache: "no-store" });
        if (remoteResponse.ok) {
          const remote = await remoteResponse.json() as { payload?: TrackerState | null };
          if (result.status === "empty" && remote.payload && typeof remote.payload === "object") nextState = remote.payload;
        }
      } catch {
        // Local state remains usable while the server is unavailable.
      }
      setState(nextState);
      setHydrated(true);
      setStorageReady(result.status === "empty" || result.status === "loaded");
      setSyncReady(true);
      if (result.status === "corrupt" || result.status === "unsupported") setStorageMessage(`${result.error ?? "Локальные данные требуют восстановления"}. Исходная запись сохранена.`);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (hydrated && storageReady && syncReady && state) {
      const result = writeState(state, userId);
      if (!result.ok) setStorageMessage("Не удалось сохранить изменения на устройстве.");
      void fetch("/api/sync", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ payload: state, version: state.version }) }).then((response) => {
        if (!response.ok) setStorageMessage("Сохранено на устройстве; синхронизация пока недоступна.");
      }).catch(() => setStorageMessage("Сохранено на устройстве; синхронизация пока недоступна."));
    }
  }, [hydrated, storageReady, syncReady, state, userId]);

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
  const nextHabit = state.habits.find((habit) => habit.type !== "workout" && !state.completions.some((item) => item.habitId === habit.id && item.localDate === today()));

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
      const workout = previous.workouts.find((item) => item.id === previous.activeWorkoutId) ?? previous.workouts[0];
      if (!workout) return previous;
      const session = completeWorkoutSet({ workout, commands: previous.workoutCommands ?? [], activeTimer: previous.activeTimer }, exerciseId, setId, `set-${workout.id}-${exerciseId}-${setId}`, now);
      if (session.workout === workout) return previous;
      const command = session.commands.at(-1);
      return {
        ...previous,
        workouts: previous.workouts.map((item) => item.id === workout.id ? session.workout : item),
        workoutCommands: session.commands,
        activeTimer: session.activeTimer,
        outbox: command ? [...previous.outbox, { id: `out-${command.id}`, entityId: command.entityId, type: "workout.set.completed", createdAt: now, status: "pending", version: 1, payload: command.payload }] : previous.outbox,
      };
    });
  }

  function updateSet(exerciseId: string, setId: string, patch: Partial<ExerciseSet>) {
    update((previous) => ({
      ...previous,
      workouts: previous.workouts.map((workout) => workout.id === previous.activeWorkoutId ? {
        ...workout,
        exercises: workout.exercises.map((exercise) => exercise.id === exerciseId ? {
          ...exercise,
          sets: exercise.sets.map((set) => set.id === setId ? { ...set, ...patch } : set),
        } : exercise),
      } : workout),
    }));
  }

  function addExercise() {
    update((previous) => {
      const workout = previous.workouts.find((item) => item.id === previous.activeWorkoutId);
      if (!workout) return previous;
      const id = `exercise-${Date.now()}`;
      return { ...previous, workouts: previous.workouts.map((item) => item.id !== workout.id ? item : { ...item, exercises: [...item.exercises, { id, name: "Новое упражнение", category: "working", restSec: 180, sets: [{ id: `${id}-set-1`, weightKg: null, reps: null, completed: false, weightMode: "total" }] }] }) };
    });
  }

  function addSet(exerciseId: string) {
    update((previous) => ({ ...previous, workouts: previous.workouts.map((workout) => workout.id !== previous.activeWorkoutId ? workout : { ...workout, exercises: workout.exercises.map((exercise) => exercise.id !== exerciseId ? exercise : { ...exercise, sets: [...exercise.sets, { id: `${exercise.id}-set-${exercise.sets.length + 1}-${Date.now()}`, weightKg: null, reps: null, completed: false, weightMode: "total" }] }) }) }));
  }

  function updateHabit(habitId: string, patch: { title?: string; schedule?: string }) {
    update((previous) => ({ ...previous, habits: previous.habits.map((habit) => habit.id === habitId ? { ...habit, ...patch } : habit) }));
  }

  function commitSetField(exerciseId: string, setId: string, field: "weight" | "reps") {
    update((previous) => {
      const workout = previous.workouts.find((item) => item.id === previous.activeWorkoutId);
      const set = workout?.exercises.find((item) => item.id === exerciseId)?.sets.find((item) => item.id === setId);
      if (!workout || !set) return previous;
      const raw = field === "weight" ? set.weightDraft ?? "" : set.repsDraft ?? "";
      const value = field === "weight" ? normalizeDecimalInput(raw) : (/^\d+$/.test(raw.trim()) ? Number(raw) : null);
      if (raw.trim() && value == null) return previous;
      return {
        ...previous,
        workouts: previous.workouts.map((item) => item.id !== workout.id ? item : {
          ...item,
          exercises: item.exercises.map((exercise) => exercise.id !== exerciseId ? exercise : {
            ...exercise,
            sets: exercise.sets.map((entry) => entry.id !== setId ? entry : {
              ...entry,
              ...(field === "weight" ? { weightKg: value } : { reps: value }),
              ...(field === "weight" ? { weightDraft: undefined } : { repsDraft: undefined }),
            }),
          }),
        }),
      };
    });
  }

  function importNotes() {
    const imported = parseWorkoutNotesBatch(notes);
    if (!notes.trim() || imported.length === 0) return;
    update((previous) => {
      const fresh = imported.filter((item) => !previous.workouts.some((workout) => workout.id === item.id));
      if (fresh.length === 0) return previous;
      return {
        ...previous,
        workouts: [...previous.workouts, ...fresh],
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
        <button className={activeTab === "settings" ? "active" : ""} onClick={() => setActiveTab("settings")}>Настройки</button>
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
              {state.habits.filter((habit) => habit.type !== "workout").map((habit) => {
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
                          value={set.weightDraft ?? (set.weightKg ?? "")}
                          onChange={(event) => updateSet(exercise.id, set.id, { weightDraft: event.target.value })}
                          onBlur={() => commitSetField(exercise.id, set.id, "weight")}
                        />
                        <span>кг</span>
                        <input
                          aria-label="Повторы"
                          inputMode="numeric"
                          value={set.repsDraft ?? (set.reps ?? "")}
                          onChange={(event) => updateSet(exercise.id, set.id, { repsDraft: event.target.value })}
                          onBlur={() => commitSetField(exercise.id, set.id, "reps")}
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

      {activeTab === "settings" && (
        <section className="grid settingsGrid">
          <article className="panel wide">
            <div className="panelTitle"><h2>Действия дня</h2><Activity size={20} /></div>
            <div className="settingsList">
              {state.habits.filter((habit) => habit.type !== "workout").map((habit) => <div className="settingRow" key={habit.id}>
                <input aria-label={`Название ${habit.id}`} value={habit.title} onChange={(event) => updateHabit(habit.id, { title: event.target.value })} />
                <input aria-label={`Расписание ${habit.id}`} value={habit.schedule} onChange={(event) => updateHabit(habit.id, { schedule: event.target.value })} />
              </div>)}
            </div>
          </article>
          <article className="panel wide">
            <div className="panelTitle"><h2>Шаблон тренировки</h2><Dumbbell size={20} /></div>
            <button className="secondary" onClick={addExercise}><Save size={16} /> Добавить упражнение</button>
            {(state.workouts.find((workout) => workout.id === state.activeWorkoutId) ?? currentWorkout).exercises.map((exercise) => <div className="settingExercise" key={exercise.id}>
              <input aria-label={`Упражнение ${exercise.id}`} value={exercise.name} onChange={(event) => update((previous) => ({ ...previous, workouts: previous.workouts.map((workout) => workout.id !== previous.activeWorkoutId ? workout : { ...workout, exercises: workout.exercises.map((item) => item.id === exercise.id ? { ...item, name: event.target.value } : item) }) }))} />
              <select aria-label={`Отдых ${exercise.id}`} value={exercise.restSec ?? 180} onChange={(event) => update((previous) => ({ ...previous, workouts: previous.workouts.map((workout) => workout.id !== previous.activeWorkoutId ? workout : { ...workout, exercises: workout.exercises.map((item) => item.id === exercise.id ? { ...item, restSec: Number(event.target.value) as 180 | 240 } : item) }) }))}>
                <option value="180">180 сек</option><option value="240">240 сек</option>
              </select>
              <button className="secondary" onClick={() => addSet(exercise.id)}>+ подход</button>
              <span className="muted">{exercise.sets.length} подходов</span>
            </div>)}
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
