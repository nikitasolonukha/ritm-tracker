create or replace function public.accept_telegram_timer_command(
  p_telegram_user_id bigint, p_command_key text, p_entity_id text, p_payload jsonb, p_source_version integer, p_action text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  linked_user uuid;
  snapshot jsonb;
  timer jsonb;
  source_job public.notification_jobs;
  saved_command public.commands;
  command_id uuid;
  job_id uuid;
  next_version integer;
  due timestamptz;
begin
  if p_telegram_user_id is null or p_telegram_user_id <= 0 or p_command_key is null or length(p_command_key) not between 1 and 1000
    or p_entity_id is null or length(p_entity_id) not between 1 and 1000 or jsonb_typeof(p_payload) is distinct from 'object'
    or p_source_version is null or p_source_version not between 1 and 2147483646 or p_action is null or p_action not in ('cancel','reschedule')
  then raise exception 'invalid timer command' using errcode = '22023'; end if;
  select user_id into linked_user from public.telegram_links
    where telegram_user_id = p_telegram_user_id and confirmed_at is not null and revoked_at is null;
  if linked_user is null then return jsonb_build_object('status','unlinked'); end if;
  select payload into snapshot from public.tracker_state where user_id = linked_user for update;
  select * into saved_command from public.commands where user_id = linked_user and command_key = p_command_key;
  if saved_command.id is not null then
    if saved_command.entity_id <> p_entity_id or saved_command.command_type <> 'workout.timer.' || p_action
      then raise exception 'command collision' using errcode = '22023'; end if;
    return jsonb_build_object('status','duplicate','command_id',saved_command.id,'version',saved_command.version);
  end if;
  timer := snapshot->'activeTimer';
  if snapshot is null or timer->>'sourceId' is distinct from p_entity_id or timer->>'status' = 'cancelled'
    or coalesce((timer->>'version')::integer,0) <> p_source_version then return jsonb_build_object('status','stale'); end if;
  select * into source_job from public.notification_jobs
    where user_id = linked_user and source_entity_id = p_entity_id and source_version = p_source_version for update;
  if source_job.id is null or source_job.status = 'cancelled' or source_job.expires_at <= now()
    then return jsonb_build_object('status','stale'); end if;
  next_version := p_source_version + 1;
  insert into public.commands(user_id,command_key,command_type,entity_id,payload,version)
    values(linked_user,p_command_key,'workout.timer.' || p_action,p_entity_id,p_payload,next_version)
    returning id into command_id;
  update public.notification_jobs set status = 'cancelled',lease_until = null,lease_token = null,last_error = 'superseded'
    where user_id = linked_user and source_entity_id = p_entity_id and status in ('pending','leased','failed','unknown');
  if p_action = 'reschedule' then
    due := now() + interval '30 seconds';
    timer := timer || jsonb_build_object('startedAt',now(),'endsAt',due,'durationSec',30,'version',next_version,'status','running');
    insert into public.notification_jobs(user_id,source_entity_id,source_version,due_at,expires_at,message)
      values(linked_user,p_entity_id,next_version,due,due + interval '2 minutes','Ритм: отдых продлён на 30 секунд.')
      returning id into job_id;
    snapshot := jsonb_set(snapshot,'{activeTimer}',timer);
  else snapshot := jsonb_set(snapshot,'{activeTimer}','null'); end if;
  update public.tracker_state set payload = snapshot,version = version + 1,updated_at = now() where user_id = linked_user;
  return jsonb_build_object('status','applied','command_id',command_id,'job_id',job_id,'version',next_version);
end; $$;
revoke all on function public.accept_telegram_timer_command(bigint,text,text,jsonb,integer,text) from public,anon,authenticated;
grant execute on function public.accept_telegram_timer_command(bigint,text,text,jsonb,integer,text) to service_role;
