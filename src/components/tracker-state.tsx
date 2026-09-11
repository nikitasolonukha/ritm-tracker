"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { readStateSafely, writeState, type TrackerState } from "@/lib/storage";
import { stableStringify } from "@/lib/tracker";

type TrackerStore = { state: TrackerState | null; update: (mutator: (state: TrackerState) => TrackerState) => boolean; userId?: string; storageError?: string };
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

function useTrackerStateInternal(): TrackerStore {
  const [state, setState] = useState<TrackerState | null>(null);
  const [userId, setUserId] = useState<string>();
  const [storageError, setStorageError] = useState<string>();
  const stateRef = useRef<TrackerState | null>(null);
  const identityReady = useRef(false);
  const revisionRef = useRef<number | null>(null);
  const syncQueue = useRef(Promise.resolve());
  const actionSeqRef = useRef(0);
  const syncBlockedRef = useRef(false);
  const sentOutboxRef = useRef(new Set<string>());
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
      return () => { active = false; };
    }
    void request.auth.getUser().then(({ data, error }) => {
      if (!active) return;
      if (error) {
        if (isSupabaseConfigured) { setStorageError("Не удалось подтвердить аккаунт"); return; }
        const local = readStateSafely();
        identityReady.current = true;
        stateRef.current = local.state;
        setState(local.state);
        return;
      }
      setUserId(data.user?.id);
      if (!data.user && isSupabaseConfigured) { setStorageError("Войдите, чтобы открыть личный трекер"); return; }
      const local = readStateSafely(data.user?.id);
      identityReady.current = true;
      if (local.status === "corrupt" || local.status === "unsupported" || local.status === "unavailable") setStorageError(local.error ?? "Локальные данные недоступны");
      stateRef.current = local.state;
      setState(local.state);
      if (data.user && isSupabaseConfigured) {
        const actionSeqAtFetch = actionSeqRef.current;
        void fetchWithRetry("/api/sync", { cache: "no-store" }).then(async (response) => {
          if (!response.ok) throw new Error("sync read failed");
          const remote = await response.json() as { payload?: TrackerState | null; version?: number };
          if (local.status === "empty" && remote.payload) {
            const saved = writeState(remote.payload, data.user.id);
            if (saved.ok && actionSeqRef.current === actionSeqAtFetch) { revisionRef.current = remote.version ?? 0; stateRef.current = remote.payload; setState(remote.payload); }
            else if (stableStringify(remote.payload) === stableStringify(stateRef.current)) revisionRef.current = remote.version ?? 0;
            else { syncBlockedRef.current = true; setStorageError("Есть изменения на другом устройстве. Локальная копия сохранена до сверки."); }
          } else if (remote.payload) {
            const same = stableStringify(remote.payload) === stableStringify(stateRef.current);
            if (same) revisionRef.current = remote.version ?? 0;
            else {
              syncBlockedRef.current = true;
              setStorageError("Есть изменения на другом устройстве. Локальная копия сохранена до сверки.");
            }
          } else {
            revisionRef.current = remote.version ?? 0;
          }
        }).catch(() => setStorageError("Синхронизация недоступна; локальные изменения сохранены"));
      }
    }).catch(() => {
      if (active) setStorageError("Не удалось проверить аккаунт");
    });
    return () => { active = false; };
  }, []);
  function update(mutator: (state: TrackerState) => TrackerState) {
    if (!identityReady.current || !stateRef.current) return false;
    actionSeqRef.current += 1;
    const next = mutator(stateRef.current);
    const result = writeState(next, userId);
    if (!result.ok) { setStorageError(result.error ?? "Не удалось сохранить изменения"); return false; }
    stateRef.current = next;
    setState(next);
    if (userId && isSupabaseConfigured) {
      let payload: TrackerState;
      try { payload = JSON.parse(stableStringify(next)) as TrackerState; }
      catch { setStorageError("Локально сохранено, но данные не удалось подготовить к синхронизации"); return true; }
      syncQueue.current = syncQueue.current.then(async () => {
        if (syncBlockedRef.current) return;
        if (revisionRef.current == null) {
          const syncRead = await fetchWithRetry("/api/sync", { cache: "no-store" });
          if (!syncRead.ok) throw new Error("sync read failed");
          const remote = await syncRead.json() as { payload?: TrackerState | null; version?: number };
          if (remote.payload && stableStringify(remote.payload) !== stableStringify(stateRef.current)) {
            syncBlockedRef.current = true;
            setStorageError("Есть изменения на другом устройстве. Локальная копия сохранена до сверки.");
            return;
          }
          revisionRef.current = remote.version ?? 0;
        }
        const expectedRevision = revisionRef.current;
        const response = await fetchWithRetry("/api/sync", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ payload, expectedRevision }) });
        if (response.status === 409) { syncBlockedRef.current = true; setStorageError("Есть конфликт на другом устройстве. Локальная копия сохранена."); return; }
        if (!response.ok) throw new Error("sync write failed");
        const saved = await response.json() as { revision?: number };
        revisionRef.current = saved.revision ?? expectedRevision + 1;
        const pending = next.outbox.filter((item) => ["workout.set.completed", "timer.rescheduled", "timer.cancelled"].includes(item.type) && item.status === "pending" && !sentOutboxRef.current.has(item.id));
        for (const item of pending) {
          const details = item.payload as { dueAt?: string; expiresAt?: string; message?: string; sessionId?: string; sourceId?: string } | undefined;
          if (item.type === "workout.set.completed" && (!details?.dueAt || !details.expiresAt)) continue;
          if (item.type !== "workout.set.completed" && item.type !== "timer.rescheduled" && item.type !== "timer.cancelled") continue;
          const isTimerCommand = item.type !== "workout.set.completed";
          const commandResponse = await fetchWithRetry(isTimerCommand ? "/api/workout/timer" : "/api/workout/command", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(isTimerCommand ? { commandKey: item.id, sourceEntityId: item.entityId, payload: { ...details, itemId: item.id }, sourceVersion: item.version ?? 1, action: item.type === "timer.cancelled" ? "cancel" : "reschedule", dueAt: details?.dueAt, expiresAt: details?.expiresAt, message: details?.message } : { commandKey: item.id, sourceEntityId: item.entityId, payload: { ...details, itemId: item.id }, sourceVersion: item.version ?? 1, dueAt: details?.dueAt, expiresAt: details?.expiresAt, message: details?.message ?? "Ритм: отдых завершен. Открой тренировку для следующего подхода." }) });
          if (!commandResponse.ok) throw new Error("workout command failed");
          sentOutboxRef.current.add(item.id);
        }
      }).catch(() => setStorageError("Нет связи с сервером; изменение осталось локально"));
    }
    if (!syncBlockedRef.current) setStorageError(undefined);
    return true;
  }
  return { state, update, userId, storageError };
}

export function TrackerProvider({ children }: { children: React.ReactNode }) {
  return <TrackerContext.Provider value={useTrackerStateInternal()}>{children}</TrackerContext.Provider>;
}

export function useTrackerState() {
  const store = useContext(TrackerContext);
  if (!store) throw new Error("useTrackerState must be used inside TrackerProvider");
  return store;
}
