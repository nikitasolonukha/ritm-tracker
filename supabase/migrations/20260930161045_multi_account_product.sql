create table public.registration_attempts (
  bucket text not null,
  window_start timestamptz not null,
  attempts integer not null default 0,
  primary key (bucket, window_start)
);
alter table public.registration_attempts enable row level security;
revoke all on public.registration_attempts from public, anon, authenticated;
grant all on public.registration_attempts to service_role;

create function public.consume_registration_attempt(p_bucket text) returns boolean
language plpgsql security definer set search_path = pg_catalog, public as $$
declare count_now integer;
begin
  if p_bucket !~ '^[a-f0-9]{64}$' then return false; end if;
  delete from public.registration_attempts where window_start < now() - interval '2 hours';
  insert into public.registration_attempts(bucket, window_start, attempts)
    values (p_bucket, date_trunc('hour', now()), 1)
    on conflict (bucket, window_start) do update set attempts = registration_attempts.attempts + 1
    returning attempts into count_now;
  return count_now <= 5;
end; $$;
revoke all on function public.consume_registration_attempt(text) from public, anon, authenticated;
grant execute on function public.consume_registration_attempt(text) to service_role;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('progress-photos', 'progress-photos', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
create policy ritm_photo_read on storage.objects for select to authenticated
  using (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy ritm_photo_add on storage.objects for insert to authenticated
  with check (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy ritm_photo_remove on storage.objects for delete to authenticated
  using (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Only this trigger writes the trusted queue from a saved, account-scoped snapshot.
create function public.persist_tracker_commands() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare item jsonb; source text; item_version integer; due timestamptz; expiry timestamptz; command_id uuid;
begin
  if auth.uid() is not null and auth.uid() <> new.user_id then raise exception 'not owner' using errcode = '42501'; end if;
  for item in select value from jsonb_array_elements(coalesce(new.payload->'outbox', '[]'))
    where value->>'type' in ('workout.set.completed','timer.rescheduled','timer.cancelled')
      and value->>'status' in ('pending','sending','failed')
  loop
    source := item->>'entityId';
    item_version := (item->>'version')::integer;
    if item_version < 1 or source is null or length(source) > 1000 or length(item->>'id') > 1000 then
      raise exception 'invalid command' using errcode = '22023';
    end if;
    if exists(select 1 from public.commands where user_id = new.user_id and command_key = item->>'id') then continue; end if;
    if item->>'type' = 'workout.set.completed' and not exists (
      select 1 from jsonb_array_elements(new.payload->'workouts') w,
        lateral jsonb_array_elements(w->'exercises') e, lateral jsonb_array_elements(e->'sets') s
      where (w->>'id') || ':' || (e->>'id') || ':' || (s->>'id') = source and s->>'completed' = 'true'
    ) then raise exception 'completed fact missing' using errcode = '22023'; end if;
    if item->>'type' <> 'workout.set.completed' and not exists (
      select 1 from public.commands where user_id = new.user_id and entity_id = source and command_type like 'workout.%'
    ) then raise exception 'timer source missing' using errcode = '22023'; end if;
    insert into public.commands(user_id, command_key, command_type, entity_id, payload, version)
      values (new.user_id, item->>'id', case item->>'type' when 'timer.cancelled' then 'workout.timer.cancel' when 'timer.rescheduled' then 'workout.timer.reschedule' else 'workout.set.completed' end, source, coalesce(item->'payload','{}'), item_version)
      on conflict (user_id, command_key) do nothing returning id into command_id;
    if command_id is null then continue; end if;
    update public.notification_jobs set status='cancelled', lease_until=null, lease_token=null, last_error='superseded'
      where user_id=new.user_id and source_entity_id=source and status in ('pending','leased','failed','unknown') and source_version <= item_version;
    due := (item->'payload'->>'dueAt')::timestamptz;
    expiry := (item->'payload'->>'expiresAt')::timestamptz;
    if item->>'type' <> 'timer.cancelled' and due is not null and expiry is not null
       and due > now() - interval '30 seconds' and expiry > now() and expiry > due
       and due < now() + interval '30 minutes' and expiry <= due + interval '15 minutes'
       and (item->>'type' = 'timer.rescheduled' or new.payload->'activeTimer'->>'sourceId' = source)
    then
      insert into public.notification_jobs(user_id, source_entity_id, source_version, due_at, expires_at, message)
        values(new.user_id, source, item_version, due, expiry, left(coalesce(item->'payload'->>'message','Ритм: отдых завершён.'),500))
        on conflict (user_id, source_entity_id, source_version) do nothing;
    end if;
  end loop;
  update public.notification_jobs j set status='cancelled',lease_until=null,lease_token=null,last_error='rest ended'
    where j.user_id=new.user_id and j.status in ('pending','leased','failed','unknown')
      and j.source_entity_id is distinct from new.payload->'activeTimer'->>'sourceId'
      and exists(select 1 from public.commands c where c.user_id=new.user_id and c.entity_id=j.source_entity_id and c.command_type like 'workout.%');
  return new;
end; $$;
revoke all on function public.persist_tracker_commands() from public, anon, authenticated;
create trigger ritm_persist_commands after insert or update of payload on public.tracker_state
  for each row execute function public.persist_tracker_commands();

-- The browser can only acknowledge an already saved command, not forge queue entries.
create or replace function public.accept_workout_command(p_command_key text,p_entity_id text,p_payload jsonb,p_source_version integer,p_due_at timestamptz,p_expires_at timestamptz,p_message text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare found_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode='42501'; end if;
  select id into found_id from public.commands where user_id=auth.uid() and command_key=p_command_key and entity_id=p_entity_id and version=p_source_version and command_type='workout.set.completed';
  if found_id is null then raise exception 'save fact first' using errcode='42501'; end if;
  return jsonb_build_object('status','accepted','command_id',found_id);
end; $$;
revoke all on function public.accept_workout_command(text,text,jsonb,integer,timestamptz,timestamptz,text) from public,anon;
grant execute on function public.accept_workout_command(text,text,jsonb,integer,timestamptz,timestamptz,text) to authenticated;
create or replace function public.accept_workout_timer_command(p_command_key text,p_entity_id text,p_payload jsonb,p_source_version integer,p_action text,p_due_at timestamptz default null,p_expires_at timestamptz default null,p_message text default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare found_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode='42501'; end if;
  select id into found_id from public.commands where user_id=auth.uid() and command_key=p_command_key and entity_id=p_entity_id and version=p_source_version and command_type='workout.timer.' || p_action;
  if found_id is null then raise exception 'save timer first' using errcode='42501'; end if;
  return jsonb_build_object('status','accepted','command_id',found_id);
end; $$;
revoke all on function public.accept_workout_timer_command(text,text,jsonb,integer,text,timestamptz,timestamptz,text) from public,anon;
grant execute on function public.accept_workout_timer_command(text,text,jsonb,integer,text,timestamptz,timestamptz,text) to authenticated;

create table public.habit_plan_coverage(user_id uuid primary key references auth.users(id) on delete cascade, planned_date date not null);
alter table public.habit_plan_coverage enable row level security;
revoke all on public.habit_plan_coverage from public,anon,authenticated;

create function public.plan_habit_notifications(p_user_id uuid, p_payload jsonb) returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
declare habit jsonb; day date; due timestamptz; parent_completion jsonb; source text; version_id integer; planned jsonb := '[]';
begin
  for habit in select value from jsonb_array_elements(coalesce(p_payload->'habits','[]')) limit 100 loop
    if habit->>'reminderEnabled' is distinct from 'true' or habit->>'archived' = 'true' or habit->>'type'='workout' then continue; end if;
    for day in select ((now() at time zone 'Europe/Moscow')::date + i) from generate_series(0,7) i loop
      if jsonb_array_length(coalesce(habit->'daysOfWeek','[]')) > 0 and not (habit->'daysOfWeek' @> jsonb_build_array(extract(dow from day)::integer)) then continue; end if;
      if exists(select 1 from jsonb_array_elements(coalesce(p_payload->'completions','[]')) c where c->>'habitId'=habit->>'id' and c->>'localDate'=day::text) then continue; end if;
      due := null;
      if nullif(habit->>'afterHabitId','') is not null then
        select c into parent_completion from jsonb_array_elements(coalesce(p_payload->'completions','[]')) c
          where c->>'habitId'=habit->>'afterHabitId' and c->>'localDate'=day::text and coalesce(c->>'outcome','completed')='completed' limit 1;
        if parent_completion is not null then due := (parent_completion->>'completedAt')::timestamptz + make_interval(mins => least(1440,greatest(0,coalesce((habit->>'delayMinutes')::integer,0)))); end if;
      elsif habit->>'time' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
        due := (day::text || ' ' || (habit->>'time'))::timestamp at time zone 'Europe/Moscow';
      end if;
      if due is null or due <= now() - interval '30 seconds' then continue; end if;
      source := 'habit:' || (habit->>'id') || ':' || day;
      version_id := ((hashtextextended(source || due::text || habit::text,0) & 2147483646) + 1)::integer;
      planned := planned || jsonb_build_array(jsonb_build_object('source',source,'version',version_id));
      insert into public.notification_jobs(user_id,source_entity_id,source_version,due_at,expires_at,message)
        values(p_user_id,source,version_id,due,due + interval '1 hour','Ритм: ' || left(habit->>'title',200))
        on conflict (user_id,source_entity_id,source_version) do nothing;
    end loop;
  end loop;
  update public.notification_jobs j set status='cancelled',lease_until=null,lease_token=null,last_error='plan changed'
    where j.user_id=p_user_id and j.source_entity_id like 'habit:%' and j.status in ('pending','leased','failed','unknown')
      and not exists(select 1 from jsonb_array_elements(planned) p where p->>'source'=j.source_entity_id and (p->>'version')::integer=j.source_version);
  insert into public.habit_plan_coverage(user_id,planned_date) values(p_user_id,(now() at time zone 'Europe/Moscow')::date)
    on conflict(user_id) do update set planned_date=excluded.planned_date;
end; $$;
revoke all on function public.plan_habit_notifications(uuid,jsonb) from public,anon,authenticated;

create function public.refresh_habit_notifications() returns integer
language plpgsql security definer set search_path = pg_catalog, public as $$
declare row_data record; count_now integer := 0;
begin
  for row_data in select s.user_id,s.payload from public.tracker_state s
    join public.telegram_links l on l.user_id=s.user_id and l.confirmed_at is not null and l.revoked_at is null
    left join public.habit_plan_coverage c on c.user_id=s.user_id
    where c.planned_date is null or c.planned_date < (now() at time zone 'Europe/Moscow')::date
    limit 20 for update of s skip locked
  loop
    perform public.plan_habit_notifications(row_data.user_id,row_data.payload); count_now := count_now + 1;
  end loop;
  return count_now;
end; $$;
revoke all on function public.refresh_habit_notifications() from public,anon,authenticated;
grant execute on function public.refresh_habit_notifications() to service_role;

create function public.tracker_habit_plan_trigger() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin perform public.plan_habit_notifications(new.user_id,new.payload); return new; end; $$;
revoke all on function public.tracker_habit_plan_trigger() from public,anon,authenticated;
create trigger ritm_plan_habits after insert or update of payload on public.tracker_state for each row execute function public.tracker_habit_plan_trigger();

create function public.accept_telegram_habit_command(p_telegram_user_id bigint,p_command_key text,p_job_id uuid,p_source_version integer,p_action text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare linked_user uuid; job public.notification_jobs; snapshot jsonb; habit_id text; local_date text; completion jsonb; command_id uuid;
begin
  if p_action not in ('done','skip') then raise exception 'invalid action' using errcode='22023'; end if;
  select user_id into linked_user from public.telegram_links where telegram_user_id=p_telegram_user_id and confirmed_at is not null and revoked_at is null;
  if linked_user is null then return jsonb_build_object('status','unlinked'); end if;
  select payload into snapshot from public.tracker_state where user_id=linked_user for update;
  select * into job from public.notification_jobs where id=p_job_id and user_id=linked_user and source_version=p_source_version for update;
  if job.id is null or job.source_entity_id not like 'habit:%' or job.status='cancelled' or job.expires_at <= now() then return jsonb_build_object('status','stale'); end if;
  if exists(select 1 from public.notification_jobs where user_id=linked_user and source_entity_id=job.source_entity_id and id<>job.id and status<>'cancelled') then return jsonb_build_object('status','stale'); end if;
  insert into public.commands(user_id,command_key,command_type,entity_id,payload,version) values(linked_user,p_command_key,'habit.' || p_action,job.source_entity_id,jsonb_build_object('source','telegram'),p_source_version)
    on conflict(user_id,command_key) do nothing returning id into command_id;
  if command_id is null then return jsonb_build_object('status','duplicate'); end if;
  local_date := right(job.source_entity_id,10);
  habit_id := substring(job.source_entity_id from 7 for length(job.source_entity_id)-17);
  completion := jsonb_build_object('id','completion-' || habit_id || '-' || local_date,'habitId',habit_id,'localDate',local_date,'completedAt',now(),'source','telegram','outcome',case when p_action='done' then 'completed' else 'skipped' end);
  snapshot := jsonb_set(snapshot,'{completions}',coalesce((select jsonb_agg(c) from jsonb_array_elements(snapshot->'completions') c where not(c->>'habitId'=habit_id and c->>'localDate'=local_date)),'[]') || jsonb_build_array(completion));
  update public.tracker_state set payload=snapshot,version=version+1,updated_at=now() where user_id=linked_user;
  return jsonb_build_object('status','applied');
end; $$;
revoke all on function public.accept_telegram_habit_command(bigint,text,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.accept_telegram_habit_command(bigint,text,uuid,integer,text) to service_role;
