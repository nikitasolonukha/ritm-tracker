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

  update public.notification_jobs
    set status = 'cancelled', lease_until = null, last_error = 'expired'
    where status in ('pending', 'leased', 'failed', 'unknown') and expires_at <= now();

  for job in
    select nj.id, nj.user_id, nj.source_entity_id, nj.source_version, nj.due_at,
           nj.expires_at, nj.attempts, tl.telegram_user_id
      from public.notification_jobs nj
      join public.telegram_links tl on tl.user_id = nj.user_id
        and tl.telegram_user_id is not null
        and tl.confirmed_at is not null
        and tl.expires_at > now()
     where nj.due_at <= now()
       and nj.expires_at > now()
       and nj.attempts < 3
       and (
         nj.status = 'pending'
         or (nj.status in ('leased', 'failed', 'unknown') and coalesce(nj.lease_until, now()) < now()
             and coalesce(nj.next_attempt_at, now()) <= now())
       )
     order by nj.due_at, nj.id
     limit p_limit
     for update of nj skip locked
  loop
    update public.notification_jobs
       set status = 'leased',
           attempts = job.attempts + 1,
           lease_until = now() + make_interval(secs => p_lease_seconds),
           last_error = null
     where id = job.id;

    return next jsonb_build_object(
      'id', job.id,
      'user_id', job.user_id,
      'telegram_user_id', job.telegram_user_id,
      'source_entity_id', job.source_entity_id,
      'source_version', job.source_version,
      'due_at', job.due_at,
      'expires_at', job.expires_at,
      'attempts', job.attempts + 1
    );
  end loop;
end;
$$;

create or replace function public.finish_notification_job(
  p_job_id uuid,
  p_status text,
  p_error text default null,
  p_next_attempt_at timestamptz default null
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_status not in ('sent', 'failed', 'unknown', 'cancelled') then
    raise exception 'invalid job status' using errcode = '22023';
  end if;

  update public.notification_jobs
     set status = p_status,
         last_error = left(p_error, 1000),
         next_attempt_at = p_next_attempt_at,
         lease_until = null
   where id = p_job_id and status = 'leased';
  return found;
end;
$$;

revoke all on function public.claim_notification_jobs(integer, integer) from public, anon, authenticated;
revoke all on function public.finish_notification_job(uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.claim_notification_jobs(integer, integer) to service_role;
grant execute on function public.finish_notification_job(uuid, text, text, timestamptz) to service_role;
