"use client";

import Link from "next/link";
import { ArrowRight, Download, Plus, Save, Settings2, Trash2 } from "lucide-react";
import { useEffect, useState, type ChangeEvent } from "react";
import { AppNav } from "@/components/app-nav";
import { AppSelect } from "@/components/app-select";
import { PrivatePhoto } from "@/components/private-photo";
import { useTrackerState } from "@/components/tracker-state";
import { calculateWorkoutTotals, formatLocalDate, getLocalDate, normalizeDecimalInput, russianWord } from "@/lib/tracker";
import { sleepFromEvents } from "@/lib/habits";
import { createClient } from "@/lib/supabase/client";

async function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.onerror = () => reject(new Error("Не удалось прочитать фото")); reader.readAsDataURL(blob); });
}

export default function ProgressPage() {
  const { state, update, storageError, userId } = useTrackerState();
  const today = getLocalDate();
  const [date, setDate] = useState(today);
  const [energy, setEnergy] = useState("");
  const [sleep, setSleep] = useState("");
  const [weight, setWeight] = useState("");
  const [skin, setSkin] = useState<"better" | "same" | "worse" | "unknown">("unknown");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const observation = state?.observations.find((item) => item.date === date);
  const computedSleep = state ? sleepFromEvents(state.habits,state.completions,date) : undefined;
  useEffect(() => {
    setEnergy(observation ? String(observation.energy) : "");
    setSleep(observation ? String(observation.sleep) : computedSleep == null ? "" : String(computedSleep));
    setWeight(observation?.weightKg == null ? "" : String(observation.weightKg));
    setSkin(observation?.skin ?? "unknown"); setNote(observation?.note ?? "");
  }, [observation, computedSleep]);
  if (!state) return <main className="shell"><p>Загружаю показатели…</p></main>;
  const sessions = state as import("@/lib/workout-session").SessionTrackerState;
  const blocked = new Set((sessions.workoutSessions ?? []).filter((s) => s.status === "active" || s.status === "cancelled").map((s) => s.workoutId));
  const workouts = state.workouts.filter((w) => !blocked.has(w.id) && calculateWorkoutTotals(w).completedSets > 0);
  const volume = workouts.reduce((sum,w) => sum + calculateWorkoutTotals(w).volumeKg,0);
  function save() {
    const e = normalizeDecimalInput(energy); const s = normalizeDecimalInput(sleep); const w = weight.trim() ? normalizeDecimalInput(weight) : undefined;
    if (e == null || e > 10 || s == null || s > 24 || (w !== undefined && (w == null || w <= 0 || w > 500)) || !date || date > today) { setMessage("Энергия: 0–10, сон: 0–24 ч, масса: больше 0 и до 500 кг. Укажите дату не позднее сегодня."); return; }
    if (update((previous) => ({ ...previous, observations: [...previous.observations.filter((o) => o.date !== date), { id: observation?.id ?? `observation-${date}`,date,energy:e,sleep:s,skin,note:note.trim(),...(w == null ? {} : { weightKg:w }) }] }))) setMessage("Отметка сохранена на устройстве.");
  }
  async function exportState() {
    setBusy(true); setMessage("");
    try {
      const photos = await Promise.all((state!.photos ?? []).map(async (photo) => {
        if (!photo.storagePath) return photo;
        const { data,error } = await createClient().storage.from("progress-photos").download(photo.storagePath);
        if (error || !data) throw new Error("Не удалось загрузить фото для полного экспорта. Проверьте соединение.");
        return { ...photo,dataUrl:await blobDataUrl(data) };
      }));
      const url = URL.createObjectURL(new Blob([JSON.stringify({ ...state,photos },null,2)],{ type:"application/json" }));
      const link = document.createElement("a"); link.href=url; link.download=`ritm-export-${today}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
    } catch (e) { setMessage(e instanceof Error ? e.message : "Экспорт не удался."); }
    finally { setBusy(false); }
  }
  async function addPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file=event.target.files?.[0]; event.target.value="";
    if (!file) return;
    if (file.size>5*1024*1024 || !["image/jpeg","image/png","image/webp"].includes(file.type)) { setMessage("Выберите JPG, PNG или WebP до 5 МБ."); return; }
    if (!navigator.onLine || !userId || userId === "demo") { setMessage("Для загрузки приватного фото нужен вход и интернет."); return; }
    setBusy(true); setMessage("");
    try {
      const path=`${userId}/${crypto.randomUUID()}.${file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg"}`;
      const { error } = await createClient().storage.from("progress-photos").upload(path,file,{ contentType:file.type,upsert:false });
      if (error) throw new Error("Фото не загружено. Проверьте соединение и попробуйте снова.");
      if (!update((previous) => ({ ...previous,photos:[...(previous.photos ?? []),{ id:`photo-${crypto.randomUUID()}`,date,name:file.name,storagePath:path,dataUrl:"" }] }))) throw new Error("Фото загружено, но ссылка не сохранилась на устройстве. Освободите место.");
      setMessage("Фото загружено в приватное хранилище.");
    } catch (e) { setMessage(e instanceof Error ? e.message : "Фото не загружено."); }
    finally { setBusy(false); }
  }
  async function removePhoto(photo: { id: string; name: string; storagePath?: string }) {
    const remote = Boolean(photo.storagePath && userId && userId !== "demo");
    const message = remote
      ? `Убрать фото «${photo.name}» из журнала и удалить файл из хранилища? Вернуть его будет нельзя.`
      : `Убрать фото «${photo.name}» из журнала? Отдельного файла в хранилище нет.`;
    if (!window.confirm(message)) return;
    if (remote && photo.storagePath) {
      const { error } = await createClient().storage.from("progress-photos").remove([photo.storagePath]);
      if (error) { setMessage("Файл в хранилище не удалился. Фото осталось в журнале. Проверьте соединение и повторите."); return; }
    }
    if (update((previous) => ({ ...previous, photos: previous.photos?.filter((item) => item.id !== photo.id) }))) setMessage(remote ? "Фото убрано из журнала, файл удалён из хранилища." : "Фото убрано из журнала.");
  }
  return <main className="shell appPage"><header className="pageHeader"><div><p className="eyebrow">Показатели</p><h1>Прогресс</h1></div><div className="headerActions"><Link className="iconButton" href="/settings" aria-label="Настройки"><Settings2 size={20} /></Link><button className="iconButton" onClick={exportState} disabled={busy} aria-label="Экспорт данных и фото" title="Экспорт данных и фото"><Download size={20} /></button></div></header>
    {storageError && <p className="storageMessage" role="alert">{storageError}</p>}{message && <p className="storageMessage" role="status">{message}</p>}
    <div className="summaryMetrics"><div><strong>{workouts.length}</strong><span>{russianWord(workouts.length, "тренировка", "тренировки", "тренировок")}</span></div><div><strong>{volume.toLocaleString("ru-RU")}</strong><span>кг объёма</span></div><div><strong>{state.completions.filter((c) => c.outcome !== "skipped").length}</strong><span>{russianWord(state.completions.filter((c) => c.outcome !== "skipped").length, "отметка", "отметки", "отметок")}</span></div></div>
    <section className="settingsEditor observationEditor"><h2>Самочувствие</h2><div className="formGrid"><label className="wide">Дата<input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} /></label><label>Энергия, 0–10<input inputMode="decimal" value={energy} onChange={(e) => setEnergy(e.target.value)} /></label><label>Сон, часов<input inputMode="decimal" value={sleep} onChange={(e) => setSleep(e.target.value)} /></label><label>Масса, кг<input inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} /></label><label className="wide">Самочувствие<AppSelect value={skin} onChange={(value) => setSkin(value as typeof skin)}><option value="unknown">Не указано</option><option value="better">Лучше</option><option value="same">Без изменений</option><option value="worse">Хуже</option></AppSelect></label></div><label>Заметка<textarea value={note} maxLength={4000} onChange={(e) => setNote(e.target.value)} rows={3} /></label><button className="primary" onClick={save}><Save size={18} />Сохранить отметку</button></section>
    <section className="settingsEditor photoEditor"><div className="sectionHeading"><h2>Фото прогресса</h2><label className="secondary photoUpload"><Plus size={18} />{busy ? "Загрузка…" : "Добавить фото"}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={addPhoto} /></label></div><div className="photoGrid">{state.photos?.map((photo) => <figure key={photo.id}><PrivatePhoto path={photo.storagePath} dataUrl={photo.dataUrl} name={photo.name} /><figcaption><span>{formatLocalDate(photo.date)}</span><button className="secondary dangerButton" aria-label={`Убрать фото ${photo.name}`} title="Убрать фото из журнала" onClick={() => void removePhoto(photo)}><Trash2 size={17} />Убрать</button></figcaption></figure>)}</div></section>
    {state.observations.length > 0 && <section className="settingsEditor"><h2>История отметок</h2>{[...state.observations].sort((a,b) => b.date.localeCompare(a.date)).map((o) => <article className="observationHistory" key={o.id}><div className="observationActions"><button className="secondary" type="button" onClick={() => { setDate(o.date); window.scrollTo({ top:0,behavior:"smooth" }); }}>{formatLocalDate(o.date)}</button><button className="secondary dangerButton" type="button" onClick={() => { if (window.confirm(`Удалить отметку за ${formatLocalDate(o.date)}?`)) update((previous) => ({ ...previous, observations: previous.observations.filter((item) => item.id !== o.id) })); }}>Удалить отметку</button></div><p>Энергия {o.energy}/10 · Сон {o.sleep} ч{o.weightKg == null ? "" : ` · ${o.weightKg} кг`}</p>{o.note && <p className="observationNote">{o.note}</p>}</article>)}</section>}
    <Link className="historyCard" href="/journal"><h2>Журнал тренировок</h2><ArrowRight size={20} /></Link><AppNav active="progress" /></main>;
}
