"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { readStateSafely, writeState, type TrackerState } from "@/lib/storage";
import { stableStringify } from "@/lib/tracker";

type TrackerStore = { state: TrackerState | null; update: (mutator: (state: TrackerState) => TrackerState) => boolean; userId?: string; storageError?: string };
const TrackerContext = createContext<TrackerStore | null>(null);

function useTrackerStateInternal(): TrackerStore {
  const [state, setState] = useState<TrackerState | null>(null);
  const [userId, setUserId] = useState<string>();
  const [storageError, setStorageError] = useState<string>();
  const stateRef = useRef<TrackerState | null>(null);
  const identityReady = useRef(false);
  const revisionRef = useRef(0);
  const syncQueue = useRef(Promise.resolve());
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
        void fetch("/api/sync", { cache: "no-store" }).then(async (response) => {
          if (!response.ok) throw new Error("sync read failed");
          const remote = await response.json() as { payload?: TrackerState | null; version?: number };
          revisionRef.current = remote.version ?? 0;
          if (local.status === "empty" && remote.payload) {
            const saved = writeState(remote.payload, data.user.id);
            if (saved.ok) { stateRef.current = remote.payload; setState(remote.payload); }
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
    const next = mutator(stateRef.current);
    const result = writeState(next, userId);
    if (!result.ok) { setStorageError(result.error ?? "Не удалось сохранить изменения"); return false; }
    stateRef.current = next;
    setState(next);
    if (userId && isSupabaseConfigured) {
      const payload = JSON.parse(stableStringify(next)) as TrackerState;
      syncQueue.current = syncQueue.current.then(async () => {
        const response = await fetch("/api/sync", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ payload, expectedRevision: revisionRef.current }) });
        if (response.status === 409) { setStorageError("Есть конфликт на другом устройстве. Локальная копия сохранена."); return; }
        if (!response.ok) throw new Error("sync write failed");
        const saved = await response.json() as { revision?: number };
        revisionRef.current = saved.revision ?? revisionRef.current + 1;
        const pending = next.outbox.filter((item) => item.type === "workout.set.completed" && item.status === "pending");
        for (const item of pending) {
          const details = item.payload as { dueAt?: string; expiresAt?: string; message?: string; sessionId?: string } | undefined;
          if (!details?.dueAt || !details.expiresAt) continue;
          await fetch("/api/workout/command", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ commandKey: item.id, sourceEntityId: item.entityId, payload: { ...details, itemId: item.id }, sourceVersion: item.version ?? 1, dueAt: details.dueAt, expiresAt: details.expiresAt, message: details.message ?? "Ритм: отдых завершен. Открой тренировку для следующего подхода." }) });
        }
      }).catch(() => setStorageError("Нет связи с сервером; изменение осталось локально"));
    }
    setStorageError(undefined);
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
