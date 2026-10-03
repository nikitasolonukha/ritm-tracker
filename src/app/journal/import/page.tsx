"use client";
import Link from "next/link";
import { ArrowLeft, Check, Upload } from "lucide-react";
import { useState } from "react";
import { useTrackerState } from "@/components/tracker-state";
import { AppNav } from "@/components/app-nav";
import { prepareWorkoutImport, withoutRepeatedImportFacts } from "@/lib/import";
import { getLocalDate, type Workout } from "@/lib/tracker";
import { SettingsInput } from "@/components/settings-input";
import { AppSelect } from "@/components/app-select";

const SAMPLE = "12.09.2026\nЖим лёжа\n60x8, 62,5x6";

export default function ImportPage() {
  const { state,update }=useTrackerState();
  const [text,setText]=useState(""); const [year,setYear]=useState(""); const [preview,setPreview]=useState<Workout[]>([]); const [error,setError]=useState(""); const [confirmed,setConfirmed]=useState(false);
  if (!state) return <main className="shell"><p>Загружаю журнал…</p></main>;
  const fresh=withoutRepeatedImportFacts(preview,state.workouts);
  const prepare=() => { const result=prepareWorkoutImport(text,Number(year)||undefined); setError(result.error ?? ""); setPreview(result.workouts); setConfirmed(false); };
  const confirm=() => {
    if (preview.some((w) => !w.date || w.date>getLocalDate())) { setError("Проверьте даты: историческая запись не может быть из будущего."); return; }
    const saved=update((previous) => ({ ...previous,workouts:[...previous.workouts,...withoutRepeatedImportFacts(preview,previous.workouts)] }));
    if (saved) { setConfirmed(true); setPreview([]); setError(""); }
  };
  const editSet=(workoutId:string,exerciseId:string,setId:string,field:"weightKg"|"reps"|"weightMode",value:string) => setPreview((items) => items.map((w) => w.id!==workoutId ? w : { ...w,exercises:w.exercises.map((e) => e.id!==exerciseId ? e : { ...e,sets:e.sets.map((s) => s.id!==setId ? s : { ...s,[field]:field === "weightMode" ? value||undefined : value === "" ? null : Number(value) }) }) }));
  return <main className="shell appPage"><Link className="backLink" href="/journal"><ArrowLeft size={18} />Журнал</Link><h1>Импорт тренировок</h1><p className="muted">Вставьте заметки: строка с датой, затем упражнение и подходы вида 60×8, 62,5×6.</p><section className="settingsEditor"><label>Исходный текст<textarea rows={8} placeholder={SAMPLE} value={text} maxLength={100000} onChange={(e) => { setText(e.target.value); setPreview([]); setConfirmed(false); }} /></label><label>Год для дат без года<input inputMode="numeric" value={year} onChange={(e) => { setYear(e.target.value); setPreview([]); }} /></label><button className="secondary" onClick={prepare} disabled={!text.trim()}><Upload size={18} />Предпросмотр</button></section>{error && <p className="storageMessage" role="alert">{error}</p>}{confirmed && <p role="status">История сохранена. Новые таймеры не запускались.</p>}
    {preview.map((w) => <section className="settingsEditor" key={w.id}><label>Дата<input type="date" value={w.date} max={getLocalDate()} onChange={(e) => setPreview((items) => items.map((item) => item.id===w.id ? { ...item,date:e.target.value } : item))} /></label>{w.exercises.map((e) => <div className="importExercise" key={e.id}><h2>{e.name}</h2>{e.sets.map((s,index) => <div className="setPart" key={s.id}><span>{index+1}</span><label>Вес<SettingsInput numeric="weight" value={s.weightKg} onCommit={(v) => editSet(w.id,e.id,s.id,"weightKg",v)} /></label><label>Режим<AppSelect value={s.weightMode??""} onChange={(value) => editSet(w.id,e.id,s.id,"weightMode",value)}><option value="">Неизвестно</option><option value="total">Общий</option><option value="per-hand">На сторону</option></AppSelect></label><label>Повторы<SettingsInput numeric="reps" value={s.reps} onCommit={(v) => editSet(w.id,e.id,s.id,"reps",v)} /></label>{s.note && <p className="muted">{s.note}</p>}</div>)}</div>)}</section>)}
    {preview.length>0 && <div className="settingsActions"><span>Новых записей: {fresh.length}. Повторяющиеся факты не добавляются.</span><button className="primary" disabled={!fresh.length} onClick={confirm}><Check size={18} />Подтвердить импорт</button><button className="secondary" onClick={() => setPreview([])}>Исправить текст</button></div>}<AppNav active="journal" /></main>;
}
