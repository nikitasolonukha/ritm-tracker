import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { hashTelegramLinkToken, validateTelegramUpdate, verifyTelegramSecret } from "@/lib/telegram";

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
  if (update.message?.text?.startsWith("/start ") && update.message.chat?.id != null) {
    const rawToken = update.message.text.slice(7).trim();
    if (rawToken) {
      const { data: link } = await admin.from("telegram_links")
        .select("user_id")
        .eq("token_hash", hashTelegramLinkToken(rawToken))
        .gt("expires_at", new Date().toISOString())
        .is("confirmed_at", null)
        .maybeSingle();
      if (link) {
        await admin.from("telegram_links").update({ telegram_user_id: update.message.chat.id, confirmed_at: new Date().toISOString() }).eq("user_id", link.user_id);
        await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: update.message.chat.id, text: "Telegram подключен к Ритму." }),
        });
      }
    }
  }
  return NextResponse.json({ accepted: true, updateId: update.update_id, duplicate: Boolean(insertError) });
}
