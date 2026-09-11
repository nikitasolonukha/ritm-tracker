import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { hashTelegramLinkToken, parseTelegramRestCallback, validateTelegramUpdate, verifyTelegramSecret, type TelegramUpdate } from "@/lib/telegram";

export const runtime = "nodejs";

async function answerCallbackQuery(botToken: string, callbackId: string, text: string) {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackId, text, show_alert: false }),
  });
  const payload = await response.json().catch(() => ({})) as { ok?: boolean };
  return response.ok && payload.ok === true;
}

export async function POST(request: NextRequest) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!verifyTelegramSecret(request.headers.get("x-telegram-bot-api-secret-token"), secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let update: unknown;
  try {
    update = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!validateTelegramUpdate(update)) return NextResponse.json({ error: "invalid_update" }, { status: 400 });
  const telegramUpdate = update as TelegramUpdate;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!url || !serviceRoleKey || !botToken) return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: claim, error: claimError } = await admin.rpc("claim_telegram_update", { p_update_id: telegramUpdate.update_id, p_payload: telegramUpdate });
  if (claimError || !claim || typeof claim !== "object") return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  const claimStatus = (claim as { status?: string }).status;
  if (claimStatus === "processed") return NextResponse.json({ accepted: true, updateId: telegramUpdate.update_id, duplicate: true });
  if (claimStatus === "busy") return NextResponse.json({ accepted: true, updateId: telegramUpdate.update_id, busy: true }, { status: 202 });
  const processingToken = (claim as { processing_token?: string }).processing_token;
  if (!processingToken) return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  async function finishUpdate(status: "processed" | "failed", error?: string) {
    const result = await admin.rpc("finish_telegram_update", {
      p_update_id: telegramUpdate.update_id,
      p_processing_token: processingToken,
      p_status: status,
      p_error: error ?? null,
    });
    return !result.error && result.data === true;
  }
  if (telegramUpdate.callback_query) {
    const callback = telegramUpdate.callback_query;
    const telegramUserId = callback.from?.id;
    const chatId = callback.message?.chat?.id;
    const parsed = parseTelegramRestCallback(callback.data);
    if (!telegramUserId || (chatId != null && chatId !== telegramUserId) || !parsed) {
      const acknowledged = await answerCallbackQuery(botToken, callback.id, "Действие устарело");
      if (!await finishUpdate("processed")) return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
      return NextResponse.json({ accepted: true, updateId: telegramUpdate.update_id, callback: "invalid", acknowledgement: acknowledged ? "sent" : "unknown" }, { status: acknowledged ? 200 : 202 });
    }
    const { action, sourceEntityId, sourceVersion } = parsed;
    const { data: command, error: commandError } = await admin.rpc("accept_telegram_timer_command", {
      p_telegram_user_id: telegramUserId,
      p_command_key: `telegram-callback-${telegramUpdate.update_id}`,
      p_entity_id: sourceEntityId,
      p_payload: { source: "telegram", callbackId: callback.id, action },
      p_source_version: sourceVersion,
      p_action: action,
    });
    if (commandError) {
      await finishUpdate("failed", "timer command unavailable");
      return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
    }
    const acknowledged = await answerCallbackQuery(botToken, callback.id, action === "cancel" ? "Отдых пропущен" : "Отдых продлен на 30 секунд").catch(() => false);
    if (!await finishUpdate("processed")) return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
    return NextResponse.json({ accepted: true, updateId: telegramUpdate.update_id, callback: command?.status ?? "accepted", acknowledgement: acknowledged ? "sent" : "unknown" }, { status: acknowledged ? 200 : 202 });
  }
  if (telegramUpdate.message?.text?.startsWith("/start ") && telegramUpdate.message.chat?.id != null) {
    const rawToken = telegramUpdate.message.text.slice(7).trim();
    if (rawToken) {
      const { data: link, error: linkLookupError } = await admin.from("telegram_links")
        .select("user_id")
        .eq("token_hash", hashTelegramLinkToken(rawToken))
        .gt("token_expires_at", new Date().toISOString())
        .maybeSingle();
      if (linkLookupError) {
        await finishUpdate("failed", "telegram link lookup unavailable");
        return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
      }
      if (link) {
        const connectedAt = new Date().toISOString();
        const tokenHash = hashTelegramLinkToken(rawToken);
        const { data: linkedRow, error: linkUpdateError } = await admin.from("telegram_links")
          .update({ token_hash: hashTelegramLinkToken(randomUUID()), expires_at: connectedAt, token_expires_at: connectedAt, telegram_user_id: telegramUpdate.message.chat.id, confirmed_at: connectedAt, connected_at: connectedAt, revoked_at: null, delivery_status: "connected", last_delivery_error: null, last_delivery_error_at: null })
          .eq("user_id", link.user_id)
          .eq("token_hash", tokenHash)
          .select("user_id")
          .maybeSingle();
        if (linkUpdateError) {
          await finishUpdate("failed", "telegram link update unavailable");
          return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
        }
        if (!linkedRow) {
          if (!await finishUpdate("processed")) return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
          return NextResponse.json({ accepted: true, updateId: telegramUpdate.update_id, duplicate: true });
        }
        try {
          await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ chat_id: telegramUpdate.message.chat.id, text: "Telegram подключен к Ритму." }),
          });
        } catch {
          if (!await finishUpdate("processed")) return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
          return NextResponse.json({ accepted: true, updateId: telegramUpdate.update_id, linked: true, confirmation: "unknown" }, { status: 202 });
        }
      }
    }
  }
  if (!await finishUpdate("processed")) return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  return NextResponse.json({ accepted: true, updateId: telegramUpdate.update_id });
}
