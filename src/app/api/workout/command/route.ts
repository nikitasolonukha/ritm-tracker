import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: { commandKey?: string; sourceEntityId?: string; payload?: unknown; sourceVersion?: number; dueAt?: string; expiresAt?: string; message?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  if (!body.commandKey || !body.sourceEntityId || !body.payload || typeof body.payload !== "object" || !Number.isInteger(body.sourceVersion) || body.sourceVersion! < 1) {
    return NextResponse.json({ error: "invalid_command" }, { status: 400 });
  }
  const { data, error } = await supabase.rpc("accept_workout_command", {
    p_command_key: body.commandKey,
    p_entity_id: body.sourceEntityId,
    p_payload: body.payload,
    p_source_version: body.sourceVersion,
    p_due_at: body.dueAt ?? null,
    p_expires_at: body.expiresAt ?? null,
    p_message: body.message?.slice(0, 500) ?? "Ритм: отдых завершён.",
  });
  if (error) return NextResponse.json({ error: "command_not_accepted" }, { status: 503 });
  return NextResponse.json(data ?? { status: "accepted" });
}
