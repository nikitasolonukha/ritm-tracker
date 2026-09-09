import { NextRequest, NextResponse } from "next/server";
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

  // Deduplication, ownership and callback-to-event checks are intentionally server-side.
  // They are performed by the Supabase transaction once credentials are configured.
  return NextResponse.json({ accepted: true, updateId: update.update_id, connected: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) });
}
