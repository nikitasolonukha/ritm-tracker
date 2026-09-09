import { createHash, timingSafeEqual } from "node:crypto";

export type TelegramUpdate = {
  update_id: number;
  callback_query?: { id: string; data?: string; from?: { id: number }; message?: { chat?: { id: number } } };
  message?: { chat?: { id: number }; text?: string };
};

export function verifyTelegramSecret(actual: string | null, expected: string | undefined): boolean {
  if (!actual || !expected) return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function validateTelegramUpdate(update: unknown): update is TelegramUpdate {
  if (!update || typeof update !== "object") return false;
  const candidate = update as Partial<TelegramUpdate>;
  return Number.isSafeInteger(candidate.update_id) && candidate.update_id! >= 0;
}

export function hashTelegramLinkToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
