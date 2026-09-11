"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { backupSyncConflict, readOutboxAcks, readStateSafely, writeOutboxAck, writeState, type TrackerState } from "@/lib/storage";
import { stableStringify } from "@/lib/tracker";
import { decideLostPutResponse, prepareSyncPayload } from "@/lib/sync";
import { setServiceWorkerAccount } from "@/lib/pwa";

type SyncConflict = { local: TrackerState; remote: TrackerState; remoteRevision: number };
export type SyncStatus = "idle" | "loading" | "dirty" | "syncing" | "offline" | "conflict" | "error";
type TrackerStore = { state: TrackerState | null; update: (mutator: (state: TrackerState) => TrackerState) => boolean; importLegacy: () => boolean; resolveSyncConflict: (choice: "local" | "remote") => boolean; retrySync: () => void; syncConflict?: SyncConflict; legacyState?: TrackerState; userId?: string; storageError?: string; syncStatus: SyncStatus };
const TrackerContext = createContext<TrackerStore | null>(null);

async function fetchWithRetry(input: RequestInfo | URL, init: RequestInit = {}, attempts = 3): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(input, { ...init, signal: controller.signal });
      window.clearTimeout(timeout);
      if (response.status >= 500 && attempt + 1 < attempts) { await new Promise((resolve) => window.setTimeout(resolve, 400 * (attempt + 1))); continue; }
      return response;
    } catch (error) {
      window.clearTimeout(timeout);
      lastError = error;
      if (attempt + 1 < attempts) await new Promise((resolve) => window.setTimeout(resolve, 400 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("network request failed");
}

async function fetchOnce(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8000);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

function useTrackerStateInternal(): TrackerStore {
  const [state, setState] = useState<TrackerState | null>(null);
  const [userId, setUserId] = useState<string>();
  const [storageError, setStorageError] = useState<string>();
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("loading");
  const [legacyState, setLegacyState] = useState<TrackerState>();
  const [syncConflict, setSyncConflict] = useState<SyncConflict>();
  const stateRef = useRef<TrackerState | null>(null);
  const userIdRef = useRef<string | undefined>(undefined);
  const identityReady = useRef(false);
  const revisionRef = useRef<number | null>(null);
  const syncQueue = useRef(Promise.resolve());
  const actionSeqRef = useRef(0);
  const syncBlockedRef = useRef(false);
  const sentOutboxRef = useRef(new Set<string>());
  function persistOutboxStatus(id: string, status: TrackerState["outbox"][number]["status"]) {
    const current = stateRef.current;
    if (!current || !current.outbox.some((item) => item.id === id && item.status !== status)) return true;
    const next = { ...current, outbox: current.outbox.map((item) => item.id === id ? { ...item, status } : item) };
    const saved = writeState(next, userId);
    if (!saved.ok) { setStorageError(saved.error ?? "Не удалось обновить очередь синхронизации"); return false; }
    stateRef.current = next;
    setState(next);
    return true;
  }
  useEffect(() => {
    let active = true;
    let request: ReturnType<typeof createClient>;
    try {
      request = createClient();
    } catch {
      const local = readStateSafely();
      identityReady.current = true;
      if (local.status === "corrupt" || local.status === "unsupported" || local.status === "unavailable") setStorageError(local.error ?? "Локальные данные недоступны");
      stateRef.current = local.state;
      setState(local.state);
      setSyncStatus("idle");
      return () => { active = false; };
    }
    void request.auth.getUser().then(({ data, error }) => {
      if (!active) return;
      if (error) {
        if (isSupabaseConfigured) { setSyncStatus("error"); setStorageError("Не удалось подтвердить аккаунт"); return; }
        const local = readStateSafely();
        identityReady.current = true;
        stateRef.current = local.state;
        setState(local.state);
        setSyncStatus("idle");
        return;
      }
      setUserId(data.user?.id);
      userIdRef.current = data.user?.id;
      setServiceWorkerAccount(data.user?.id);
      sentOutboxRef.current = readOutboxAcks(data.user?.id);
      if (!data.user && isSupabaseConfigured) { setSyncStatus("error"); setStorageError("Войдите, чтобы открыть личный трекер"); return; }
      const local = readStateSafely(data.user?.id);
      const localAtFetch = local.state;
      const actionSeqAtFetch = actionSeqRef.current;
      if (data.user?.id && local.status === "empty") {
        const legacy = readStateSafely();
        if (legacy.status === "loaded") setLegacyState(legacy.state);
      }
      identityReady.current = true;
      if (local.status === "corrupt" || local.status === "unsupported" || local.status === "unavailable") setStorageError(local.error ?? "Локальные данные недоступны");
      stateRef.current = local.state;
      setState(local.state);
      setSyncStatus(data.user && isSupabaseConfigured ? "loading" : "idle");
      if (data.user && isSupabaseConfigured) {
        void fetchWithRetry("/api/sync", { cache: "no-store" }).then(async (response) => {
          if (!response.ok) throw new Error("sync read failed");
          const remote = await response.json() as { payload?: TrackerState | null; version?: number };
          if (local.status === "empty" && remote.payload) {
            setLegacyState(undefined);
            const saved = writeState(remote.payload, data.user.id);
            if (saved.ok && actionSeqRef.current === actionSeqAtFetch) { revisionRef.current = remote.version ?? 0; stateRef.current = remote.payload; setState(remote.payload); }
            else if (stableStringify(remote.payload) === stableStringify(stateRef.current)) revisionRef.current = remote.version ?? 0;
            else {
              syncBlockedRef.current = true;
              if (stateRef.current) setSyncConflict({ local: stateRef.current, remote: remote.payload, remoteRevision: remote.version ?? 0 });
              setStorageError("Есть изменения на другом устройстве. Выберите копию для продолжения.");
            }
          } else if (remote.payload) {
            const remoteMatchesFetchBase = stableStringify(remote.payload) === stableStringify(localAtFetch);
            const same = stableStringify(remote.payload) === stableStringify(stateRef.current);
            if (same) {
              revisionRef.current = remote.version ?? 0;
              setSyncStatus("idle");
            } else if (actionSeqRef.current !== actionSeqAtFetch && remoteMatchesFetchBase) {
              revisionRef.current = remote.version ?? 0;
              setSyncStatus("dirty");
              queueSync();
            } else {
              syncBlockedRef.current = true;
              if (stateRef.current) setSyncConflict({ local: stateRef.current, remote: remote.payload, remoteRevision: remote.version ?? 0 });
              setSyncStatus("conflict");
              setStorageError("Есть изменения на другом устройстве. Выберите копию для продолжения.");
            }
          } else {
            revisionRef.current = remote.version ?? 0;
            const shouldUploadLocal = local.status === "loaded" || actionSeqRef.current !== actionSeqAtFetch;
            setSyncStatus(shouldUploadLocal ? "dirty" : "idle");
            if (shouldUploadLocal) queueSync();
          }
        }).catch(() => { setSyncStatus("offline"); setStorageError("Синхронизация недоступна; локальные изменения сохранены"); });
      }
    }).catch(() => {
      if (active) { setSyncStatus("offline"); setStorageError("Не удалось проверить аккаунт"); }
    });
    const recover = () => { if (navigator.onLine) queueSync(); };
    window.addEventListener("online", recover);
    window.addEventListener("visibilitychange", recover);
    return () => { active = false; window.removeEventListener("online", recover); window.removeEventListener("visibilitychange", recover); };
  // queueSync is backed by refs so recovery observes the latest local snapshot.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function queueSync() {
    if (!userIdRef.current || !isSupabaseConfigured || !stateRef.current) return;
    const snapshot = stateRef.current;
    setSyncStatus("syncing");
    syncQueue.current = syncQueue.current.then(async () => {
      if (syncBlockedRef.current) return;
      if (revisionRef.current == null) {
        const response = await fetchWithRetry("/api/sync", { cache: "no-store" });
        if (!response.ok) throw new Error("sync read failed");
        const remote = await response.json() as { payload?: TrackerState | null; version?: number };
        revisionRef.current = remote.version ?? 0;
      }
      const expectedRevision = revisionRef.current;
      const payload = prepareSyncPayload(JSON.parse(stableStringify(snapshot)) as TrackerState);
      let response: Response;
      try {
        response = await fetchOnce("/api/sync", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ payload, expectedRevision }) });
      } catch {
        const recovery = await fetchWithRetry("/api/sync", { cache: "no-store" });
        if (!recovery.ok) throw new Error("sync recovery read failed");
        const remote = await recovery.json() as { payload?: TrackerState | null; version?: number };
        const decision = decideLostPutResponse(payload, expectedRevision, remote);
        if (decision.action === "accepted") {
          revisionRef.current = decision.revision;
          setSyncStatus("idle");
          return;
        }
        if (decision.action === "retry") {
          response = await fetchOnce("/api/sync", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ payload, expectedRevision }) });
        } else {
          syncBlockedRef.current = true;
          if (remote.payload && stateRef.current) setSyncConflict({ local: stateRef.current, remote: remote.payload, remoteRevision: decision.revision });
          setSyncStatus("conflict");
          setStorageError("Есть конфликт на другом устройстве. Выберите копию для продолжения.");
          return;
        }
      }
      if (response.status === 409) {
        const conflict = await response.json().catch(() => ({})) as { remote?: TrackerState; revision?: number };
        syncBlockedRef.current = true;
        if (conflict.remote && stateRef.current) setSyncConflict({ local: stateRef.current, remote: conflict.remote, remoteRevision: conflict.revision ?? expectedRevision + 1 });
        setSyncStatus("conflict");
        setStorageError("Есть конфликт на другом устройстве. Выберите копию для продолжения.");
        return;
      }
      if (!response.ok) throw new Error("sync write failed");
      const saved = await response.json() as { revision?: number };
      revisionRef.current = saved.revision ?? expectedRevision + 1;
      const syncOnly = snapshot.outbox.filter((item) => ["habit.completed", "habit.cancelled"].includes(item.type) && ["pending", "sending", "failed"].includes(item.status) && !sentOutboxRef.current.has(item.id));
      for (const item of syncOnly) {
        if (!persistOutboxStatus(item.id, "accepted")) throw new Error("outbox status write failed");
        const acknowledgement = writeOutboxAck(item.id, userIdRef.current);
        if (!acknowledgement.ok) throw new Error(acknowledgement.error ?? "outbox acknowledgement write failed");
        sentOutboxRef.current.add(item.id);
      }
      const pending = snapshot.outbox.filter((item) => ["workout.set.completed", "timer.rescheduled", "timer.cancelled"].includes(item.type) && ["pending", "failed", "sending"].includes(item.status) && !sentOutboxRef.current.has(item.id));
      for (const item of pending) {
        const details = item.payload as { dueAt?: string; expiresAt?: string; message?: string } | undefined;
        if (item.type === "workout.set.completed" && (!details?.dueAt || !details.expiresAt)) continue;
        const isTimerCommand = item.type !== "workout.set.completed";
        if (!persistOutboxStatus(item.id, "sending")) throw new Error("outbox status write failed");
        const commandResponse = await fetchWithRetry(isTimerCommand ? "/api/workout/timer" : "/api/workout/command", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(isTimerCommand ? { commandKey: item.id, sourceEntityId: item.entityId, payload: { ...details, itemId: item.id }, sourceVersion: item.version ?? 1, action: item.type === "timer.cancelled" ? "cancel" : "reschedule", dueAt: details?.dueAt, expiresAt: details?.expiresAt, message: details?.message } : { commandKey: item.id, sourceEntityId: item.entityId, payload: { ...details, itemId: item.id }, sourceVersion: item.version ?? 1, dueAt: details?.dueAt, expiresAt: details?.expiresAt, message: details?.message ?? "Ритм: отдых завершен. Открой тренировку для следующего подхода." }) });
        if (!commandResponse.ok) { persistOutboxStatus(item.id, "failed"); throw new Error("workout command failed"); }
        const acknowledgement = writeOutboxAck(item.id, userIdRef.current);
        if (!acknowledgement.ok) { persistOutboxStatus(item.id, "failed"); throw new Error(acknowledgement.error ?? "outbox acknowledgement write failed"); }
        if (!persistOutboxStatus(item.id, "accepted")) throw new Error("outbox status write failed");
        sentOutboxRef.current.add(item.id);
      }
      setSyncStatus("idle");
    }).catch(() => { setSyncStatus("offline"); setStorageError("Нет связи с сервером; изменение осталось локально"); });
  }
  function retrySync() { syncBlockedRef.current = false; setStorageError(undefined); queueSync(); }
  function update(mutator: (state: TrackerState) => TrackerState) {
    if (!identityReady.current || !stateRef.current) return false;
    actionSeqRef.current += 1;
    const next = mutator(stateRef.current);
    const result = writeState(next, userId);
    if (!result.ok) { setStorageError(result.error ?? "Не удалось сохранить изменения"); return false; }
    stateRef.current = next;
    setState(next);
    if (userId && isSupabaseConfigured) {
      setSyncStatus("dirty");
      queueSync();
    }
    if (!syncBlockedRef.current) setStorageError(undefined);
    return true;
  }
  function importLegacy() {
    if (!identityReady.current || !stateRef.current || !userId || !legacyState) return false;
    const imported = update(() => legacyState);
    if (imported) setLegacyState(undefined);
    return imported;
  }
  function resolveSyncConflict(choice: "local" | "remote") {
    if (!syncConflict || !userId || !identityReady.current) return false;
    const backup = backupSyncConflict(userId, syncConflict.remoteRevision, syncConflict.local, syncConflict.remote);
    if (!backup.ok) { setStorageError(backup.error ?? "Не удалось сохранить резервные копии конфликта"); return false; }
    if (choice === "remote") {
      const saved = writeState(syncConflict.remote, userId);
      if (!saved.ok) { setStorageError(saved.error ?? "Не удалось сохранить серверную копию"); return false; }
      syncBlockedRef.current = false;
      revisionRef.current = syncConflict.remoteRevision;
      stateRef.current = syncConflict.remote;
      setState(syncConflict.remote);
      setSyncConflict(undefined);
      setStorageError(undefined);
      return true;
    }
    syncBlockedRef.current = false;
    revisionRef.current = syncConflict.remoteRevision;
    setSyncConflict(undefined);
    return update((current) => current);
  }
  return { state, update, importLegacy, resolveSyncConflict, retrySync, syncConflict, legacyState, userId, storageError, syncStatus };
}

export function TrackerProvider({ children }: { children: React.ReactNode }) {
  return <TrackerContext.Provider value={useTrackerStateInternal()}>{children}</TrackerContext.Provider>;
}

export function useTrackerState() {
  const store = useContext(TrackerContext);
  if (!store) throw new Error("useTrackerState must be used inside TrackerProvider");
  return store;
}
