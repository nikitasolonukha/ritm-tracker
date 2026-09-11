-- A link token expires; a confirmed Telegram connection does not.
alter table public.telegram_links
  add column if not exists token_expires_at timestamptz,
  add column if not exists connected_at timestamptz,
  add column if not exists revoked_at timestamptz;

update public.telegram_links
   set token_expires_at = coalesce(token_expires_at, expires_at),
       connected_at = coalesce(connected_at, confirmed_at)
 where token_expires_at is null or (confirmed_at is not null and connected_at is null);

alter table public.telegram_links
  alter column token_expires_at set default (now() + interval '10 minutes');

create index if not exists telegram_links_active_connection_idx
  on public.telegram_links (user_id)
  where telegram_user_id is not null and confirmed_at is not null and revoked_at is null;

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
    update public.notification_jobs
       set status = 'leased', attempts = job.attempts + 1,
           lease_until = now() + make_interval(secs => p_lease_seconds), last_error = null
     where id = job.id;
    return next jsonb_build_object(
      'id', job.id, 'user_id', job.user_id, 'telegram_user_id', job.telegram_user_id,
      'source_entity_id', job.source_entity_id, 'source_version', job.source_version,
      'due_at', job.due_at, 'expires_at', job.expires_at,
      'attempts', job.attempts + 1, 'message', job.message
    );
  end loop;
end;
$$;
