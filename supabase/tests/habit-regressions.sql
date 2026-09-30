\set ON_ERROR_STOP on
begin;

create function pg_temp.assert_true(value boolean, label text) returns void language plpgsql as $$
begin
  if value is distinct from true then raise exception 'FAILED: %',label; end if;
  raise notice 'PASS: %',label;
end; $$;

-- All deadlines are relative to this transaction's real now(); no clock replacement is needed.
create function pg_temp.snooze_snapshot(p_id text, p_due timestamptz, p_date text) returns jsonb language sql as $$
  select jsonb_build_object('version',1,
    'habits',jsonb_build_array(jsonb_build_object('id',p_id,'title','Habit fixture','type','habit','schedule','',
      'reminderEnabled',true,'daysOfWeek',jsonb_build_array(extract(dow from p_date::date)::integer))),
    'habitSnoozes',jsonb_build_array(jsonb_build_object('id','snooze-' || p_id || '-' || p_date,
      'habitId',p_id,'localDate',p_date,'dueAt',p_due,'count',1)),
    'completions','[]'::jsonb,'workouts','[]'::jsonb,'outbox','[]'::jsonb,'observations','[]'::jsonb,'activeTimer',null);
$$;
grant execute on function pg_temp.assert_true(boolean,text), pg_temp.snooze_snapshot(text,timestamptz,text) to service_role;

insert into auth.users(id,email) values
  ('d3000000-0000-4000-8000-000000000001','habit-regression-a@example.test'),
  ('e3000000-0000-4000-8000-000000000002','habit-regression-b@example.test');
insert into public.tracker_state(user_id,payload) values
  ('d3000000-0000-4000-8000-000000000001','{"version":1,"habits":[],"completions":[],"workouts":[],"outbox":[]}'),
  ('e3000000-0000-4000-8000-000000000002','{"version":1,"habits":[],"completions":[],"workouts":[],"outbox":[]}');
insert into public.telegram_links(user_id,token_hash,expires_at,token_expires_at,telegram_user_id,confirmed_at,connected_at)
  values('e3000000-0000-4000-8000-000000000002',repeat('d',64),now() + interval '1 hour',
    now() + interval '1 hour',2233445501,now(),now());

do $$
declare
  fixture_user uuid := 'd3000000-0000-4000-8000-000000000001';
  day_text text := (now() at time zone 'Europe/Moscow')::date::text;
  snapshot jsonb := pg_temp.snooze_snapshot('revive',now() + interval '5 minutes',day_text);
  original public.notification_jobs;
  restored public.notification_jobs;
begin
  update public.tracker_state set payload = snapshot where user_id = fixture_user;
  select * into original from public.notification_jobs where user_id = fixture_user and source_entity_id = 'habit:revive:' || day_text;
  perform pg_temp.assert_true(original.id is not null and original.status = 'pending','future reminder planned');
  update public.tracker_state set payload = jsonb_set(snapshot,'{habits,0,reminderEnabled}','false') where user_id = fixture_user;
  perform pg_temp.assert_true((select status = 'cancelled' and last_error = 'plan changed'
    from public.notification_jobs where id = original.id),'disabled reminder cancelled for plan change');
  update public.notification_jobs set lease_until = now() + interval '1 minute',lease_token = gen_random_uuid(),
    next_attempt_at = now() + interval '1 minute' where id = original.id;
  update public.tracker_state set payload = snapshot where user_id = fixture_user;
  select * into restored from public.notification_jobs where id = original.id;
  perform pg_temp.assert_true(restored.status = 'pending' and restored.source_version = original.source_version
    and restored.due_at = original.due_at and restored.expires_at = original.expires_at and restored.attempts = 0
    and restored.lease_until is null and restored.lease_token is null and restored.next_attempt_at is null
    and restored.last_error is null,'reenable revives the same safe job and clears transport fields');
  update public.tracker_state set payload = snapshot where user_id = fixture_user;
  perform pg_temp.assert_true((select count(*) = 1 from public.notification_jobs
    where user_id = fixture_user and source_entity_id = original.source_entity_id),'identical replanning creates no duplicate');

  update public.tracker_state set payload = jsonb_set(snapshot,'{completions}',jsonb_build_array(
    jsonb_build_object('id','completion-revive','habitId','revive','localDate',day_text,'completedAt',now(),'outcome','completed')))
    where user_id = fixture_user;
  perform pg_temp.assert_true((select status = 'cancelled' and last_error = 'completion'
    from public.notification_jobs where id = original.id),'completion cancels undelivered job');
  update public.tracker_state set payload = snapshot where user_id = fixture_user;
  perform pg_temp.assert_true((select status = 'pending' and due_at = original.due_at and expires_at = original.expires_at
    from public.notification_jobs where id = original.id),'undo completion revives the same unattempted job');
end; $$;

do $$
declare
  fixture_user uuid := 'd3000000-0000-4000-8000-000000000001';
  day_text text := (now() at time zone 'Europe/Moscow')::date::text;
  snapshot jsonb := pg_temp.snooze_snapshot('no-replay',now() + interval '5 minutes',day_text);
  job_id uuid;
  reason text;
begin
  update public.tracker_state set payload = snapshot where user_id = fixture_user;
  select id into job_id from public.notification_jobs where user_id = fixture_user and source_entity_id = 'habit:no-replay:' || day_text;
  update public.notification_jobs set status = 'sent',attempts = 1 where id = job_id;
  update public.tracker_state set payload = jsonb_set(snapshot,'{habits,0,reminderEnabled}','false') where user_id = fixture_user;
  update public.tracker_state set payload = snapshot where user_id = fixture_user;
  perform pg_temp.assert_true((select status = 'sent' and attempts = 1 from public.notification_jobs where id = job_id),
    'reenable never requeues sent delivery');

  update public.notification_jobs set status = 'unknown',attempts = 1,last_error = 'timeout' where id = job_id;
  update public.tracker_state set payload = snapshot where user_id = fixture_user;
  perform pg_temp.assert_true((select status = 'unknown' and attempts = 1 and last_error = 'timeout'
    from public.notification_jobs where id = job_id),'unchanged plan preserves unknown delivery');
  update public.tracker_state set payload = jsonb_set(snapshot,'{habits,0,reminderEnabled}','false') where user_id = fixture_user;
  update public.tracker_state set payload = snapshot where user_id = fixture_user;
  perform pg_temp.assert_true((select status = 'cancelled' and last_error = 'delivery uncertain' and attempts = 1
    from public.notification_jobs where id = job_id),'unknown disable reenabling cannot replay delivery');

  update public.notification_jobs set status = 'leased',attempts = 1,lease_token = gen_random_uuid(),
    lease_until = now() + interval '45 seconds' where id = job_id;
  update public.tracker_state set payload = jsonb_set(snapshot,'{habits,0,reminderEnabled}','false') where user_id = fixture_user;
  update public.tracker_state set payload = snapshot where user_id = fixture_user;
  perform pg_temp.assert_true((select status = 'cancelled' and last_error = 'delivery uncertain' and lease_token is null
    from public.notification_jobs where id = job_id),'cancelled in-flight delivery is not revived');

  foreach reason in array array['telegram_http_403','expired','other',null] loop
    update public.notification_jobs set status = 'cancelled',attempts = 0,last_error = reason where id = job_id;
    update public.tracker_state set payload = snapshot where user_id = fixture_user;
    perform pg_temp.assert_true((select status = 'cancelled' and last_error is not distinct from reason
      from public.notification_jobs where id = job_id),'unsafe cancellation remains cancelled: ' || coalesce(reason,'null'));
  end loop;
  update public.notification_jobs set status = 'cancelled',attempts = 1,last_error = 'plan changed' where id = job_id;
  update public.tracker_state set payload = snapshot where user_id = fixture_user;
  perform pg_temp.assert_true((select status = 'cancelled' from public.notification_jobs where id = job_id),
    'legacy cancelled attempted delivery is not revived');
  update public.notification_jobs set status = 'cancelled',attempts = 0,last_error = 'plan changed',expires_at = now() where id = job_id;
  update public.tracker_state set payload = snapshot where user_id = fixture_user;
  perform pg_temp.assert_true((select status = 'cancelled' and expires_at = now() from public.notification_jobs where id = job_id),
    'expired cancelled delivery is not revived or extended');
end; $$;

do $$
declare
  fixture_user uuid := 'd3000000-0000-4000-8000-000000000001';
  day_text text := (now() at time zone 'Europe/Moscow')::date::text;
  snapshot jsonb := pg_temp.snooze_snapshot('overdue-snooze',now() - interval '5 seconds',day_text);
  original public.notification_jobs;
  replayed public.notification_jobs;
begin
  update public.tracker_state set payload = snapshot where user_id = fixture_user;
  select * into original from public.notification_jobs where user_id = fixture_user and source_entity_id = 'habit:overdue-snooze:' || day_text;
  perform pg_temp.assert_true(original.id is not null and original.due_at = now() - interval '5 seconds'
    and original.expires_at = now() + interval '59 minutes 55 seconds','due snooze remains valid for its full delivery hour');
  update public.notification_jobs set status = 'failed',attempts = 1,last_error = 'retryable',next_attempt_at = now() + interval '10 seconds'
    where id = original.id;
  update public.tracker_state set payload = jsonb_set(snapshot,'{observations}',jsonb_build_array(jsonb_build_object('id','unrelated')))
    where user_id = fixture_user;
  select * into replayed from public.notification_jobs where id = original.id;
  perform pg_temp.assert_true(replayed.status = 'failed' and replayed.attempts = 1 and replayed.last_error = 'retryable'
    and replayed.next_attempt_at = now() + interval '10 seconds' and replayed.due_at = original.due_at
    and replayed.expires_at = original.expires_at,'unrelated save preserves overdue snooze and retry state');

  snapshot := pg_temp.snooze_snapshot('expiry-boundary',now() - interval '1 hour',day_text);
  update public.tracker_state set payload = snapshot where user_id = fixture_user;
  perform pg_temp.assert_true((select count(*) = 0 from public.notification_jobs where user_id = fixture_user
    and source_entity_id = 'habit:expiry-boundary:' || day_text),'snooze expiring exactly now is not queued');
  snapshot := pg_temp.snooze_snapshot('expired-snooze',now() - interval '1 hour 1 second',day_text);
  update public.tracker_state set payload = snapshot where user_id = fixture_user;
  perform pg_temp.assert_true((select count(*) = 0 from public.notification_jobs where user_id = fixture_user
    and source_entity_id = 'habit:expired-snooze:' || day_text),'expired snooze is not queued');
end; $$;

do $$
declare
  fixture_user uuid := 'd3000000-0000-4000-8000-000000000001';
  day_text text := (now() at time zone 'Europe/Moscow')::date::text;
  yesterday text := ((now() at time zone 'Europe/Moscow')::date - 1)::text;
  snapshot jsonb;
  original public.notification_jobs;
begin
  snapshot := jsonb_build_object('version',1,'habits',jsonb_build_array(jsonb_build_object('id','overdue-dependent',
    'title','Dependent fixture','type','habit','schedule','','reminderEnabled',true,'afterHabitId','anchor','delayMinutes',0)),
    'completions',jsonb_build_array(jsonb_build_object('id','anchor-today','habitId','anchor','localDate',day_text,
      'completedAt',now() - interval '31 seconds','outcome','completed')),'workouts','[]'::jsonb,'outbox','[]'::jsonb);
  update public.tracker_state set payload = snapshot where user_id = fixture_user;
  select * into original from public.notification_jobs where user_id = fixture_user and source_entity_id = 'habit:overdue-dependent:' || day_text;
  perform pg_temp.assert_true(original.id is not null and original.status = 'pending' and original.due_at = now() - interval '31 seconds',
    'ordinary dependent reminder survives the old thirty-second cutoff');
  update public.tracker_state set payload = snapshot where user_id = fixture_user;
  perform pg_temp.assert_true((select status = 'pending' and expires_at = original.expires_at
    from public.notification_jobs where id = original.id),'ordinary due reminder remains pending without extending expiry');

  snapshot := jsonb_set(snapshot,'{habits,0,id}','"yesterday-dependent"');
  snapshot := jsonb_set(snapshot,'{habits,0,delayMinutes}','15');
  snapshot := jsonb_set(snapshot,'{habits,0,daysOfWeek}',jsonb_build_array(extract(dow from yesterday::date)::integer));
  snapshot := jsonb_set(snapshot,'{completions,0,localDate}',to_jsonb(yesterday));
  snapshot := jsonb_set(snapshot,'{completions,0,completedAt}',to_jsonb(now() - interval '10 minutes'));
  update public.tracker_state set payload = snapshot where user_id = fixture_user;
  select * into original from public.notification_jobs where user_id = fixture_user and source_entity_id = 'habit:yesterday-dependent:' || yesterday;
  perform pg_temp.assert_true(original.id is not null and original.due_at = now() + interval '5 minutes'
    and original.status = 'pending','yesterday dependent reminder retains its source date with a future deadline');
  update public.tracker_state set payload = jsonb_set(snapshot,'{completions,0,outcome}','"skipped"') where user_id = fixture_user;
  perform pg_temp.assert_true((select status = 'cancelled' from public.notification_jobs where id = original.id),
    'skipped parent suppresses yesterday dependent reminder');
  update public.tracker_state set payload = jsonb_set(snapshot,'{completions,0,localDate}',to_jsonb(day_text)) where user_id = fixture_user;
  perform pg_temp.assert_true((select status = 'cancelled' from public.notification_jobs where id = original.id),
    'today parent cannot substitute for yesterday parent');
  update public.tracker_state set payload = snapshot where user_id = fixture_user;
  perform pg_temp.assert_true((select status = 'pending' from public.notification_jobs where id = original.id),
    'restored yesterday parent safely restores its dependent job');
end; $$;

do $$
declare
  fixture_user uuid := 'e3000000-0000-4000-8000-000000000002';
  yesterday text := ((now() at time zone 'Europe/Moscow')::date - 1)::text;
  snapshot jsonb := pg_temp.snooze_snapshot('yesterday-snooze',now() + interval '5 minutes',yesterday);
  original public.notification_jobs;
begin
  update public.tracker_state set payload = snapshot where user_id = fixture_user;
  select * into original from public.notification_jobs where user_id = fixture_user and source_entity_id = 'habit:yesterday-snooze:' || yesterday;
  perform pg_temp.assert_true(original.id is not null and original.due_at = now() + interval '5 minutes'
    and original.status = 'pending','future snooze on yesterday-only weekday is queued');
  update public.tracker_state set payload = snapshot where user_id = fixture_user;
  update public.habit_plan_coverage set planned_date = yesterday::date where user_id = fixture_user;
  perform public.refresh_habit_notifications();
  perform pg_temp.assert_true((select status = 'pending' and due_at = original.due_at and expires_at = original.expires_at
    from public.notification_jobs where id = original.id),'daily refresh retains yesterday future snooze');
  perform pg_temp.assert_true((select count(*) = 1 from public.notification_jobs where user_id = fixture_user
    and source_entity_id like 'habit:yesterday-snooze:%'),'yesterday snooze has no replacement on a different date');
  update public.tracker_state set payload = jsonb_set(snapshot,'{habits,0,archived}','true') where user_id = fixture_user;
  perform pg_temp.assert_true((select status = 'cancelled' from public.notification_jobs where id = original.id),
    'archived habit suppresses yesterday snooze');
  update public.tracker_state set payload = snapshot where user_id = fixture_user;
  update public.tracker_state set payload = jsonb_set(snapshot,'{completions}',jsonb_build_array(jsonb_build_object(
    'id','yesterday-completed','habitId','yesterday-snooze','localDate',yesterday,'completedAt',now(),'outcome','completed')))
    where user_id = fixture_user;
  perform pg_temp.assert_true((select status = 'cancelled' and last_error = 'completion' from public.notification_jobs where id = original.id),
    'completed yesterday habit suppresses its future snooze');
end; $$;

set local role service_role;
do $$
declare
  fixture_user uuid := 'e3000000-0000-4000-8000-000000000002';
  day_text text := (now() at time zone 'Europe/Moscow')::date::text;
  snapshot jsonb := pg_temp.snooze_snapshot('sent-repeat',now() - interval '5 seconds',day_text);
  parent_job public.notification_jobs;
  dependent_job public.notification_jobs;
  original_snapshot jsonb;
  original_revision integer;
  original_updated_at timestamptz;
  result jsonb;
begin
  snapshot := jsonb_set(snapshot,'{habits}',snapshot->'habits' || jsonb_build_array(jsonb_build_object('id','repeat-dependent',
    'title','Repeat dependent','type','habit','schedule','','reminderEnabled',true,'afterHabitId','sent-repeat','delayMinutes',10)));
  update public.tracker_state set payload = snapshot where user_id = fixture_user;
  select * into parent_job from public.notification_jobs where user_id = fixture_user and source_entity_id = 'habit:sent-repeat:' || day_text;
  update public.notification_jobs set status = 'sent',attempts = 1 where id = parent_job.id;
  result := public.accept_telegram_habit_command(2233445501,'repeat-first',parent_job.id,parent_job.source_version,'done');
  perform pg_temp.assert_true(result->>'status' = 'applied','sent notification initially applies done');

  -- Seed an earlier committed event; consecutive now() calls within this transaction would hide the regression.
  update public.tracker_state set payload = jsonb_set(payload,'{completions,0,completedAt}',to_jsonb(now() - interval '2 minutes')),
    updated_at = now() - interval '2 minutes' where user_id = fixture_user;
  select payload,version,updated_at into original_snapshot,original_revision,original_updated_at
    from public.tracker_state where user_id = fixture_user;
  select * into dependent_job from public.notification_jobs where user_id = fixture_user
    and source_entity_id = 'habit:repeat-dependent:' || day_text and status = 'pending';
  perform pg_temp.assert_true(dependent_job.id is not null and dependent_job.due_at = now() + interval '8 minutes',
    'dependent reminder reflects the earlier durable completion');
  result := public.accept_telegram_habit_command(2233445501,'repeat-new-key',parent_job.id,parent_job.source_version,'done');
  perform pg_temp.assert_true(result->>'status' = 'duplicate','same done with a new command key is duplicate');
  perform pg_temp.assert_true((select payload = original_snapshot and version = original_revision and updated_at = original_updated_at
    from public.tracker_state where user_id = fixture_user),'duplicate preserves snapshot completion time and revision');
  perform pg_temp.assert_true((select source_version = dependent_job.source_version and due_at = dependent_job.due_at
    and expires_at = dependent_job.expires_at and status = dependent_job.status from public.notification_jobs where id = dependent_job.id)
    and (select count(*) = 1 from public.notification_jobs where user_id = fixture_user
      and source_entity_id = dependent_job.source_entity_id and status = 'pending'),'duplicate preserves the exact dependent reminder');
  perform pg_temp.assert_true((select c.result = 'duplicate' from public.commands c where user_id = fixture_user and command_key = 'repeat-new-key'),
    'duplicate outcome is durably keyed for retries');
  result := public.accept_telegram_habit_command(2233445501,'repeat-new-key',parent_job.id,parent_job.source_version,'done');
  perform pg_temp.assert_true(result->>'status' = 'duplicate','same duplicate command key is idempotent');
  result := public.accept_telegram_habit_command(2233445501,'later-completed',parent_job.id,parent_job.source_version,'later');
  perform pg_temp.assert_true(result->>'status' = 'stale','completed habit cannot be snoozed');

  update public.tracker_state set payload = jsonb_set(payload,'{completions,0}',(payload->'completions'->0) - 'outcome') where user_id = fixture_user;
  select payload,version into original_snapshot,original_revision from public.tracker_state where user_id = fixture_user;
  result := public.accept_telegram_habit_command(2233445501,'repeat-legacy',parent_job.id,parent_job.source_version,'done');
  perform pg_temp.assert_true(result->>'status' = 'duplicate' and (select payload = original_snapshot and version = original_revision
    from public.tracker_state where user_id = fixture_user),'legacy completion without outcome is also duplicate');
  result := public.accept_telegram_habit_command(2233445501,'switch-skip',parent_job.id,parent_job.source_version,'skip');
  perform pg_temp.assert_true(result->>'status' = 'applied','different outcome remains an explicit change');
  result := public.accept_telegram_habit_command(2233445501,'repeat-new-key',parent_job.id,parent_job.source_version,'done');
  perform pg_temp.assert_true(result->>'status' = 'duplicate' and (select payload->'completions'->0->>'outcome' = 'skipped'
    from public.tracker_state where user_id = fixture_user),'retrying earlier duplicate cannot undo a later outcome');
end; $$;

do $$
declare
  fixture_user uuid := 'e3000000-0000-4000-8000-000000000002';
  day_text text := (now() at time zone 'Europe/Moscow')::date::text;
  snapshot jsonb := pg_temp.snooze_snapshot('callback-snooze',now() - interval '5 seconds',day_text);
  current_job public.notification_jobs;
  result jsonb;
  prior_snapshot jsonb;
  n integer;
begin
  update public.tracker_state set payload = snapshot where user_id = fixture_user;
  for n in 1..3 loop
    select * into current_job from public.notification_jobs where user_id = fixture_user
      and source_entity_id = 'habit:callback-snooze:' || day_text and status = 'pending';
    update public.notification_jobs set status = 'sent',attempts = 1 where id = current_job.id;
    result := public.accept_telegram_habit_command(2233445501,'snooze-' || n,current_job.id,current_job.source_version,'later');
    if n < 3 then
      perform pg_temp.assert_true(result->>'status' = 'applied','snooze callback remains available: ' || n);
      perform pg_temp.assert_true((select (payload->'habitSnoozes'->0->>'count')::integer = n + 1
        and (payload->'habitSnoozes'->0->>'dueAt')::timestamptz = now() + interval '10 minutes'
        from public.tracker_state where user_id = fixture_user),'callback saves ten-minute snooze and count: ' || n);
      result := public.accept_telegram_habit_command(2233445501,'snooze-' || n,current_job.id,current_job.source_version,'later');
      perform pg_temp.assert_true(result->>'status' = 'duplicate','snooze retry does not increment count: ' || n);
      -- Move only fixture deadlines so the next already-sent reminder has a distinct planning version.
      update public.tracker_state set payload = jsonb_set(payload,'{habitSnoozes,0,dueAt}',to_jsonb(now() - make_interval(secs => 5 - n)))
        where user_id = fixture_user;
    else
      select payload into prior_snapshot from public.tracker_state where user_id = fixture_user;
      perform pg_temp.assert_true(result->>'status' = 'limited','snooze limit remains enforced');
      result := public.accept_telegram_habit_command(2233445501,'snooze-' || n,current_job.id,current_job.source_version,'later');
      perform pg_temp.assert_true(result->>'status' = 'limited' and (select payload = prior_snapshot from public.tracker_state where user_id = fixture_user),
        'limited snooze retry cannot falsely become applied');
    end if;
  end loop;
end; $$;
reset role;

select pg_temp.assert_true(not has_function_privilege('authenticated','public.plan_habit_notifications(uuid,jsonb)','EXECUTE')
  and not has_function_privilege('anon','public.accept_telegram_habit_command(bigint,text,uuid,integer,text)','EXECUTE')
  and not has_function_privilege('authenticated','public.accept_telegram_habit_command(bigint,text,uuid,integer,text)','EXECUTE'),
  'replacement functions retain service-only permissions');
rollback;
