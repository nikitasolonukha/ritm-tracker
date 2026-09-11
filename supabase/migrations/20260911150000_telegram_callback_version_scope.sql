create or replace function public.accept_telegram_timer_command(
  p_telegram_user_id bigint, p_command_key text, p_entity_id text, p_payload jsonb, p_source_version integer, p_action text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  linked_user_id uuid;
  command_id uuid;
  job_id uuid;
  latest_version integer;
  command_version integer := case when p_action = 'reschedule' then p_source_version + 1 else p_source_version end;
begin
  if p_telegram_user_id is null or nullif(trim(p_command_key), '') is null
     or nullif(trim(p_entity_id), '') is null or jsonb_typeof(p_payload) <> 'object'
     or p_source_version < 1 or p_action not in ('cancel', 'reschedule')
     or command_version > 2147483647 then
    raise exception 'invalid Telegram timer command' using errcode = '22023';
  end if;

  select user_id into linked_user_id from public.telegram_links
   where telegram_user_id = p_telegram_user_id and confirmed_at is not null and revoked_at is null limit 1;
  if linked_user_id is null then raise exception 'Telegram account is not linked' using errcode = '42501'; end if;

  -- Diagnostic jobs have their own command and must not make a real timer callback stale.
  select max(version) into latest_version from public.commands
   where user_id = linked_user_id and entity_id = p_entity_id and command_type like 'workout.%';
  if latest_version is not null and latest_version > p_source_version then
    return jsonb_build_object('status', 'stale');
  end if;

  if p_action = 'reschedule' then
    select id into job_id from public.notification_jobs
     where user_id = linked_user_id and source_entity_id = p_entity_id and source_version = command_version
       and status in ('pending', 'leased', 'failed', 'unknown') limit 1;
    if job_id is not null then return jsonb_build_object('status', 'duplicate', 'job_id', job_id, 'version', command_version); end if;
  end if;

  insert into public.commands(user_id, command_key, command_type, entity_id, payload, version)
    values (linked_user_id, p_command_key, 'workout.timer.' || p_action, p_entity_id, p_payload, command_version)
    on conflict (user_id, command_key) do nothing returning id into command_id;
  if command_id is null then
    select id into command_id from public.commands where user_id = linked_user_id and command_key = p_command_key;
    select id into job_id from public.notification_jobs where user_id = linked_user_id and source_entity_id = p_entity_id and source_version = command_version;
    return jsonb_build_object('status', 'duplicate', 'command_id', command_id, 'job_id', job_id, 'version', command_version);
  end if;

  update public.notification_jobs set status = 'cancelled', lease_until = null,
    last_error = case when p_action = 'cancel' then 'cancelled' else 'superseded' end
   where user_id = linked_user_id and source_entity_id = p_entity_id and status in ('pending', 'leased', 'failed', 'unknown');

  if p_action = 'reschedule' then
    insert into public.notification_jobs(user_id, source_entity_id, source_version, due_at, expires_at, message)
      values (linked_user_id, p_entity_id, command_version, now() + interval '30 seconds', now() + interval '5 minutes', 'Ритм: отдых продлен на 30 секунд.')
      returning id into job_id;
  end if;
  return jsonb_build_object('status', 'applied', 'command_id', command_id, 'job_id', job_id, 'version', command_version);
end;
$$;

revoke all on function public.accept_telegram_timer_command(bigint, text, text, jsonb, integer, text) from public, anon, authenticated;
grant execute on function public.accept_telegram_timer_command(bigint, text, text, jsonb, integer, text) to service_role;
