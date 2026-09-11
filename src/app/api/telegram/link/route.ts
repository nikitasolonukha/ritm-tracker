import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { hashTelegramLinkToken } from "@/lib/telegram";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await supabase.from("telegram_links")
    .select("telegram_user_id, confirmed_at, connected_at, revoked_at, token_expires_at, delivery_status, last_delivery_error")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });

  const connected = Boolean(data?.telegram_user_id && data.confirmed_at && !data.revoked_at);
  const pending = Boolean(!connected && data?.token_expires_at && new Date(data.token_expires_at).getTime() > Date.now());
  return NextResponse.json({
    status: connected ? (data?.delivery_status === "error" ? "error" : "connected") : pending ? "pending" : data ? "expired" : "disconnected",
    connectedAt: data?.connected_at ?? null,
    tokenExpiresAt: data?.token_expires_at ?? null,
    lastError: connected && data?.delivery_status === "error" ? data.last_delivery_error : null,
  });
}

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

export async function DELETE() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  const admin = createAdminClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await admin.from("telegram_links").update({
    telegram_user_id: null,
    confirmed_at: null,
    connected_at: null,
    revoked_at: new Date().toISOString(),
    token_hash: hashTelegramLinkToken(randomBytes(32).toString("base64url")),
    expires_at: new Date().toISOString(),
    token_expires_at: new Date().toISOString(),
  }).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  return NextResponse.json({ status: "disconnected" });
}
