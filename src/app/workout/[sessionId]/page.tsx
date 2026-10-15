"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Bell, BellOff, Check, ChevronRight, Clock, History, MoreHorizontal, Play, Plus, SkipForward, Square, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, Chip, IconButton, Segmented, Sheet, Stepper } from "@/components/ds";
import { useTrackerState } from "@/components/tracker-state";
import { ExercisePhoto } from "@/components/exercise-photo";
import { useRestAlert } from "@/components/use-rest-alert";
import { useWakeLock } from "@/components/use-wake-lock";
import { Notice, useConfirm } from "@/components/ui";
import { formatSets, lastPerformance } from "@/lib/exercises";
import { createRestTimerCommand, formatLocalDate, restoreRestTimer, visibleCopy, type Exercise, type ExerciseSet } from "@/lib/tracker";
import { cancelWorkoutSession, finishWorkoutSession, type SessionTrackerState } from "@/lib/workout-session";
import { addExtraSet, currentLogicalSet, goToExercise, logicalSets, parseRepsInput, parseWeightInput, recordLogicalSet, setSetWeight, type WeightScope } from "@/lib/workout-flow";

const WEIGHT_STEP = 2.5;
const formatTime = (value: number) => `${Math.floor(value / 60).toString().padStart(2, "0")}:${(value % 60).toString().padStart(2, "0")}`;
const kgText = (value: number | null | undefined) => (value == null ? "—" : String(value));
const unitOf = (set: ExerciseSet) => set.weightMode === "per-hand" ? "кг на сторону" : set.weightMode === "total" ? "кг общий вес" : "кг";

const sideName = (label: "A" | "B" | null) => label === "A" ? "Правая" : label === "B" ? "Левая" : "";
const sideSuffix = (label: "A" | "B" | null) => label ? ` ${sideName(label).toLowerCase()}` : "";

type NumberHandlers = {
  weightEditing: boolean;
  weightText: string;
  onWeightStep: (delta: number) => void;
  onWeightStartEdit: () => void;
  onWeightText: (value: string) => void;
  onWeightCommit: () => void;
};

function WeightField({ weight, unit, suffix, weightEditing, weightText, onWeightStep, onWeightStartEdit, onWeightText, onWeightCommit, title = "Вес" }: NumberHandlers & { weight: number | null | undefined; unit: string; suffix: string; title?: string }) {
  return <div className="wkField workWeight">
    <span className="wkFieldName">{title}</span>
    <Stepper minusLabel={`Уменьшить вес${suffix}`} plusLabel={`Увеличить вес${suffix}`} minusDisabled={(weight ?? 0) <= 0} onMinus={() => onWeightStep(-WEIGHT_STEP)} onPlus={() => onWeightStep(WEIGHT_STEP)}>
      {weightEditing
        ? <input autoFocus aria-label={`Вес${suffix}`} inputMode="decimal" value={weightText} onChange={(event) => onWeightText(event.target.value)} onBlur={onWeightCommit} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
        : <button type="button" className="stepperValueBtn" aria-label={`Ввести вес${suffix} числом`} onClick={onWeightStartEdit}><strong>{kgText(weight)}</strong></button>}
      <small>{unit}</small>
    </Stepper>
  </div>;
}

function RepsField({ set, label, reps, onRepsText, onRepsStep, title = "Повторы" }: { set: ExerciseSet; label: "A" | "B" | null; reps: string; onRepsText: (value: string) => void; onRepsStep: (delta: number) => void; title?: string }) {
  const repsNumber = Number(reps || 0);
  return <div className="wkField">
    <span className="wkFieldName">{title}</span>
    <div className="repsControl">
      <Stepper minusLabel={`Уменьшить повторы${sideSuffix(label)}`} plusLabel={`Увеличить повторы${sideSuffix(label)}`} minusDisabled={repsNumber <= 1} plusDisabled={repsNumber >= 100} onMinus={() => onRepsStep(-1)} onPlus={() => onRepsStep(1)}>
        <input autoComplete="off" aria-label={`Фактические повторы${sideSuffix(label)}`} inputMode="numeric" value={reps} placeholder={`${set.reps ?? "—"}`} onChange={(event) => onRepsText(event.target.value)} />
        <small>план: {set.reps ?? "не задан"}</small>
      </Stepper>
    </div>
  </div>;
}

/** Обычный подход или одна сторона пары, когда у сторон разный вес. */
function PartEditor({ set, label, reps, onRepsText, onRepsStep, ...weight }: NumberHandlers & { set: ExerciseSet; label: "A" | "B" | null; reps: string; onRepsText: (value: string) => void; onRepsStep: (delta: number) => void }) {
  return <div className={`wkPart${label ? "" : " single"}`}>
    {label ? <div className="wkPartLabel"><span className="wkPartBadge">{label === "A" ? "П" : "Л"}</span>{sideName(label)} сторона</div> : null}
    <div className="wkFields">
      <WeightField weight={set.weightKg} unit={unitOf(set)} suffix={sideSuffix(label)} {...weight} />
      <RepsField set={set} label={label} reps={reps} onRepsText={onRepsText} onRepsStep={onRepsStep} />
    </div>
  </div>;
}

/** Пара «правая, затем левая» с одинаковым весом: один вес на обе стороны и повторы для каждой. */
function PairEditor({ parts, reps, onRepsText, onRepsStep, ...weight }: NumberHandlers & { parts: Array<{ set: ExerciseSet; label: "A" | "B" | null }>; reps: Record<string, string>; onRepsText: (setId: string, value: string) => void; onRepsStep: (setId: string, delta: number) => void }) {
  return <div className="wkPart single">
    <div className="wkFields">
      <div className="wkWide"><WeightField weight={parts[0].set.weightKg} unit={`${unitOf(parts[0].set)} · обе стороны`} suffix="" {...weight} /></div>
      {parts.map((part) => <RepsField key={part.set.id} set={part.set} label={part.label} title={`Повторы · ${sideName(part.label).toLowerCase()}`} reps={reps[part.set.id] ?? ""} onRepsText={(value) => onRepsText(part.set.id, value)} onRepsStep={(delta) => onRepsStep(part.set.id, delta)} />)}
    </div>
  </div>;
}

export default function ActiveWorkoutPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const router = useRouter();
  const { state, update, userId, syncStatus, storageError } = useTrackerState();
  const { confirm, dialog } = useConfirm();
  const [routeSessionId, setRouteSessionId] = useState<string>();
  const [now, setNow] = useState(() => new Date().toISOString());
  const [reps, setReps] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState("");
  const [scope, setScope] = useState<WeightScope>("this");
  const [remember, setRemember] = useState(false);
  const [editingWeightId, setEditingWeightId] = useState<string | null>(null);
  const [weightText, setWeightText] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const initKey = useRef<string | undefined>(undefined);
  const tabsRef = useRef<HTMLDivElement>(null);

  useEffect(() => { void params.then(({ sessionId }) => setRouteSessionId(sessionId)); }, [params]);
  useEffect(() => { const id = window.setInterval(() => setNow(new Date().toISOString()), 1000); return () => window.clearInterval(id); }, []);

  const sessionState = state as SessionTrackerState | null;
  const alertTimer = sessionState?.activeTimer;
  const { soundOn, setSoundOn, unlock } = useRestAlert(alertTimer ? `${alertTimer.sourceId}:${alertTimer.version}` : undefined, Boolean(alertTimer && restoreRestTimer(alertTimer, now).expired));
  useWakeLock(Boolean(sessionState?.workoutSessions?.some((item) => item.id === routeSessionId && item.status === "active")));
  const session = sessionState?.workoutSessions?.find((item) => item.id === routeSessionId);
  const workout = session && sessionState?.workouts.find((item) => item.id === session.workoutId);
  const exercise: Exercise | undefined = workout ? workout.exercises[session!.activeExerciseIndex] ?? workout.exercises[0] : undefined;
  const groups = exercise ? logicalSets(exercise) : [];
  const current = exercise ? currentLogicalSet(exercise) : undefined;
  const currentKey = session && exercise ? `${session.id}:${exercise.id}:${current?.key ?? "done"}` : undefined;
  const draftPrefix = `ritm-workout-draft:${userId}:`;

  // Новый подход на экране: подтягиваем черновики повторов и сбрасываем «только для этого подхода».
  useEffect(() => {
    if (!currentKey || initKey.current === currentKey) return;
    initKey.current = currentKey;
    const next: Record<string, string> = {};
    for (const part of current?.parts ?? []) {
      let stored: string | null = null;
      try { stored = window.localStorage.getItem(`${draftPrefix}${part.set.id}`); } catch { /* private mode */ }
      next[part.set.id] = stored ?? part.set.repsDraft ?? (part.set.reps == null ? "" : String(part.set.reps));
    }
    setReps(next); setTouched(false); setError(""); setScope("this"); setRemember(false); setEditingWeightId(null);
  }, [currentKey, current, draftPrefix]);

  useEffect(() => {
    if (!touched) return;
    for (const [setId, value] of Object.entries(reps)) { try { window.localStorage.setItem(`${draftPrefix}${setId}`, value); } catch { /* local state is the fallback */ } }
  }, [reps, touched, draftPrefix]);

  useEffect(() => {
    const active = tabsRef.current?.querySelector<HTMLElement>("[aria-current='true']");
    active?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [session?.activeExerciseIndex]);

  if (!state || !sessionState) return <main className="wk"><p className="muted">Восстанавливаю тренировку…</p></main>;
  if (!session || !workout || !exercise) return <main className="wk"><p>Сессия не найдена.</p><Link className="btn btn-secondary" href="/workouts">Вернуться к программам</Link></main>;
  if (session.status !== "active") return <main className="wk"><p>Эта сессия уже закрыта.</p><Link className="btn btn-secondary" href={`/workout/${session.id}/summary`}>Открыть результат</Link></main>;

  const previous = lastPerformance(sessionState, exercise.name, workout.id);
  const exerciseDone = groups.length > 0 && groups.every((group) => group.completed);
  const isLastExercise = session.activeExerciseIndex >= workout.exercises.length - 1;
  const hasRecorded = workout.exercises.some((item) => item.sets.some((set) => set.completed));
  const rest = sessionState.activeTimer && sessionState.activeTimer.sourceId?.startsWith(`${workout.id}:`) ? restoreRestTimer(sessionState.activeTimer, now) : null;
  const restSetId = sessionState.activeTimer?.sourceId?.split(":").at(-1);
  const restSet = restSetId ? workout.exercises.flatMap((item) => item.sets).find((set) => set.id === restSetId) : undefined;
  const elapsed = Math.max(0, Math.floor((Date.parse(now) - Date.parse(session.startedAt)) / 1000));
  const currentIndex = current ? groups.findIndex((group) => group.key === current.key) : groups.length;
  const restRunning = Boolean(rest && !rest.expired);

  const setRepsFor = (setId: string, value: string) => { setTouched(true); setReps((previousReps) => ({ ...previousReps, [setId]: value })); };
  const stepReps = (setId: string, delta: number) => setRepsFor(setId, String(Math.max(1, Math.min(100, Number(reps[setId] || 0) + delta))));
  const stepWeight = (set: ExerciseSet, delta: number) => {
    const next = Math.max(0, Math.round(((set.weightKg ?? 0) + delta) * 100) / 100);
    update((previousState) => setSetWeight(previousState as SessionTrackerState, session.id, exercise.id, set.id, next, { scope, remember }));
  };
  const incompleteParts = current ? current.parts.filter((part) => !part.set.completed) : [];
  const sharedWeight = incompleteParts.length === 2 && incompleteParts[0].set.weightKg === incompleteParts[1].set.weightKg;
  const applyWeightToParts = (kg: number) => update((previousState) => incompleteParts.reduce((acc, part) => setSetWeight(acc, session.id, exercise.id, part.set.id, kg, { scope, remember }), previousState as SessionTrackerState));
  const stepSharedWeight = (delta: number) => applyWeightToParts(Math.max(0, Math.round(((incompleteParts[0]?.set.weightKg ?? 0) + delta) * 100) / 100));
  const commitSharedWeight = () => {
    const value = parseWeightInput(weightText);
    setEditingWeightId(null);
    if (value == null) { if (weightText.trim()) setError("Укажите вес числом, например 12,5."); return; }
    setError("");
    applyWeightToParts(value);
  };
  const addSet = () => { setMenuOpen(false); update((previousState) => addExtraSet(previousState as SessionTrackerState, session.id, exercise.id)); };
  // «Как в прошлый раз»: вес каждой стороны из такого же подхода прошлой тренировки.
  const lastWeights = incompleteParts.map((part) => ({ part, weight: previous?.sets[part.index]?.weightKg ?? null }));
  const lastWeightHint = lastWeights.find((item) => item.weight != null && item.weight !== item.part.set.weightKg);
  const applyLastWeights = () => update((previousState) => lastWeights.reduce((acc, item) => item.weight == null ? acc : setSetWeight(acc, session.id, exercise.id, item.part.set.id, item.weight, { scope: "this" }), previousState as SessionTrackerState));
  const startWeightEdit = (set: ExerciseSet) => { setEditingWeightId(set.id); setWeightText(set.weightKg == null ? "" : String(set.weightKg)); };
  const commitWeight = (set: ExerciseSet) => {
    const value = parseWeightInput(weightText);
    setEditingWeightId(null);
    if (value == null) { if (weightText.trim()) setError("Укажите вес числом, например 12,5."); return; }
    setError("");
    update((previousState) => setSetWeight(previousState as SessionTrackerState, session.id, exercise.id, set.id, value, { scope, remember }));
  };

  const record = () => {
    if (!current) return;
    unlock();
    const entries: Array<{ setId: string; reps: number }> = [];
    for (const part of current.parts) {
      if (part.set.completed) continue;
      const value = parseRepsInput(reps[part.set.id] ?? "");
      if (value == null) { setError(part.label ? `Повторы (${sideName(part.label).toLowerCase()}): целое число от 1 до 100.` : "Укажи целое число повторений от 1 до 100."); return; }
      entries.push({ setId: part.set.id, reps: value });
    }
    setError("");
    const saved = update((previousState) => recordLogicalSet(previousState as SessionTrackerState, session.id, exercise.id, entries));
    if (!saved) { setError("Не удалось сохранить подход. Черновик оставлен, повтори действие."); return; }
    for (const entry of entries) { try { window.localStorage.removeItem(`${draftPrefix}${entry.setId}`); } catch { /* ignore */ } }
    setTouched(false);
  };

  const changeRest = (action: "reschedule" | "cancel") => update((previousState) => {
    const next = previousState as SessionTrackerState;
    const timer = next.activeTimer;
    if (!timer) return previousState;
    const mutation = createRestTimerCommand(timer, action, new Date().toISOString(), `Ритм: отдых завершен после ${exercise.name}. Открой тренировку для следующего шага.`);
    if (!mutation) return previousState;
    const outbox = next.outbox.map((item) => item.entityId === timer.sourceId && ["timer.rescheduled", "timer.cancelled"].includes(item.type) && item.status === "pending" ? { ...item, status: "cancelled" as const } : item);
    return { ...next, activeTimer: mutation.timer, outbox: [...outbox, mutation.command] };
  });

  const collapse = () => {
    const saved = touched && current
      ? update((previousState) => ({ ...previousState, workouts: previousState.workouts.map((item) => item.id !== workout.id ? item : { ...item, exercises: item.exercises.map((itemExercise) => itemExercise.id !== exercise.id ? itemExercise : { ...itemExercise, sets: itemExercise.sets.map((set) => reps[set.id] !== undefined && current.parts.some((part) => part.set.id === set.id) ? { ...set, repsDraft: reps[set.id] } : set) }) }) }))
      : true;
    if (saved) router.push("/workouts");
  };
  const commitFinish = () => { setFinishOpen(false); const saved = update((previousState) => finishWorkoutSession(previousState as SessionTrackerState, session.id)); if (saved) router.push(`/workout/${session.id}/summary`); };
  const askFinish = () => { setMenuOpen(false); if (!hasRecorded) { setError("Пока нет записанных подходов. Запишите подход или отмените тренировку."); return; } setFinishOpen(true); };
  const cancel = async () => {
    setMenuOpen(false);
    if (!(await confirm("Записанные подходы останутся в журнале в «Отменённых», но не попадут в статистику и недельную цель.", { title: "Отменить тренировку?", danger: true, confirmLabel: "Отменить тренировку", cancelLabel: "Продолжить" }))) return;
    const saved = update((previousState) => cancelWorkoutSession(previousState as SessionTrackerState, session.id));
    if (saved) router.push("/workouts");
  };

  const recordLabel = current ? `Записать ${current.parts.filter((part) => !part.set.completed).map((part) => reps[part.set.id] || "—").join(" + ")}` : "";
  const syncText = syncStatus === "idle" ? "" : syncStatus === "syncing" || syncStatus === "dirty" ? "На устройстве · отправляем на сервер" : "На устройстве · нет подтверждения сервера";

  return <main className="wk">
    <header className="wkTop">
      <IconButton label="Свернуть" icon={ArrowLeft} onClick={collapse} />
      <span className="workoutTimer"><Clock size={18} />{formatTime(elapsed)}</span>
      <IconButton label="Меню тренировки" icon={MoreHorizontal} onClick={() => setMenuOpen(true)} />
    </header>
    {syncText ? <p className="wkHint" role="status">{syncText}</p> : null}
    {storageError && <Notice tone="warning">{storageError}</Notice>}
    {error && !current && <Notice tone="warning">{error}</Notice>}
    <div className="wkTabs" ref={tabsRef} role="group" aria-label="Упражнения">
      {workout.exercises.map((item, index) => {
        const done = item.sets.length > 0 && item.sets.every((set) => set.completed);
        return <button type="button" key={item.id} className={`wkTab${done ? " done" : ""}`} aria-current={index === session.activeExerciseIndex} aria-label={`Упражнение ${index + 1}: ${item.name}${done ? ", выполнено" : ""}`} onClick={() => update((previousState) => goToExercise(previousState as SessionTrackerState, session.id, index))}>{done ? <Check size={18} /> : index + 1}</button>;
      })}
    </div>
    <div className="workoutProgress"><span>Упражнение {session.activeExerciseIndex + 1} из {workout.exercises.length}</span><span>{exerciseDone ? "Готово" : `Подход ${Math.max(1, currentIndex + 1)} из ${groups.length}`}</span></div>
    <section className="wkCard">
      <div className="wkHead">
        <div>
        <h1>{exercise.name}</h1>
        {visibleCopy(exercise.settings) ? <p className="wkLast">{visibleCopy(exercise.settings)}</p> : null}
        {previous ? <p className="wkLast">В прошлый раз ({formatLocalDate(previous.date)}): <b>{formatSets(previous.sets)}</b></p> : null}
        </div>
        <ExercisePhoto name={exercise.name} size={72} />
      </div>
      <div className="wkRibbon setSegments" aria-label="Подходы">{groups.map((group) => <span className={group.completed ? "done" : group.key === current?.key ? "current" : ""} key={group.key}>{group.number}</span>)}</div>
      {exerciseDone
        ? <div className="wkDone completeState">
          <Check size={40} />
          <h2>Упражнение завершено</h2>
          <p>{isLastExercise ? "Это было последнее упражнение." : `Дальше: ${workout.exercises[session.activeExerciseIndex + 1]?.name ?? ""}`}</p>
        </div>
        : current && <>
          <div className="wkSetTitle"><h2>{`Подход ${current.number}`}</h2>{current.paired ? <span>правая, затем левая</span> : null}</div>
          {sharedWeight
            ? <PairEditor
              parts={incompleteParts}
              reps={reps}
              weightEditing={editingWeightId === "shared"}
              weightText={weightText}
              onWeightStep={stepSharedWeight}
              onWeightStartEdit={() => { setEditingWeightId("shared"); setWeightText(incompleteParts[0].set.weightKg == null ? "" : String(incompleteParts[0].set.weightKg)); }}
              onWeightText={setWeightText}
              onWeightCommit={commitSharedWeight}
              onRepsText={setRepsFor}
              onRepsStep={stepReps}
            />
            : incompleteParts.map((part) => <PartEditor
              key={part.set.id}
              set={part.set}
              label={part.label}
              reps={reps[part.set.id] ?? ""}
              weightEditing={editingWeightId === part.set.id}
              weightText={weightText}
              onWeightStep={(delta) => stepWeight(part.set, delta)}
              onWeightStartEdit={() => startWeightEdit(part.set)}
              onWeightText={setWeightText}
              onWeightCommit={() => commitWeight(part.set)}
              onRepsText={(value) => setRepsFor(part.set.id, value)}
              onRepsStep={(delta) => stepReps(part.set.id, delta)}
            />)}
          {lastWeightHint && <Chip pressed={false} onClick={applyLastWeights}><History size={16} />Вес как в прошлый раз: {String(lastWeightHint.weight).replace(".", ",")} кг</Chip>}
          <div className="wkScope">
            <Segmented<WeightScope> label="Куда применить вес" value={scope} onChange={setScope} options={[{ value: "this", label: "Только этот подход" }, { value: "rest", label: "И следующие" }]} />
            {scope === "rest" ? <Chip pressed={remember} onClick={() => setRemember((value) => !value)}>{remember ? <Check size={16} /> : null}Запомнить в программе</Chip> : null}
            <p className="wkHint">Вес меняется сразу, количество подходов не растёт.</p>
          </div>
          {error ? <p className="wkError" role="alert">{error}</p> : null}
        </>}
    </section>
    <div className="wkBottom">
      {restRunning && rest && <div className="restState" role="timer" aria-label="Отдых">
        <span className="restLabel">Отдых</span>
        <strong>{formatTime(rest.remainingSec)}</strong>
        <small>Записано: {restSet?.weightKg != null ? `${restSet.weightKg} кг × ` : ""}{restSet?.reps ?? "—"}</small>
        <div className="restActions">
          <Button size="sm" onClick={() => changeRest("reschedule")}>+30 секунд</Button>
          <Button size="sm" icon={SkipForward} onClick={() => changeRest("cancel")}>Пропустить отдых</Button>
        </div>
        <div className="restBar"><span style={{ width: `${Math.max(0, Math.min(100, (rest.remainingSec / (sessionState.activeTimer?.durationSec || 1)) * 100))}%` }} /></div>
      </div>}
      {exerciseDone
        ? <>
          <Button block icon={Plus} onClick={addSet}>Ещё подход</Button>
          {isLastExercise
            ? <Button variant="primary" size="lg" block icon={Square} onClick={() => setFinishOpen(true)}>Завершить тренировку</Button>
            : <Button variant="primary" size="lg" block onClick={() => update((previousState) => goToExercise(previousState as SessionTrackerState, session.id, session.activeExerciseIndex + 1))}>Следующее упражнение<ChevronRight size={22} /></Button>}
        </>
        : <Button variant="primary" size="lg" block icon={Check} onClick={record}>{recordLabel}</Button>}
    </div>
    <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title="Тренировка">
      <ul className="menuList">
        <li><button type="button" className="menuItem" onClick={() => setSoundOn(!soundOn)} aria-pressed={soundOn}>{soundOn ? <Bell size={20} /> : <BellOff size={20} />}<span>Сигнал после отдыха: {soundOn ? "включён" : "выключен"}<small>Звук и вибрация, пока экран открыт</small></span></button></li>
        <li><button type="button" className="menuItem" onClick={addSet}><Plus size={20} /><span>Добавить подход<small>Ещё один подход в это упражнение</small></span></button></li>
        <li><button type="button" className="menuItem" onClick={askFinish}><Play size={20} /><span>Завершить досрочно<small>Невыполненные подходы не попадут в итог</small></span></button></li>
        <li><button type="button" className="menuItem danger" onClick={() => void cancel()}><XCircle size={20} /><span>Отменить тренировку<small>Подходы останутся в «Отменённых»</small></span></button></li>
      </ul>
      <Button variant="ghost" block onClick={() => setMenuOpen(false)}>Закрыть</Button>
    </Sheet>
    <Sheet open={finishOpen} onClose={() => setFinishOpen(false)} title="Завершить тренировку?">
      <p>{groups.every((group) => group.completed) && workout.exercises.every((item) => item.sets.every((set) => set.completed)) ? "Все подходы записаны." : "Незаписанные подходы не попадут в результат. В недельной цели останутся только записанные."}</p>
      <div className="sheetActions two">
        <Button onClick={() => setFinishOpen(false)}>Продолжить занятие</Button>
        <Button variant="primary" onClick={commitFinish}>Подтвердить завершение</Button>
      </div>
    </Sheet>
    {dialog}
  </main>;
}
