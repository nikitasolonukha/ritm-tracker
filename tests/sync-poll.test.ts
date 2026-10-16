import assert from "node:assert/strict";
import test from "node:test";
import { canSkipPoll, syncFingerprint } from "../src/lib/sync.ts";

const local = { habits: [{ id: "a" }], outbox: [{ id: "o1", type: "habit.completed", status: "accepted" }] };
const checkpoint = { revision: 7, fingerprint: syncFingerprint(local) };

test("a background poll is skipped only when nothing changed anywhere", () => {
  assert.equal(canSkipPoll({ local, checkpoint, remoteVersion: 7 }), true);
});

test("a newer server version, a missing checkpoint or an unknown version always mean a full sync", () => {
  assert.equal(canSkipPoll({ local, checkpoint, remoteVersion: 8 }), false, "changed from Telegram or another device");
  assert.equal(canSkipPoll({ local, checkpoint, remoteVersion: 6 }), false, "server went backwards: let the full sync decide");
  assert.equal(canSkipPoll({ local, checkpoint, remoteVersion: undefined }), false);
  assert.equal(canSkipPoll({ local, remoteVersion: 7 }), false, "never synced on this device");
});

test("local changes, unsent actions or an unfinished write are never skipped", () => {
  assert.equal(canSkipPoll({ local: { ...local, habits: [{ id: "a" }, { id: "b" }] }, checkpoint, remoteVersion: 7 }), false, "edited locally");
  for (const status of ["pending", "sending", "failed"]) {
    assert.equal(canSkipPoll({ local: { ...local, outbox: [...local.outbox, { id: "o2", type: "workout.set.completed", status }] }, checkpoint, remoteVersion: 7 }), false, status);
  }
  assert.equal(canSkipPoll({ local, checkpoint, remoteVersion: 7, writeIntent: { expectedRevision: 6, fingerprint: "x" } }), false);
});

test("outbox statuses alone do not count as a local change", () => {
  const acknowledged = { ...local, outbox: [{ id: "o1", type: "habit.completed", status: "sent" }] };
  assert.equal(canSkipPoll({ local: acknowledged, checkpoint, remoteVersion: 7 }), true);
});
