import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data, error } = await supabase.from("tracker_state").select("payload, version, updated_at").eq("user_id", user.id).maybeSingle();
  if (error) return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  return NextResponse.json(data ?? { payload: null, version: 0, updated_at: null });
}

export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: { payload?: unknown; expectedRevision?: number };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const payload = body.payload as Record<string, unknown> | undefined;
  if (!payload || Array.isArray(payload) || Object.keys(payload).length === 0 || payload.version !== 1 || !Array.isArray(payload.habits) || !Array.isArray(payload.completions) || !Array.isArray(payload.workouts) || !Number.isInteger(body.expectedRevision) || body.expectedRevision! < 0) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }
  const { data, error } = await supabase.rpc("save_tracker_state", { p_expected_revision: body.expectedRevision, p_payload: payload });
  if (error?.code === "40001") {
    const revision = Number(error.details);
    const remote = await supabase.from("tracker_state").select("payload, version, updated_at").eq("user_id", user.id).maybeSingle();
    return NextResponse.json({ error: "revision_conflict", revision: Number.isInteger(revision) ? revision : remote.data?.version ?? null, remote: remote.data?.payload ?? null }, { status: 409 });
  }
  if (error) return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  return NextResponse.json(data ?? { saved: true });
}
