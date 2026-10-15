-- Reminder planner fixes (not applied automatically; review and run with `supabase db push`).
-- 1. A reminder's version no longer depends on every habit field, so renaming a private note or schedule label
--    within an hour after delivery cannot send the same reminder twice.
-- 2. "+10 minutes" pressed before the planned time no longer replaces that time (09:00 habit snoozed at 07:00
--    used to fire at 07:10 and never at 09:00).
-- One-time effect: jobs planned before this migration get a new version once, so a reminder delivered in the
-- last hour before the migration may be planned again.
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
      -- A snooze only postpones a reminder that already fired: pressing it before the planned time must not replace that time.
      if snooze_due is not null and (due is null or snooze_due > due) then due := snooze_due; end if;
      if due is null or due + interval '1 hour' <= now() then continue; end if;

      source := 'habit:' || (habit->>'id') || ':' || day;
      version_id := ((hashtextextended(source || due::text || coalesce(habit->>'title','') || coalesce(habit->>'afterHabitId',''),0) & 2147483646) + 1)::integer;
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
