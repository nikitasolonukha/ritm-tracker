import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!process.env.RITM_OWNER_USER_ID || user.id !== process.env.RITM_OWNER_USER_ID) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  const admin = createAdminClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const id = randomUUID();
  const dueAt = new Date(Date.now() + 60_000).toISOString();
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  const { data, error } = await admin.rpc("create_telegram_diagnostic_job", {
    p_user_id: user.id,
    p_command_key: `telegram-diagnostic-${id}`,
    p_entity_id: `telegram-diagnostic:${id}`,
    p_due_at: dueAt,
    p_expires_at: expiresAt,
    p_message: "Ритм: диагностическое уведомление через рабочую очередь.",
  });
  if (error) return NextResponse.json({ error: error.code === "42501" ? "telegram_not_linked" : "storage_unavailable" }, { status: error.code === "42501" ? 409 : 503 });
  return NextResponse.json({ ...data, dueAt, expiresAt });
}
