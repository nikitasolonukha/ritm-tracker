create or replace function public.accept_workout_timer_command(
  p_command_key text,
  p_entity_id text,
  p_payload jsonb,
  p_source_version integer,
  p_action text,
  p_due_at timestamptz default null,
  p_expires_at timestamptz default null,
  p_message text default null
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  current_user_id uuid := (select auth.uid());
  command_id uuid;
  job_id uuid;
begin
  if current_user_id is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if nullif(trim(p_command_key), '') is null or nullif(trim(p_entity_id), '') is null
     or jsonb_typeof(p_payload) <> 'object' or p_source_version < 1
     or p_action not in ('reschedule', 'cancel') then
    raise exception 'invalid timer command' using errcode = '22023';
  end if;
  if p_action = 'reschedule' and (p_due_at is null or p_expires_at is null or p_expires_at <= p_due_at or length(coalesce(p_message, '')) > 500) then
    raise exception 'invalid timer schedule' using errcode = '22023';
  end if;

  insert into public.commands(user_id, command_key, command_type, entity_id, payload, version)
    values (current_user_id, p_command_key, 'workout.timer.' || p_action, p_entity_id, p_payload, p_source_version)
    on conflict (user_id, command_key) do nothing
    returning id into command_id;
  if command_id is null then
    select id into command_id from public.commands where user_id = current_user_id and command_key = p_command_key;
    select id into job_id from public.notification_jobs where user_id = current_user_id and source_entity_id = p_entity_id and source_version = p_source_version;
    return jsonb_build_object('status', 'duplicate', 'command_id', command_id, 'job_id', job_id);
  end if;

  update public.notification_jobs
     set status = 'cancelled', lease_until = null, last_error = case when p_action = 'cancel' then 'cancelled' else 'superseded' end
   where user_id = current_user_id and source_entity_id = p_entity_id
     and status in ('pending', 'leased', 'failed', 'unknown');

  if p_action = 'reschedule' then
    insert into public.notification_jobs(user_id, source_entity_id, source_version, due_at, expires_at, message)
      values (current_user_id, p_entity_id, p_source_version, p_due_at, p_expires_at, left(p_message, 500))
      returning id into job_id;
  end if;
  return jsonb_build_object('status', 'applied', 'command_id', command_id, 'job_id', job_id);
end;
$$;

revoke all on function public.accept_workout_timer_command(text, text, jsonb, integer, text, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.accept_workout_timer_command(text, text, jsonb, integer, text, timestamptz, timestamptz, text) to authenticated;
