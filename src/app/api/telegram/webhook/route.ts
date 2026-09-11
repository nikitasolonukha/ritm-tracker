import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { hashTelegramLinkToken, parseTelegramRestCallback, validateTelegramUpdate, verifyTelegramSecret } from "@/lib/telegram";

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
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!url || !serviceRoleKey || !botToken) return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: existing, error: lookupError } = await admin
    .from("telegram_updates")
    .select("update_id")
    .eq("update_id", update.update_id)
    .maybeSingle();
  if (lookupError) return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  if (existing) return NextResponse.json({ accepted: true, updateId: update.update_id, duplicate: true });

  const { error: insertError } = await admin.from("telegram_updates").insert({ update_id: update.update_id, payload: update });
  if (insertError && insertError.code !== "23505") {
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }
  if (existing && !update.callback_query) return NextResponse.json({ accepted: true, updateId: update.update_id, duplicate: true });
  if (update.callback_query) {
    const callback = update.callback_query;
    const telegramUserId = callback.from?.id;
    const chatId = callback.message?.chat?.id;
    const parsed = parseTelegramRestCallback(callback.data);
    if (!telegramUserId || (chatId != null && chatId !== telegramUserId) || !parsed) {
      const acknowledged = await answerCallbackQuery(botToken, callback.id, "Действие устарело");
      return NextResponse.json({ accepted: true, updateId: update.update_id, callback: "invalid", acknowledgement: acknowledged ? "sent" : "unknown" }, { status: acknowledged ? 200 : 202 });
    }
    const { action, sourceEntityId, sourceVersion } = parsed;
    const { data: command, error: commandError } = await admin.rpc("accept_telegram_timer_command", {
      p_telegram_user_id: telegramUserId,
      p_command_key: `telegram-callback-${update.update_id}`,
      p_entity_id: sourceEntityId,
      p_payload: { source: "telegram", callbackId: callback.id, action },
      p_source_version: sourceVersion,
      p_action: action,
    });
    if (commandError) return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
    const acknowledged = await answerCallbackQuery(botToken, callback.id, action === "cancel" ? "Отдых пропущен" : "Отдых продлен на 30 секунд").catch(() => false);
    return NextResponse.json({ accepted: true, updateId: update.update_id, callback: command?.status ?? "accepted", acknowledgement: acknowledged ? "sent" : "unknown" }, { status: acknowledged ? 200 : 202 });
  }
  if (update.message?.text?.startsWith("/start ") && update.message.chat?.id != null) {
    const rawToken = update.message.text.slice(7).trim();
    if (rawToken) {
      const { data: link } = await admin.from("telegram_links")
        .select("user_id")
        .eq("token_hash", hashTelegramLinkToken(rawToken))
        .gt("token_expires_at", new Date().toISOString())
        .is("confirmed_at", null)
        .maybeSingle();
      if (link) {
        const connectedAt = new Date().toISOString();
        const { error: linkUpdateError } = await admin.from("telegram_links").update({ telegram_user_id: update.message.chat.id, confirmed_at: connectedAt, connected_at: connectedAt, revoked_at: null }).eq("user_id", link.user_id).eq("token_hash", hashTelegramLinkToken(rawToken));
        if (linkUpdateError) return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
        try {
          await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ chat_id: update.message.chat.id, text: "Telegram подключен к Ритму." }),
          });
        } catch {
          return NextResponse.json({ accepted: true, updateId: update.update_id, linked: true, confirmation: "unknown" }, { status: 202 });
        }
      }
    }
  }
  return NextResponse.json({ accepted: true, updateId: update.update_id, duplicate: Boolean(insertError) });
}
