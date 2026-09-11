revoke all on function public.finish_notification_job(uuid, text, text, timestamptz) from public, anon, authenticated, service_role;
drop function if exists public.finish_notification_job(uuid, text, text, timestamptz);
