"use client";

import Link from "next/link";
import { Activity, ArrowRight, Download, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { AppNav } from "@/components/app-nav";
import { useTrackerState } from "@/components/tracker-state";
import { calculateWorkoutTotals, getLocalDate } from "@/lib/tracker";

export default function ProgressPage() {
  const { state, update, storageError } = useTrackerState();
  const [energy, setEnergy] = useState("");
  const [sleep, setSleep] = useState("");
  const [skin, setSkin] = useState<"better" | "same" | "worse" | "unknown">("unknown");
  const [note, setNote] = useState("");
  const today = getLocalDate();
  const todayObservation = state?.observations.find((item) => item.date === today);
  useEffect(() => {
    if (!todayObservation) return;
    setEnergy(String(todayObservation.energy));
    setSleep(String(todayObservation.sleep));
    setSkin(todayObservation.skin);
    setNote(todayObservation.note);
  }, [todayObservation]);
  if (!state) return <main className="shell"><p>Считаю показатели…</p></main>;
  const sessionState = state as import("@/lib/workout-session").SessionTrackerState;
  const blocked = new Set((sessionState.workoutSessions ?? []).filter((session) => session.status === "active" || session.status === "cancelled").map((session) => session.workoutId));
  const workouts = state.workouts.filter((item) => !blocked.has(item.id) && calculateWorkoutTotals(item).completedSets > 0);
  const volume = workouts.reduce((sum, item) => sum + calculateWorkoutTotals(item).volumeKg, 0);
  function saveObservation() {
    const energyValue = Number(energy);
    const sleepValue = Number(sleep);
    if (!Number.isFinite(energyValue) || !Number.isFinite(sleepValue)) return;
    update((previous) => ({ ...previous, observations: [...previous.observations.filter((item) => item.date !== today), { id: todayObservation?.id ?? `observation-${today}`, date: today, energy: energyValue, sleep: sleepValue, skin, note }] }));
  }
  function exportState() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ritm-export-${today}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }
  function addPhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || file.size > 5 * 1024 * 1024 || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      update((previous) => ({ ...previous, photos: [...(previous.photos ?? []), { id: `photo-${Date.now()}`, date: today, name: file.name, dataUrl: reader.result as string }] }));
    };
    reader.readAsDataURL(file);
  }
  const photos = state.photos ?? [];
  return <main className="shell appPage"><header className="pageHeader"><div><p className="eyebrow">Показатели</p><h1>Прогресс</h1></div><div className="pageActions"><button className="iconButton" onClick={exportState} aria-label="Экспорт данных"><Download size={20} /></button><Activity size={26} /></div></header>{storageError && <p className="storageMessage" role="alert">{storageError}</p>}<div className="summaryMetrics"><div><strong>{workouts.length}</strong><span>тренировок</span></div><div><strong>{volume.toLocaleString("ru-RU")}</strong><span>кг объём</span></div><div><strong>{state.completions.length}</strong><span>отметок</span></div></div><section className="panel observationEditor"><div className="panelTitle"><div><p className="eyebrow">Сегодня, {today}</p><h2>Самочувствие</h2></div></div><div className="formGrid"><label>Энергия<input type="number" min="0" max="10" step="1" value={energy} onChange={(event) => setEnergy(event.target.value)} placeholder="0–10" /></label><label>Сон, часов<input type="number" min="0" max="24" step="0.5" value={sleep} onChange={(event) => setSleep(event.target.value)} placeholder="0–24" /></label><label>Наблюдение<select value={skin} onChange={(event) => setSkin(event.target.value as typeof skin)}><option value="unknown">Не указано</option><option value="better">Лучше</option><option value="same">Без изменений</option><option value="worse">Хуже</option></select></label></div><label>Заметка<textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} /></label><button className="primary" onClick={saveObservation}><Save size={18} /> Сохранить отметку</button></section><section className="panel photoEditor"><div className="panelTitle"><div><p className="eyebrow">Приватно</p><h2>Фото прогресса</h2></div><label className="secondary photoUpload">Добавить фото<input type="file" accept="image/*" onChange={addPhoto} /></label></div>{photos.length ? <div className="photoGrid">{photos.map((photo) => <figure key={photo.id}><img src={photo.dataUrl} alt={photo.name} /><figcaption><span>{photo.date}</span><button className="iconButton" onClick={() => update((previous) => ({ ...previous, photos: (previous.photos ?? []).filter((item) => item.id !== photo.id) }))} aria-label={`Удалить ${photo.name}`}>×</button></figcaption></figure>)}</div> : <p className="muted">Добавь до 5 МБ на фото. Файлы остаются в данных аккаунта и попадают в экспорт.</p>}</section><Link className="resumeBanner" href="/journal"><span><strong>Открыть журнал</strong><small>Смотреть каждую сессию отдельно</small></span><ArrowRight size={20} /></Link><AppNav active="progress" /></main>;
}
