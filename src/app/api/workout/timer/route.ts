import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: {
    commandKey?: string;
    sourceEntityId?: string;
    sourceVersion?: number;
    action?: "reschedule" | "cancel";
    payload?: unknown;
    dueAt?: string;
    expiresAt?: string;
    message?: string;
  };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  if (!body.commandKey || !body.sourceEntityId || !Number.isInteger(body.sourceVersion) || body.sourceVersion! < 1 || !body.action) {
    return NextResponse.json({ error: "invalid_timer_command" }, { status: 400 });
  }
  if (body.action === "reschedule" && (!body.dueAt || !body.expiresAt || !body.message)) {
    return NextResponse.json({ error: "invalid_timer_schedule" }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("accept_workout_timer_command", {
    p_command_key: body.commandKey,
    p_entity_id: body.sourceEntityId,
    p_payload: body.payload && typeof body.payload === "object" ? body.payload : {},
    p_source_version: body.sourceVersion,
    p_action: body.action,
    p_due_at: body.dueAt ?? null,
    p_expires_at: body.expiresAt ?? null,
    p_message: body.message?.slice(0, 500) ?? null,
  });
  if (error) return NextResponse.json({ error: "timer_command_not_accepted" }, { status: 503 });
  return NextResponse.json(data ?? { status: "accepted" });
}
