import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { hashTelegramLinkToken, parseTelegramRestCallback, validateTelegramUpdate, verifyTelegramSecret } from "../src/lib/telegram.ts";

test("Telegram webhook secret comparison is exact and timing-safe", () => {
  assert.equal(verifyTelegramSecret("secret", "secret"), true);
  assert.equal(verifyTelegramSecret("secret", "other"), false);
  assert.equal(verifyTelegramSecret(null, "secret"), false);
});

test("Telegram updates require a non-negative update_id", () => {
  assert.equal(validateTelegramUpdate({ update_id: 12 }), true);
  assert.equal(validateTelegramUpdate({ update_id: -1 }), false);
  assert.equal(validateTelegramUpdate({}), false);
});

test("link tokens are stored as hashes, never raw tokens", () => {
  assert.notEqual(hashTelegramLinkToken("one-time-token"), "one-time-token");
  assert.equal(hashTelegramLinkToken("one-time-token"), hashTelegramLinkToken("one-time-token"));
});

test("Telegram rest callbacks accept only bounded, versioned actions", () => {
  assert.deepEqual(parseTelegramRestCallback("rest_add30:exercise-set-1:2"), { action: "reschedule", sourceEntityId: "exercise-set-1", sourceVersion: 2 });
  assert.deepEqual(parseTelegramRestCallback("rest_add30:workout-session:set-1:2"), { action: "reschedule", sourceEntityId: "workout-session:set-1", sourceVersion: 2 });
  assert.deepEqual(parseTelegramRestCallback("rest_skip:exercise-set-1:2"), { action: "cancel", sourceEntityId: "exercise-set-1", sourceVersion: 2 });
  assert.equal(parseTelegramRestCallback("rest_add30:exercise-set-1:0"), null);
  assert.equal(parseTelegramRestCallback("rest_add30:exercise-set-1:not-a-version"), null);
});

test("Telegram delivery SQL fences stale workers and resumes failed updates", () => {
  const migration = fs.readFileSync(new URL("../supabase/migrations/20260911130000_telegram_delivery_fencing.sql", import.meta.url), "utf8");
  assert.match(migration, /lease_token uuid/);
  assert.match(migration, /lease_token = p_lease_token/);
  assert.match(migration, /claim_telegram_update/);
  assert.match(migration, /status in \('received', 'processing', 'processed', 'failed'\)/);
});

test("permanent Telegram delivery failures mark the connection instead of retrying forever", () => {
  const migration = fs.readFileSync(new URL("../supabase/migrations/20260911140000_telegram_link_delivery_status.sql", import.meta.url), "utf8");
  const worker = fs.readFileSync(new URL("../src/app/api/telegram/worker/route.ts", import.meta.url), "utf8");
  assert.match(migration, /delivery_status text not null default 'connected'/);
  assert.match(migration, /telegram_links_delivery_status_check/);
  assert.match(worker, /response\.status === 400 \|\| response\.status === 403/);
  assert.match(worker, /delivery_status: "error"/);
  assert.match(worker, /nextStatus = permanent \? "cancelled"/);
});

test("invalid Telegram callbacks keep their update durable when acknowledgement is unavailable", () => {
  const webhook = fs.readFileSync(new URL("../src/app/api/telegram/webhook/route.ts", import.meta.url), "utf8");
  assert.match(webhook, /answerCallbackQuery\(botToken, callback\.id, "Действие устарело"\)\.catch\(\(\) => false\)/);
  assert.match(webhook, /callbackJob\.source_entity_id/);
  assert.match(webhook, /finishUpdate\("processed"\)/);
});

test("Telegram worker uses the notification job id for bounded callback data", () => {
  const worker = fs.readFileSync(new URL("../src/app/api/telegram/worker/route.ts", import.meta.url), "utf8");
  assert.match(worker, /rest_add30:\$\{job\.id\}:\$\{job\.source_version\}/);
  assert.match(worker, /rest_skip:\$\{job\.id\}:\$\{job\.source_version\}/);
});

test("Telegram timer callback version checks ignore diagnostic commands", () => {
  const migration = fs.readFileSync(new URL("../supabase/migrations/20260911150000_telegram_callback_version_scope.sql", import.meta.url), "utf8");
  assert.match(migration, /command_type like 'workout\.%'/);
});
