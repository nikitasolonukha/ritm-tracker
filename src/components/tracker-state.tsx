"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { backupSyncConflict, clearSyncWriteIntent, migrateState, readOutboxAcks, readStateSafely, readSyncCheckpoint, readSyncWriteIntent, writeSyncCheckpoint, writeSyncWriteIntent, writeOutboxAck, writeState, type TrackerState } from "@/lib/storage";
import { acknowledgeSavedHabits, confirmedSyncWrite, decideLostPutResponse, decideSyncDirection, prepareSyncPayload, syncFingerprint } from "@/lib/sync";
import { mergeBackup, previewBackup } from "@/lib/backup";
import { setServiceWorkerAccount } from "@/lib/pwa";
import Link from "next/link";
import { usePathname } from "next/navigation";

type SyncConflict = { local: TrackerState; remote: TrackerState; remoteRevision: number };
export type SyncStatus = "idle" | "loading" | "dirty" | "syncing" | "offline" | "conflict" | "error";
type TrackerStore = { state: TrackerState | null; update: (mutator: (state: TrackerState) => TrackerState) => boolean; importLegacy: () => boolean; resolveSyncConflict: (choice: "local" | "remote") => boolean; retrySync: () => void; syncConflict?: SyncConflict; legacyState?: TrackerState; userId?: string; storageError?: string; syncStatus: SyncStatus };
const TrackerContext = createContext<TrackerStore | null>(null);

async function request(input: string, init: RequestInit = {}) {
  const response = await fetch(input, { ...init, cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (response.status === 401) {
    setServiceWorkerAccount();
    window.location.assign("/login?reason=expired");
    throw new Error("Войдите снова. Локальные записи сохранены.");
  }
  return response;
}

function useTrackerStateInternal(demoMode: boolean): TrackerStore {
  const pathname = usePathname();
  const [state, setState] = useState<TrackerState | null>(null);
  const [userId, setUserId] = useState<string>();
  const [storageError, setStorageError] = useState<string>();
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("loading");
  const [legacyState, setLegacyState] = useState<TrackerState>();
  const [syncConflict, setSyncConflict] = useState<SyncConflict>();
  const current = useRef<TrackerState | null>(null);
  const account = useRef<string | undefined>(undefined);
  const base = useRef<string | undefined>(undefined);
  const ready = useRef(false);
  const empty = useRef(false);
  const running = useRef(false);
  const again = useRef(false);
  const blocked = useRef(false);
  const alive = useRef(true);
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const acks = useRef(new Set<string>());
  const legacyAllowed = useRef(false);
  useEffect(() => { if (userId && !demoMode) setServiceWorkerAccount(userId); }, [pathname, userId, demoMode]);

  function persist(next: TrackerState) {
    const result = writeState(next, account.current);
    if (!result.ok) { setStorageError("Не удалось сохранить на устройстве. Освободите место или экспортируйте данные."); return false; }
    current.current = next;
    setState(next);
    return true;
  }
  function checkpoint(snapshot: TrackerState, revision: number) {
    const fingerprint = syncFingerprint(snapshot);
    if (account.current && !writeSyncCheckpoint(account.current, revision, fingerprint)) throw new Error("Не удалось сохранить подтверждение синхронизации.");
    base.current = fingerprint;
  }
  function conflict(remote: TrackerState, revision: number) {
    blocked.current = true;
    if (current.current) setSyncConflict({ local: current.current, remote, remoteRevision: revision });
    setSyncStatus("conflict");
    setStorageError("На двух устройствах есть изменения. Выберите копию; обе будут сохранены в резерве.");
  }
  async function deliverCommands(snapshot: TrackerState, syncAccount: string) {
    const types = ["workout.set.completed", "timer.rescheduled", "timer.cancelled"];
    for (const item of snapshot.outbox.filter((item) => types.includes(item.type) && ["pending", "failed", "sending"].includes(item.status))) {
      if (!alive.current || account.current !== syncAccount) return;
      if (!acks.current.has(item.id)) {
        const details = item.payload as { dueAt?: string; expiresAt?: string; message?: string } | undefined;
        const timer = item.type !== "workout.set.completed";
        const response = await request(timer ? "/api/workout/timer" : "/api/workout/command", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ commandKey: item.id, sourceEntityId: item.entityId, payload: { ...details, itemId: item.id }, sourceVersion: item.version ?? 1, ...(timer ? { action: item.type === "timer.cancelled" ? "cancel" : "reschedule" } : {}), dueAt: details?.dueAt, expiresAt: details?.expiresAt, message: details?.message ?? "Ритм: отдых завершён." }) });
        if (!alive.current || account.current !== syncAccount) return;
        if (!response.ok) throw new Error("Подход сохранён на устройстве, но сервер ещё не подтвердил уведомление. Повторите синхронизацию.");
        const saved = writeOutboxAck(item.id, syncAccount);
        if (!saved.ok) throw new Error("Не удалось сохранить подтверждение команды.");
        acks.current.add(item.id);
      }
      if (current.current && !persist({ ...current.current, outbox: current.current.outbox.map((entry) => entry.id === item.id ? { ...entry, status: "accepted" } : entry) })) throw new Error("Не удалось сохранить очередь.");
    }
  }
  async function sync() {
    if (!ready.current || !account.current || demoMode || !isSupabaseConfigured || !current.current || blocked.current) return;
    if (running.current) { again.current = true; return; }
    if (!navigator.onLine) { setSyncStatus("offline"); return; }
    running.current = true;
    const syncAccount = account.current;
    setSyncStatus("syncing");
    try {
      do {
        again.current = false;
        const response = await request("/api/sync");
        if (!response.ok) throw new Error("Сервер временно недоступен. Данные сохранены на устройстве.");
        const remote = await response.json() as { payload?: TrackerState | null; version?: number; legacyImportAllowed?: boolean };
        if (!alive.current || account.current !== syncAccount) return;
        legacyAllowed.current = remote.legacyImportAllowed === true;
        if (legacyAllowed.current) {
          const legacy = readStateSafely();
          if (legacy.status === "loaded") setLegacyState(legacy.state);
        } else setLegacyState(undefined);
        const snapshot = current.current!;
        const revision = remote.version ?? 0;
        // The previous page may have committed its PUT without receiving the response.
        if (confirmedSyncWrite(readSyncWriteIntent(syncAccount), remote)) {
          checkpoint(remote.payload!, revision);
          if (!clearSyncWriteIntent(syncAccount)) throw new Error("Не удалось сохранить подтверждение отправки.");
        }
        const direction = decideSyncDirection(snapshot, remote.payload, base.current, empty.current);
        if (direction === "conflict") { conflict(remote.payload!, revision); return; }
        if (direction === "download") {
          if (!persist(migrateState(remote.payload!))) throw new Error("Не удалось сохранить серверную копию на устройстве.");
          checkpoint(remote.payload!, revision);
          empty.current = false;
          await deliverCommands(current.current!, syncAccount);
          if (!alive.current || account.current !== syncAccount) return;
          continue;
        }
        if (direction === "same") {
          checkpoint(remote.payload!, revision);
          empty.current = false;
          await deliverCommands(snapshot, syncAccount);
          if (!alive.current || account.current !== syncAccount) return;
          if (current.current) {
            const prepared: TrackerState = acknowledgeSavedHabits(current.current, snapshot);
            if (prepared !== current.current && !persist(prepared)) throw new Error("Не удалось обновить очередь.");
          }
          continue;
        }
        const payload = prepareSyncPayload(snapshot);
        if (!writeSyncWriteIntent(syncAccount, { expectedRevision: revision, fingerprint: syncFingerprint(payload) })) throw new Error("Не удалось сохранить намерение отправки. Данные остались на устройстве.");
        let savedRevision = revision;
        let put: Response | undefined;
        try {
          put = await request("/api/sync", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ payload, expectedRevision: revision }) });
        } catch {
          if (!alive.current || account.current !== syncAccount) return;
          const recovery = await request("/api/sync");
          if (!recovery.ok) throw new Error("Сервер не подтвердил сохранение. Локальная копия сохранена.");
          const checked = await recovery.json() as { payload?: TrackerState | null; version?: number };
          if (!alive.current || account.current !== syncAccount) return;
          const decision = decideLostPutResponse(payload, revision, checked);
          if (decision.action !== "accepted") {
            if (decision.action === "conflict" && checked.payload) { conflict(checked.payload, decision.revision); return; }
            throw new Error("Нет подтверждения сервера. Повторите синхронизацию.");
          }
          savedRevision = decision.revision;
        }
        if (!alive.current || account.current !== syncAccount) return;
        if (put?.status === 409) {
          const other = await put.json();
          if (!alive.current || account.current !== syncAccount) return;
          if (other.remote) conflict(other.remote, other.revision);
          else throw new Error("Данные изменились на другом устройстве. Повторите синхронизацию.");
          return;
        }
        if (put) {
          if (!put.ok) throw new Error("Сохранение на сервере не подтверждено. Локальная копия сохранена.");
          savedRevision = (await put.json()).revision;
        }
        if (!alive.current || account.current !== syncAccount) return;
        checkpoint(payload, savedRevision);
        if (!clearSyncWriteIntent(syncAccount)) throw new Error("Не удалось сохранить подтверждение отправки.");
        empty.current = false;
        // A recovered PUT still needs to deliver its durable commands.
        await deliverCommands(snapshot, syncAccount);
        if (!alive.current || account.current !== syncAccount) return;
        if (current.current) {
          const prepared: TrackerState = acknowledgeSavedHabits(current.current, payload);
          if (prepared !== current.current && !persist(prepared)) throw new Error("Не удалось обновить очередь.");
        }
      } while (again.current && !blocked.current && alive.current);
      if (alive.current && account.current === syncAccount) { setSyncStatus("idle"); setStorageError(undefined); }
    } catch (error) {
      if (alive.current && account.current === syncAccount) { setSyncStatus("offline"); setStorageError(error instanceof Error ? error.message : "Нет связи. Локальные данные сохранены."); }
    } finally { running.current = false; }
  }
  function queueSync() {
    if (blocked.current) return;
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => { void sync(); }, 250);
  }

  useEffect(() => {
    alive.current = true;
    if (["/login", "/register", "/update-password"].includes(window.location.pathname)) return;
    async function initialize() {
      let id: string | undefined;
      if (demoMode) id = "demo";
      else {
        const client = createClient();
        const verified = navigator.onLine ? await client.auth.getUser() : { data: { user: (await client.auth.getSession()).data.session?.user }, error: null };
        if (!alive.current) return;
        if (verified.error && !navigator.onLine) id = (await client.auth.getSession()).data.session?.user.id;
        else id = verified.data.user?.id;
        if (!id) { setStorageError("Войдите, чтобы открыть свои данные."); setSyncStatus("error"); return; }
      }
      if (!alive.current) return;
      account.current = id;
      setUserId(id);
      setServiceWorkerAccount(demoMode ? undefined : id);
      acks.current = readOutboxAcks(id);
      base.current = readSyncCheckpoint(id!)?.fingerprint;
      const local = readStateSafely(id);
      empty.current = local.status === "empty";
      if (local.status === "corrupt" || local.status === "unsupported" || local.status === "unavailable") { setStorageError(local.error ?? "Локальная история повреждена. Исходная копия сохранена."); setSyncStatus("error"); blocked.current = true; return; }
      if (empty.current && !demoMode) {
        local.state = { ...local.state, habits: [], workoutTemplates: [] };
      }
      current.current = local.state;
      setState(local.state);
      ready.current = true;
      setSyncStatus(demoMode ? "idle" : navigator.onLine ? "loading" : "offline");
      if (!demoMode) await sync();
    }
    void initialize().catch(() => { if (alive.current) { setSyncStatus("error"); setStorageError("Не удалось открыть аккаунт. Проверьте соединение."); } });
    const recover = () => { if (document.visibilityState === "visible" && navigator.onLine) void sync(); };
    window.addEventListener("online", recover);
    document.addEventListener("visibilitychange", recover);
    const poll = setInterval(recover, 30_000);
    let subscription: { unsubscribe: () => void } | undefined;
    if (!demoMode && isSupabaseConfigured) subscription = createClient().auth.onAuthStateChange((event, session) => {
      if (account.current && (event === "SIGNED_OUT" || (session?.user.id && session.user.id !== account.current))) {
        ready.current = false; current.current = null; account.current = undefined; setState(null); setServiceWorkerAccount();
        window.location.assign("/login");
      }
    }).data.subscription;
    return () => { alive.current = false; ready.current = false; subscription?.unsubscribe(); clearInterval(poll); clearTimeout(debounce.current); window.removeEventListener("online", recover); document.removeEventListener("visibilitychange", recover); };
  // The worker reads refs so rapid actions and recovery use the latest account snapshot.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoMode]);

  function update(mutator: (state: TrackerState) => TrackerState) {
    if (!ready.current || !current.current) return false;
    const next=mutator(current.current);
    if (next===current.current) return true;
    if (!persist(next)) return false;
    empty.current = false;
    if (!demoMode) { setSyncStatus(blocked.current ? "conflict" : "dirty"); queueSync(); }
    return true;
  }
  function importLegacy() {
    if (!legacyState || !account.current || !legacyAllowed.current) return false;
    const preview = previewBackup(current.current!, { state: legacyState }, account.current);
    if (preview.unavailablePhotos) { setStorageError("В старой копии есть ссылки на недоступные фото. Сначала экспортируйте её с изображениями из исходного аккаунта."); return false; }
    const unfinished = preview.unfinishedWorkouts ? ` Незавершённые тренировки (${preview.unfinishedWorkouts}) останутся в исходной копии и не заменят текущую сессию.` : "";
    if (!window.confirm(`Добавить старую локальную историю в этот аккаунт? Существующие записи, активная тренировка и очередь останутся без изменений. Старые команды не будут повторно отправлены.${unfinished} Обе копии будут сохранены в резерве.`)) return false;
    const saved = backupSyncConflict(account.current, 0, current.current!, legacyState);
    if (!saved.ok) { setStorageError("Не удалось создать резервную копию."); return false; }
    let imported = false;
    try { imported = update((previous) => mergeBackup(previous, { state: legacyState }, account.current!, { skipUnfinishedWorkouts: true })); }
    catch (error) { setStorageError(error instanceof Error ? error.message : "Не удалось объединить историю. Исходные данные сохранены."); }
    if (imported) setLegacyState(undefined);
    return imported;
  }
  function resolveSyncConflict(choice: "local" | "remote") {
    if (!syncConflict || !account.current) return false;
    const saved = backupSyncConflict(account.current, syncConflict.remoteRevision, current.current!, syncConflict.remote);
    if (!saved.ok) { setStorageError("Не удалось сохранить резервные копии."); return false; }
    if (choice === "remote" && !persist(syncConflict.remote)) return false;
    checkpoint(syncConflict.remote, syncConflict.remoteRevision);
    blocked.current = false; setSyncConflict(undefined); setStorageError(undefined);
    setSyncStatus(choice === "remote" ? "idle" : "dirty");
    queueSync();
    return true;
  }
  return { state, update, importLegacy, resolveSyncConflict, retrySync: () => { if (!blocked.current) void sync(); }, syncConflict, legacyState, userId, storageError, syncStatus };
}

export function TrackerProvider({ children, demoMode = false }: { children: React.ReactNode; demoMode?: boolean }) {
  const store = useTrackerStateInternal(demoMode);
  return <TrackerContext.Provider value={store}>{!store.state && store.storageError ? <main className="shell"><h1>Не удалось открыть Ритм</h1><p role="alert">{store.storageError}</p><button className="secondary" onClick={() => window.location.reload()}>Повторить</button><Link className="primary" href="/login">Войти</Link></main> : children}</TrackerContext.Provider>;
}
export function useTrackerState() {
  const store = useContext(TrackerContext);
  if (!store) throw new Error("useTrackerState must be used inside TrackerProvider");
  return store;
}
