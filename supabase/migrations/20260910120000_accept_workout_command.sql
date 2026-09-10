alter table public.notification_jobs
  add column if not exists message text not null default 'Ритм: отдых завершен';

create or replace function public.accept_workout_command(
  p_command_key text,
  p_entity_id text,
  p_payload jsonb,
  p_source_version integer,
  p_due_at timestamptz,
  p_expires_at timestamptz,
  p_message text
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  current_user_id uuid := (select auth.uid());
  existing public.commands;
  job_id uuid;
begin
  if current_user_id is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if nullif(trim(p_command_key), '') is null or nullif(trim(p_entity_id), '') is null
     or jsonb_typeof(p_payload) <> 'object' or p_source_version < 1
     or p_due_at is null or p_expires_at is null or p_expires_at <= p_due_at
     or length(coalesce(p_message, '')) > 500 then
    raise exception 'invalid workout command' using errcode = '22023';
  end if;

  select * into existing from public.commands
    where user_id = current_user_id and command_key = p_command_key for update;
  if existing.id is not null then
    select id into job_id from public.notification_jobs
      where user_id = current_user_id and source_entity_id = p_entity_id and source_version = p_source_version;
    return jsonb_build_object('status', 'duplicate', 'command_id', existing.id, 'job_id', job_id);
  end if;

  update public.notification_jobs
    set status = 'cancelled', lease_until = null, last_error = 'superseded'
    where user_id = current_user_id and source_entity_id = p_entity_id
      and status in ('pending', 'leased', 'failed', 'unknown');

  insert into public.commands(user_id, command_key, command_type, entity_id, payload, version)
    values (current_user_id, p_command_key, 'workout.set.completed', p_entity_id, p_payload, p_source_version)
    returning id into job_id;

  insert into public.notification_jobs(user_id, source_entity_id, source_version, due_at, expires_at, message)
    values (current_user_id, p_entity_id, p_source_version, p_due_at, p_expires_at, left(p_message, 500))
    returning id into job_id;
  return jsonb_build_object('status', 'applied', 'job_id', job_id);
end;
$$;

revoke all on function public.accept_workout_command(text, text, jsonb, integer, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.accept_workout_command(text, text, jsonb, integer, timestamptz, timestamptz, text) to authenticated;

create or replace function public.claim_notification_jobs(
  p_limit integer default 10,
  p_lease_seconds integer default 45
) returns setof jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  job record;
begin
  if p_limit < 1 or p_limit > 50 or p_lease_seconds < 10 or p_lease_seconds > 300 then
    raise exception 'invalid worker limits' using errcode = '22023';
  end if;
  update public.notification_jobs set status = 'cancelled', lease_until = null, last_error = 'expired'
    where status in ('pending', 'leased', 'failed', 'unknown') and expires_at <= now();
  for job in
    select nj.id, nj.user_id, nj.source_entity_id, nj.source_version, nj.due_at, nj.expires_at,
           nj.attempts, nj.message, tl.telegram_user_id
      from public.notification_jobs nj
      join public.telegram_links tl on tl.user_id = nj.user_id
        and tl.telegram_user_id is not null and tl.confirmed_at is not null
        and tl.expires_at > now()
     where nj.due_at <= now() and nj.expires_at > now() and nj.attempts < 3
       and (nj.status = 'pending' or (nj.status in ('leased', 'failed', 'unknown')
         and (nj.lease_until is null or nj.lease_until < now())
         and coalesce(nj.next_attempt_at, now()) <= now()))
     order by nj.due_at, nj.id limit p_limit for update of nj skip locked
  loop
    update public.notification_jobs set status = 'leased', attempts = job.attempts + 1,
      lease_until = now() + make_interval(secs => p_lease_seconds), last_error = null where id = job.id;
    return next jsonb_build_object('id', job.id, 'user_id', job.user_id, 'telegram_user_id', job.telegram_user_id,
      'source_entity_id', job.source_entity_id, 'source_version', job.source_version, 'due_at', job.due_at,
      'expires_at', job.expires_at, 'attempts', job.attempts + 1, 'message', job.message);
  end loop;
end;
$$;
