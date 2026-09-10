revoke all on table public.commands, public.notification_jobs, public.telegram_links, public.telegram_updates from anon, authenticated;
revoke execute on function public.complete_workout_set(text, uuid, uuid, integer) from authenticated;
