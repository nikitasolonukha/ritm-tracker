alter table public.workout_sessions add constraint workout_sessions_id_user_key unique (id, user_id);

alter table public.workout_sets
  add constraint workout_sets_session_owner_fk
  foreign key (session_id, user_id)
  references public.workout_sessions (id, user_id)
  on delete cascade;

revoke insert, update, delete on public.commands, public.notification_jobs, public.telegram_links from authenticated;
revoke insert, update, delete on public.workout_sets from authenticated;
grant select on public.workout_sets to authenticated;

drop policy if exists "owner can manage commands" on public.commands;
drop policy if exists "owner can manage notification jobs" on public.notification_jobs;
drop policy if exists "owner can manage telegram links" on public.telegram_links;

create policy "owner can read commands" on public.commands for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "owner can read notification jobs" on public.notification_jobs for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "owner can read telegram links" on public.telegram_links for select to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.complete_workout_set(
  p_command_key text,
  p_session_id uuid,
  p_set_id uuid,
  p_source_version integer default 1
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_user_id uuid := (select auth.uid());
  command_id uuid;
begin
  if current_user_id is null then raise exception 'not authenticated' using errcode = '42501'; end if;

  insert into public.commands(user_id, command_key, command_type, entity_id, payload, version)
    values (current_user_id, p_command_key, 'workout.set.completed', p_set_id::text,
      jsonb_build_object('session_id', p_session_id, 'set_id', p_set_id), p_source_version)
    on conflict (user_id, command_key) do nothing
    returning id into command_id;

  if command_id is null then
    select id into command_id from public.commands where user_id = current_user_id and command_key = p_command_key;
    return jsonb_build_object('status', 'duplicate', 'command_id', command_id);
  end if;

  update public.workout_sets
    set completed_at = coalesce(completed_at, now())
    where id = p_set_id and session_id = p_session_id and user_id = current_user_id;
  if not found then
    delete from public.commands where id = command_id;
    raise exception 'set does not belong to owner session' using errcode = 'P0002';
  end if;

  return jsonb_build_object('status', 'applied', 'command_id', command_id);
end;
$$;

revoke all on function public.complete_workout_set(text, uuid, uuid, integer) from public, anon;
grant execute on function public.complete_workout_set(text, uuid, uuid, integer) to authenticated;
