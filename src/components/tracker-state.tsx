"use client";

import { useEffect, useRef, useState } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { readStateSafely, writeState, type TrackerState } from "@/lib/storage";

export function useTrackerState() {
  const [state, setState] = useState<TrackerState | null>(null);
  const [userId, setUserId] = useState<string>();
  const [storageError, setStorageError] = useState<string>();
  const stateRef = useRef<TrackerState | null>(null);
  const identityReady = useRef(false);
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
    setStorageError(undefined);
    return true;
  }
  return { state, update, userId, storageError };
}
