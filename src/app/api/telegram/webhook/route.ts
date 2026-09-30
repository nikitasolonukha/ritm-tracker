import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { hashTelegramLinkToken, parseTelegramHabitCallback, parseTelegramRestCallback, validateTelegramUpdate, verifyTelegramSecret, type TelegramUpdate } from "@/lib/telegram";
import { boundedServerFetch } from "@/lib/server-fetch";

export const runtime = "nodejs";
export const maxDuration = 30;

async function answerCallbackQuery(botToken: string, callbackId: string, text: string) {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
    method: "POST",
    signal: AbortSignal.timeout(8000),
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
  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false }, global: { fetch: boundedServerFetch } });
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
    const habitCallback = parseTelegramHabitCallback(callback.data);
    if (habitCallback && telegramUserId && chatId === telegramUserId) {
      const accepted = await admin.rpc("accept_telegram_habit_command", { p_telegram_user_id: telegramUserId, p_command_key: `telegram-callback-${telegramUpdate.update_id}`, p_job_id: habitCallback.jobId, p_source_version: habitCallback.sourceVersion, p_action: habitCallback.action });
      if (accepted.error) { await finishUpdate("failed", "habit command unavailable"); return NextResponse.json({ error: "storage_unavailable" }, { status: 503 }); }
      const status = accepted.data?.status;
      const applied = status === "applied" || status === "duplicate";
      const acknowledged = await answerCallbackQuery(botToken, callback.id, applied ? habitCallback.action === "done" ? "Отмечено" : habitCallback.action === "later" ? "Отложено на 10 минут" : "Пропущено" : status === "limited" ? "Достигнут лимит повторов" : "Действие устарело").catch(() => false);
      if (!await finishUpdate("processed")) return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
      return NextResponse.json({ accepted: true, callback: status, acknowledgement: acknowledged ? "sent" : "unknown" });
    }
    const parsed = parseTelegramRestCallback(callback.data);
    if (!telegramUserId || (chatId != null && chatId !== telegramUserId) || !parsed) {
      const acknowledged = await answerCallbackQuery(botToken, callback.id, "Действие устарело").catch(() => false);
      if (!await finishUpdate("processed")) return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
      return NextResponse.json({ accepted: true, updateId: telegramUpdate.update_id, callback: "invalid", acknowledgement: acknowledged ? "sent" : "unknown" }, { status: acknowledged ? 200 : 202 });
    }
    const { action, sourceEntityId, sourceVersion } = parsed;
    const { data: callbackJob, error: callbackJobError } = await admin.from("notification_jobs")
      .select("source_entity_id, source_version, user_id")
      .eq("id", sourceEntityId)
      .eq("source_version", sourceVersion)
      .maybeSingle();
    if (callbackJobError || !callbackJob || callbackJob.source_version !== sourceVersion) {
      const acknowledged = await answerCallbackQuery(botToken, callback.id, "Действие устарело").catch(() => false);
      if (!await finishUpdate("processed")) return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
      return NextResponse.json({ accepted: true, updateId: telegramUpdate.update_id, callback: "invalid", acknowledgement: acknowledged ? "sent" : "unknown" }, { status: acknowledged ? 200 : 202 });
    }
    const { data: command, error: commandError } = await admin.rpc("accept_telegram_timer_command", {
      p_telegram_user_id: telegramUserId,
      p_command_key: `telegram-callback-${telegramUpdate.update_id}`,
      p_entity_id: callbackJob.source_entity_id,
      p_payload: { source: "telegram", callbackId: callback.id, action },
      p_source_version: sourceVersion,
      p_action: action,
    });
    if (commandError) {
      await finishUpdate("failed", "timer command unavailable");
      return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
    }
    const applied = command?.status === "applied" || command?.status === "duplicate";
    const acknowledged = await answerCallbackQuery(botToken, callback.id, applied ? action === "cancel" ? "Отдых пропущен" : "Отдых продлен на 30 секунд" : "Действие устарело").catch(() => false);
    if (!await finishUpdate("processed")) return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
    return NextResponse.json({ accepted: true, updateId: telegramUpdate.update_id, callback: command?.status ?? "accepted", acknowledgement: acknowledged ? "sent" : "unknown" }, { status: acknowledged ? 200 : 202 });
  }
  if (telegramUpdate.message?.text?.startsWith("/start ") && telegramUpdate.message.chat?.id != null) {
    const message = telegramUpdate.message;
    const senderId = message.from?.id;
    if (!senderId || senderId !== message.chat?.id || senderId <= 0) {
      if (!await finishUpdate("processed")) return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
      return NextResponse.json({ accepted: true, linked: false });
    }
    const rawToken = message.text!.slice(7).trim();
    const { data: linked, error } = await admin.rpc("confirm_telegram_link", {
      p_token_hash: hashTelegramLinkToken(rawToken), p_telegram_user_id: senderId,
    });
    if (error) {
      await finishUpdate("failed", "telegram link update unavailable");
      return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
    }
    let connected = linked === true;
    if (!connected) {
      const existing = await admin.from("telegram_links").select("confirmed_at")
        .eq("token_hash", hashTelegramLinkToken(rawToken)).eq("telegram_user_id", senderId).is("revoked_at", null).maybeSingle();
      if (existing.error) { await finishUpdate("failed", "telegram link read unavailable"); return NextResponse.json({ error: "storage_unavailable" }, { status: 503 }); }
      connected = Boolean(existing.data?.confirmed_at);
    }
    let confirmation = false;
    try {
      const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        signal: AbortSignal.timeout(8000),
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: senderId, text: connected ? "Telegram подключен к Ритму." : "Ссылка истекла или уже использована. Создайте новую в настройках Ритма." }),
      });
      const body = await response.json();
      confirmation = response.ok && body.ok === true;
    } catch { /* The binding is durable even when the confirmation cannot be delivered. */ }
    if (!await finishUpdate("processed")) return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
    return NextResponse.json({ accepted: true, linked: connected, confirmation: confirmation ? "sent" : "unknown" });
  }
  if (!await finishUpdate("processed")) return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  return NextResponse.json({ accepted: true, updateId: telegramUpdate.update_id });
}
