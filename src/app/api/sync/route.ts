import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data, error } = await supabase.from("tracker_state").select("payload, version, updated_at").eq("user_id", user.id).maybeSingle();
  if (error) return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  return NextResponse.json(data ?? { payload: null, version: 1, updated_at: null });
}

export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: { payload?: unknown; version?: number };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  if (!body.payload || typeof body.payload !== "object" || !Number.isInteger(body.version) || body.version! < 1) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  const { error } = await supabase.from("tracker_state").upsert({ user_id: user.id, payload: body.payload, version: body.version }, { onConflict: "user_id" });
  if (error) return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  return NextResponse.json({ saved: true });
}
