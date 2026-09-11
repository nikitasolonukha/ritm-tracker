alter table public.notification_jobs
  add column if not exists lease_token uuid;

create index if not exists notification_jobs_lease_idx
  on public.notification_jobs (id, lease_token)
  where status = 'leased';

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
  current_lease_token uuid;
begin
  if p_limit < 1 or p_limit > 50 or p_lease_seconds < 10 or p_lease_seconds > 300 then
    raise exception 'invalid worker limits' using errcode = '22023';
  end if;

  update public.notification_jobs
     set status = 'cancelled', lease_until = null, lease_token = null, last_error = 'expired'
   where status in ('pending', 'leased', 'failed', 'unknown') and expires_at <= now();

  for job in
    select nj.id, nj.user_id, nj.source_entity_id, nj.source_version, nj.due_at,
           nj.expires_at, nj.attempts, nj.message, tl.telegram_user_id
      from public.notification_jobs nj
      join public.telegram_links tl on tl.user_id = nj.user_id
        and tl.telegram_user_id is not null
        and tl.confirmed_at is not null
        and tl.revoked_at is null
     where nj.due_at <= now()
       and nj.expires_at > now()
       and nj.attempts < 3
       and (nj.status = 'pending' or (nj.status in ('leased', 'failed', 'unknown')
         and (nj.lease_until is null or nj.lease_until < now())
         and coalesce(nj.next_attempt_at, now()) <= now()))
     order by nj.due_at, nj.id
     limit p_limit
     for update of nj skip locked
  loop
    current_lease_token := gen_random_uuid();
    update public.notification_jobs
       set status = 'leased', attempts = job.attempts + 1,
           lease_until = now() + make_interval(secs => p_lease_seconds),
           lease_token = current_lease_token, last_error = null
     where id = job.id;
    return next jsonb_build_object(
      'id', job.id, 'user_id', job.user_id, 'telegram_user_id', job.telegram_user_id,
      'source_entity_id', job.source_entity_id, 'source_version', job.source_version,
      'due_at', job.due_at, 'expires_at', job.expires_at, 'attempts', job.attempts + 1,
      'message', job.message, 'lease_token', current_lease_token
    );
  end loop;
end;
$$;

create or replace function public.finish_notification_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_status text,
  p_error text default null,
  p_next_attempt_at timestamptz default null
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_status not in ('sent', 'failed', 'unknown', 'cancelled') or p_lease_token is null then
    raise exception 'invalid job finish' using errcode = '22023';
  end if;

  update public.notification_jobs
     set status = p_status, last_error = left(p_error, 1000),
         next_attempt_at = p_next_attempt_at, lease_until = null, lease_token = null
   where id = p_job_id and status = 'leased' and lease_token = p_lease_token;
  return found;
end;
$$;

revoke all on function public.finish_notification_job(uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.finish_notification_job(uuid, uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.finish_notification_job(uuid, uuid, text, text, timestamptz) to service_role;

alter table public.telegram_updates
  add column if not exists status text not null default 'received',
  add column if not exists attempts integer not null default 0,
  add column if not exists processing_token uuid,
  add column if not exists lease_until timestamptz;

alter table public.telegram_updates
  drop constraint if exists telegram_updates_status_check;
alter table public.telegram_updates
  add constraint telegram_updates_status_check check (status in ('received', 'processing', 'processed', 'failed'));

create index if not exists telegram_updates_processing_idx
  on public.telegram_updates (status, lease_until);

create or replace function public.claim_telegram_update(
  p_update_id bigint,
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_row public.telegram_updates;
  new_token uuid;
begin
  if p_update_id is null or p_update_id < 0 or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'invalid Telegram update' using errcode = '22023';
  end if;

  select * into current_row from public.telegram_updates where update_id = p_update_id for update;
  if current_row.update_id is not null then
    if current_row.status = 'processed' then
      return jsonb_build_object('status', 'processed');
    end if;
    if current_row.status = 'processing' and current_row.lease_until > now() then
      return jsonb_build_object('status', 'busy');
    end if;
    new_token := gen_random_uuid();
    update public.telegram_updates
       set payload = p_payload, status = 'processing', attempts = attempts + 1,
           processing_token = new_token, lease_until = now() + interval '60 seconds', last_error = null
     where update_id = p_update_id;
    return jsonb_build_object('status', 'claimed', 'processing_token', new_token);
  end if;

  new_token := gen_random_uuid();
  insert into public.telegram_updates(update_id, payload, status, attempts, processing_token, lease_until)
    values (p_update_id, p_payload, 'processing', 1, new_token, now() + interval '60 seconds');
  return jsonb_build_object('status', 'claimed', 'processing_token', new_token);
end;
$$;

create or replace function public.finish_telegram_update(
  p_update_id bigint,
  p_processing_token uuid,
  p_status text,
  p_error text default null
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_status not in ('processed', 'failed') or p_processing_token is null then
    raise exception 'invalid Telegram update finish' using errcode = '22023';
  end if;
  update public.telegram_updates
     set status = p_status, processed_at = case when p_status = 'processed' then now() else null end,
         last_error = left(p_error, 1000), processing_token = null, lease_until = null
   where update_id = p_update_id and status = 'processing' and processing_token = p_processing_token;
  return found;
end;
$$;

revoke all on function public.claim_telegram_update(bigint, jsonb) from public, anon, authenticated;
revoke all on function public.finish_telegram_update(bigint, uuid, text, text) from public, anon, authenticated;
grant execute on function public.claim_telegram_update(bigint, jsonb) to service_role;
grant execute on function public.finish_telegram_update(bigint, uuid, text, text) to service_role;
