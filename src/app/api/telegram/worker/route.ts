import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyTelegramSecret } from "@/lib/telegram";

export const runtime = "nodejs";

type ClaimedJob = {
  id: string;
  telegram_user_id: number;
  source_entity_id: string;
  source_version: number;
  attempts: number;
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
  for (const job of jobs) {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: job.telegram_user_id, text: `Напоминание Ритм: ${job.source_entity_id}` }),
    });
    const payload = await response.json().catch(() => ({})) as { ok?: boolean; description?: string; parameters?: { retry_after?: number } };
    if (response.ok && payload.ok) {
      await admin.rpc("finish_notification_job", { p_job_id: job.id, p_status: "sent" });
      results.push({ id: job.id, status: "sent" });
      continue;
    }

    const retryAfter = payload.parameters?.retry_after;
    const nextAttemptAt = retryAfter ? new Date(Date.now() + retryAfter * 1000).toISOString() : null;
    const nextStatus = job.attempts >= 3 ? "unknown" : "failed";
    await admin.rpc("finish_notification_job", {
      p_job_id: job.id,
      p_status: nextStatus,
      p_error: payload.description ?? `telegram_http_${response.status}`,
      p_next_attempt_at: nextAttemptAt,
    });
    results.push({ id: job.id, status: nextStatus });
  }

  return NextResponse.json({ processed: results.length, results });
}
