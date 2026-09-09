import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { validateTelegramUpdate, verifyTelegramSecret } from "@/lib/telegram";

export const runtime = "nodejs";

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
  if (!url || !serviceRoleKey) return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await admin.from("telegram_updates").upsert({ update_id: update.update_id, payload: update }, { onConflict: "update_id", ignoreDuplicates: true });
  if (error) return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  return NextResponse.json({ accepted: true, updateId: update.update_id, duplicate: false });
}
