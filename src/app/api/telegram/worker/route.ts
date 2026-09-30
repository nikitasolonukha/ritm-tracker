import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyTelegramSecret } from "@/lib/telegram";
import { POST as handleSavedUpdate } from "../webhook/route";
import { boundedServerFetch } from "@/lib/server-fetch";

export const runtime = "nodejs";
export const maxDuration = 60;

type ClaimedJob = {
  id: string;
  user_id: string;
  telegram_user_id: number;
  source_entity_id: string;
  source_version: number;
  attempts: number;
  message: string;
  lease_token: string;
};

export async function POST(request: NextRequest) {
  if (!verifyTelegramSecret(request.headers.get("x-telegram-worker-secret"), process.env.TELEGRAM_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!url || !serviceRoleKey || !botToken) return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });

  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false }, global: { fetch: boundedServerFetch } });
  const stuck = await admin.from("telegram_updates").select("update_id, payload")
    .or(`status.eq.failed,and(status.eq.processing,lease_until.lt.${new Date().toISOString()})`)
    .lt("attempts", 5).order("update_id").limit(1);
  if (stuck.error) return NextResponse.json({ error: "update_queue_unavailable" }, { status: 503 });
  for (const update of stuck.data ?? []) {
    // Reprocess only durable, previously authenticated Telegram updates. The webhook owns claim/lease fencing.
    await handleSavedUpdate(new NextRequest(new URL("/api/telegram/webhook", request.url), {
      method: "POST", headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": process.env.TELEGRAM_WEBHOOK_SECRET! }, body: JSON.stringify(update.payload),
    })).catch(() => undefined);
  }
  const refresh = await admin.rpc("refresh_habit_notifications");
  if (refresh.error) return NextResponse.json({ error: "queue_unavailable" }, { status: 503 });
  const { data, error } = await admin.rpc("claim_notification_jobs", { p_limit: 1, p_lease_seconds: 45 });
  if (error) return NextResponse.json({ error: "queue_unavailable" }, { status: 503 });

  const jobs = (data ?? []) as ClaimedJob[];
  const results: Array<{ id: string; status: string }> = [];
  async function finish(job: ClaimedJob, status: "sent" | "failed" | "unknown" | "cancelled", error?: string, nextAttemptAt?: string | null) {
    const result = await admin.rpc("finish_notification_job", {
      p_job_id: job.id,
      p_lease_token: job.lease_token,
      p_status: status,
      p_error: error ?? null,
      p_next_attempt_at: nextAttemptAt ?? null,
    });
    if (result.error) return "queue_unavailable" as const;
    return result.data === true ? status : "lease_lost";
  }
  async function markDeliveryError(job: ClaimedJob, error: string) {
    return admin.from("telegram_links").update({
      delivery_status: "error",
      last_delivery_error: error.slice(0, 1000),
      last_delivery_error_at: new Date().toISOString(),
    }).eq("user_id", job.user_id);
  }
  for (const job of jobs) {
    let response: Response;
    const replyMarkup = job.source_entity_id.startsWith("habit:") ? { inline_keyboard: [[
      { text: "Выполнено", callback_data: `habit_done:${job.id}:${job.source_version}` },
      { text: "Пропустить", callback_data: `habit_skip:${job.id}:${job.source_version}` },
    ],[{ text: "+10 минут", callback_data: `habit_later:${job.id}:${job.source_version}` }]] } : job.source_entity_id.startsWith("telegram-diagnostic:") ? undefined : { inline_keyboard: [[
      { text: "+30 сек", callback_data: `rest_add30:${job.id}:${job.source_version}` },
      { text: "Пропустить", callback_data: `rest_skip:${job.id}:${job.source_version}` },
    ]] };
    try {
      response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        signal: AbortSignal.timeout(8000),
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: job.telegram_user_id,
          text: job.message,
          reply_markup: replyMarkup,
        }),
      });
    } catch (error) {
      const status = await finish(job, "unknown", error instanceof Error ? error.message : "telegram_request_unknown", new Date(Date.now() + 60_000).toISOString());
      if (status === "queue_unavailable") return NextResponse.json({ error: "queue_unavailable" }, { status: 503 });
      results.push({ id: job.id, status });
      continue;
    }
    const payload = await response.json().catch(() => ({})) as { ok?: boolean; description?: string; parameters?: { retry_after?: number } };
    if (response.ok && payload.ok) {
      const status = await finish(job, "sent");
      if (status === "queue_unavailable") return NextResponse.json({ error: "queue_unavailable" }, { status: 503 });
      results.push({ id: job.id, status });
      continue;
    }

    const retryAfter = payload.parameters?.retry_after;
    const nextAttemptAt = retryAfter ? new Date(Date.now() + retryAfter * 1000).toISOString() : null;
    const permanent = response.status === 400 || response.status === 403;
    if (permanent) await markDeliveryError(job, payload.description ?? `telegram_http_${response.status}`);
    const nextStatus = permanent ? "cancelled" : job.attempts >= 3 ? "unknown" : "failed";
    const status = await finish(job, nextStatus, payload.description ?? `telegram_http_${response.status}`, nextAttemptAt);
    if (status === "queue_unavailable") return NextResponse.json({ error: "queue_unavailable" }, { status: 503 });
    results.push({ id: job.id, status });
  }

  return NextResponse.json({ processed: results.length, results });
}
