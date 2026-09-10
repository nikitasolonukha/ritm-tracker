"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { readStateSafely, writeState, type TrackerState } from "@/lib/storage";

export function useTrackerState() {
  const [state, setState] = useState<TrackerState | null>(null);
  const [userId, setUserId] = useState<string>();
  useEffect(() => {
    let active = true;
    let request: ReturnType<typeof createClient>;
    try {
      request = createClient();
    } catch {
      setState(readStateSafely().state);
      return () => { active = false; };
    }
    void request.auth.getUser().then(({ data, error }) => {
      if (!active) return;
      if (error) {
        setState(readStateSafely().state);
        return;
      }
      setUserId(data.user?.id);
      setState(readStateSafely(data.user?.id).state);
    }).catch(() => {
      if (active) setState(readStateSafely().state);
    });
    return () => { active = false; };
  }, []);
  function update(mutator: (state: TrackerState) => TrackerState) {
    setState((previous) => {
      if (!previous) return previous;
      const next = mutator(previous);
      writeState(next, userId);
      return next;
    });
  }
  return { state, update, userId };
}
