create or replace function public.create_telegram_diagnostic_job(
  p_user_id uuid,
  p_command_key text,
  p_entity_id text,
  p_due_at timestamptz,
  p_expires_at timestamptz,
  p_message text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  job_id uuid;
begin
  if p_user_id is null or nullif(trim(p_command_key), '') is null or nullif(trim(p_entity_id), '') is null
     or p_due_at is null or p_expires_at is null or p_due_at <= now()
     or p_expires_at <= p_due_at or p_expires_at > now() + interval '15 minutes'
     or length(coalesce(p_message, '')) > 500 then
    raise exception 'invalid diagnostic job' using errcode = '22023';
  end if;
  if not exists (select 1 from public.telegram_links where user_id = p_user_id
    and telegram_user_id is not null and confirmed_at is not null and revoked_at is null) then
    raise exception 'Telegram account is not linked' using errcode = '42501';
  end if;

  insert into public.commands(user_id, command_key, command_type, entity_id, payload, version)
    values (p_user_id, p_command_key, 'telegram.diagnostic', p_entity_id,
      jsonb_build_object('source', 'owner-diagnostic'), 1)
    on conflict (user_id, command_key) do nothing;
  insert into public.notification_jobs(user_id, source_entity_id, source_version, due_at, expires_at, message)
    values (p_user_id, p_entity_id, 1, p_due_at, p_expires_at, left(p_message, 500))
    on conflict (user_id, source_entity_id, source_version) do nothing
    returning id into job_id;
  if job_id is null then
    select id into job_id from public.notification_jobs
      where user_id = p_user_id and source_entity_id = p_entity_id and source_version = 1;
  end if;
  return jsonb_build_object('status', 'accepted', 'job_id', job_id, 'due_at', p_due_at);
end;
$$;

revoke all on function public.create_telegram_diagnostic_job(uuid, text, text, timestamptz, timestamptz, text) from public, anon, authenticated;
grant execute on function public.create_telegram_diagnostic_job(uuid, text, text, timestamptz, timestamptz, text) to service_role;
