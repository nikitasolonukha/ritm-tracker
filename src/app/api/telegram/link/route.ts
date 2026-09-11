import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { hashTelegramLinkToken } from "@/lib/telegram";

export const runtime = "nodejs";

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!url || !serviceRoleKey || !botToken) return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });

  const meResponse = await fetch(`https://api.telegram.org/bot${botToken}/getMe`, { cache: "no-store" });
  const me = await meResponse.json().catch(() => ({})) as { ok?: boolean; result?: { username?: string } };
  if (!meResponse.ok || !me.ok || !me.result?.username) return NextResponse.json({ error: "telegram_unavailable" }, { status: 503 });

  const rawToken = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const admin = createAdminClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const tokenFields = { token_hash: hashTelegramLinkToken(rawToken), expires_at: expiresAt, token_expires_at: expiresAt };
  const { data: existing, error: lookupError } = await admin.from("telegram_links").select("user_id").eq("user_id", user.id).maybeSingle();
  if (lookupError) return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  const { error } = existing
    ? await admin.from("telegram_links").update(tokenFields).eq("user_id", user.id)
    : await admin.from("telegram_links").insert({ user_id: user.id, ...tokenFields, telegram_user_id: null, confirmed_at: null, connected_at: null, revoked_at: null });
  if (error) return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });

  return NextResponse.json({ link: `https://t.me/${me.result.username}?start=${rawToken}`, expiresAt });
}
