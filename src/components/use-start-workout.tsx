"use client";

import { useRouter } from "next/navigation";
import { useTrackerState } from "./tracker-state";
import { useConfirm } from "./ui";
import { startWorkoutSession, type SessionTrackerState } from "@/lib/workout-session";

/** Старт тренировки по программе одним действием. Если после прошлой прошло меньше двух суток, один раз спрашивает. */
export function useStartWorkout() {
  const router = useRouter();
  const { state, update } = useTrackerState();
  const { confirm, dialog } = useConfirm();
  const start = async (templateId: string) => {
    const sessionState = state as SessionTrackerState | null;
    const active = sessionState?.workoutSessions?.find((session) => session.status === "active");
    if (active) { router.push(`/workout/${active.id}`); return; }
    const latest = (sessionState?.workoutSessions ?? []).filter((session) => session.status === "completed" || session.status === "partial").at(-1);
    if (latest && Date.now() - Date.parse(latest.finishedAt ?? latest.startedAt) < 48 * 3600_000
      && !(await confirm("Между тренировками рекомендуется полный день отдыха. Всё равно начать?", { title: "Прошло меньше двух дней", confirmLabel: "Всё равно начать" }))) return;
    let sessionId: string | undefined;
    const saved = update((previous) => {
      const result = startWorkoutSession(previous as SessionTrackerState, templateId);
      if (!result) return previous;
      sessionId = result.sessionId;
      return result.state;
    });
    if (saved && sessionId) router.push(`/workout/${sessionId}`);
  };
  return { start, dialog };
}
