"use client";

import { Download, FileCheck, Upload, X } from "lucide-react";
import { useRef, useState, type ChangeEvent } from "react";
import { useTrackerState } from "@/components/tracker-state";
import { createClient } from "@/lib/supabase/client";
import {
  createBackupDocument, embeddedPhotoSize, MAX_BACKUP_BYTES, MAX_BACKUP_PHOTO_BYTES,
  mergeBackup, parseBackup, photoBelongsToAccount, previewBackup, saveBeforeImport,
  type BackupCounts, type ParsedBackup,
} from "@/lib/backup";
import { getLocalDate } from "@/lib/tracker";

const countLabels: Record<keyof BackupCounts, string> = {
  habits: "Привычки", completions: "Отметки привычек", workouts: "Тренировки", exercises: "Упражнения в истории",
  sets: "Подходы в истории", programs: "Программы", observations: "Показатели", photos: "Фото",
};
function photoDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Не удалось прочитать фото."));
    reader.onerror = () => reject(new Error("Не удалось прочитать фото."));
    reader.readAsDataURL(blob);
  });
}

export function DataSettings() {
  const { state, userId, update } = useTrackerState();
  const [backup, setBackup] = useState<ParsedBackup>();
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [skipPhotos, setSkipPhotos] = useState(false);
  const [skipUnfinished, setSkipUnfinished] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  if (!state || !userId) return <p role="status">Загружаю данные аккаунта…</p>;
  const preview = backup ? previewBackup(state, backup, userId) : undefined;
  const additions = preview ? Object.values(preview.additions).reduce((sum, count) => sum + count, 0) : 0;
  function clearPreview() {
    setBackup(undefined); setFileName(""); setConfirmed(false); setSkipPhotos(false); setSkipUnfinished(false);
  }
  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file) return;
    clearPreview(); setError(""); setMessage("");
    if (file.size > MAX_BACKUP_BYTES) { setError("Выберите JSON-копию до 20 МБ."); return; }
    setBusy(true);
    try { setBackup(parseBackup(await file.text())); setFileName(file.name); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось прочитать копию. Данные не изменены."); }
    finally { setBusy(false); }
  }
  async function exportBackup() {
    if (!state || !userId) return;
    setBusy(true); setError(""); setMessage("");
    try {
      // Download one photo at a time to bound memory and fail rather than produce an incomplete export.
      const photos = [];
      let photoBytes = 0;
      for (const photo of state.photos ?? []) {
        let dataUrl = photo.dataUrl;
        if (photo.storagePath) {
          if (!photoBelongsToAccount(photo.storagePath, userId)) {
            if (!dataUrl) throw new Error("В журнале есть недоступное фото другого аккаунта. Полная копия не создана; исходные данные сохранены.");
          } else {
            const { data, error: downloadError } = await createClient().storage.from("progress-photos").download(photo.storagePath);
            if (downloadError || !data) throw new Error("Не удалось загрузить все фото. Проверьте соединение; неполная копия не будет сохранена.");
            if (data.size > MAX_BACKUP_PHOTO_BYTES) throw new Error("Одно фото превышает 5 МБ. Полная копия не создана.");
            dataUrl = await photoDataUrl(data);
          }
        }
        photoBytes += embeddedPhotoSize(dataUrl);
        if (photoBytes * 4 / 3 > MAX_BACKUP_BYTES) throw new Error("Копия с фото превышает 20 МБ. Сохраните фото отдельно.");
        const portable = { ...photo };
        delete portable.storagePath;
        photos.push({ ...portable, dataUrl });
      }
      const document = createBackupDocument({ ...state, photos }, userId);
      const url = URL.createObjectURL(new Blob([JSON.stringify(document)], { type: "application/json" }));
      const link = window.document.createElement("a");
      link.href = url; link.download = `ritm-backup-${getLocalDate()}.json`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage("Полная копия подготовлена. Она содержит личные данные и фото — храните её в безопасном месте.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось создать резервную копию."); }
    finally { setBusy(false); }
  }
  function restoreBackup() {
    if (!backup || !userId || !confirmed || busy) return;
    setError(""); setMessage("");
    try {
      const saved = update((previous) => {
        const merged = mergeBackup(previous, backup, userId, { skipUnavailablePhotos: skipPhotos, skipUnfinishedWorkouts: skipUnfinished });
        saveBeforeImport(previous, userId, window.localStorage);
        return merged;
      });
      if (!saved) throw new Error("Не удалось записать импорт на устройстве. Исходная копия сохранена в резерве; освободите место и повторите.");
      clearPreview(); setMessage("Новые записи добавлены на устройство. Исходная копия сохранена в резерве этого аккаунта; синхронизация покажет отдельное подтверждение сервера.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Импорт не выполнен. Исходные данные сохранены."); }
  }

  return <section className="settingsEditor" aria-labelledby="data-settings-title">
    <div className="sectionHeading"><h2 id="data-settings-title">Резервная копия</h2></div>
    <div className="settingsActions"><button className="secondary" onClick={exportBackup} disabled={busy}><Download size={18} />{busy ? "Обрабатываю…" : "Скачать копию с фото"}</button></div>
    <div className="settingsActions"><input ref={fileInput} type="file" aria-label="Восстановить из JSON" hidden accept="application/json,.json" disabled={busy} onChange={chooseFile} /><button className="secondary" onClick={() => fileInput.current?.click()} disabled={busy}><Upload size={18} />Выбрать JSON-копию</button></div>
    {error && <p className="storageMessage" role="alert">{error}</p>}
    {message && <p className="storageMessage" role="status">{message}</p>}
    {preview && <div className="settingsEditor">
      <div className="sectionHeading"><h3 style={{ overflowWrap: "anywhere" }}><FileCheck size={18} /> {fileName}</h3><button className="iconButton" aria-label="Отменить импорт" title="Отменить импорт" disabled={busy} onClick={clearPreview}><X size={18} /></button></div>
      <dl style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: "8px 16px" }}>{Object.entries(countLabels).map(([key, label]) => <div key={key} style={{ display: "contents" }}><dt>{label}</dt><dd style={{ margin: 0 }}>{preview.additions[key as keyof BackupCounts]}</dd></div>)}</dl>
      <p className="muted">Совпадающих записей: {preview.existingItems}. Существующие значения и ID останутся без изменений.</p>
      <p className="muted">Текущая активная тренировка, отдых и очередь синхронизации не заменяются.</p>
      {backup?.accountId && backup.accountId !== userId && <p className="muted">Копия создана в другом аккаунте. Встроенные фото перенесутся без ссылок на его приватное хранилище.</p>}
      {preview.portablePhotos > 0 && <p className="muted">Фото перенесутся из встроенных изображений без прежних ссылок хранилища: {preview.portablePhotos}.</p>}
      {preview.ignoredCommands > 0 && <p className="muted">Команды из файла ({preview.ignoredCommands}) не будут отправлены заново. Текущая очередь и таймер останутся без изменений.</p>}
      {!!backup?.state.habitSnoozes?.length && <p className="muted">Отложенные напоминания из файла не возобновляются. Текущие напоминания сохраняются.</p>}
      {preview.unavailablePhotos > 0 && <label className="checkLabel" style={{ display: "flex", alignItems: "start", gap: 10, margin: "16px 0" }}><input type="checkbox" checked={skipPhotos} onChange={(event) => setSkipPhotos(event.target.checked)} /><span>Пропустить недоступные фото: {preview.unavailablePhotos}. В копии есть только ссылки другого аккаунта; нужен полный экспорт с изображениями, чтобы их перенести.</span></label>}
      {preview.unfinishedWorkouts > 0 && <label className="checkLabel" style={{ display: "flex", alignItems: "start", gap: 10, margin: "16px 0" }}><input type="checkbox" checked={skipUnfinished} onChange={(event) => setSkipUnfinished(event.target.checked)} /><span>Пропустить незавершённые тренировки из файла: {preview.unfinishedWorkouts}. Текущая активная тренировка не изменится.</span></label>}
      {additions > 0 ? <><label className="checkLabel" style={{ display: "flex", alignItems: "start", gap: 10, margin: "16px 0" }}><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>Добавить новые записи, сохранив существующие данные и резервную копию.</span></label><div className="settingsActions"><button className="primary" disabled={busy || !confirmed || (!!preview.unavailablePhotos && !skipPhotos) || (!!preview.unfinishedWorkouts && !skipUnfinished)} onClick={restoreBackup}><Upload size={18} />Подтвердить восстановление</button></div></> : <p role="status">В этой копии нет новых доступных записей для добавления.</p>}
    </div>}
  </section>;
}
