import { stableStringify } from "./tracker.ts";

export type SyncRecoveryRemote<T> = { payload?: T | null; version?: number };

export function decideLostPutResponse<T>(sentPayload: T, expectedRevision: number, remote: SyncRecoveryRemote<T>) {
  const remoteRevision = remote.version ?? 0;
  if (remote.payload && stableStringify(remote.payload) === stableStringify(sentPayload) && remoteRevision > expectedRevision) {
    return { action: "accepted" as const, revision: remoteRevision };
  }
  if (remoteRevision === expectedRevision) return { action: "retry" as const, revision: expectedRevision };
  return { action: "conflict" as const, revision: remoteRevision };
}
