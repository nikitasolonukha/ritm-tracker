import assert from "node:assert/strict";
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
  assert.deepEqual(parseTelegramRestCallback("rest_skip:exercise-set-1:2"), { action: "cancel", sourceEntityId: "exercise-set-1", sourceVersion: 2 });
  assert.equal(parseTelegramRestCallback("rest_add30:exercise-set-1:0"), null);
  assert.equal(parseTelegramRestCallback("rest_add30:exercise-set-1:not-a-version"), null);
});
