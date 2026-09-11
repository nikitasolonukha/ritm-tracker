import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyTelegramSecret } from "@/lib/telegram";

export const runtime = "nodejs";

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

  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await admin.rpc("claim_notification_jobs", { p_limit: 10, p_lease_seconds: 45 });
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
    try {
      response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: job.telegram_user_id,
          text: job.message,
          reply_markup: {
            inline_keyboard: [[
              { text: "+30 сек", callback_data: `rest_add30:${job.id}:${job.source_version}` },
              { text: "Пропустить", callback_data: `rest_skip:${job.id}:${job.source_version}` },
            ]],
          },
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
