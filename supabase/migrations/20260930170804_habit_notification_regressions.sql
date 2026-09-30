create or replace function public.plan_habit_notifications(p_user_id uuid, p_payload jsonb) returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  habit jsonb;
  day date;
  due timestamptz;
  snooze_due timestamptz;
  parent_completion jsonb;
  source text;
  version_id integer;
  planned jsonb := '[]';
begin
  for habit in select value from jsonb_array_elements(coalesce(p_payload->'habits','[]')) limit 100 loop
    if habit->>'reminderEnabled' is distinct from 'true' or habit->>'archived' = 'true' or habit->>'type' = 'workout' then continue; end if;
    -- A 24-hour dependency plus its delivery window can still belong to two days ago.
    for day in select ((now() at time zone 'Europe/Moscow')::date + i) from generate_series(-2,7) i loop
      if jsonb_array_length(coalesce(habit->'daysOfWeek','[]')) > 0
        and not (habit->'daysOfWeek' @> jsonb_build_array(extract(dow from day)::integer)) then continue; end if;
      if exists(select 1 from jsonb_array_elements(coalesce(p_payload->'completions','[]')) c
        where c->>'habitId' = habit->>'id' and c->>'localDate' = day::text) then continue; end if;

      due := null;
      if nullif(habit->>'afterHabitId','') is not null then
        select c into parent_completion from jsonb_array_elements(coalesce(p_payload->'completions','[]')) c
          where c->>'habitId' = habit->>'afterHabitId' and c->>'localDate' = day::text
            and coalesce(c->>'outcome','completed') = 'completed' limit 1;
        if parent_completion is not null then
          due := (parent_completion->>'completedAt')::timestamptz
            + make_interval(mins => least(1440,greatest(0,coalesce((habit->>'delayMinutes')::integer,0))));
        end if;
      elsif habit->>'time' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
        due := (day::text || ' ' || (habit->>'time'))::timestamp at time zone 'Europe/Moscow';
      end if;
      select (s->>'dueAt')::timestamptz into snooze_due
        from jsonb_array_elements(coalesce(p_payload->'habitSnoozes','[]')) s
        where s->>'habitId' = habit->>'id' and s->>'localDate' = day::text
          and (s->>'dueAt')::timestamptz + interval '1 hour' > now() limit 1;
      due := coalesce(snooze_due,due);
      if due is null or due + interval '1 hour' <= now() then continue; end if;

      source := 'habit:' || (habit->>'id') || ':' || day;
      version_id := ((hashtextextended(source || due::text || habit::text,0) & 2147483646) + 1)::integer;
      planned := planned || jsonb_build_array(jsonb_build_object('source',source,'version',version_id));
      insert into public.notification_jobs(user_id,source_entity_id,source_version,due_at,expires_at,message)
        values(p_user_id,source,version_id,due,due + interval '1 hour','Ритм: ' || left(habit->>'title',200))
        on conflict (user_id,source_entity_id,source_version) do update
          set status = 'pending', next_attempt_at = null, lease_until = null, lease_token = null, last_error = null
          -- Attempted deliveries may have succeeded before cancellation, including under the old planner.
          where notification_jobs.status = 'cancelled' and notification_jobs.attempts = 0
            and notification_jobs.last_error in ('plan changed','completion')
            and notification_jobs.expires_at > now();
    end loop;
  end loop;
  update public.notification_jobs j set status = 'cancelled', lease_until = null, lease_token = null,
    last_error = case when j.status in ('leased','unknown') then 'delivery uncertain'
      when exists(select 1 from jsonb_array_elements(coalesce(p_payload->'completions','[]')) c
      where j.source_entity_id = 'habit:' || (c->>'habitId') || ':' || (c->>'localDate'))
      then 'completion' else 'plan changed' end
    where j.user_id = p_user_id and j.source_entity_id like 'habit:%' and j.status in ('pending','leased','failed','unknown')
      and not exists(select 1 from jsonb_array_elements(planned) p
        where p->>'source' = j.source_entity_id and (p->>'version')::integer = j.source_version);
  insert into public.habit_plan_coverage(user_id,planned_date) values(p_user_id,(now() at time zone 'Europe/Moscow')::date)
    on conflict(user_id) do update set planned_date = excluded.planned_date;
end; $$;
revoke all on function public.plan_habit_notifications(uuid,jsonb) from public,anon,authenticated;

create or replace function public.accept_telegram_habit_command(p_telegram_user_id bigint,p_command_key text,p_job_id uuid,p_source_version integer,p_action text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  linked_user uuid;
  job public.notification_jobs;
  snapshot jsonb;
  habit_id text;
  local_date text;
  completion jsonb;
  existing_completion jsonb;
  command_id uuid;
  snooze jsonb;
  snooze_count integer;
  outcome text;
begin
  if p_action is null or p_action not in ('done','skip','later') then raise exception 'invalid action' using errcode = '22023'; end if;
  select user_id into linked_user from public.telegram_links
    where telegram_user_id = p_telegram_user_id and confirmed_at is not null and revoked_at is null;
  if linked_user is null then return jsonb_build_object('status','unlinked'); end if;
  select payload into snapshot from public.tracker_state where user_id = linked_user for update;
  if snapshot is null then return jsonb_build_object('status','stale'); end if;
  select * into job from public.notification_jobs
    where id = p_job_id and user_id = linked_user and source_version = p_source_version for update;
  if job.id is null or job.source_entity_id not like 'habit:%' then return jsonb_build_object('status','stale'); end if;
  if exists(select 1 from public.commands where user_id = linked_user and command_key = p_command_key) then
    return jsonb_build_object('status','duplicate');
  end if;

  local_date := right(job.source_entity_id,10);
  habit_id := substring(job.source_entity_id from 7 for length(job.source_entity_id)-17);
  select c into existing_completion from jsonb_array_elements(coalesce(snapshot->'completions','[]')) c
    where c->>'habitId' = habit_id and c->>'localDate' = local_date limit 1;
  outcome := case when p_action = 'done' then 'completed' when p_action = 'skip' then 'skipped' end;
  if existing_completion is not null and coalesce(existing_completion->>'outcome','completed') = outcome then
    insert into public.commands(user_id,command_key,command_type,entity_id,payload,version,result)
      values(linked_user,p_command_key,'habit.' || p_action,job.source_entity_id,jsonb_build_object('source','telegram'),p_source_version,'duplicate')
      on conflict(user_id,command_key) do nothing;
    return jsonb_build_object('status','duplicate');
  end if;
  if job.status = 'cancelled' or job.expires_at <= now()
    or (p_action = 'later' and existing_completion is not null) then return jsonb_build_object('status','stale'); end if;
  if exists(select 1 from public.notification_jobs where user_id = linked_user and source_entity_id = job.source_entity_id
    and id <> job.id and due_at > job.due_at and status <> 'cancelled') then return jsonb_build_object('status','stale'); end if;
  if p_action = 'later' then
    select s into snooze from jsonb_array_elements(coalesce(snapshot->'habitSnoozes','[]')) s
      where s->>'habitId' = habit_id and s->>'localDate' = local_date limit 1;
    snooze_count := coalesce((snooze->>'count')::integer,0);
    if snooze_count >= 3 then return jsonb_build_object('status','limited'); end if;
  end if;
  insert into public.commands(user_id,command_key,command_type,entity_id,payload,version)
    values(linked_user,p_command_key,'habit.' || p_action,job.source_entity_id,jsonb_build_object('source','telegram'),p_source_version)
    on conflict(user_id,command_key) do nothing returning id into command_id;
  if command_id is null then return jsonb_build_object('status','duplicate'); end if;

  if p_action = 'later' then
    snooze := jsonb_build_object('id','snooze-' || habit_id || '-' || local_date,'habitId',habit_id,'localDate',local_date,
      'dueAt',now() + interval '10 minutes','count',snooze_count + 1);
    snapshot := jsonb_set(snapshot,'{habitSnoozes}',coalesce((select jsonb_agg(s)
      from jsonb_array_elements(coalesce(snapshot->'habitSnoozes','[]')) s
      where not(s->>'habitId' = habit_id and s->>'localDate' = local_date)),'[]') || jsonb_build_array(snooze));
  else
    completion := jsonb_build_object('id','completion-' || habit_id || '-' || local_date,'habitId',habit_id,'localDate',local_date,
      'completedAt',now(),'source','telegram','outcome',outcome);
    snapshot := jsonb_set(snapshot,'{completions}',coalesce((select jsonb_agg(c)
      from jsonb_array_elements(coalesce(snapshot->'completions','[]')) c
      where not(c->>'habitId' = habit_id and c->>'localDate' = local_date)),'[]') || jsonb_build_array(completion));
  end if;
  update public.tracker_state set payload = snapshot, version = version + 1, updated_at = now() where user_id = linked_user;
  return jsonb_build_object('status','applied');
end; $$;
revoke all on function public.accept_telegram_habit_command(bigint,text,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.accept_telegram_habit_command(bigint,text,uuid,integer,text) to service_role;
