"use client";

import { useEffect } from "react";

type WakeLockSentinelLike = { release: () => Promise<void>; addEventListener?: (type: "release", listener: () => void) => void };
type WakeLockNavigator = Navigator & { wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> } };

/**
 * Держит экран включённым, пока идёт тренировка: иначе телефон гаснет посреди отдыха.
 * Блокировка снимается системой при сворачивании приложения, поэтому берём её заново при возврате.
 * Если браузер не умеет (или запретил), приложение просто работает как раньше.
 */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    const api = (navigator as WakeLockNavigator).wakeLock;
    if (!active || !api) return;
    let sentinel: WakeLockSentinelLike | undefined;
    let cancelled = false;
    const acquire = async () => {
      if (cancelled || document.visibilityState !== "visible" || sentinel) return;
      try {
        const lock = await api.request("screen");
        if (cancelled) { void lock.release().catch(() => undefined); return; }
        sentinel = lock;
        lock.addEventListener?.("release", () => { if (sentinel === lock) sentinel = undefined; });
      } catch { /* экономия заряда или запрет: не страшно */ }
    };
    const onVisible = () => { if (document.visibilityState === "visible") void acquire(); };
    document.addEventListener("visibilitychange", onVisible);
    void acquire();
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void sentinel?.release().catch(() => undefined);
    };
  }, [active]);
}
