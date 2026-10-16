import type { SupabaseClient } from "@supabase/supabase-js";
import { buildWeeklyDigest, weeklyDigestWindow } from "./weekly-digest.ts";
import type { SessionTrackerState } from "./workout-session.ts";

const HOURS_5 = 5 * 3_600_000;

/**
 * В воскресенье вечером ставит в очередь недельную сводку каждому, у кого подтверждён Telegram.
 * Задание уникально по (пользователь, `weekly:<дата воскресенья>`, версия 1), поэтому повторные вызовы воркера (раз в 10 секунд)
 * ничего не дублируют. Для отключивших сводку и для недель без данных создаётся отменённая запись: так состояние
 * не перечитывается каждые 10 секунд. Любая ошибка базы тихо пропускается, доставка напоминаний важнее.
 */
export async function planWeeklyDigests(admin: SupabaseClient, now: Date): Promise<number> {
  const window = weeklyDigestWindow(now);
  if (!window) return 0;
  try {
    const source = `weekly:${window.endDate}`;
    const links = await admin.from("telegram_links").select("user_id").not("telegram_user_id", "is", null).not("confirmed_at", "is", null).is("revoked_at", null);
    if (links.error || !links.data?.length) return 0;
    const userIds = links.data.map((row) => row.user_id as string);
    const existing = await admin.from("notification_jobs").select("user_id").eq("source_entity_id", source).in("user_id", userIds);
    if (existing.error) return 0;
    const planned = new Set((existing.data ?? []).map((row) => row.user_id as string));
    const missing = userIds.filter((id) => !planned.has(id));
    if (!missing.length) return 0;
    const states = await admin.from("tracker_state").select("user_id, payload").in("user_id", missing);
    if (states.error) return 0;
    const dueAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + HOURS_5).toISOString();
    const rows = (states.data ?? []).map((row) => {
      const payload = row.payload as SessionTrackerState & { weeklyDigest?: boolean };
      const base = { user_id: row.user_id as string, source_entity_id: source, source_version: 1, due_at: dueAt, expires_at: expiresAt };
      if (payload?.weeklyDigest === false) return { ...base, message: "", status: "cancelled", last_error: "digest disabled" };
      const digest = buildWeeklyDigest(payload, window.endDate);
      return digest.hasData ? { ...base, message: digest.text, status: "pending" } : { ...base, message: "", status: "cancelled", last_error: "no data" };
    });
    if (!rows.length) return 0;
    const result = await admin.from("notification_jobs").upsert(rows, { onConflict: "user_id,source_entity_id,source_version", ignoreDuplicates: true });
    return result.error ? 0 : rows.filter((row) => row.status === "pending").length;
  } catch {
    return 0;
  }
}
