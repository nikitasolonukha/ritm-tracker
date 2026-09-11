import { stableStringify } from "./tracker.ts";

export type SyncRecoveryRemote<T> = { payload?: T | null; version?: number };

const syncOnlyOutboxTypes = new Set(["habit.completed", "habit.cancelled"]);

export function prepareSyncPayload<T extends { outbox?: Array<{ type: string; status: string }> }>(state: T): T {
  if (!state.outbox?.some((item) => syncOnlyOutboxTypes.has(item.type) && ["pending", "sending", "failed"].includes(item.status))) return state;
  return {
    ...state,
    outbox: state.outbox.map((item) => syncOnlyOutboxTypes.has(item.type) && ["pending", "sending", "failed"].includes(item.status)
      ? { ...item, status: "accepted" }
      : item),
  } as T;
}

export function decideLostPutResponse<T>(sentPayload: T, expectedRevision: number, remote: SyncRecoveryRemote<T>) {
  const remoteRevision = remote.version ?? 0;
  if (remote.payload && stableStringify(remote.payload) === stableStringify(sentPayload) && remoteRevision > expectedRevision) {
    return { action: "accepted" as const, revision: remoteRevision };
  }
  if (remoteRevision === expectedRevision) return { action: "retry" as const, revision: expectedRevision };
  return { action: "conflict" as const, revision: remoteRevision };
}
