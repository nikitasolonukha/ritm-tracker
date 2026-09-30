import { stableStringify } from "./tracker.ts";

export type SyncRecoveryRemote<T> = { payload?: T | null; version?: number };
export type SyncWriteIntent = { expectedRevision: number; fingerprint: string };

export function syncFingerprint(state: { outbox?: Array<{ status: string }> }): string {
  return stableStringify({ ...state, outbox: state.outbox?.map((item) => ({ ...item, status: "transport" })) });
}

export function confirmedSyncWrite<T extends { outbox?: Array<{ status: string }> }>(intent: SyncWriteIntent | undefined, remote: SyncRecoveryRemote<T>): string | undefined {
  if (intent && remote.payload && (remote.version ?? 0) > intent.expectedRevision && syncFingerprint(remote.payload) === intent.fingerprint) return intent.fingerprint;
  return undefined;
}

export function decideSyncDirection(local: { outbox?: Array<{ status: string }> }, remote: typeof local | null | undefined, base?: string, localEmpty = false) {
  if (!remote) return "upload" as const;
  const localKey = syncFingerprint(local);
  const remoteKey = syncFingerprint(remote);
  if (localKey === remoteKey) return "same" as const;
  if (localEmpty || (base && base === localKey)) return "download" as const;
  if (base && base === remoteKey) return "upload" as const;
  return "conflict" as const;
}

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

export function acknowledgeSavedHabits<T extends { outbox?: Array<{ id: string; type: string; status: string }> }>(current: T, saved: T): T {
  const ids = new Set(saved.outbox?.filter((item) => syncOnlyOutboxTypes.has(item.type)).map((item) => item.id));
  if (!current.outbox?.some((item) => ids.has(item.id) && item.status !== "accepted")) return current;
  return { ...current, outbox: current.outbox.map((item) => ids.has(item.id) ? { ...item, status: "accepted" } : item) } as T;
}

export function decideLostPutResponse<T>(sentPayload: T, expectedRevision: number, remote: SyncRecoveryRemote<T>) {
  const remoteRevision = remote.version ?? 0;
  if (remote.payload && stableStringify(remote.payload) === stableStringify(sentPayload) && remoteRevision > expectedRevision) {
    return { action: "accepted" as const, revision: remoteRevision };
  }
  if (remoteRevision === expectedRevision) return { action: "retry" as const, revision: expectedRevision };
  return { action: "conflict" as const, revision: remoteRevision };
}
